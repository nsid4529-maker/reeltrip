const VIEWED_KEY='reeltrip-places-opened-v1';

// Cards and map pins share one deliberate view per bucket/place/browser session.
export function firstPlaceView(browser:Pick<Window,'sessionStorage'>,placeId:string,bucketId?:string):boolean{
 try{
  const storage=browser.sessionStorage;
  const key=JSON.stringify([bucketId??null,placeId]),seen=new Set<string>(JSON.parse(storage.getItem(VIEWED_KEY)||'[]'));
  if(seen.has(key))return false;
  seen.add(key);storage.setItem(VIEWED_KEY,JSON.stringify([...seen]));return true;
 }catch{return false;}
}
