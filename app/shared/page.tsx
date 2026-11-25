'use client';
import {useEffect,useState} from 'react';
import {WorkspaceHeader} from '@/components/workspace-navigation';
import {SharedBucketList,SharedBucketView} from '@/components/shared-bucket';

export default function SharedPage(){
 const [id,setId]=useState<string|null|undefined>(undefined);
 useEffect(()=>{const value=new URLSearchParams(location.search).get('id');setId(value&&/^[0-9a-f-]{36}$/i.test(value)?value:null);},[]);
 return <div className="reel-app shared-workspace"><WorkspaceHeader active="shared" helpHref={id?'#shared-guide-heading':'/shared'}/><main className={'reservation-examples shared-page'+(id?' shared-dashboard-page':' shared-landing-page')}>
  {id===undefined?<p role="status">Loading…</p>:id?<><a className="text-button shared-back" href="/shared">← All shared buckets</a><SharedBucketView id={id}/></>:<SharedBucketList/>}
 </main></div>;
}
