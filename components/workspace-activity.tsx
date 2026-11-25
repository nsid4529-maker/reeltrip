'use client';
import {useEffect,useState} from 'react';
import {activityKey} from '@/lib/activity';
export function WorkspaceActivity(){
 const [counts,setCounts]=useState<Record<string,number>>({});
 useEffect(()=>{const read=()=>{try{setCounts(JSON.parse(localStorage.getItem(activityKey)||'{}'));}catch{}};read();window.addEventListener('reeltrip-activity',read);return()=>window.removeEventListener('reeltrip-activity',read);},[]);
 return <><div className="eyebrow">YOUR PLANNING ACTIVITY</div><h2>A little progress, at a glance.</h2><p>These counters record actions in this browser only. They are not site-wide visitor analytics, unique users or confirmed bookings.</p><div className="activity-grid">{[['imports','Reviewed imports'],['itineraries','Itineraries generated'],['providerSearches','Provider links opened'],['bookmarks','Save actions']].map(([id,label])=><div key={id}><strong>{Number(counts[id])||0}</strong><span>{label}</span></div>)}</div><p>No analytics provider receives this data. Clear your guest workspace to reset these counts. Shared website traffic analytics still need a separate service.</p></>;
}
