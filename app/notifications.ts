'use client';
// Web Push on this device. On iPhone this only works in iOS 16.4+ once MAX is added to the Home Screen
// and opened from there (the "standalone" web app), over HTTPS.

export type PushStatus='unsupported'|'needs-install'|'denied'|'off'|'on';

export const isIOS=()=>typeof navigator!=='undefined'&&(/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1));
export const isStandalone=()=>typeof window!=='undefined'&&(window.matchMedia('(display-mode: standalone)').matches||(navigator as Navigator&{standalone?:boolean}).standalone===true);
const pushCapable=()=>typeof window!=='undefined'&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;

// Also installs MAX for offline use. A new version takes over in the background; it is applied the
// next time MAX comes back to the foreground, so nothing reloads while you're typing.
export function registerServiceWorker(){
 if(typeof window==='undefined'||!('serviceWorker' in navigator))return;
 // Ask the browser not to clear MAX's offline copy when the phone is low on space.
 void navigator.storage?.persist?.().catch(()=>{});
 const hadController=!!navigator.serviceWorker.controller;let updated=false;
 navigator.serviceWorker.addEventListener('controllerchange',()=>{if(hadController)updated=true});
 document.addEventListener('visibilitychange',()=>{if(updated&&document.visibilityState==='visible')window.location.reload()});
 navigator.serviceWorker.register('./sw.js').then(reg=>{document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void reg.update().catch(()=>{})})}).catch(()=>{});
}

function base64UrlToBytes(value:string){const pad='='.repeat((4-value.length%4)%4),b64=(value+pad).replace(/-/g,'+').replace(/_/g,'/'),raw=atob(b64);return Uint8Array.from(raw,c=>c.charCodeAt(0))}

export async function pushStatus():Promise<PushStatus>{
 if(!pushCapable())return isIOS()&&!isStandalone()?'needs-install':'unsupported';
 if(Notification.permission==='denied')return 'denied';
 const reg=await navigator.serviceWorker.getRegistration();const sub=await reg?.pushManager.getSubscription();
 return sub&&Notification.permission==='granted'?'on':'off';
}

// Must be called from a tap (iOS only shows the permission prompt in response to a user gesture).
export async function enablePush(){
 if(!pushCapable())throw Error(isIOS()?'Add MAX to your Home Screen first, then open it from there.':'This browser does not support notifications.');
 const permission=await Notification.requestPermission();
 if(permission!=='granted')throw Error(permission==='denied'?'Notifications are blocked. Allow them for MAX in Settings.':'Notifications were not allowed.');
 const reg=await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready;
 const {publicKey}=await (await fetch('./api/push/key',{cache:'no-store'})).json() as {publicKey:string};
 const sub=await reg.pushManager.getSubscription()??await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64UrlToBytes(publicKey)});
 const r=await fetch('./api/push/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription:sub.toJSON()})});
 if(!r.ok)throw Error('Could not register this device. Please retry.');
}

export async function disablePush(){
 const reg=await navigator.serviceWorker.getRegistration();const sub=await reg?.pushManager.getSubscription();if(!sub)return;
 await fetch('./api/push/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:sub.endpoint})}).catch(()=>{});
 await sub.unsubscribe();
}

export async function sendTestPush(){const r=await fetch('./api/push/test',{method:'POST'});const data=await r.json().catch(()=>({})) as {error?:string};if(!r.ok)throw Error(data.error??'Could not send a test notification.')}
