const C='kb5',A=['./','index.html','css/style.css','js/app.js','js/api.js','js/store.js','js/nutrition.js','icon.svg','icon-192.png','icon-512.png','icon-maskable-512.png','apple-touch-icon.png','manifest.webmanifest'];
self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(A)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>clients.claim())));
self.addEventListener('fetch',e=>{const q=e.request;if(q.method!=='GET'||new URL(q.url).origin!==location.origin)return;
e.respondWith(fetch(q).then(r=>{const c=r.clone();caches.open(C).then(x=>x.put(q,c));return r}).catch(()=>caches.match(q)))});
