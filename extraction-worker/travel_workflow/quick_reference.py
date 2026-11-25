"""Prepare speech and sampled visual evidence concurrently after acquisition."""
from __future__ import annotations
import concurrent.futures as cf
import datetime as dt
import json
import math
import subprocess
import threading
import time
from pathlib import Path
from .video_acquisition import acquire_video
from .evidence_cache import prepared_cache, read_json, valid_acquisition

_SPEECH_LOCK = threading.Lock()
_VISUAL_LOCK = threading.Lock()
_MODELS = {}


def speech_review_flags(segments, duration):
    """Flag suspicious intervals, not a claim that speech actually occurs there."""
    flags = []
    end = 0.0
    for s in segments:
        start = max(0.0, float(s['start']))
        if start-end >= 8:
            flags.append({'kind': 'transcript_gap', 'start': round(end, 2), 'end': start,
                          'action': 'Check audio/captions; this could be silence or missed speech'})
        end = max(end, float(s['end']))
        if s.get('avg_logprob', 0) < -0.8 or s.get('no_speech_prob', 0) > 0.75:
            flags.append({'kind': 'uncertain_speech', 'start': start, 'end': s['end'],
                          'action': 'Verify against captions/audio before extracting facts'})
    if duration-end >= 8:
        flags.append({'kind': 'transcript_gap', 'start': round(end, 2), 'end': round(duration, 2),
                      'action': 'Check the tail for silence or missed speech'})
    return flags


def prepare_reference(source_url, output_dir, upload=None, provider="auto", *, fast=False, reuse=True):
    """Return evidence, not a model's claim to have visually reviewed the clip.

    Requires ffmpeg, ffprobe, Pillow and faster-whisper. Uses two CPU workers:
    Whisper runs with one CPU thread; ffmpeg uses one decoder/filter/encoder thread.
    Optional upload contains a presigned HTTPS upload_url plus media_id and url.
    Upload credentials are never stored in the output or printed.
    """
    root = Path(output_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    timings = {}
    settings = {'pipeline_version': 3, 'profile': 'fast' if fast else 'thorough',
                'speech_model': 'small', 'beam_size': 1 if fast else 5,
                'speech_task': 'translate' if fast else 'transcribe',
                'sample_frames': 24 if fast else 36}
    if reuse and not upload:
        cached = prepared_cache(root, source_url, settings)
        if cached:
            return {**cached, 'cache_status': 'prepared_evidence',
                    'this_run_seconds': round(time.perf_counter()-started, 3)}
    def save(name, value):
        path = root / name
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(value, indent=2))
        temporary.replace(path)
    def mark(stage):
        print(json.dumps({"source_url": source_url, "stage": stage,
                          "elapsed_seconds": round(time.perf_counter()-started, 2)}), flush=True)
    acq = read_json(root / 'acquisition.json') if reuse else None
    acquisition_cached = valid_acquisition(acq, source_url)
    if not acquisition_cached:
        options = {'download_seconds': 30} if fast else {}
        acq = acquire_video(source_url, root / "archive", provider=provider, **options)
    timings["acquire_seconds"] = round(time.perf_counter()-started, 3)
    save("acquisition.json", acq)
    mark("download_validated")
    video = acq["file"]
    # A separate evidence directory per content hash prevents stale sheets on reruns.
    evidence = root / acq["sha256"] / settings['profile']
    evidence.mkdir(parents=True, exist_ok=True)
    def extract_visuals():
        from PIL import Image, ImageDraw
        at = time.perf_counter()
        interval = max(0.1, acq["duration_seconds"]/settings['sample_frames'])
        for stale in evidence.glob('frame-*.jpg'):
            stale.unlink()
        command = ["ffmpeg", "-v", "error", "-xerror", "-nostdin", "-y",
                   "-threads", "1", "-protocol_whitelist", "file,pipe", "-i", video, "-map", "0:v:0",
                   "-vf", f"fps=1/{interval},scale={480 if fast else 288}:-2",
                   "-filter_threads", "1", "-threads", "1", "-q:v", "4",
                   str(evidence/"frame-%03d.jpg"), "-map", "0:a:0?",
                   "-f", "null", "-"]
        subprocess.run(command, check=True, capture_output=True, timeout=90)
        frames = sorted(evidence.glob("frame-*.jpg"))[:settings['sample_frames']]
        if not frames:
            raise RuntimeError("No visual frames extracted")
        sheets = []
        width, height = (224, 400) if fast else (288, 512)
        for page in range(math.ceil(len(frames)/12)):
            group = frames[page*12:(page+1)*12]
            thumbs = []
            for f in group:
                with Image.open(f) as image:
                    thumb = image.convert("RGB")
                    thumb.thumbnail((width,height))
                    thumbs.append(thumb.copy())
            sheet = Image.new("RGB",(width*3,(height+24)*math.ceil(len(group)/3)),"#202020")
            draw = ImageDraw.Draw(sheet)
            for j,thumb in enumerate(thumbs):
                x,y=(j%3)*width,(j//3)*(height+24)
                sheet.paste(thumb,(x,y))
                seconds = min((page*12+j+.5)*interval,acq["duration_seconds"])
                draw.text((x+6,y+height+3),f"approx {seconds:.1f}s",fill="white")
            target = evidence/f"sheet-{page+1}.jpg"
            quality = 58 if fast else 68
            sheet.save(target,quality=quality)
            # Two fast sheets fit in one 512 KiB visual-inspection call.
            while fast and target.stat().st_size > 240*1024:
                if quality > 30:
                    quality -= 7
                else:
                    sheet = sheet.resize((int(sheet.width*.9), int(sheet.height*.9)))
                sheet.save(target,quality=quality)
            sheets.append(str(target))
        result = {"decode_passed":True,"interval_seconds":interval,
                  "frame_count":len(frames),"contact_sheets":sheets,
                  "contact_sheet_bytes":{p:Path(p).stat().st_size for p in sheets},
                  "visual_review_completed":False,
                  "seconds":round(time.perf_counter()-at,3)}
        save("visual-evidence.json",result)
        mark("frames_ready")
        return result
    def visuals():
        with _VISUAL_LOCK:
            return extract_visuals()
    def speech():
        at = time.perf_counter()
        if not acq["audio_present"]:
            result={"audio_present":False,"segments":[]}
        else:
            from faster_whisper import WhisperModel
            # One loaded model and one ASR job at a time across the whole batch.
            # Another clip can download/extract frames while this one transcribes.
            with _SPEECH_LOCK:
                if 'small' not in _MODELS:
                    _MODELS['small'] = WhisperModel("small",device="cpu",compute_type="int8",cpu_threads=1)
                options = {'condition_on_previous_text': False, 'no_speech_threshold': None,
                           'temperature': 0.0, 'task': 'translate'} if fast else {}
                segments,info=_MODELS['small'].transcribe(video,beam_size=settings['beam_size'],vad_filter=False,**options)
                result={"audio_present":True,"language":info.language,
                        "task":settings['speech_task'], "output_language":'en' if fast else info.language,
                        "language_probability":info.language_probability,
                        "duration":info.duration,
                        "segments":[{"start":round(s.start,2),"end":round(s.end,2),
                                     "text":s.text.strip(),
                                     "avg_logprob":round(s.avg_logprob,3),
                                     "no_speech_prob":round(s.no_speech_prob,3)} for s in segments]}
            result['review_flags'] = speech_review_flags(result['segments'], acq['duration_seconds'])
        result["seconds"]=round(time.perf_counter()-at,3)
        save("asr-raw.json",result)
        mark("speech_ready")
        return result
    def transfer():
        at=time.perf_counter()
        if not upload:
            return {"status":"not_requested","seconds":0}
        from urllib.parse import urlsplit
        parsed=urlsplit(upload["upload_url"])
        if parsed.scheme!="https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Upload endpoint must be HTTPS")
        p=subprocess.run(["curl","--disable","-f","-sS","--proto","=https","--max-time","45",
                          "-X","PUT","-H","Content-Type: video/mp4",
                          "-H","If-None-Match: *","--upload-file",video,
                          upload["upload_url"],"-o","/dev/null","-w","%{http_code}"],
                         capture_output=True,text=True,timeout=50)
        if p.returncode!=0 or p.stdout!="200":
            raise RuntimeError("Media upload did not return HTTP 200")
        result={"status":"uploaded_pending_confirmation","http_status":200,
                "media_id":upload["media_id"],"media_url":upload.get("url"),
                "seconds":round(time.perf_counter()-at,3)}
        save("upload.json",result)
        mark("upload_ready")
        return result
    # Three I/O tasks, with CPU work constrained to two threads in total.
    with cf.ThreadPoolExecutor(max_workers=3) as pool:
        futures={name:pool.submit(fn) for name,fn in
                 [("visuals",visuals),("speech",speech),("upload",transfer)]}
        results={name:future.result() for name,future in futures.items()}
    timings.update({name+"_seconds":value["seconds"] for name,value in results.items()})
    timings["processing_total_seconds"]=round(time.perf_counter()-started,3)
    acq['validation'].update({'full_video_decode_passed': True,
                             'full_audio_decode_passed': True if acq['audio_present'] else None})
    save('acquisition.json', acq)
    result={"status":"evidence_ready","source_url":acq["source_url"],
            "prepared_at":dt.datetime.now(dt.timezone.utc).isoformat(),
            "acquisition":acq,"timings":timings,"settings":settings,
            "cache_status":'acquisition' if acquisition_cached else 'miss',**results,
            "visual_review_completed":False,"analysis_completed":False}
    save("prepared.json",result)
    mark("evidence_ready")
    return result
