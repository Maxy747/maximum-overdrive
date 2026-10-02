'use client';
import {useEffect,useState} from 'react';
import {Trash2} from 'lucide-react';
import {toast} from 'sonner';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {forgetUser,sharedKey,trackerKey} from './offline';

type Info={storage:{used:number;limit:number|null}|null};
const mb=(b:number)=>b>=1e9?`${(b/1e9).toFixed(1)} GB`:`${Math.max(0,b/1e6).toFixed(b<1e7?1:0)} MB`;

// Profile: storage used, the privacy policy and terms, and deleting the account (with the password).
export function AccountControls({username,partnerName}:{username:string;partnerName?:string}){
 const [legal,setLegal]=useState<{privacy:string;terms:string}|null>(null),[info,setInfo]=useState<Info|null>(null),[asking,setAsking]=useState(false),[password,setPassword]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{fetch('./api/account',{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<Info>:null).then(setInfo).catch(()=>{});
  fetch('./api/config',{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{legal?:{privacy:string;terms:string}}>:null).then(c=>setLegal(c?.legal??null)).catch(()=>{})},[]);
 const remove=async(e:React.FormEvent)=>{e.preventDefault();if(busy)return;setBusy(true);
  try{const r=await fetch('./api/account',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});const d=await r.json().catch(()=>({})) as {error?:string};
   if(!r.ok)throw Error(d.error??'Could not delete the account.');
   // This account's copies on this phone go too, unsynced edits included; other accounts' are left alone.
   forgetUser();for(const k of [trackerKey(username),sharedKey(username),sharedKey(username)+':mine','max-assistant'])try{localStorage.removeItem(k)}catch{}
   try{await caches.delete('max-photos')}catch{}
   toast.success('Your account is deleted');setTimeout(()=>window.location.reload(),800);
  }catch(err){toast.error((err as Error).message);setPassword('')}finally{setBusy(false)}};
 const s=info?.storage,pct=s?.limit?Math.min(100,Math.round(s.used/s.limit*100)):0;
 return <section className="project-panel data-panel account-controls">
  <h2>Account</h2>
  {s&&<div className="storage-line"><span>Storage<span className="setting-hint">{s.limit?`${mb(s.used)} of ${mb(s.limit)} used`:`${mb(s.used)} used`} · photos and files</span></span>
   {s.limit&&<span className="storage-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Storage used"><i style={{width:`${pct}%`}}/></span>}</div>}
  {legal&&<p className="setting-hint"><a href={legal.privacy} target="_blank" rel="noreferrer">Privacy policy</a> · <a href={legal.terms} target="_blank" rel="noreferrer">Terms</a></p>}
  <button type="button" className="chip-btn danger-btn" onClick={()=>{setAsking(true);setPassword('')}}><Trash2 size={15} aria-hidden/>Delete my account</button>
  {asking&&<Dialog open onOpenChange={v=>!v&&setAsking(false)}><DialogContent className="editor"><DialogTitle>Delete your account?</DialogTitle>
   <DialogDescription>This deletes your account and everything that’s only yours, right away: your goals and history, your own journal, your photos and hidden photos, moods and coach chats. It can’t be undone. Export everything first if you want a copy.{partnerName?` Your shared journal and its photos stay with ${partnerName}.`:''}</DialogDescription>
   <form className="form-stack" onSubmit={e=>void remove(e)}>
    <label className="field">Your password<input type="password" autoComplete="current-password" required maxLength={200} autoFocus value={password} onChange={e=>setPassword(e.target.value)}/></label>
    <div className="form-actions"><button type="button" className="secondary" onClick={()=>setAsking(false)}>Cancel</button><button className="primary danger-primary" disabled={busy||!password}>{busy?'Deleting…':'Delete forever'}</button></div>
   </form>
  </DialogContent></Dialog>}
 </section>;
}
