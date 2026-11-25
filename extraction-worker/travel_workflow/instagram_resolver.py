"""Direct public Instagram acquisition: platform page/query -> platform CDN.

An unofficial, changeable web interface. No downloader website, account cookies,
credentials, browser fingerprint impersonation or challenge solving.
"""
from __future__ import annotations
import datetime as dt
import json
import re
import tempfile
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlencode, urljoin, urlsplit
from .video_acquisition import AcquisitionError, MAX_BYTES, canonical_source
from .http_transfer import TransferError, curl_transfer, require_success, save_stream

ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
QUERY_URL = 'https://www.instagram.com/api/graphql'
QUERY_ID = '27130156389949648'  # Changeable Instagram web query, tested 2026-11-15.
QUERY_NAME = 'PolarisLoggedOutDesktopWWWPostRootContentQuery'
MAX_METADATA_BYTES = 6_000_000


def source_identity(source_url):
    platform, source = canonical_source(source_url)
    code = source.rsplit('/', 1)[-1]
    if platform != 'instagram' or not re.fullmatch(r'[A-Za-z0-9_-]{1,16}', code):
        raise AcquisitionError('Supply a single public Instagram reel or video post')
    numeric = 0
    for char in code:
        numeric = numeric * 64 + ALPHABET.index(char)
    return source, code, str(numeric)


def checked_instagram_media_url(url):
    try:
        if not isinstance(url, str) or not url or len(url) > 16000:
            raise ValueError
        if any(ord(c) <= 32 or ord(c) >= 127 for c in url) or '\\' in url:
            raise ValueError
        p = urlsplit(url)
        host = p.hostname or ''
        if (p.scheme != 'https' or p.username or p.password or p.port or p.fragment
                or not re.fullmatch(r'[a-zA-Z0-9.-]+', host)
                or not any(host.endswith('.' + d) for d in ('fbcdn.net', 'cdninstagram.com'))
                or not p.path.endswith('.mp4')):
            raise ValueError
    except (ValueError, TypeError):
        raise AcquisitionError('Instagram returned an unsupported media destination') from None
    return url


def parse_resolution(source_url, payload, method='instagram_anonymous_web_query'):
    source, code, numeric = source_identity(source_url)
    try:
        if not isinstance(payload, dict):
            raise ValueError
        errors = payload.get('errors', [])
        # Instagram may fail a location thumbnail while returning the complete public video.
        picture_path = ['xig_polaris_media', 'if_not_gated_logged_out', 'location', 'profile_pic_url']
        if errors is not None and (not isinstance(errors, list) or any(
                not isinstance(error, dict) or error.get('path') != picture_path for error in errors)):
            raise ValueError
        media = payload['data']['xig_polaris_media']['if_not_gated_logged_out']
        if not isinstance(media, dict):
            raise ValueError
    except (KeyError, TypeError, ValueError):
        raise AcquisitionError('Instagram did not expose this video to anonymous visitors; it may be gated, unavailable, or the web interface may have changed') from None
    if media.get('code') != code or str(media.get('pk')) != numeric:
        raise AcquisitionError('Instagram returned a different post; refusing to archive it')
    if media.get('media_type') != 2 or media.get('carousel_media'):
        raise AcquisitionError('This is not a single video post')
    variants = media.get('video_versions')
    if not isinstance(variants, list) or not variants:
        raise AcquisitionError('Instagram exposed no progressive MP4; split DASH streams are not supported yet')
    def pixels(v):
        if not isinstance(v, dict):
            return 0
        w, h = v.get('width'), v.get('height')
        return w*h if type(w) is int and type(h) is int and 0 < w <= 16384 and 0 < h <= 16384 else 0
    chosen = sorted(variants, key=pixels, reverse=True)[0]
    if not isinstance(chosen, dict):
        raise AcquisitionError('Instagram returned invalid video metadata')
    media_url = checked_instagram_media_url(chosen.get('url'))
    user = media.get('user') if isinstance(media.get('user'), dict) else {}
    handle = user.get('username')
    if not isinstance(handle, str) or not re.fullmatch(r'[A-Za-z0-9_.]{1,100}', handle):
        handle = None
    caption = media.get('caption') if isinstance(media.get('caption'), dict) else {}
    metrics = {k: media[k] for k in ('like_count', 'comment_count', 'view_count', 'play_count')
               if type(media.get(k)) is int and media[k] >= 0}
    return {'media_url': media_url, 'metadata': {
        'name': 'Instagram direct', 'method': method, 'source_shortcode': code,
        'media_id': numeric, 'author_handle': handle,
        'caption': str(caption.get('text') or '')[:10000],
        'taken_at': media.get('taken_at') if type(media.get('taken_at')) is int else None,
        'metrics': metrics, 'metrics_source': 'Instagram response at retrieval; absent counts remain unknown',
        'reported_has_audio': media.get('has_audio') if type(media.get('has_audio')) is bool else None,
        'resolved_at': dt.datetime.now(dt.timezone.utc).isoformat(),
        'source_identity_checked': True, 'browser_credentials_used': False,
        'third_party_downloader_used': False, 'official_api': False,
        'quality': 'largest_declared_progressive_variant_or_first_when_unspecified'}}


class PublicScripts(HTMLParser):
    """Read inert public HTML JSON; never execute downloaded JavaScript."""
    def __init__(self):
        super().__init__()
        self.scripts, self.current = [], None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'script' and (attrs.get('type') == 'application/json' or 'data-sjs' in attrs):
            self.current = []

    def handle_data(self, data):
        if self.current is not None:
            self.current.append(data)

    def handle_endtag(self, tag):
        if tag == 'script' and self.current is not None:
            self.scripts.append(''.join(self.current))
            self.current = None


def embedded_payload(html, source_url=None):
    parser = PublicScripts()
    parser.feed(html)
    first = None
    for script in parser.scripts:
        if '"xig_polaris_media"' not in script:
            continue
        try:
            stack = [(json.loads(script), 0)]
        except (ValueError, RecursionError):
            continue
        visited = 0
        while stack and visited < 100000:
            node, depth = stack.pop()
            visited += 1
            if depth > 64:
                continue
            if isinstance(node, dict):
                if 'xig_polaris_media' in node:
                    candidate = {'data': {'xig_polaris_media': node['xig_polaris_media']}}
                    if first is None:
                        first = candidate
                    if source_url is None:
                        return candidate
                    try:
                        parse_resolution(source_url, candidate)
                    except AcquisitionError:
                        pass
                    else:
                        return candidate
                stack.extend((v, depth+1) for v in node.values() if isinstance(v, (dict, list)))
            elif isinstance(node, list):
                stack.extend((v, depth+1) for v in node if isinstance(v, (dict, list)))
    # Keep invalid/gated embedded data fail-closed; it must not trigger a new query.
    return first


def resolve_instagram(source_url):
    source, code, numeric = source_identity(source_url)
    deadline = time.monotonic() + 25
    retried = False

    def request(url, target, stage, extra=()):
        nonlocal retried
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TransferError('Instagram metadata exceeded its time limit', 'timeout', stage=stage)
            headers = {}
            try:
                status, headers = curl_transfer(url, target, min(10, remaining), MAX_METADATA_BYTES, extra)
                require_success(status, stage)
                if time.monotonic() >= deadline:
                    raise TransferError('Instagram metadata exceeded its time limit', 'timeout', stage=stage)
                return
            except TransferError as error:
                error.stage = stage
                after = headers.get('retry-after')
                delay = float(after) if isinstance(after, str) and re.fullmatch(r'[0-2]', after) else None
                transient = error.kind in {'network', 'timeout'} or error.status in {500, 502, 503, 504}
                if error.status == 429:
                    transient = delay is not None
                # One extra same-provider request per resolution; honour server backoff and the whole deadline.
                if retried or not transient or (after is not None and delay is None):
                    raise
                delay = 0.3 if delay is None else delay
                if time.monotonic() + delay >= deadline:
                    raise
                retried = True
                time.sleep(delay)

    with tempfile.TemporaryDirectory(prefix='instagram-resolve-') as directory:
        root = Path(directory)
        page = root / 'page.html'
        # No redirects into login/challenge screens or alternate services.
        request(source + '/', page, 'Instagram public page')
        html = page.read_text(errors='replace')
        embedded = embedded_payload(html, source)
        if embedded is not None:
            return parse_resolution(source, embedded, 'instagram_public_page')
        match = re.search(r'\["LSD",\[\],\{"token":"([A-Za-z0-9_-]{1,256})"', html)
        if not match:
            raise AcquisitionError("Instagram's anonymous page token is unavailable; the post may need login or the web interface may have changed")
        token = match.group(1)
        # This token belongs to our anonymous page request, not a user account.
        # Keep it out of manifests/logs/process arguments; temp directory is private.
        headers = root / 'request.headers'
        headers.write_text('\n'.join([
            'X-IG-App-ID: 936619743392459', 'X-ASBD-ID: 359341', 'X-IG-WWW-Claim: 0',
            'Origin: https://www.instagram.com', 'Accept: */*',
            'X-FB-Friendly-Name: ' + QUERY_NAME, 'X-FB-LSD: ' + token,
            'X-Requested-With: XMLHttpRequest', 'Referer: ' + source + '/']) + '\n')
        form = root / 'request.form'
        form.write_text(urlencode({'lsd': token, 'fb_api_caller_class': 'RelayModern',
            'fb_api_req_friendly_name': QUERY_NAME, 'server_timestamps': 'true',
            'variables': json.dumps({'media_id': numeric}), 'doc_id': QUERY_ID}))
        body = root / 'query.json'
        request(QUERY_URL, body, 'Instagram public query',
                ['--header', '@' + str(headers), '--data', '@' + str(form)])
        try:
            payload = json.loads(body.read_bytes())
        except (ValueError, UnicodeError, RecursionError):
            raise AcquisitionError('Instagram returned an invalid metadata response') from None
        return parse_resolution(source, payload)


def download_instagram(source_url, target, download_seconds=120):
    resolution = resolve_instagram(source_url)
    deadline = time.monotonic() + download_seconds
    url = resolution['media_url']
    with tempfile.TemporaryDirectory(prefix='instagram-transfer-', dir=target.parent) as directory:
        body = Path(directory) / 'body.mp4'
        for hop in range(4):
            if time.monotonic() >= deadline:
                raise AcquisitionError('Video transfer exceeded its time limit')
            status, headers = curl_transfer(url, body, deadline-time.monotonic(), MAX_BYTES)
            if status in {301, 302, 303, 307, 308}:
                if hop == 3 or not headers.get('location'):
                    raise AcquisitionError('Too many media redirects or missing destination')
                url = checked_instagram_media_url(urljoin(url, headers['location']))
                continue
            require_success(status, 'Instagram video transfer')
            class SavedResponse:
                status = 200
            response = SavedResponse()
            response.headers = {'Content-Type': headers.get('content-type', '')}
            if 'content-length' in headers:
                response.headers['Content-Length'] = headers['content-length']
            with body.open('rb') as stream:
                response.read = stream.read
                save_stream(response, target, deadline)
            break
    # No ephemeral signed CDN URLs or session tokens cross the archival boundary.
    return resolution['metadata']
