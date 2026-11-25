"""Bounded HTTPS transport shared by independent media resolvers."""
from __future__ import annotations
import shutil
import subprocess
import time
from .video_acquisition import AcquisitionError, MAX_BYTES


class TransferError(AcquisitionError):
    """Safe transport diagnostics; never include URLs, response bodies or stderr."""
    def __init__(self, message, kind, *, status=None, curl_code=None, stage=None):
        super().__init__(message)
        self.kind, self.status, self.curl_code, self.stage = kind, status, curl_code, stage


def curl_transfer(url, target, seconds, max_bytes, extra=()):
    """One request, no automatic redirect/retry; callers check each destination."""
    curl = shutil.which("curl")
    if not curl:
        raise AcquisitionError("curl is required for video acquisition")
    header_file = target.with_suffix(".headers")
    command = [curl, "--disable", "--silent", "--show-error", "--proto", "=https", "--connect-timeout", "10",
        "--max-time", str(max(0.001, seconds)), "--max-filesize", str(max_bytes),
        "--dump-header", str(header_file), "--output", str(target),
        "--write-out", "%{http_code}", *extra, "--", url]
    try:
        result = subprocess.run(command, capture_output=True, timeout=max(0.001, seconds), check=False)
        if result.returncode:
            kind = ('timeout' if result.returncode == 28 else 'network'
                    if result.returncode in {5, 6, 7, 18, 52, 55, 56, 92} else 'transfer')
            raise TransferError("Transfer failed, timed out, or exceeded its size limit", kind,
                                curl_code=result.returncode)
        status = int(result.stdout)
        # curl may record an HTTPS proxy CONNECT response before the actual response.
        text = header_file.read_text(errors="replace").replace("\r\n", "\n")
        blocks = [b for b in text.split("\n\n") if b.startswith("HTTP/")]
        headers = {}
        for line in blocks[-1].splitlines()[1:]:
            if ":" in line:
                key, value = line.split(":", 1)
                headers[key.lower()] = value.strip()
        if target.stat().st_size > max_bytes:
            raise AcquisitionError("Transfer exceeded its size limit")
        return status, headers
    except subprocess.TimeoutExpired:
        raise TransferError("Transfer exceeded its time limit", 'timeout') from None
    except (subprocess.SubprocessError, OSError, ValueError, IndexError):
        raise AcquisitionError("Transfer failed or returned invalid headers") from None
    finally:
        header_file.unlink(missing_ok=True)


def require_success(status, stage):
    if status in {401, 403}:
        raise TransferError(f"{stage} refused access (HTTP {status}); no bypass was attempted",
                            'access', status=status, stage=stage)
    if status == 429:
        raise TransferError(f"{stage} rate limit reached; retry later without changing providers",
                            'rate_limit', status=status, stage=stage)
    if status != 200:
        raise TransferError(f"{stage} failed (HTTP {status})", 'http', status=status, stage=stage)


def save_stream(response, target, deadline):
    """Never accept an HTML error page, truncated body, or oversized stream."""
    if response.status != 200:
        raise AcquisitionError("Media request did not return a complete file")
    content_type = response.headers.get("Content-Type", "").split(";")[0].strip().lower()
    if content_type not in {"video/mp4", "application/octet-stream", "binary/octet-stream"}:
        raise AcquisitionError("Media endpoint returned a non-video response")
    length = response.headers.get("Content-Length")
    try:
        expected = int(length) if length is not None else None
    except ValueError:
        raise AcquisitionError("Media endpoint returned an invalid file size") from None
    if expected is not None and not 0 < expected <= MAX_BYTES:
        raise AcquisitionError("Media exceeds the 50 MB acquisition limit or is empty")
    count = 0
    created = False
    try:
        with target.open("xb") as output:
            created = True
            while True:
                if time.monotonic() > deadline:
                    raise AcquisitionError("Video transfer exceeded its time limit")
                chunk = response.read(65536)
                if not chunk:
                    break
                count += len(chunk)
                if count > MAX_BYTES:
                    raise AcquisitionError("Video transfer exceeded the 50 MB limit")
                output.write(chunk)
        if not count or (expected is not None and count != expected):
            raise AcquisitionError("Video transfer was incomplete")
    except BaseException:
        # target is private staging; originals and accepted archives are untouched.
        if created:
            target.unlink(missing_ok=True)
        raise
    return count


