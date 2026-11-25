export const WORKSPACE_RETURN_KEY='reeltrip.workspace-return.v1';
export type WorkspaceReturn={reelId:string;bundleId?:string};
export function readWorkspaceReturn(raw:string|null):WorkspaceReturn|null{
 if(!raw||raw.length>2048)return null;
 try{const v=JSON.parse(raw);if(v?.version!==1||typeof v.reelId!=='string'||!v.reelId||v.reelId.length>300)return null;
  if(v.bundleId!==undefined&&(typeof v.bundleId!=='string'||!/^[0-9a-f-]{36}$/i.test(v.bundleId)))return null;
  return {reelId:v.reelId,...(v.bundleId?{bundleId:v.bundleId}:{})};
 }catch{return null;}
}
