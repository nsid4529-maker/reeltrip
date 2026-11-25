"""Real decoder regression: audio continues after the last video frame."""
import json
import subprocess
import tempfile
from pathlib import Path
from service.pipeline import extract_frames, run_ffmpeg
from travel_workflow.video_acquisition import probe_video

with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    video = root / 'fixture.mp4'
    subprocess.run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error',
                    '-f', 'lavfi', '-i', 'color=c=red:s=240x420:d=2',
                    '-f', 'lavfi', '-i', 'sine=frequency=400:duration=2.25',
                    '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', str(video)], check=True)
    record = probe_video(video)
    frames = extract_frames(video, root, record['duration_seconds'])
    assert len(frames) >= 2 and all(path.stat().st_size > 0 for _, path in frames)
    run_ffmpeg(['-i', str(video), '-t', '2', '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', '-threads', '1', str(root / 'audio.mp3')])
    print('Real media decode, tail-frame sampling and audio extraction passed.')

    # Small text must retain available pixels without enlarging low-res inputs.
    # Exercise both orientations using the real production filter and decoder.
    for width, height, expected in [(240, 420, (240, 420)), (420, 240, (420, 240)),
                                    (1080, 1920, (720, 1280)), (1920, 1080, (1280, 720))]:
        case = root / f'{width}x{height}'
        case.mkdir()
        video = case / 'fixture.mp4'
        run_ffmpeg(['-f', 'lavfi', '-i', f'color=c=blue:s={width}x{height}:r=2:d=1',
                    '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', str(video)])
        frames = extract_frames(video, case, 1)
        for _, frame in frames:
            dimensions = json.loads(subprocess.check_output([
                'ffprobe', '-v', 'error', '-select_streams', 'v:0',
                '-show_entries', 'stream=width,height', '-of', 'json', str(frame)]))['streams'][0]
            assert (dimensions['width'], dimensions['height']) == expected, dimensions
    print('Portrait/landscape sampling preserves source detail and never upscales.')
