'use client';
import {useCallback,useEffect,useState} from 'react';
import {ChevronLeft,Lock,Delete,Check,ImagePlus,Trash2,ShieldCheck} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {toast} from 'sonner';
import type {DumpPhoto} from '@/lib/tracker';
import {uploadPhotos} from './photos';
import {Lightbox} from './photo-dump';

type Phase='loading'|'create'|'confirm'|'locked'|'open';
const vaultSrc=(p:{id:string})=>`./api/vault/file?id=${encodeURIComponent(p.id)}`;
async function post(path:string,body?:unknown){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body??{})});const data=await r.json().catch(()=>({})) as {error?:string};return {ok:r.ok,status:r.status,error:data.error}}

// Your PIN-locked album. The server only hands out these photos to a browser unlocked with your PIN.
export function Vault({onClose}:{onClose:()=>void}){
 const [phase,setPhase]=useState<Phase>('loading'),[pin,setPin]=useState(''),[first,setFirst]=useState(''),[error,setError]=useState(''),[items,setItems]=useState<DumpPhoto[]>([]),[busy,setBusy]=useState(false),[zoomAt,setZoomAt]=useState<number|null>(null),[shake,setShake]=useState(0);
 const fail=(message:string)=>{setError(message);setPin('');setShake(n=>n+1);navigator.vibrate?.([30,40,30])};
 const loadItems=useCallback(async()=>{const r=await fetch('./api/vault',{cache:'no-store'});if(r.status===403){setPhase('locked');setError('Locked again for safety. Enter your PIN.');return}const data=await r.json() as {items:DumpPhoto[]};setItems(data.items);setPhase('open')},[]);
 useEffect(()=>{void (async()=>{try{const s=await (await fetch('./api/vault/status',{cache:'no-store'})).json() as {hasPin:boolean;unlocked:boolean};if(!s.hasPin)setPhase('create');else if(s.unlocked)await loadItems();else setPhase('locked')}catch{setError('Could not open hidden photos.');setPhase('locked')}})()},[loadItems]);
 // Lock again whenever this screen closes.
 useEffect(()=>()=>{void fetch('./api/vault/lock',{method:'POST'}).catch(()=>{})},[]);
 const submit=async()=>{
  if(busy)return;if(pin.length<4)return fail('Use at least 4 digits.');
  setBusy(true);setError('');
  try{
   if(phase==='create'){setFirst(pin);setPin('');setPhase('confirm');return}
   if(phase==='confirm'){if(pin!==first){setFirst('');setPhase('create');return fail('Those PINs didn’t match. Try again.')}const set=await post('./api/vault/pin',{pin});if(!set.ok)return fail(set.error??'Could not save the PIN.');}
   const r=await post('./api/vault/unlock',{pin});
   if(!r.ok)return fail(r.error??'Wrong PIN.');
   setPin('');setFirst('');await loadItems();
  }finally{setBusy(false)}
 };
 const press=(d:string)=>{setError('');setPin(p=>p.length<12?p+d:p)};
 const add=async(files:FileList|null)=>{setBusy(true);await uploadPhotos(files,500,p=>setItems(list=>[p,...list]),'./api/vault/files');setBusy(false)};
 const remove=async(p:DumpPhoto)=>{if(!window.confirm('Remove this photo from hidden photos? This deletes it.'))return;const r=await fetch(`./api/vault/files?id=${encodeURIComponent(p.id)}`,{method:'DELETE'});if(r.status===403)return void setPhase('locked');if(!r.ok)return void toast.error('Could not remove the photo.');setItems(list=>list.filter(x=>x.id!==p.id));setZoomAt(null);toast.success('Photo removed')};
 const lockNow=async()=>{await post('./api/vault/lock');setItems([]);setPhase('locked')};
 const keypad=phase==='create'||phase==='confirm'||phase==='locked';
 return <Dialog open onOpenChange={v=>!v&&onClose()}><DialogContent className="journal-editor vault" showCloseButton={false} onEscapeKeyDown={ev=>{if(zoomAt!==null){ev.preventDefault();setZoomAt(null)}}}
  onKeyDown={e=>{if(!keypad)return;if(/^\d$/.test(e.key))press(e.key);else if(e.key==='Backspace')setPin(p=>p.slice(0,-1));else if(e.key==='Enter'){e.preventDefault();void submit()}}}>
  <div className="dump-top">
   <button className="round-btn" aria-label="Back" onClick={onClose}><ChevronLeft size={22}/></button>
   <div className="dump-heading"><DialogTitle>Hidden photos</DialogTitle><DialogDescription>{phase==='open'?`${items.length} photo${items.length===1?'':'s'} · locks when you leave`:'Protected with a PIN'}</DialogDescription></div>
   {phase==='open'?<button className="round-btn" aria-label="Lock now" title="Lock now" onClick={()=>void lockNow()}><Lock size={19}/></button>:<span/>}
  </div>
  {phase==='loading'&&<p className="muted vault-loading">Opening…</p>}
  {keypad&&<div className="pin-screen">
   <div className="pin-icon" aria-hidden>{phase==='locked'?<Lock size={26}/>:<ShieldCheck size={26}/>}</div>
   <h3>{phase==='create'?'Create a PIN':phase==='confirm'?'Enter it once more':'Enter your PIN'}</h3>
   <p className="muted">{phase==='create'?'4 to 12 digits. Only you know it; it can also lock your own journal.':phase==='confirm'?'Just to be sure.':'Hidden photos stay locked until then.'}</p>
   <div key={shake} className={`pin-dots ${shake?'shake':''}`} aria-live="polite" aria-label={`${pin.length} digits entered`}>{Array.from({length:Math.max(6,pin.length)},(_,i)=><span key={i} className={i<pin.length?'on':''}/>)}</div>
   <p className="pin-error" role="alert">{error}</p>
   <div className="pin-pad">
    {['1','2','3','4','5','6','7','8','9'].map(d=><button key={d} type="button" onClick={()=>press(d)} disabled={busy}>{d}</button>)}
    <button type="button" className="pin-aux" aria-label="Delete digit" onClick={()=>setPin(p=>p.slice(0,-1))} disabled={busy||!pin}><Delete size={22}/></button>
    <button type="button" onClick={()=>press('0')} disabled={busy}>0</button>
    <button type="button" className="pin-ok" aria-label={phase==='create'?'Next':phase==='confirm'?'Save PIN':'Unlock'} onClick={()=>void submit()} disabled={busy||pin.length<4}><Check size={24}/></button>
   </div>
  </div>}
  {phase==='open'&&<div className="dump-scroll">
   <label className={`vault-add ${busy?'busy':''}`}><ImagePlus size={20} aria-hidden/>{busy?'Adding…':'Add photos'}<input type="file" accept="image/*" multiple aria-label="Add hidden photos" disabled={busy} onChange={e=>{void add(e.target.files);e.target.value=''}}/></label>
   {items.length?<div className="dump-grid">{items.map((p,i)=><button key={p.id} className="dump-tile" aria-label={`Hidden photo ${i+1}. Tap to zoom.`} onClick={()=>setZoomAt(i)}><img src={vaultSrc(p)} alt="" loading="lazy" draggable={false}/></button>)}</div>
    :<p className="muted vault-empty">Nothing here yet. Photos you add stay hidden behind the PIN.</p>}
  </div>}
  {phase==='open'&&zoomAt!==null&&items[zoomAt]&&<Lightbox photos={items} index={zoomAt} hidden={()=>false} onReveal={()=>{}} onIndex={setZoomAt} onClose={()=>setZoomAt(null)} src={vaultSrc}
   action={p=><button className="round-btn glass" aria-label="Remove photo" title="Remove photo" onClick={()=>void remove(p)}><Trash2 size={19}/></button>}/>}
 </DialogContent></Dialog>;
}
