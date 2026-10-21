const CACHE='fzqb-r3m8-49-database-path-v1';
const SHELL=[
  './','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png',
  './shift-analytics-v29.js','./monitor-captions.js','./table-capacity-v30.js',
  './smart-next.css','./smart-next.js','./scheduled-cut-v23.js','./beeper-history-v43.js','./table-audit-v49.js',
  './database-transport-v49.js','./background-sync-v49.js'
];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).catch(()=>{}).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  // Database traffic goes directly to Firebase. Never substitute app HTML for
  // a failed database response, or keep a stalled database request in this worker.
  if(new URL(e.request.url).origin!==self.location.origin)return;
  e.respondWith(fetch(e.request).then(r=>{
    const copy=r.clone();
    if(r.ok&&new URL(e.request.url).origin===self.location.origin)caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});
    return r;
  }).catch(async()=>{
    const cached=await caches.match(e.request,{ignoreSearch:true});
    if(cached)return cached;
    if(e.request.mode==='navigate')return caches.match('./index.html');
    throw new Error('App resource unavailable');
  }));
});
