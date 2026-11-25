"""Acquire a single public social video, or validate a manually saved file.

This module never reads browser sessions or silently changes providers.
TikTok defaults to TikWM. Instagram defaults to our direct public resolver.
ffprobe is required; direct Instagram downloads also require ffmpeg validation.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import importlib.util
import json
import math
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


MAX_BYTES = 50_000_000


class AcquisitionError(RuntimeError):
    pass


def canonical_source(url):
    try:
        if not isinstance(url, str) or any(ord(c) <= 32 for c in url) or "\\" in url:
            raise ValueError
        p = urlsplit(url)
        if p.scheme != "https" or p.username or p.password or p.port:
            raise ValueError
    except ValueError:
        raise AcquisitionError("Use an HTTPS Instagram or TikTok post URL without credentials or a port") from None
    host = (p.hostname or "").lower()
    ig_match = re.fullmatch(r"/(?:[A-Za-z0-9_.]+/)?(reel|p)/([A-Za-z0-9_-]+)/?", p.path)
    if host in {"www.instagram.com", "instagram.com"} and ig_match:
        platform, host = "instagram", "www.instagram.com"
        p = p._replace(path=f"/{ig_match[1]}/{ig_match[2]}")
    elif host in {"www.tiktok.com", "tiktok.com"} and re.fullmatch(r"/@[A-Za-z0-9_.-]+/video/[0-9]+/?", p.path):
        platform, host = "tiktok", "www.tiktok.com"
    elif host in {"vm.tiktok.com", "vt.tiktok.com"} and re.fullmatch(r"/[A-Za-z0-9]+/?", p.path):
        platform = "tiktok"
    else:
        raise AcquisitionError("Supply one Instagram Reel/post or TikTok video link, not a profile or feed")
    return platform, urlunsplit(("https", host, p.path.rstrip("/"), "", ""))


def probe_video(path):
    path = Path(path)
    if path.suffix.lower() not in {".mp4", ".mov", ".webm"} or not path.is_file() or not 0 < path.stat().st_size <= MAX_BYTES:
        raise AcquisitionError("Supply an MP4, MOV or WebM file up to 50 MB")
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        raise AcquisitionError("ffprobe is required to validate the actual audio/video streams")
    try:
        result = subprocess.run([ffprobe, "-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries",
            "format=duration,format_name:stream=codec_type,codec_name,width,height", "-of", "json", str(path.resolve())],
            capture_output=True, text=True, timeout=15, check=True)
        probe = json.loads(result.stdout)
        duration = float(probe["format"]["duration"])
        streams = probe["streams"]
        if not math.isfinite(duration) or not 0 < duration <= 600 or not any(s.get("codec_type") == "video" for s in streams):
            raise ValueError
    except (subprocess.SubprocessError, OSError, ValueError, KeyError, TypeError):
        raise AcquisitionError("The file did not validate as a playable video; no analysis was started") from None
    return {"duration_seconds": duration, "streams": streams, "container_format": str(probe["format"].get("format_name", "")),
            "audio_present": any(s.get("codec_type") == "audio" for s in streams)}


def decode_video(path, audio_present):
    """Decode every video frame and any audio before accepting a direct download."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise AcquisitionError("ffmpeg is required to fully validate the Instagram download")
    try:
        subprocess.run([ffmpeg, "-v", "error", "-xerror", "-nostdin", "-threads", "1",
            "-protocol_whitelist", "file,pipe", "-i", str(Path(path).resolve()),
            "-map", "0:v:0", "-map", "0:a:0?", "-threads", "1", "-f", "null", "-"],
            check=True, capture_output=True, timeout=90)
    except (subprocess.SubprocessError, OSError):
        raise AcquisitionError("The downloaded video failed complete audio/video decoding; no archive was accepted") from None
    return {"full_video_decode_passed": True,
            "full_audio_decode_passed": True if audio_present else None}


def acquire_video(source_url, output_dir, supplied_file=None, provider="auto", download_seconds=None):
    platform, source_url = canonical_source(source_url)
    if provider not in {"auto", "tikwm", "yt-dlp", "instagram-direct"}:
        raise AcquisitionError("Unknown acquisition provider")
    if download_seconds is not None and (type(download_seconds) not in {int, float} or not 1 <= download_seconds <= 180):
        raise AcquisitionError("Download timeout must be between 1 and 180 seconds")
    transfer_options = {} if download_seconds is None else {"download_seconds": download_seconds}
    if provider == "tikwm" and platform != "tiktok":
        raise AcquisitionError("TikWM supports TikTok links only")
    if provider == "instagram-direct" and platform != "instagram":
        raise AcquisitionError("The direct Instagram resolver accepts Instagram links only")
    selected = ("tikwm" if platform == "tiktok" else "instagram-direct") if provider == "auto" else provider
    if not supplied_file and selected == "instagram-direct" and (not shutil.which("ffmpeg") or not shutil.which("ffprobe")):
        raise AcquisitionError("Direct Instagram acquisition requires ffmpeg and ffprobe; install these in the processing environment before downloading")
    provider_record = {}
    output = Path(output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    # Temporary artifacts are removed on download, timeout or validation failure.
    with tempfile.TemporaryDirectory(prefix="acquire-", dir=output) as temporary:
        staging = Path(temporary)
        if supplied_file:
            original = Path(supplied_file).resolve()
            if not original.is_file() or not 0 < original.stat().st_size <= MAX_BYTES:
                raise AcquisitionError("The supplied file is missing, empty or larger than 50 MB")
            video = staging / ("video" + original.suffix.lower())
            shutil.copyfile(original, video)
            method = "supplied_file"
        elif selected == "instagram-direct":
            from .instagram_resolver import download_instagram
            video = staging / "video.mp4"
            provider_record = download_instagram(source_url, video, **transfer_options)
            method = "instagram_direct"
        elif selected == "tikwm":
            from .tiktok_resolver import download_tiktok
            video = staging / "video.mp4"
            provider_record = download_tiktok(source_url, video, **transfer_options)
            method = "tikwm_public_resolver"
        else:
            if importlib.util.find_spec("yt_dlp") is None:
                raise AcquisitionError("Public-link downloads require yt-dlp; alternatively supply --file with your saved video")
            command = [sys.executable, "-m", "yt_dlp", "--ignore-config", "--no-plugin-dirs",
                "--no-cookies", "--no-cookies-from-browser", "--no-cache-dir", "--no-playlist",
                "--playlist-end", "1", "--quiet", "--no-progress", "--socket-timeout", "10",
                "--retries", "0", "--fragment-retries", "0", "--extractor-retries", "0",
                "--max-filesize", str(MAX_BYTES), "--format", "best[ext=mp4]/best",
                "--output", str(staging / "video.%(ext)s"), "--", source_url]
            try:
                subprocess.run(command, capture_output=True, text=True, timeout=60, check=True)
            except (subprocess.SubprocessError, OSError):
                # Provider errors can contain signed URLs; avoid persisting raw stderr.
                raise AcquisitionError("Public download failed or timed out. No alternate provider or login bypass was attempted. Supply the saved MP4 with --file.") from None
            candidates = [p for p in staging.iterdir() if p.suffix.lower() in {".mp4", ".mov", ".webm"}]
            if len(candidates) != 1:
                raise AcquisitionError("The downloader did not produce exactly one video file")
            video, method = candidates[0], "yt-dlp_public"
        probe = probe_video(video)
        validation = {"probe_passed": True, "full_video_decode_passed": False, "full_audio_decode_passed": False}
        if method == "instagram_direct":
            if provider_record.get("reported_has_audio") is True and not probe["audio_present"]:
                raise AcquisitionError("Instagram reported audio but the downloaded MP4 has none; refusing incomplete media")
            validation.update(decode_video(video, probe["audio_present"]))
        with video.open("rb") as handle:
            checksum = hashlib.file_digest(handle, "sha256").hexdigest()
        target = output / (checksum + video.suffix.lower())
        if target.exists():
            with target.open("rb") as handle:
                if hashlib.file_digest(handle, "sha256").hexdigest() != checksum:
                    raise AcquisitionError("An existing archive file failed its checksum check")
        else:
            video.replace(target)
        record = {"source_url": source_url, "platform": platform, "method": method,
            "acquired_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "file": str(target), "sha256": checksum, "bytes": target.stat().st_size, **probe,
            "validation": validation,
            "source_association": ("caller_supplied_unverified" if supplied_file else
                "instagram_returned_shortcode_and_numeric_id_checked" if method == "instagram_direct" else
                "third_party_resolver_id_checked" if method == "tikwm_public_resolver" else "platform_extractor"),
            "provider": provider_record,
            "analysis_started": False, "gemini_inline_size_compatible": target.stat().st_size <= 12_000_000}
        identity = hashlib.sha256((source_url + checksum).encode()).hexdigest()[:20]
        manifest = output / (identity + ".json")
        temporary_manifest = staging / "manifest.json"
        temporary_manifest.write_text(json.dumps(record, indent=2))
        temporary_manifest.replace(manifest)
        return {**record, "manifest": str(manifest)}
