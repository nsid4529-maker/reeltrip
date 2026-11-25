"""Private, byte-bounded video staging on the existing persistent volume."""
from __future__ import annotations
from datetime import datetime, timezone
import hashlib
import hmac
import json
from pathlib import Path
import re
import time
import uuid
from .contracts import ProcessingError
from travel_workflow.video_acquisition import AcquisitionError, probe_video, decode_video

MAX_BYTES = 50_000_000
MAX_STORED_BYTES = 200_000_000
OWNER_BYTES = 100_000_000
RETENTION = 7 * 86400
TYPES = {'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm'}

def upload_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', value):
        raise ProcessingError('upload_not_found', 'This uploaded video is unavailable on this browser.')
    return value

def upload_reference(value):
    return '/api/upload?id=' + upload_id(value)

def reference_id(value):
    return upload_id(value[len('/api/upload?id='):]) if isinstance(value, str) and value.startswith('/api/upload?id=') else None

def owner_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{64}', value):
        raise ProcessingError('upload_not_found', 'This uploaded video is unavailable on this browser.')
    return value

def validate_upload(path, mime):
    try:
        # Reject playlists and text before ffprobe can interpret embedded file references.
        with Path(path).open('rb') as handle:
            signature = handle.read(12)
        if mime not in TYPES or (mime == 'video/webm' and not signature.startswith(b'\x1aE\xdf\xa3')) or (mime != 'video/webm' and (len(signature) < 8 or signature[4:8] not in {b'ftyp', b'moov', b'mdat', b'wide', b'free', b'skip'})):
            raise AcquisitionError('Unsupported container signature')
        probe = probe_video(path)
        formats = set(probe.get('container_format', '').split(','))
        if not formats.intersection({'mov', 'mp4'} if mime != 'video/webm' else {'webm', 'matroska'}):
            raise AcquisitionError('Unsupported container')
        if probe['duration_seconds'] > 180:
            raise ProcessingError('video_too_long', 'Choose a video no longer than three minutes.')
        videos = [stream for stream in probe['streams'] if stream.get('codec_type') == 'video']
        if len(videos) != 1:
            raise AcquisitionError('Unsupported video streams')
        width, height = videos[0].get('width'), videos[0].get('height')
        if type(width) is not int or type(height) is not int or not 0 < width <= 4096 or not 0 < height <= 4096 or width * height > 8_847_360:
            raise AcquisitionError('Unsupported dimensions')
        return {**probe, 'validation': decode_video(path, probe['audio_present'])}
    except (AcquisitionError, OSError):
        raise ProcessingError('media_invalid', 'This file is not a supported, playable MP4, MOV or WebM video.') from None

class Uploads:
    def __init__(self, jobs, directory: Path):
        self.jobs, self.directory = jobs, directory
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.last_cleanup = 0
        with jobs.db() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS uploads (
                    id TEXT PRIMARY KEY, owner TEXT NOT NULL, state TEXT NOT NULL,
                    size INTEGER NOT NULL, mime TEXT NOT NULL, title TEXT NOT NULL,
                    created_at REAL NOT NULL, expires_at REAL NOT NULL, metadata TEXT
                );
                CREATE INDEX IF NOT EXISTS uploads_owner ON uploads(owner, expires_at);
                CREATE TABLE IF NOT EXISTS upload_usage(day TEXT NOT NULL, owner TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(day,owner));
            ''')
            # A restart interrupts in-flight uploads; only completed media survives.
            for row in db.execute("SELECT id,mime FROM uploads WHERE state='uploading'").fetchall():
                self.file(row['id'], row['mime']).unlink(missing_ok=True)
            db.execute("DELETE FROM uploads WHERE state='uploading'")
        self.cleanup(force=True)

    def file(self, identity, mime):
        return self.directory / (upload_id(identity) + TYPES[mime])

    def cleanup(self, force=False):
        now = self.jobs.clock()
        if not force and now - self.last_cleanup < 60:
            return
        self.last_cleanup = now
        with self.jobs.db() as db:
            for row in db.execute("SELECT id,mime FROM uploads WHERE expires_at<=? AND state='ready'", (now,)).fetchall():
                self.file(row['id'], row['mime']).unlink(missing_ok=True)
            # Metadata outlives raw video so an owned, recent breakdown stays readable.
            db.execute("DELETE FROM uploads WHERE expires_at<? AND NOT EXISTS (SELECT 1 FROM jobs WHERE source_url='/api/upload?id='||uploads.id AND updated_at>?)", (now - RETENTION, now - RETENTION))
            db.execute('DELETE FROM upload_usage WHERE day<?', (datetime.fromtimestamp(now - RETENTION, timezone.utc).date().isoformat(),))

    def get(self, identity, owner, require_file=False):
        identity, owner = upload_id(identity), owner_id(owner)
        self.cleanup()
        with self.jobs.db() as db:
            row = db.execute("SELECT * FROM uploads WHERE id=? AND state='ready'", (identity,)).fetchone()
        if row is None or not hmac.compare_digest(row['owner'], owner):
            raise ProcessingError('upload_not_found', 'This uploaded video is unavailable on this browser.')
        if require_file and (row['expires_at'] <= self.jobs.clock() or not self.file(identity, row['mime']).is_file()):
            raise ProcessingError('upload_expired', 'The original upload has expired. Your saved breakdown stays in your library; upload the video again to analyse it afresh.')
        return dict(row)

    def receive(self, reader, size, mime, title, owner, *, validator=validate_upload):
        owner = owner_id(owner)
        if type(size) is not int or not 0 < size <= MAX_BYTES:
            raise ProcessingError('upload_too_large', 'Choose a video file up to 50 MB.')
        if mime not in TYPES or not isinstance(title, str) or not 0 < len(title) <= 180 or any(ord(c) < 32 for c in title):
            raise ProcessingError('media_invalid', 'Choose an MP4, MOV or WebM file with a short file name.')
        title = title.replace('\\', '/').rsplit('/', 1)[-1]
        if not title.lower().endswith(TYPES[mime]):
            raise ProcessingError('media_invalid', 'The file extension and video format must agree.')
        self.cleanup(force=True)
        identity, now = str(uuid.uuid4()), self.jobs.clock()
        day = datetime.fromtimestamp(now, timezone.utc).date().isoformat()
        with self.jobs.db() as db:
            db.execute('BEGIN IMMEDIATE')
            total = db.execute('SELECT COALESCE(SUM(size),0) FROM uploads WHERE expires_at>?', (now,)).fetchone()[0]
            own = db.execute('SELECT COUNT(*),COALESCE(SUM(size),0) FROM uploads WHERE owner=? AND expires_at>?', (owner, now)).fetchone()
            if total + size > MAX_STORED_BYTES or own[0] >= 10 or own[1] + size > OWNER_BYTES:
                raise ProcessingError('upload_storage_full', 'Video upload storage is temporarily full. Please try a smaller file or return after older uploads expire.', True)
            used = db.execute('SELECT COALESCE(SUM(count),0) FROM upload_usage WHERE day=?', (day,)).fetchone()[0]
            personal = db.execute('SELECT count FROM upload_usage WHERE day=? AND owner=?', (day, owner)).fetchone()
            if used >= 25 or personal and personal[0] >= 10:
                raise ProcessingError('daily_limit', 'Today’s upload limit has been reached. Please try again tomorrow.', True)
            db.execute('INSERT INTO upload_usage(day,owner,count) VALUES(?,?,1) ON CONFLICT(day,owner) DO UPDATE SET count=count+1', (day, owner))
            db.execute("INSERT INTO uploads VALUES (?,?, 'uploading',?,?,?,?,?,NULL)", (identity, owner, size, mime, title, now, now + RETENTION))
        path, remaining, checksum = self.file(identity, mime), size, hashlib.sha256()
        try:
            deadline = time.monotonic() + 120
            with path.open('xb') as output:
                while remaining:
                    if time.monotonic() > deadline:
                        raise ProcessingError('upload_timeout', 'The upload took too long. Please try again.', True)
                    chunk = reader.read(min(65536, remaining))
                    if not chunk or len(chunk) > remaining:
                        raise ProcessingError('media_invalid', 'The upload was incomplete. Please choose the file again.')
                    output.write(chunk); checksum.update(chunk); remaining -= len(chunk)
            verified = validator(path, mime)
            metadata = {**verified, 'sha256': checksum.hexdigest()}
            with self.jobs.db() as db:
                db.execute("UPDATE uploads SET state='ready', metadata=? WHERE id=?", (json.dumps(metadata), identity))
            return self.present(self.get(identity, owner, True))
        except Exception:
            path.unlink(missing_ok=True)
            with self.jobs.db() as db:
                db.execute('DELETE FROM uploads WHERE id=?', (identity,))
            raise

    def present(self, row):
        metadata = json.loads(row['metadata'])
        return {'id': row['id'], 'title': row['title'], 'size': row['size'], 'mimeType': row['mime'],
                'durationSeconds': metadata['duration_seconds'],
                'addedAt': datetime.fromtimestamp(row['created_at'], timezone.utc).isoformat(),
                'expiresAt': datetime.fromtimestamp(row['expires_at'], timezone.utc).isoformat(),
                'retentionMessage': 'The original video is private to this browser and kept for 7 days. A completed breakdown remains saved in your browser; its private server cache lasts 7 days after analysis.'}

    def record_for_job(self, identity):
        with self.jobs.db() as db:
            row = db.execute('SELECT owner FROM uploads WHERE id=?', (upload_id(identity),)).fetchone()
        if row is None:
            raise ProcessingError('upload_expired', 'This uploaded video has expired. Please upload it again.')
        item = self.get(identity, row['owner'], True)
        return {**json.loads(item['metadata']), 'file': str(self.file(identity, item['mime'])),
                'source_url': upload_reference(identity), 'platform': 'upload', 'upload_id': identity,
                'provider': {}, 'mime_type': item['mime'], 'acquired_at': datetime.fromtimestamp(item['created_at'], timezone.utc).isoformat(),
                'source_association': 'private_user_supplied_video'}
