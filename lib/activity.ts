export type Activity = 'imports'|'itineraries'|'providerSearches'|'bookmarks';
export const activityKey='reeltrip-activity-v1';
export function recordActivity(event:Activity){try{const data=JSON.parse(localStorage.getItem(activityKey)||'{}');data[event]=(Number(data[event])||0)+1;localStorage.setItem(activityKey,JSON.stringify(data));window.dispatchEvent(new Event('reeltrip-activity'));}catch{}}
