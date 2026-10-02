'use client';
import {useEffect,useState} from 'react';
import {Heart,Copy,Share2,X,UserPlus,KeyRound} from 'lucide-react';
import {toast} from 'sonner';
import type {User} from '@/lib/tracker';
import {Avatar} from './avatar';
import {confirmAction} from './confirm';

type Pair={partner:User|null;since:string|null;invite:{expires:number}|null};
const post=async<T,>(path:string,body?:unknown,method='POST')=>{const r=await fetch(path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json().catch(()=>({})) as T&{error?:string};if(!r.ok)throw Error(d.error??'Please retry.');return d};
const longDate=(iso:string)=>new Date(iso).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});

// Profile: are you in a relationship here? Single: invite your partner with a code, or enter theirs.
// Paired: who with and since when, and leaving. Pairing or leaving reloads the app so every page shows the new journal.
export function RelationshipCard({me}:{me:User}){
 const [pair,setPair]=useState<Pair|null>(null),[code,setCode]=useState<{code:string;expires:number}|null>(null),[entering,setEntering]=useState(false),[entry,setEntry]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{fetch('./api/pair',{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<Pair>:null).then(p=>{if(p)setPair(p)}).catch(()=>{})},[]);
 // Opened from an invite link: fill in the code (and take it out of the address).
 useEffect(()=>{const params=new URLSearchParams(window.location.search),c=params.get('pair');if(!c)return;setEntering(true);setEntry(c.toUpperCase().slice(0,9));params.delete('pair');const q=params.toString();window.history.replaceState(null,'',window.location.pathname+(q?'?'+q:'')+window.location.hash)},[]);
 if(!pair)return null;
 const invite=async()=>{setBusy(true);try{setCode(await post<{code:string;expires:number}>('./api/pair/invite'))}catch(e){toast.error((e as Error).message)}finally{setBusy(false)}};
 const cancel=async()=>{try{await post('./api/pair/invite',undefined,'DELETE');setCode(null);setPair({...pair,invite:null})}catch(e){toast.error((e as Error).message)}};
 const link=code?`${window.location.origin}${window.location.pathname}?pair=${encodeURIComponent(code.code)}`:'';
 const share=async()=>{if(!code)return;const text=`Join me on MAX as my partner. Code: ${code.code}`;try{if(navigator.share)await navigator.share({title:'Be my partner on MAX',text,url:link});else{await navigator.clipboard.writeText(`${text}\n${link}`);toast.success('Invite copied')}}catch{/* share sheet closed */}};
 const copy=async()=>{if(!code)return;try{await navigator.clipboard.writeText(code.code);toast.success('Code copied')}catch{toast.error('Couldn’t copy. Select the code instead.')}};
 const join=async(e:React.FormEvent)=>{e.preventDefault();if(busy)return;setBusy(true);
  try{const {from}=await post<{from:{displayName:string}}>('./api/pair/preview',{code:entry});
   const ok=await confirmAction({title:`Be partners with ${from.displayName}?`,body:`You’ll get a shared journal with ${from.displayName}. Your own journal stays private: only you ever see it.`,action:'Join',danger:false});
   if(!ok)return;await post('./api/pair/accept',{code:entry});toast.success(`You and ${from.displayName} are partners 💜`);setTimeout(()=>window.location.reload(),600);
  }catch(err){toast.error((err as Error).message)}finally{setBusy(false)}};
 const leave=async()=>{if(!pair.partner)return;
  const ok=await confirmAction({title:`Leave ${pair.partner.displayName}?`,body:'Your shared journal is hidden from both of you (nothing is deleted) and comes back if you pair again. Your own journals aren’t touched.',action:'Leave'});
  if(!ok)return;try{await post('./api/pair/leave');toast('You’re no longer paired');setTimeout(()=>window.location.reload(),600)}catch(e){toast.error((e as Error).message)}};

 if(pair.partner)return <section className="project-panel relationship-status">
  <h2><Heart size={17} aria-hidden/> Relationship</h2>
  <div className="setting-line compact"><span className="rel-status-who"><Avatar user={pair.partner} size={36}/><span>In a relationship with <strong>{pair.partner.displayName}</strong><span className="setting-hint">{pair.since?`Partners on MAX since ${longDate(pair.since)}`:'Sharing a journal'}</span></span></span>
   <button type="button" className="chip-btn" onClick={()=>void leave()}>Leave</button></div>
 </section>;
 return <section className="project-panel relationship-status">
  <h2><Heart size={17} aria-hidden/> Relationship</h2>
  <p className="muted">Single here, {me.displayName}. Invite your partner to get a shared journal, the daily question and moods together. Your own journal stays yours and private.</p>
  {code?<div className="invite-code">
   <span className="setting-hint">Send this code to your partner. It works once, for 48 hours.</span>
   <strong className="invite-code-value" aria-label={`Invite code ${code.code.split('').join(' ')}`}>{code.code}</strong>
   <div className="form-actions"><button type="button" className="secondary" onClick={()=>void cancel()}><X size={15} aria-hidden/>Cancel</button><button type="button" className="secondary" onClick={()=>void copy()}><Copy size={15} aria-hidden/>Copy</button><button type="button" className="primary" onClick={()=>void share()}><Share2 size={15} aria-hidden/>Share</button></div>
  </div>:<div className="form-actions start">
   <button type="button" className="primary" disabled={busy} onClick={()=>void invite()}><UserPlus size={15} aria-hidden/>{pair.invite?'New invite code':'Invite your partner'}</button>
   {!entering&&<button type="button" className="secondary" onClick={()=>setEntering(true)}><KeyRound size={15} aria-hidden/>I have a code</button>}
  </div>}
  {entering&&!code&&<form className="form-stack invite-enter" onSubmit={e=>void join(e)}>
   <label className="field">Your partner’s code<input className="code-input" autoComplete="off" autoCapitalize="characters" required maxLength={9} placeholder="XXXX-XXXX" autoFocus value={entry} onChange={e=>setEntry(e.target.value.toUpperCase())}/></label>
   <div className="form-actions"><button type="button" className="secondary" onClick={()=>{setEntering(false);setEntry('')}}>Cancel</button><button className="primary" disabled={busy||entry.replace(/[^0-9A-Z]/gi,'').length!==8}>Continue</button></div>
  </form>}
 </section>;
}
