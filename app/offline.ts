'use client';
// Offline support. The service worker keeps the app itself on the phone; this file keeps the data.
// Each document is stored as the last copy the server confirmed (`base`) plus any edits that have
// not reached the server yet (`mine`). When the phone is back online the edits are merged onto the
// server's latest copy, entry by entry, so changes made elsewhere in the meantime are kept too.
import type {Day,Entry,SharedState,State,User} from '@/lib/tracker';

export type LocalCopy<T>={revision:number;base:T;mine:T|null};

export const OFFLINE_STATUS='Offline · saved on this phone';
export const trackerKey=(username:string)=>`max-tracker:${username}`;
export const sharedKey=(username:string)=>`max-shared:${username}`;
const lastUserKey='max-last-user';

export function readLocal<T>(key:string):LocalCopy<T>|null{
 try{const raw=localStorage.getItem(key);if(!raw)return null;const copy=JSON.parse(raw) as LocalCopy<T>;return copy&&typeof copy.revision==='number'&&copy.base?copy:null}catch{return null}
}
export function writeLocal<T>(key:string,copy:LocalCopy<T>){try{localStorage.setItem(key,JSON.stringify(copy))}catch{/* storage full or blocked: the app still works online */}}

// fetch() rejects with a TypeError when there is no connection ("Load failed" on iPhone).
export const isOfflineError=(e:unknown)=>e instanceof TypeError||(typeof navigator!=='undefined'&&navigator.onLine===false);

// Who was signed in last, so MAX can open without a connection.
export function rememberUser(user:User,users?:User[]){try{const prev=lastUser();localStorage.setItem(lastUserKey,JSON.stringify({user,users:users??(prev?.user.username===user.username?prev.users:[])}))}catch{}}
export function lastUser():{user:User;users:User[]}|null{try{const raw=localStorage.getItem(lastUserKey);return raw?JSON.parse(raw):null}catch{return null}}
export function forgetUser(){try{localStorage.removeItem(lastUserKey)}catch{}}

// Logging out removes this account's copies and cached photos from the phone. Edits that never
// reached the server are kept so they sync after the next login instead of being lost.
export async function forgetDevice(username:string){
 forgetUser();
 try{localStorage.removeItem('max-assistant')}catch{}
 for(const key of [trackerKey(username),sharedKey(username)]){const copy=readLocal(key);if(!copy?.mine)try{localStorage.removeItem(key)}catch{}}
 try{await caches.delete('max-photos')}catch{}
}

const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
// Changed here? keep ours. Otherwise take theirs.
const pick=<T,>(base:T,mine:T,theirs:T)=>same(mine,base)?theirs:mine;

function mergeMap<T>(base:Record<string,T>={},mine:Record<string,T>={},theirs:Record<string,T>={}){
 const out={...theirs};
 for(const k of new Set([...Object.keys(base),...Object.keys(mine)])){if(same(mine[k],base[k]))continue;if(mine[k]===undefined)delete out[k];else out[k]=mine[k]}
 return out;
}

function mergeList<T extends {id:string}>(base:T[]=[],mine:T[]=[],theirs:T[]=[]){
 const b=new Map(base.map(x=>[x.id,x])),m=new Map(mine.map(x=>[x.id,x])),out:T[]=[];
 for(const x of theirs){const was=b.get(x.id),ours=m.get(x.id);if(was&&!ours)continue;out.push(ours&&!same(ours,was)?ours:x)}
 const have=new Set(out.map(x=>x.id)),added=mine.filter(x=>!b.has(x.id)&&!have.has(x.id));
 // Lists that grow at the front (photo dump) keep new items at the front.
 return added.length&&mine[0]?.id===added[0].id?[...added,...out]:[...out,...added];
}

// Two devices editing the same day (the phone logs breakfast while the computer logs water) must both be kept, so a
// day is merged goal by goal, and inside a goal field by field: each tick and time, each exercise's reps, the
// resisted moments (joined), and everything else by whichever side changed it. Only when both changed the very same
// thing does this device's version win.
type Obj=Record<string,unknown>;
function mergeFields(b:Obj,m:Obj,t:Obj,special:Record<string,(b:unknown,m:unknown,t:unknown)=>unknown>={}){
 const out={...t};
 for(const k of new Set([...Object.keys(b),...Object.keys(m)])){const v=special[k]?special[k](b[k],m[k],t[k]):pick(b[k],m[k],t[k]);if(v===undefined)delete out[k];else out[k]=v}
 return out;
}
// Arrays lined up by position (a checklist's ticks, its times): each slot from whichever side changed it.
const mergeSlots=(fill:unknown)=>(b:unknown,m:unknown,t:unknown)=>{const B=(b??[]) as unknown[],M=(m??[]) as unknown[],T=(t??[]) as unknown[];if(m===undefined&&t===undefined)return undefined;return Array.from({length:Math.max(M.length,T.length)},(_,i)=>same(M[i],B[i])?T[i]??fill:M[i]??fill)};
// Moments resisted: everything either side added, minus what either side took back.
const mergeSet=(b:unknown,m:unknown,t:unknown)=>{const B=new Set((b??[]) as number[]),M=new Set((m??[]) as number[]),T=new Set((t??[]) as number[]);const out=[...new Set([...M,...T])].filter(x=>!(B.has(x)&&(!M.has(x)||!T.has(x)))).sort((x,y)=>x-y);return out.length?out:undefined};
function mergeEntry(base:Entry|undefined,mine:Entry,theirs:Entry):Entry{
 if(same(mine,theirs))return theirs;
 if(!base)return mine;
 if(same(mine,base))return theirs;if(same(theirs,base))return mine;
 // The card's tasks changed on one side (added or renamed): positions no longer line up, so take that side whole.
 if(!same(mine.goal.items,theirs.goal.items))return same(mine.goal,base.goal)?theirs:mine;
 return mergeFields(base as unknown as Obj,mine as unknown as Obj,theirs as unknown as Obj,{checks:mergeSlots(false),times:mergeSlots(null),resists:mergeSet,
  exerciseLogs:(b,m,t)=>{const v=mergeMap(b as Obj,m as Obj,t as Obj);return Object.keys(v).length?v:undefined}}) as unknown as Entry;
}
// Nothing logged at all: an empty day a device filled in itself (it had been asleep since before that day).
const blankEntry=(e:Entry)=>!e.rest&&!e.checks.some(Boolean)&&!e.value&&!e.note?.trim()&&!e.media?.length&&!(e.exerciseLogs&&Object.keys(e.exerciseLogs).length)&&!e.times?.some(Boolean)&&!e.resists?.length&&!e.noSleep&&!e.couldnt?.length&&!e.bed&&!e.wake;
export const blankDay=(d:Day)=>!d.reflection?.trim()&&!d.focus?.trim()&&d.entries.every(blankEntry);
function mergeDay(base:Day|undefined,mine:Day,theirs:Day):Day{
 // This device never saw the day before (no base): a blank copy of its own must never replace a logged one.
 if(!base){if(same(mine,theirs)||blankDay(mine))return theirs;if(blankDay(theirs))return mine;
  const empty={...mine,reflection:'',focus:'',entries:mine.entries.map(e=>({goal:e.goal,checks:e.checks.map(()=>false),value:0,note:'',rest:false}))} as Day;
  return mergeDay(empty,mine,theirs)}
 if(same(mine,base))return theirs;if(same(theirs,base))return mine;
 return mergeFields(base as unknown as Obj,mine as unknown as Obj,theirs as unknown as Obj,{entries:(b,m,t)=>{
  const B=(b??[]) as Entry[],M=(m??[]) as Entry[],T=(t??[]) as Entry[],id=(e:Entry)=>e.goal.id,was=new Map(B.map(e=>[id(e),e])),ours=new Map(M.map(e=>[id(e),e])),out:Entry[]=[];
  for(const e of T){const o=ours.get(id(e)),w=was.get(id(e));if(w&&!o)continue;out.push(o?mergeEntry(w,o,e):e)}
  for(const e of M)if(!was.has(id(e))&&!out.some(x=>id(x)===id(e)))out.push(e);
  return out}}) as unknown as Day;
}
function mergeDays(base:Record<string,Day>={},mine:Record<string,Day>={},theirs:Record<string,Day>={}){
 const out={...theirs};
 for(const k of new Set([...Object.keys(base),...Object.keys(mine)])){
  if(same(mine[k],base[k]))continue;
  if(mine[k]===undefined){delete out[k];continue}
  out[k]=theirs[k]?(base[k]&&blankDay(mine[k])&&!blankDay(theirs[k])&&blankDay(base[k])?theirs[k]:mergeDay(base[k],mine[k],theirs[k])):mine[k];
 }
 return out;
}

export function mergeTracker(base:State,mine:State,theirs:State):State{
 const out={...theirs} as Record<string,unknown>,b=base as unknown as Record<string,unknown>,m=mine as unknown as Record<string,unknown>;
 for(const k of new Set([...Object.keys(b),...Object.keys(m)])){
  if(k==='days')out.days=mergeDays(base.days,mine.days,theirs.days);
  else if(k==='goals')out.goals=mergeList(base.goals,mine.goals,theirs.goals);
  else if(k==='settings')out.settings=mergeMap(base.settings as Record<string,unknown>,mine.settings as Record<string,unknown>,theirs.settings as Record<string,unknown>);
  else{const v=pick(b[k],m[k],out[k]);if(v===undefined)delete out[k];else out[k]=v}
 }
 return out as unknown as State;
}

export function mergeShared(base:SharedState,mine:SharedState,theirs:SharedState):SharedState{
 const out={...theirs} as Record<string,unknown>,b=base as unknown as Record<string,unknown>,m=mine as unknown as Record<string,unknown>,lists=['journal','moments','photoDump','photoTrash','diary','journalTrash'];
 for(const k of new Set([...Object.keys(b),...Object.keys(m)])){
  if(lists.includes(k))out[k]=mergeList(b[k] as {id:string}[]|undefined,m[k] as {id:string}[]|undefined,out[k] as {id:string}[]|undefined);
  else{const v=pick(b[k],m[k],out[k]);if(v===undefined)delete out[k];else out[k]=v}
 }
 return out as unknown as SharedState;
}
