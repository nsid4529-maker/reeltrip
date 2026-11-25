// No video data, provider responses, or guest drafts are cached by this worker.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>new Response('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>ReelTrip offline</title><h1>You’re offline</h1><p>Reconnect, then reload to receive your shared video. Your existing trip remains on this device.</p></html>',{headers:{'Content-Type':'text/html; charset=utf-8'}})));
});
