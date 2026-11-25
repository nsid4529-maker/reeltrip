"""TikWM-backed public TikTok acquisition, independent of browser download events.

The observed public interface is POST https://www.tikwm.com/api/ with url/web/hd.
This is an unofficial provider dependency, not SnapTik's proprietary resolver.
No cookies, challenge solvers, authentication headers or browser sessions are used.
"""
from __future__ import annotations

import datetime as dt
import http.client
import json
import re
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit

from .video_acquisition import AcquisitionError, MAX_BYTES, canonical_source
from .http_transfer import curl_transfer, require_success, save_stream


API = "https://www.tikwm.com/api/"
BASE = "https://www.tikwm.com/"
MAX_JSON_BYTES = 1_000_000
DOWNLOAD_SECONDS = 180
# Only the provider and its public video CDNs can receive download requests.
MEDIA_DOMAINS = ("tikwm.com", "tiktokcdn.com", "tiktokcdn-us.com",
                 "tiktokcdn-eu.com", "tiktokv.com")


def checked_media_url(url):
    try:
        p = urlsplit(url)
        host = (p.hostname or "").lower()
        if (p.scheme != "https" or p.username or p.password or p.port or p.fragment
                or not any(host == d or host.endswith("." + d) for d in MEDIA_DOMAINS)):
            raise ValueError
    except (ValueError, TypeError):
        raise AcquisitionError("Resolver returned an unsupported media destination") from None
    return url


def _http_error(error, stage):
    if isinstance(error, HTTPError):
        if error.code in {401, 403}:
            return AcquisitionError(f"{stage} refused access (HTTP {error.code}); no bypass was attempted")
        if error.code == 429:
            return AcquisitionError(f"{stage} rate limit reached; retry later without changing providers")
        return AcquisitionError(f"{stage} failed (HTTP {error.code})")
    return AcquisitionError(f"{stage} network request failed or timed out")


def resolve_tiktok(source_url):
    platform, source_url = canonical_source(source_url)
    if platform != "tiktok":
        raise AcquisitionError("TikWM supports TikTok links only")
    try:
        # Use ordinary curl, the transport exercised in the live acquisition test.
        # No browser impersonation, exported cookies or challenge tokens.
        with tempfile.TemporaryDirectory(prefix="tikwm-resolve-") as directory:
            body = Path(directory) / "response.json"
            status, headers = curl_transfer(API, body, 30, MAX_JSON_BYTES,
                ["--data-urlencode", "url=" + source_url, "--data", "web=1&hd=1"])
            require_success(status, "TikWM resolver")
            raw = body.read_bytes()
            if len(raw) > MAX_JSON_BYTES:
                raise AcquisitionError("Resolver response exceeded its size limit")
        payload = json.loads(raw)
    except (HTTPError, URLError, TimeoutError, OSError, http.client.HTTPException) as error:
        raise _http_error(error, "TikWM resolver") from None
    except (ValueError, UnicodeError):
        raise AcquisitionError("Resolver did not return valid JSON") from None
    return parse_resolution(source_url, payload)


def parse_resolution(source_url, payload):
    if not isinstance(payload, dict) or payload.get("code") != 0 or not isinstance(payload.get("data"), dict):
        raise AcquisitionError("Resolver could not resolve this public post")
    data = payload["data"]
    if data.get("images"):
        raise AcquisitionError("This is an image post, not a single video")
    video_id = str(data.get("id", ""))
    if not re.fullmatch(r"[0-9]{10,25}", video_id):
        raise AcquisitionError("Resolver returned an invalid video ID")
    source_match = re.search(r"/video/([0-9]+)$", source_url)
    if source_match and source_match.group(1) != video_id:
        raise AcquisitionError("Resolver returned a different video; refusing to archive it")
    play = data.get("play")
    if not isinstance(play, str) or not play:
        raise AcquisitionError("Resolver returned metadata without a downloadable video")
    media_url = checked_media_url(urljoin(BASE, play))
    # Provider-relative file URLs must also agree with the requested post ID.
    path = urlsplit(media_url).path
    if urlsplit(media_url).hostname in {"tikwm.com", "www.tikwm.com"}:
        if path != f"/video/media/play/{video_id}.mp4":
            raise AcquisitionError("Resolver returned an unexpected video path")
    author = data.get("author") if isinstance(data.get("author"), dict) else {}
    handle = author.get("unique_id", "")
    if not isinstance(handle, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", handle):
        handle = None
    metrics = {}
    for key in ("play_count", "digg_count", "comment_count", "share_count", "collect_count"):
        value = data.get(key)
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            metrics[key] = value
    return {"media_url": media_url, "metadata": {
        "name": "TikWM", "video_id": video_id, "author_handle": handle,
        "title": str(data.get("title", ""))[:4000],
        "resolved_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "metrics": metrics, "metrics_source": "third_party; cache age unknown",
        "requested_quality": "standard", "browser_credentials_used": False}}


def download_tiktok(source_url, target, download_seconds=DOWNLOAD_SECONDS):
    resolution = resolve_tiktok(source_url)
    deadline = time.monotonic() + download_seconds
    url = resolution["media_url"]
    try:
        with tempfile.TemporaryDirectory(prefix="transfer-", dir=target.parent) as directory:
            body = Path(directory) / "body.mp4"
            for hop in range(6):
                if time.monotonic() >= deadline:
                    raise AcquisitionError("Video transfer exceeded its time limit")
                status, headers = curl_transfer(url, body, deadline - time.monotonic(), MAX_BYTES)
                if status in {301, 302, 303, 307, 308}:
                    if hop == 5 or not headers.get("location"):
                        raise AcquisitionError("Too many media redirects or missing destination")
                    url = checked_media_url(urljoin(url, headers["location"]))
                    continue
                require_success(status, "Video transfer")
                # Reuse the bounded stream validator before exposing a finished file.
                class SavedResponse:
                    status = 200
                response = SavedResponse()
                response.headers = {"Content-Type": headers.get("content-type", "")}
                if "content-length" in headers:
                    response.headers["Content-Length"] = headers["content-length"]
                with body.open("rb") as file:
                    response.read = file.read
                    save_stream(response, target, deadline)
                break
    except (HTTPError, URLError, TimeoutError, OSError, http.client.HTTPException) as error:
        raise _http_error(error, "Video transfer") from None
    # Signed CDN URLs are deliberately excluded from the persisted manifest.
    return resolution["metadata"]
