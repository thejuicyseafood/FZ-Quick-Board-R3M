const CACHE='fzqb-host-only-r3m854-undo';
const SHELL=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./fast-seat-v53.js','./daily-clear-v54.js','./firebase-app-compat.js','./firebase-database-compat.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)));self.skipWaiting()});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(new URL(e.request.url).origin!==self.location.origin||e.request.method!=='GET')return;e.respondWith(fetch(e.request).catch(()=>caches.match(e.request).then(r=>r||Response.error())))});
