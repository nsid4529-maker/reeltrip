"""Validate and archive an Instagram MP4 saved through the normal browser UI."""
import argparse
import datetime as dt
import hashlib
import json
import shutil
import tempfile
from pathlib import Path
from .video_acquisition import AcquisitionError, MAX_BYTES, canonical_source
from .local_media import inspect_media
from .mp4_container import inspect_container

def import_download(source_url, downloaded_file, output_dir, container_only=False):
    platform, source = canonical_source(source_url)
    if platform != "instagram":
        raise AcquisitionError("This browser import is for an Instagram reel/post")
    incoming = Path(downloaded_file).resolve()
    if incoming.suffix.lower() != '.mp4' or not incoming.is_file() or not 0 < incoming.stat().st_size <= MAX_BYTES:
        raise AcquisitionError("Supply the completed MP4, up to 50 MB")
    root = Path(output_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="browser-import-", dir=root) as temp:
        staging = Path(temp)
        video = staging/'reference.mp4'
        shutil.copy2(incoming, video)
        with video.open('rb') as f:
            digest = hashlib.file_digest(f,'sha256').hexdigest()
        try:
            if container_only:
                validation=inspect_container(video)
                (staging/'inspection').mkdir()
                (staging/'inspection'/'validation.json').write_text(json.dumps(validation,indent=2))
            else:
                validation=inspect_media(video,staging/'inspection')
        except (ImportError,OSError,ValueError):
            raise AcquisitionError("Local software validation failed; install PyAV, Pillow and NumPy or check the downloaded file") from None
        if not (validation.get('full_video_decode_passed') or (container_only and validation.get('container_structure_validated'))):
            raise AcquisitionError("The saved file did not fully decode")
        record = {'source_url':source,'platform':'instagram','method':'user_supplied_browser_download',
                  'acquired_at':dt.datetime.now(dt.timezone.utc).isoformat(),
                  'sha256':digest,'bytes':video.stat().st_size,'file':'reference.mp4',
                  'duration_seconds':validation['duration_seconds'],'audio_present':validation['audio_present'],
                  'source_association':'caller_supplied_source_requires_visual_comparison',
                  'browser_credentials_exported':False,'media_url_persisted':False,
                  'validation':'container_only' if container_only else 'full_local_decode_passed','analysis_completed':False,
                  'inspection':'inspection/validation.json'}
        (staging/'acquisition.json').write_text(json.dumps(record,indent=2))
        destination = root/digest
        if destination.exists():
            with (destination/'reference.mp4').open('rb') as f:
                if hashlib.file_digest(f,'sha256').hexdigest()!=digest:
                    raise AcquisitionError("Existing archive does not match its checksum")
        else:
            shutil.copytree(staging,destination)
    return {**record,'archive_directory':str(destination)}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-url',required=True)
    parser.add_argument('--file',required=True)
    parser.add_argument('--output',required=True)
    parser.add_argument('--container-only',action='store_true',help='Validate MP4 structure without claiming full codec decoding')
    args=parser.parse_args()
    print(json.dumps(import_download(args.source_url,args.file,args.output,args.container_only),indent=2))

if __name__=='__main__':main()
