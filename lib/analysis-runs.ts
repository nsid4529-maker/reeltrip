// One request per reel across mounted views. A view releases only its own
// subscription; remaining views keep the request alive. Superseded results
// must neither update the cache nor resolve into a stale caller's screen.
export class AnalysisRuns<T>{
 private runs=new Map<string,{controller:AbortController;promise:Promise<T>;owners:Set<object>;version?:string;started:boolean}>();
 get(id:string,owner?:object){const entry=this.runs.get(id);if(owner)entry?.owners.add(owner);return entry?.promise;}
 version(id:string){return this.runs.get(id)?.version;}
 // Until work dispatches, storage still contains the previous attempt. A
 // second view joining in that same tick must not treat it as a replacement.
 activeVersion(id:string){const entry=this.runs.get(id);return entry?.started?entry.version:undefined;}
 run(id:string,work:(controller:AbortController,isCurrent:()=>boolean)=>Promise<T>,owner?:object,version?:string):Promise<T>{
  const existing=this.get(id,owner);if(existing)return existing;
  const controller=new AbortController();
  const isCurrent=()=>this.runs.get(id)?.controller===controller;
  const check=()=>{controller.signal.throwIfAborted();if(!isCurrent())throw new DOMException('A newer analysis replaced this request.','AbortError');};
  const promise=Promise.resolve().then(()=>{check();this.runs.get(id)!.started=true;return work(controller,isCurrent);}).then(value=>{check();return value;},error=>{check();throw error;}).finally(()=>{if(isCurrent())this.runs.delete(id);});
  this.runs.set(id,{controller,promise,owners:new Set(owner?[owner]:[]),version,started:false});return promise;
 }
 release(owner:object){for(const [id,entry] of this.runs)if(entry.owners.delete(owner)&&!entry.owners.size)this.supersede(id);}
 supersede(id:string){const entry=this.runs.get(id);if(!entry)return;this.runs.delete(id);entry.controller.abort();}
 abortAll(){for(const id of this.runs.keys())this.supersede(id);}
}
