export const UPLOAD_MAX_BYTES=50_000_000;
export const UPLOAD_MAX_SECONDS=180;
export const UPLOAD_RETENTION_DAYS=7;
export type UploadMetadata={id:string;expiresAt:string;mimeType:'video/mp4'|'video/quicktime'|'video/webm';size:number;durationSeconds:number};
export const uploadReference=(value:unknown):{id:string;url:string}|null=>{
 if(typeof value!=='string')return null;
 const id=value.match(/^\/api\/upload\?id=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)?.[1]?.toLowerCase();
 return id?{id,url:'/api/upload?id='+id}:null;
};
export function uploadFileType(file:{name:string;type:string;size:number}):UploadMetadata['mimeType']{
 if(!Number.isInteger(file.size)||file.size<=0)throw new Error('Choose a video file that is not empty.');
 if(file.size>UPLOAD_MAX_BYTES)throw new Error('This video is too large. Choose a file up to 50 MB.');
 const types=['video/mp4','video/quicktime','video/webm'] as const;
 const inferred=file.name.toLowerCase().endsWith('.mp4')?'video/mp4':file.name.toLowerCase().endsWith('.mov')?'video/quicktime':file.name.toLowerCase().endsWith('.webm')?'video/webm':null;
 const type=types.find(type=>type===file.type)||(!file.type?inferred:null);
 if(!type)throw new Error('Choose an MP4, MOV or WebM video. Other file types cannot be analysed.');
 return type;
}
