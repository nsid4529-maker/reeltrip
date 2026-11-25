"""Explicit, authenticated public TikTok acquisition through Apify.

Uses the documented clockworks/tiktok-video-scraper API, never a fallback after
another provider refuses access. No browser credentials or proxy settings.
https://apify.com/clockworks/tiktok-video-scraper
https://docs.apify.com/api/v2/actors-runs-post
"""
from __future__ import annotations

import datetime as dt
import http.client
import json
import os
import re
import time
import urllib.error
import urllib.request
from urllib.parse import quote, urlsplit

from .http_transfer import save_stream
from .video_acquisition import AcquisitionError, canonical_source

ORIGIN = 'https://api.apify.com'
ACTOR = 'clockworks~tiktok-video-scraper'
MAX_CHARGE_USD = '0.01'
RUN_SECONDS = 45
ACQUISITION_SECONDS = 70  # Existing TikTok resolver + transfer allowance.
MAX_JSON_BYTES = 1_000_000
TERMINAL = {'SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED'}
IDENTIFIER = re.compile(r'^[A-Za-z0-9]{1,64}$')


class ProviderError(AcquisitionError):
    """An API/account outage does not mean the shared video is inaccessible."""
    def __init__(self, message, *, busy=False):
        super().__init__(message)
        self.busy = busy


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def token_configured(value=None):
    value = os.environ.get('APIFY_API_TOKEN', '') if value is None else value
    return isinstance(value, str) and 1 <= len(value) <= 512 and all(32 < ord(c) < 127 for c in value)


def _remaining(deadline, clock):
    remaining = deadline - clock()
    if remaining <= 0:
        raise AcquisitionError('Apify video acquisition exceeded its time limit')
    return min(10, remaining)


def _identifier(value):
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise AcquisitionError('Apify returned an invalid run or storage identity')
    return value


def _open(opener, path, token, timeout, body=None):
    # Every caller constructs a fixed API path; content cannot choose a host.
    request = urllib.request.Request(ORIGIN + path, data=None if body is None else json.dumps(body).encode(),
                                    method='GET' if body is None else 'POST',
                                    headers={'Authorization': 'Bearer ' + token,
                                             'Content-Type': 'application/json', 'Accept': 'application/json'})
    try:
        return opener.open(request, timeout=timeout)
    except urllib.error.HTTPError as error:
        code = error.code
        error.close()
        if code in {401, 403}:
            raise ProviderError('Apify access was refused; check the configured API account') from None
        if code in {402, 429}:
            raise ProviderError('Apify quota or rate limit reached; no retry was attempted', busy=True) from None
        if code in {301, 302, 303, 307, 308}:
            raise AcquisitionError('Apify returned a redirect; credentials were not forwarded') from None
        raise ProviderError('Apify request failed') from None
    except (OSError, TimeoutError, http.client.HTTPException):
        raise ProviderError('Apify request failed or timed out; no duplicate run was submitted') from None


def _json(opener, path, token, timeout, body=None):
    try:
        with _open(opener, path, token, timeout, body) as response:
            if response.status not in {200, 201}:
                raise AcquisitionError('Apify returned an unexpected response')
            raw = response.read(MAX_JSON_BYTES + 1)
        if len(raw) > MAX_JSON_BYTES:
            raise AcquisitionError('Apify response exceeded its size limit')
        return json.loads(raw)
    except (OSError, TimeoutError, http.client.HTTPException):
        raise ProviderError('Apify response transfer failed or timed out') from None
    except (ValueError, UnicodeError):
        raise AcquisitionError('Apify returned an unreadable response') from None


def _run(payload, expected_id=None):
    value = payload.get('data') if isinstance(payload, dict) else None
    if not isinstance(value, dict):
        raise AcquisitionError('Apify returned no run identity')
    identity = _identifier(value.get('id'))
    if expected_id is not None and identity != expected_id:
        raise AcquisitionError('Apify returned a different run identity')
    if value.get('status') not in TERMINAL | {'READY', 'RUNNING', 'ABORTING', 'TIMING-OUT'}:
        raise AcquisitionError('Apify returned an unknown run state')
    return value


def media_record(item, source_url, store_id):
    """Bind a stored MP4 to both the requested video and this actor run."""
    if not isinstance(item, dict) or item.get('errorCode') or item.get('error'):
        raise AcquisitionError('Apify could not retrieve this public video')
    platform, actual = canonical_source(item.get('webVideoUrl'))
    video_id = source_url.rsplit('/', 1)[-1]
    if platform != 'tiktok' or actual.rsplit('/', 1)[-1] != video_id:
        raise AcquisitionError('Apify returned a different video')
    if 'id' in item and (type(item['id']) not in (str, int) or str(item['id']) != video_id):
        raise AcquisitionError('Apify returned inconsistent video identities')
    video = item.get('videoMeta')
    address = video.get('downloadAddr') if isinstance(video, dict) else None
    try:
        if not isinstance(address, str) or len(address) > 2000 or any(ord(c) <= 32 for c in address) or '\\' in address:
            raise ValueError
        url = urlsplit(address)
        if url.scheme != 'https' or url.hostname != 'api.apify.com' or url.username or url.password or url.port or url.fragment:
            raise ValueError
        match = re.fullmatch(r'/v2/key-value-stores/([A-Za-z0-9]+)/records/([A-Za-z0-9._-]+\.mp4)', url.path)
        if not match or match[1] != store_id or not re.search(r'(?:^|[-_])' + re.escape(video_id) + r'(?:[-_.]|$)', match[2]):
            raise ValueError
    except (ValueError, TypeError):
        raise AcquisitionError('Apify returned media outside this run or video') from None
    # Discard any query credentials/signature and construct our own record URL.
    path = '/v2/key-value-stores/' + store_id + '/records/' + quote(match[2], safe='')
    author = item.get('authorMeta') if isinstance(item.get('authorMeta'), dict) else {}
    handle = author.get('name')
    if not isinstance(handle, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,100}', handle):
        handle = None
    caption = item.get('text', '')
    if caption is None:
        caption = ''
    if not isinstance(caption, str):
        raise AcquisitionError('Apify returned an invalid caption')
    return path, {'name': 'Apify / Clockworks TikTok Video Scraper', 'video_id': video_id,
                  'author_handle': handle, 'caption': caption[:4000], 'browser_credentials_used': False}


def download_apify_tiktok(source_url, target, *, token=None, opener=None, clock=time.monotonic, sleep=time.sleep):
    platform, source_url = canonical_source(source_url)
    if platform != 'tiktok' or not re.search(r'/video/[0-9]{10,25}$', source_url):
        raise AcquisitionError('Apify requires one full public TikTok video URL')
    token = os.environ.get('APIFY_API_TOKEN', '') if token is None else token
    if not token_configured(token):
        raise AcquisitionError('An Apify API token must be configured for this provider')
    if target.exists():
        raise AcquisitionError('The media destination already exists')
    opener = opener or urllib.request.build_opener(NoRedirect())
    deadline = clock() + ACQUISITION_SECONDS
    run_id = None
    terminal = False
    try:
        # No retry: a timed-out POST may already have created a charged run.
        run = _run(_json(opener, '/v2/actors/' + ACTOR + '/runs?timeout=' + str(RUN_SECONDS)
                         + '&maxTotalChargeUsd=' + MAX_CHARGE_USD + '&restartOnError=false',
                         token, _remaining(deadline, clock),
                         {'postURLs': [source_url], 'scrapeRelatedVideos': False, 'resultsPerPage': 1,
                          'shouldDownloadVideos': True, 'shouldDownloadCovers': False,
                          'shouldDownloadSlideshowImages': False,
                          'downloadSubtitlesOptions': 'NEVER_DOWNLOAD_SUBTITLES'}))
        run_id = run['id']
        while run['status'] not in TERMINAL:
            sleep(min(2, _remaining(deadline, clock)))
            run = _run(_json(opener, '/v2/actor-runs/' + run_id, token, _remaining(deadline, clock)), run_id)
        terminal = True
        if run['status'] != 'SUCCEEDED':
            raise AcquisitionError('Apify did not complete this video within its limits')
        dataset_id = _identifier(run.get('defaultDatasetId'))
        store_id = _identifier(run.get('defaultKeyValueStoreId'))
        items = _json(opener, '/v2/datasets/' + dataset_id + '/items?format=json&clean=true&limit=2', token, _remaining(deadline, clock))
        if not isinstance(items, list) or len(items) != 1:
            raise AcquisitionError('Apify did not return exactly the requested video')
        path, metadata = media_record(items[0], source_url, store_id)
        try:
            with _open(opener, path, token, _remaining(deadline, clock)) as response:
                # save_stream enforces 50 MB, video content type, exact length and
                # deadline, and removes incomplete files. Redirects never receive auth.
                save_stream(response, target, time.monotonic() + max(0, deadline - clock()))
        except (OSError, TimeoutError, http.client.HTTPException):
            raise ProviderError('Apify media transfer failed or was incomplete') from None
        _remaining(deadline, clock)
        return {**metadata, 'run_id': run_id, 'max_charge_usd': MAX_CHARGE_USD,
                'resolved_at': dt.datetime.now(dt.timezone.utc).isoformat()}
    except BaseException:
        # This path owns the new staging file; pre-existing files were rejected.
        target.unlink(missing_ok=True)
        raise
    finally:
        if run_id and not terminal:
            # Cancellation is best effort; the server-side 45s/$0.01 limits also
            # bound a run whose submit/poll response is lost. Never retry POST.
            try:
                _json(opener, '/v2/actor-runs/' + run_id + '/abort', token, 3, {})
            except AcquisitionError:
                pass
