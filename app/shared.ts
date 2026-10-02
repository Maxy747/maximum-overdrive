'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {SharedState} from '@/lib/tracker';
import {isOfflineError,mergeShared,readLocal,sharedKey,writeLocal} from './offline';

export type MutateShared=(fn:(draft:SharedState)=>void)=>void;
type Op=(s:SharedState)=>void;

// Replays edits saved on this phone (possibly in an earlier session, while offline) onto whatever
// the server has now.
const mergeOp=(base:SharedState,mine:SharedState):Op=>s=>{const merged=mergeShared(base,mine,s);for(const k of Object.keys(s))delete (s as Record<string,unknown>)[k];Object.assign(s,merged)};

// A journal document: the default one (shared with your partner, or your own when you're on your own), or with
// space:'mine' always your own. `enabled:false` leaves it unloaded (your own journal while you're on your own, when the
// default one already is it). Partners edit the shared journal together. Local edits are kept as a queue of operations on top of the
// last server copy, so when the other person saved first (409) we fetch their version and replay ours.
// The queue's result is also kept on the phone, so edits made offline survive closing the app.
export function useShared(onUnauthorized:()=>void,username:string,{space,enabled=true}:{space?:'mine';enabled?:boolean}={}){
 const api=space?'./api/shared?space=mine':'./api/shared';
 const [shared,setShared]=useState<SharedState|null>(null),[error,setError]=useState(''),[saving,setSaving]=useState(false),[offline,setOffline]=useState(false),[locked,setLocked]=useState(false);
 const base=useRef<SharedState|null>(null),revision=useRef(0),pending=useRef<Op[]>([]),busy=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const key=sharedKey(username)+(space?':mine':'');
 const replay=useCallback(()=>{if(!base.current)return null;const next=structuredClone(base.current);for(const fn of pending.current)fn(next);return next},[]);
 const persist=useCallback(()=>{if(base.current)writeLocal(key,{revision:revision.current,base:base.current,mine:pending.current.length?replay():null})},[key,replay]);
 const fetchLatest=useCallback(async()=>{
  const r=await fetch(api,{cache:'no-store'});
  if(r.status===401){onUnauthorized();throw Error('Please log in.')}
  const data=await r.json() as {shared:SharedState;revision:number;error?:string;locked?:boolean};
  if(r.status===403&&data.locked){setLocked(true);setShared(null);return}
  setLocked(false);
  if(!r.ok)throw Error(data.error??'Could not load the journal.');
  base.current=data.shared;revision.current=data.revision;setShared(replay());setOffline(false);persist();
 },[api,onUnauthorized,replay,persist]);
 const flush=useCallback(async()=>{
  if(busy.current||!pending.current.length||!base.current)return;
  busy.current=true;setSaving(true);
  try{
   for(let conflicts=0;pending.current.length;){
    const count=pending.current.length,next=replay()!;
    const r=await fetch(api,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({shared:next,revision:revision.current})});
    if(r.status===401){onUnauthorized();return}
    if(r.status===403){const d=await r.json().catch(()=>({})) as {locked?:boolean};if(d.locked){persist();setLocked(true);setShared(null);return}}
    if(r.status===409){if(++conflicts>5)throw Error('The journal keeps changing. Please try again.');await fetchLatest();continue}
    const data=await r.json() as {revision:number;error?:string};
    if(!r.ok)throw Error(data.error??'Could not save the journal.');
    base.current=next;revision.current=data.revision;pending.current=pending.current.slice(count);persist();
   }
   setError('');setOffline(false);
  }catch(e){if(isOfflineError(e)){setError('');setOffline(true)}else setError(e instanceof Error?e.message:'Could not save the journal.')}
  finally{busy.current=false;setSaving(false)}
 },[api,fetchLatest,onUnauthorized,replay,persist]);
 const mutate:MutateShared=useCallback(fn=>{if(!base.current)return;pending.current.push(fn);setShared(replay());if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>{persist();void flush()},400)},[flush,replay,persist]);
 useEffect(()=>{
  if(!enabled)return;
  const copy=readLocal<SharedState>(key);
  const restore=()=>{if(copy?.mine){pending.current.unshift(mergeOp(copy.base,copy.mine));setShared(replay());persist()}};
  fetchLatest().then(()=>{restore();void flush()}).catch(e=>{
   // No connection: open the copy kept on this phone and sync it later.
   if(isOfflineError(e)&&copy&&!base.current){base.current=copy.base;revision.current=copy.revision;restore();setShared(replay());setOffline(true)}
   else setError(isOfflineError(e)?'You’re offline. Open MAX once with internet to keep a copy on this phone.':e instanceof Error?e.message:'Could not load the journal.');
  });
  // Pick up the other person's entries while the app is open, and send offline edits when back online.
  const refresh=()=>{if(document.visibilityState!=='visible'||busy.current)return;if(pending.current.length)void flush();else fetchLatest().catch(()=>{})};
  const hide=()=>{if(document.visibilityState==='hidden'&&pending.current.length)persist()};
  const interval=setInterval(refresh,30000);document.addEventListener('visibilitychange',refresh);document.addEventListener('visibilitychange',hide);window.addEventListener('online',refresh);
  const unload=(e:BeforeUnloadEvent)=>{if(pending.current.length){persist();if(navigator.onLine){e.preventDefault();e.returnValue=''}}};window.addEventListener('beforeunload',unload);
  return()=>{clearInterval(interval);document.removeEventListener('visibilitychange',refresh);document.removeEventListener('visibilitychange',hide);window.removeEventListener('online',refresh);window.removeEventListener('beforeunload',unload)};
 },[enabled,fetchLatest,flush,key,persist,replay]);
 // After the PIN: load it again, then send anything that was waiting.
 const unlocked=useCallback(()=>{fetchLatest().then(()=>void flush()).catch(()=>{})},[fetchLatest,flush]);
 return {shared,mutate,error,saving,offline,locked,unlocked,retry:()=>void flush()};
}
