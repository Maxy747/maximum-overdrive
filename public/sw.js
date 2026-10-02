// MAX service worker.
// - Keeps the app itself on the phone so it opens instantly and works offline.
// - Keeps photos you've already seen, so they are not downloaded again.
// - Shows push notifications (reminders, partner activity) when the app is closed.
// Tracker and journal data are kept by the app itself (app/offline.ts), not here.
// The build fills in VERSION and PRECACHE (scripts/build-selfhost.mjs).
const VERSION='dev';
const PRECACHE=[];
const SHELL='max-shell-'+VERSION,PHOTOS='max-photos',MAX_PHOTOS=2500;
const scope=new URL(self.registration.scope);
const home=new URL('./',scope).href;
const inScope=url=>url.origin===scope.origin&&url.pathname.startsWith(scope.pathname);

self.addEventListener('install',event=>{
 event.waitUntil(caches.open(SHELL).then(cache=>cache.addAll([home,...PRECACHE.map(path=>new URL(path,scope).href)].map(href=>new Request(href,{cache:'reload'})))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('max-shell-')&&k!==SHELL).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});

async function put(cacheName,request,response){try{await (await caches.open(cacheName)).put(request,response)}catch{/* storage full: MAX still works online */}}

// Opening the app: fresh from the server when it answers quickly, otherwise the copy on the phone.
async function page(request){
 const cached=caches.open(SHELL).then(cache=>cache.match(home));
 try{
  const response=await Promise.race([fetch(request),new Promise((_,reject)=>setTimeout(()=>reject(Error('slow')),3500))]);
  if(response.ok&&response.headers.get('content-type')?.includes('text/html'))void put(SHELL,home,response.clone());
  return response;
 }catch{return (await cached)||Response.error()}
}

// Build files carry a content hash in their name and photos a random id: neither ever changes,
// so the phone's copy is always right and is never downloaded twice.
async function cacheFirst(request,cacheName){
 const hit=await caches.match(request);if(hit)return hit;
 const response=await fetch(request);
 if(response.ok&&response.type==='basic'){await put(cacheName,request,response.clone());if(cacheName===PHOTOS)void trimPhotos()}
 return response;
}

// Icons and the manifest: answer from the phone, refresh in the background.
async function staleWhileRevalidate(request){
 const hit=await caches.match(request);
 const fresh=fetch(request).then(response=>{if(response.ok)void put(SHELL,request,response.clone());return response}).catch(()=>hit||Response.error());
 return hit||fresh;
}

// Oldest photos go first once the phone holds a lot of them.
let trimming=false;
async function trimPhotos(){
 if(trimming)return;trimming=true;
 try{const cache=await caches.open(PHOTOS),keys=await cache.keys();for(const key of keys.slice(0,Math.max(0,keys.length-MAX_PHOTOS)))await cache.delete(key)}catch{}
 trimming=false;
}

self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||!inScope(url))return;
 const path=url.pathname.slice(scope.pathname.length);
 if(request.mode==='navigate')return event.respondWith(page(request));
 if(path.startsWith('assets/'))return event.respondWith(cacheFirst(request,SHELL));
 // Hidden-vault photos (api/vault/file) are never kept on the phone.
 if(path==='api/files'&&url.searchParams.get('inline')==='1')return event.respondWith(cacheFirst(request,PHOTOS));
 if(path==='api/accounts/avatar'&&url.searchParams.has('v'))return event.respondWith(cacheFirst(request,PHOTOS));
 if(path.startsWith('api/')||path==='sw.js')return;
 if(/\.(png|svg|webmanifest|ico)$/.test(path))return event.respondWith(staleWhileRevalidate(request));
});

self.addEventListener('push',event=>{
 let data={};
 try{data=event.data?event.data.json():{}}catch{data={title:'MAX',body:event.data?event.data.text():''}}
 event.waitUntil(self.registration.showNotification(data.title||'MAX',{
  body:data.body||'',
  tag:data.tag||undefined,
  icon:new URL('max-icon-192-v3.png',self.registration.scope).href,
  badge:new URL('max-icon-192-v3.png',self.registration.scope).href,
  data:{url:self.registration.scope,view:typeof data.view==='string'?data.view:'',target:typeof data.target==='string'?data.target:''},
 }));
});

self.addEventListener('notificationclick',event=>{
 event.notification.close();
 // Open MAX on the page the notification is about (Today for reminders, Journal for your partner).
 const data=event.notification.data||{},view=/^[A-Za-z]+$/.test(data.view||'')?data.view:'';
 const target=/^(goal:[\w-]{1,80}|recap|advice)$/.test(data.target||'')?data.target:'';
 const url=new URL(data.url||self.registration.scope);if(view)url.searchParams.set('open',view);if(target)url.searchParams.set('target',target);
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
  for(const client of list){if('focus' in client){if(view)client.postMessage({type:'open',view,target});return client.focus()}}
  return self.clients.openWindow(url.href);
 }));
});
