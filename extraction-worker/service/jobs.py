"""Durable bounded jobs with a hard deadline and restart-safe failure states."""
from __future__ import annotations
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from .contracts import ProcessingError, canonical_url
from . import PIPELINE_VERSION
from .uploads import Uploads, reference_id, upload_reference

STAGES = {'acquiring', 'sampling', 'transcribing', 'analysing'}
DAY = 86400

def error_payload(code, message, retryable=False):
    return {'code': code, 'message': message, 'retryable': retryable}

class Jobs:
    def __init__(self, path: Path, *, daily_limit=25, pending_limit=20, clock=time.time):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.daily_limit = max(1, min(1000, int(daily_limit)))
        self.pending_limit = max(1, min(100, int(pending_limit)))
        self.clock = clock
        self.stop = threading.Event()
        self.threads = []
        with self.db() as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, source_url TEXT NOT NULL, status TEXT NOT NULL,
                    stage TEXT NOT NULL, created_at REAL NOT NULL, updated_at REAL NOT NULL,
                    result TEXT, error TEXT
                );
                CREATE INDEX IF NOT EXISTS jobs_source ON jobs(source_url, created_at);
                CREATE TABLE IF NOT EXISTS daily_usage(day TEXT PRIMARY KEY, count INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS chat_usage(day TEXT PRIMARY KEY, count INTEGER NOT NULL);
            ''')
            now = self.clock()
            error = json.dumps(error_payload('service_restarted', 'Processing was interrupted. Please try this reel again.', True))
            db.execute("UPDATE jobs SET status='failed', stage='failed', error=?, updated_at=? WHERE status IN ('queued','processing')", (error, now))
        self.uploads = Uploads(self, self.path.parent / 'uploads')

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def _present(self, row):
        if row is None:
            raise ProcessingError('not_found', 'That processing job could not be found. Please share the reel again.')
        result = {'id': row['id'], 'status': row['status'], 'stage': row['stage']}
        if reference_id(row['source_url']):
            result['uploadId'] = reference_id(row['source_url'])
        if row['result']:
            result['result'] = json.loads(row['result'])
        if row['error']:
            result['error'] = json.loads(row['error'])
        return result

    def get(self, job_id, upload_owner=None):
        try:
            if str(uuid.UUID(job_id)) != job_id:
                raise ValueError
        except (ValueError, TypeError, AttributeError):
            raise ProcessingError('not_found', 'That processing job could not be found.') from None
        with self.db() as db:
            row = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
        if row and reference_id(row['source_url']):
            self.uploads.get(reference_id(row['source_url']), upload_owner)
            if row['updated_at'] < self.clock() - 7 * DAY:
                raise ProcessingError('upload_expired', 'This private analysis has expired. Your browser’s saved breakdown is unchanged.')
        return self._present(row)

    def submit(self, raw_url):
        return self._submit(canonical_url(raw_url))

    def submit_upload(self, identity, owner):
        self.uploads.get(identity, owner)
        return self._submit(upload_reference(identity), owner)

    def upload_result(self, identity, owner):
        self.uploads.get(identity, owner)
        with self.db() as db:
            row = db.execute("SELECT * FROM jobs WHERE source_url=? AND status='complete' AND updated_at>? AND json_extract(result,'$.pipeline_version')=? ORDER BY updated_at DESC LIMIT 1", (upload_reference(identity), self.clock() - 7 * DAY, PIPELINE_VERSION)).fetchone()
        return self._present(row)

    def _submit(self, url, upload_owner=None):
        now = self.clock()
        identity = reference_id(url)
        day = datetime.fromtimestamp(now, timezone.utc).date().isoformat()
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            # Public source results expire from the cache after one day.
            time_column = 'updated_at' if identity else 'created_at'
            existing = db.execute(f"SELECT * FROM jobs WHERE source_url=? AND {time_column}>? AND (status IN ('queued','processing') OR (status='complete' AND json_extract(result,'$.pipeline_version')=?)) ORDER BY created_at DESC LIMIT 1", (url, now - (7 * DAY if identity else DAY), PIPELINE_VERSION)).fetchone()
            if existing:
                return self._present(existing)
            if identity:
                self.uploads.get(identity, upload_owner, require_file=True)
            pending = db.execute("SELECT COUNT(*) FROM jobs WHERE status IN ('queued','processing')").fetchone()[0]
            if pending >= self.pending_limit:
                raise ProcessingError('queue_full', 'Video analysis is busy. Please try again shortly.', True)
            used = db.execute('SELECT count FROM daily_usage WHERE day=?', (day,)).fetchone()
            if used and used[0] >= self.daily_limit:
                raise ProcessingError('daily_limit', 'Video analysis has reached today’s limit. Please try again tomorrow.', True)
            db.execute('INSERT INTO daily_usage(day,count) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET count=count+1', (day,))
            job_id = str(uuid.uuid4())
            db.execute('INSERT INTO jobs(id,source_url,status,stage,created_at,updated_at) VALUES(?,?,?,?,?,?)', (job_id, url, 'queued', 'queued', now, now))
            db.execute("DELETE FROM jobs WHERE status IN ('complete','failed') AND updated_at<?", (now - 7 * DAY,))
            db.execute('DELETE FROM daily_usage WHERE day<?', (datetime.fromtimestamp(now - 7 * DAY, timezone.utc).date().isoformat(),))
            return {'id': job_id, 'status': 'queued', 'stage': 'queued', **({'uploadId': identity} if identity else {})}

    def reserve_chat(self):
        day = datetime.fromtimestamp(self.clock(), timezone.utc).date().isoformat()
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            used = db.execute('SELECT count FROM chat_usage WHERE day=?', (day,)).fetchone()
            if used and used[0] >= 100:
                raise ProcessingError('daily_limit', 'Bundle chat has reached today’s limit.', True)
            db.execute('INSERT INTO chat_usage(day,count) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET count=count+1', (day,))
            db.execute('DELETE FROM chat_usage WHERE day<?', (day,))

    def claim(self):
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1").fetchone()
            if row:
                db.execute("UPDATE jobs SET status='processing', stage='acquiring', updated_at=? WHERE id=?", (self.clock(), row['id']))
                return dict(row)
        return None

    def finish(self, job_id, body):
        if isinstance(body, dict) and isinstance(body.get("result"), dict):
            body["result"]["pipeline_version"] = PIPELINE_VERSION
        if not isinstance(body, dict) or (('result' in body) == ('error' in body)):
            body = {'error': error_payload('processing_failed', 'We couldn’t finish this video. Please try again.', True)}
        with self.db() as db:
            db.execute('UPDATE jobs SET status=?, stage=?, result=?, error=?, updated_at=? WHERE id=?',
                       ('complete' if 'result' in body else 'failed', 'complete' if 'result' in body else 'failed',
                        json.dumps(body['result']) if 'result' in body else None, json.dumps(body['error']) if 'error' in body else None, self.clock(), job_id))
        result = body.get('result')
        usage = result.get('usage', {}) if isinstance(result, dict) else {}
        timings = usage.get('phase_seconds', {}) if isinstance(usage, dict) else {}
        if isinstance(timings, dict) and timings:
            # Log bounded durations only, never source URLs, evidence or credentials.
            phases = {key: round(value, 3) for key, value in timings.items()
                      if key in {'acquisition', 'sampling', 'transcription', 'preparation', 'analysis'}
                      and type(value) in (int, float) and 0 <= value <= 360}
            print(json.dumps({'event': 'analysis_timing', 'pipeline': PIPELINE_VERSION,
                              'job_id': job_id, 'phase_seconds': phases}), flush=True)

    def set_stage(self, job_id, stage):
        if stage in STAGES:
            with self.db() as db:
                db.execute('UPDATE jobs SET stage=?, updated_at=? WHERE id=? AND status=?', (stage, self.clock(), job_id, 'processing'))

    def start(self, workers=2):
        for i in range(max(1, min(2, workers))):
            thread = threading.Thread(target=self._loop, name=f'media-worker-{i}', daemon=True)
            thread.start()
            self.threads.append(thread)

    def _loop(self):
        while not self.stop.is_set():
            try:
                self.uploads.cleanup()
                row = self.claim()
                if not row:
                    self.stop.wait(0.5)
                    continue
                self.finish(row['id'], self.run_job(row))
            except Exception:
                # Do not log raw exceptions: they can include URLs or credentials.
                self.stop.wait(1)

    def run_job(self, row, *, deadline_seconds=360):
        with tempfile.TemporaryDirectory(prefix='reeltrip-video-') as temporary:
            root = Path(temporary)
            process = None
            try:
                identity = reference_id(row['source_url'])
                if identity:
                    record = self.uploads.record_for_job(identity)
                    video = root / ('video' + Path(record['file']).suffix)
                    shutil.copyfile(record['file'], video)
                    record['file'] = str(video)
                    manifest = root / 'upload.json'; manifest.write_text(json.dumps(record))
                    arguments = ['--upload', str(manifest)]
                else:
                    arguments = ['--url', row['source_url']]
                process = subprocess.Popen([sys.executable, '-m', 'service.pipeline', *arguments, '--workdir', str(root)],
                                           cwd=Path(__file__).resolve().parent.parent, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                           start_new_session=True)
                deadline = time.monotonic() + deadline_seconds
                last_stage = None
                while process.poll() is None:
                    if self.stop.is_set() or time.monotonic() >= deadline:
                        raise TimeoutError
                    stage_path = root / 'stage'
                    if stage_path.exists():
                        stage = stage_path.read_text()[:32]
                        if stage != last_stage:
                            self.set_stage(row['id'], stage)
                            last_stage = stage
                    self.stop.wait(0.5)
                output = root / 'result.json'
                if process.returncode != 0 or not output.exists() or output.stat().st_size > 1_000_000:
                    raise ValueError
                return json.loads(output.read_text())
            except TimeoutError:
                return {'error': error_payload('processing_timeout', 'This video took too long to process. Please try a shorter reel.', True)}
            except ProcessingError as error:
                return {'error': error_payload(error.code, error.message, error.retryable)}
            except Exception:
                return {'error': error_payload('processing_failed', 'We couldn’t finish this video. Please try again later.', True)}
            finally:
                if process and process.poll() is None:
                    # Kill ffmpeg/curl descendants as well as the Python worker.
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.wait(timeout=5)
                # TemporaryDirectory removes videos, frames, audio and manifests on every exit.

    def shutdown(self):
        self.stop.set()
        for thread in self.threads:
            thread.join(timeout=10)
