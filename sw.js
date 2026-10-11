/* Service worker : cache-first.
   Après toute modification d'un fichier de l'appli, incrémenter CACHE_VERSION
   pour que les téléphones récupèrent la nouvelle version, et APP_VERSION dans index.html. */
const CACHE_VERSION='1.10.0';
const CACHE='suivi-solaire-'+CACHE_VERSION;
const FONT_CACHE='suivi-solaire-fonts';
const ASSETS=['./','index.html','store.js','sync.js','model.js','seed.json','manifest.webmanifest',
  'vendor/chart.umd.min.js','vendor/supabase.js','icons/icon-180.png','icons/icon-192.png','icons/icon-512.png'];
const FONT_HOSTS=['fonts.googleapis.com','fonts.gstatic.com'];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});

/* la nouvelle version attend ; la page l'active quand on touche « Mettre à jour » */
self.addEventListener('message',e=>{if(e.data==='skipWaiting')self.skipWaiting()});

self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys()
    .then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&k!==FONT_CACHE).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim()));
});

async function cacheFirst(req,cacheName,opts){
  const cache=await caches.open(cacheName);
  const hit=await cache.match(req,opts);
  if(hit)return hit;
  const res=await fetch(req);
  if(res.ok||res.type==='opaque')cache.put(req,res.clone());
  return res;
}

self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(FONT_HOSTS.includes(url.hostname)){e.respondWith(cacheFirst(req,FONT_CACHE));return}
  if(url.origin!==self.location.origin)return;
  if(req.mode==='navigate'){
    e.respondWith(caches.match('index.html',{ignoreSearch:true}).then(hit=>hit||fetch(req)));
    return;
  }
  e.respondWith(cacheFirst(req,CACHE,{ignoreSearch:true}));
});
