"""Bounded MP4 structure inspection; explicitly not a codec decode check."""
import math
import struct
from pathlib import Path

def inspect_container(source):
    data=Path(source).read_bytes();length=len(data)
    if not 0<length<=50_000_000:raise ValueError('File size outside 50 MB limit')
    def boxes(start,end):
        while start<end:
            if end-start<8:raise ValueError('Truncated MP4 box header')
            size,kind=struct.unpack_from('>I4s',data,start);header=8
            if size==1:
                if end-start<16:raise ValueError('Truncated extended size')
                size=struct.unpack_from('>Q',data,start+8)[0];header=16
            elif size==0:size=end-start
            if size<header or start+size>end:raise ValueError('Truncated or invalid MP4 box')
            yield kind,start+header,start+size
            start+=size
    def children(box):return list(boxes(box[1],box[2]))
    def first(items,kind):return next(x for x in items if x[0]==kind)
    top=list(boxes(0,length))
    if not any(k==b'ftyp' for k,_,_ in top):raise ValueError('Not an MP4 container')
    mdats=[(s,e) for k,s,e in top if k==b'mdat']
    if not mdats or not sum(e-s for s,e in mdats):raise ValueError('No media payload')
    try:
        moov=children(first(top,b'moov'));mvhd=first(moov,b'mvhd');v=data[mvhd[1]]
        if v not in (0,1):raise ValueError('Unsupported duration header')
        scale=struct.unpack_from('>I',data,mvhd[1]+(20 if v else 12))[0]
        ticks=struct.unpack_from('>Q' if v else '>I',data,mvhd[1]+(24 if v else 16))[0]
        duration=ticks/scale
        if not math.isfinite(duration) or not 0<duration<=600:raise ValueError('Invalid duration')
        tracks=[]
        for trak in [x for x in moov if x[0]==b'trak']:
            parts=children(trak);mdia=children(first(parts,b'mdia'));hdlr=first(mdia,b'hdlr')
            handler=data[hdlr[1]+8:hdlr[1]+12].decode('ascii')
            stbl=children(first(children(first(mdia,b'minf')),b'stbl'))
            stsd=first(stbl,b'stsd');codec=data[stsd[1]+12:stsd[1]+16].decode('ascii')
            stsz=first(stbl,b'stsz');samples=struct.unpack_from('>I',data,stsz[1]+8)[0]
            for box in [x for x in stbl if x[0] in (b'stco',b'co64')]:
                count=struct.unpack_from('>I',data,box[1]+4)[0];step=8 if box[0]==b'co64' else 4
                if box[1]+8+count*step>box[2]:raise ValueError('Truncated media offset table')
                for i in range(count):
                    pos=struct.unpack_from('>Q' if step==8 else '>I',data,box[1]+8+i*step)[0]
                    if not any(s<=pos<e for s,e in mdats):raise ValueError('Media offset outside payload')
            item={'type':handler,'codec':codec,'encoded_sample_count':samples}
            if handler=='vide':
                tkhd=first(parts,b'tkhd');w,h=struct.unpack_from('>II',data,tkhd[2]-8)
                item.update(width=w/65536,height=h/65536)
            tracks.append(item)
        if not any(x['type']=='vide' and x['encoded_sample_count']>0 for x in tracks):raise ValueError('No populated video stream')
    except (StopIteration,struct.error,ZeroDivisionError,UnicodeError,IndexError) as error:
        raise ValueError('Incomplete or unsupported MP4 structure') from error
    return {'method':'standard-library MP4 box and media-offset inspection',
            'container_structure_validated':True,'duration_seconds':duration,'streams':tracks,
            'audio_present':any(x['type']=='soun' for x in tracks),'bytes':length,
            'full_video_decode_passed':False,'full_audio_decode_passed':False,
            'visual_review_completed':False,'limitation':'Container validation is not codec decoding or visual inspection.'}
