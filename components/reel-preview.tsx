'use client';
import {useState} from 'react';
import {ArrowUpRight,Film,Play} from 'lucide-react';
import {reelPreviewSource} from '@/lib/reel-preview';

export function ReelPreview({url,title,creator,collapsed=false}:{url:string;title?:string;creator?:string;collapsed?:boolean}){
 const source=reelPreviewSource(url),[opened,setOpened]=useState(!collapsed),[attempt,setAttempt]=useState(0),[failed,setFailed]=useState(false);
 if(!source)return null;
 return <figure className="source-preview">
  <figcaption><span className="eyebrow"><Film size={14}/> ORIGINAL REEL · {source.platform}</span><strong>{title||'The video behind your trip'}</strong>{creator&&<span>{source.platform==='Uploaded video'?creator:'@'+creator}</span>}</figcaption>
  {source.platform==='Uploaded video'&&(opened?<video key={source.url+attempt} src={source.url} controls preload="metadata" playsInline onError={()=>setFailed(true)}/>:<button className="preview-load" onClick={()=>setOpened(true)}><Play size={21}/>Play uploaded video</button>)}
  {source.embed&&(opened?<iframe key={source.embed+attempt} src={source.embed} title={`${source.platform} preview: ${title||'selected reel'}`} loading="eager" referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen onError={()=>setFailed(true)}/>:<button className="preview-load" onClick={()=>setOpened(true)}><Play size={21}/>Preview this reel</button>)}
  {failed&&<p role="status">{source.platform==='Uploaded video'?'This private video may have expired or belong to another browser. Upload it again to view or reanalyse it.':'The preview couldn’t load. Open the original video below, or reload the preview.'}</p>}
  {(source.embed||source.platform==='Uploaded video')&&opened&&<button className="preview-original" onClick={()=>{setFailed(false);setAttempt(n=>n+1);}}>Reload preview</button>}
  <a className="preview-original" href={source.url} target="_blank" rel="noopener noreferrer">{source.platform==='Uploaded video'?'Open uploaded video':'Open original on '+source.platform}<ArrowUpRight size={14}/></a>
  <small>{source.platform==='Uploaded video'?'Private to this browser. Uploaded video files are retained for 7 days; keep your own copy.':source.embed?'Preview supplied by '+source.platform+'. If it is unavailable here, open the original.':'Open the original to preview this short link. Its full preview appears after successful analysis.'}</small>
 </figure>;
}
