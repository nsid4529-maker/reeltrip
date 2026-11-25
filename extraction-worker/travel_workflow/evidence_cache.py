"""Reuse evidence only when its post identity and local media checksum agree."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
from .video_acquisition import canonical_source


def source_key(url):
    platform, canonical = canonical_source(url)
    # Instagram /p and /reel aliases and changed TikTok handles identify one post.
    identity = canonical.rsplit('/', 1)[-1]
    prefix = 'tiktok-short' if platform == 'tiktok' and '/video/' not in canonical else platform
    return prefix + '-' + identity


def read_json(path):
    try:
        data = json.loads(Path(path).read_text())
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def matching_source(record, url):
    try:
        return source_key(record['source_url']) == source_key(url)
    except (KeyError, TypeError, ValueError, RuntimeError):
        return False


def valid_acquisition(record, url):
    if not record or not matching_source(record, url):
        return False
    try:
        path = Path(record['file'])
        if not record['validation']['probe_passed'] or path.stat().st_size != record['bytes']:
            return False
        with path.open('rb') as handle:
            return hashlib.file_digest(handle, 'sha256').hexdigest() == record['sha256']
    except (KeyError, OSError, TypeError):
        return False


def prepared_cache(root, url, settings):
    data = read_json(Path(root) / 'prepared.json')
    if not data or data.get('settings') != settings or data.get('status') != 'evidence_ready':
        return None
    if not valid_acquisition(data.get('acquisition'), url):
        return None
    visual = data.get('visuals', {})
    sheets = visual.get('contact_sheets', [])
    if not visual.get('decode_passed') or not sheets or not all(Path(p).is_file() for p in sheets):
        return None
    sizes = visual.get('contact_sheet_bytes', {})
    if any(p in sizes and Path(p).stat().st_size != sizes[p] for p in sheets):
        return None
    if not isinstance(data.get('speech', {}).get('segments'), list):
        return None
    return data


def reviewed_catalog(roots):
    """Index completed semantic reviews without requiring old remote MP4 paths.

    Raw evidence is not a completed review. Pair each review with its acquisition
    and require an explicit visual-review flag and matching content checksum.
    """
    entries = {}
    for root in roots:
        for path in sorted(Path(root).rglob('analysis.json')):
            analysis = read_json(path)
            acquisition = read_json(path.with_name('acquisition.json'))
            if not analysis or not acquisition:
                continue
            if analysis.get('status') not in {'completed', 'completed_with_unknowns'}:
                continue
            if not analysis.get('method', {}).get('visual_review_completed'):
                continue
            if not matching_source(analysis, acquisition.get('source_url')):
                continue
            if not analysis.get('media_sha256') or analysis['media_sha256'] != acquisition.get('sha256'):
                continue
            key = source_key(analysis['source_url'])
            current = entries.get(key)
            if current and Path(current['analysis_path']).stat().st_mtime >= path.stat().st_mtime:
                continue
            entries[key] = {'source_url': analysis['source_url'], 'analysis': analysis,
                            'analysis_path': str(path.resolve()), 'acquisition': acquisition,
                            'cache_status': 'reviewed_analysis',
                            'original_acquired_at': acquisition.get('acquired_at'),
                            'live_metadata_refreshed': False}
    return entries
