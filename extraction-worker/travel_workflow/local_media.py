"""Full software decode, sampled frames and a speech-ready WAV from a local file."""
import json
import math
import wave
from pathlib import Path

def inspect_media(source, output):
    import av
    from PIL import Image, ImageDraw
    root=Path(output);root.mkdir(parents=True,exist_ok=True)
    frames=[];count=0;next_sample=0
    with av.open(str(source)) as container:
        video=container.streams.video[0]
        duration=float(container.duration/av.time_base)
        if not math.isfinite(duration) or not 0<duration<=600:
            raise ValueError('Expected a video shorter than 10 minutes')
        interval=duration/36
        targets=[(i+.5)*interval for i in range(36)]
        video_info={'codec':video.codec_context.name,'width':video.codec_context.width,'height':video.codec_context.height}
        audio_present=bool(container.streams.audio)
        for frame in container.decode(video=0):
            count+=1
            seconds=float(frame.time or 0)
            if next_sample<len(targets) and seconds>=targets[next_sample]:
                path=root/f'frame-{next_sample+1:03}.jpg'
                frame.to_image().save(path,quality=88)
                frames.append({'file':path.name,'seconds':seconds})
                next_sample+=1
    if not count or not frames:raise ValueError('No decoded video frames')
    audio_frames=0;audio_samples=0
    if audio_present:
        with av.open(str(source)) as container,wave.open(str(root/'speech.wav'),'wb') as wav:
            wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(16000)
            resampler=av.AudioResampler(format='s16',layout='mono',rate=16000)
            for frame in container.decode(audio=0):
                audio_frames+=1;audio_samples+=frame.samples
                for converted in resampler.resample(frame):
                    wav.writeframes(converted.to_ndarray().tobytes())
            for converted in resampler.resample(None):
                wav.writeframes(converted.to_ndarray().tobytes())
        if not audio_frames:raise ValueError('No decoded audio frames')
    sheets=[]
    for page in range(math.ceil(len(frames)/12)):
        group=frames[page*12:(page+1)*12]
        sheet=Image.new('RGB',(864,536*math.ceil(len(group)/3)),'#202020');draw=ImageDraw.Draw(sheet)
        for i,item in enumerate(group):
            with Image.open(root/item['file']) as im:
                im.thumbnail((288,512));x,y=i%3*288,i//3*536;sheet.paste(im,(x,y))
                draw.text((x+6,y+515),f"{item['seconds']:.1f}s",fill='white')
        path=root/f'sheet-{page+1}.jpg';sheet.save(path,quality=75);sheets.append(path.name)
    result={'method':'PyAV software decoder','duration_seconds':duration,'video':video_info,
            'audio_present':audio_present,'full_video_decode_passed':True,
            'full_audio_decode_passed':audio_present,'decoded_video_frames':count,
            'decoded_audio_frames':audio_frames,'decoded_audio_samples':audio_samples,
            'sampled_frames':frames,'contact_sheets':sheets,'speech_audio':'speech.wav' if audio_present else None,
            'visual_review_completed':False,'speech_transcription_completed':False}
    (root/'validation.json').write_text(json.dumps(result,indent=2))
    return result
