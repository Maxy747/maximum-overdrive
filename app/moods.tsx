'use client';
import {useCallback,useEffect,useState} from 'react';
import {History,Trash2,Lock} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Switch} from '@/components/ui/switch';
import {toast} from 'sonner';
import {MOODS,moodOf,type Mood,type MoodKey,type User} from '@/lib/tracker';
import {Avatar} from './avatar';
import {confirmAction} from './confirm';

// How are you feeling? Tap a mood, add a note if you like, and choose whether your partner sees it.
// Your partner sees only your latest shared mood (the server never sends them private ones).
type Partner=User&{latest:Mood|null};
const ago=(at:number)=>{const s=(Date.now()-at)/1000;if(s<60)return 'just now';if(s<3600)return `${Math.floor(s/60)}m ago`;if(s<86400)return `${Math.floor(s/3600)}h ago`;const d=Math.floor(s/86400);return d===1?'yesterday':`${d} days ago`};
const stamp=(at:number)=>new Date(at).toLocaleString('en-US',{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});

export function MoodCard({solo=false}:{solo?:boolean}={}){
 const [mine,setMine]=useState<Mood[]>([]),[partners,setPartners]=useState<Partner[]>([]),[pick,setPick]=useState<MoodKey|null>(null),[history,setHistory]=useState(false);
 const load=useCallback(async()=>{try{const r=await fetch('./api/moods',{cache:'no-store'});if(!r.ok)return;const d=await r.json() as {mine:Mood[];partners:Partner[]};setMine(d.mine);setPartners(d.partners)}catch{}},[]);
 // Keeps your partner's mood fresh while the app is open.
 useEffect(()=>{void load();const t=setInterval(()=>void load(),60000),focus=()=>{if(document.visibilityState==='visible')void load()};document.addEventListener('visibilitychange',focus);return()=>{clearInterval(t);document.removeEventListener('visibilitychange',focus)}},[load]);
 const latest=mine[0],partnerName=partners.map(p=>p.displayName).join(' & ')||'your partner';
 const remove=async(m:Mood)=>{if(!await confirmAction({title:'Delete this mood?',body:m.shared?`${partnerName} will no longer see it.`:'It’s removed from your history.'}))return;const r=await fetch(`./api/moods?id=${encodeURIComponent(m.id)}`,{method:'DELETE'}).catch(()=>null);if(!r?.ok)return void toast.error('Couldn’t delete that. Check your connection.');setMine(ms=>ms.filter(x=>x.id!==m.id));toast.success('Mood deleted')};
 return <section className="mood-card" aria-label="Mood">
  <div className="mood-head"><h2>How are you feeling?</h2>{mine.length>0&&<button type="button" className="link-btn mood-history-btn" onClick={()=>setHistory(true)}><History size={14} aria-hidden/>History</button>}</div>
  <div className="mood-row" role="group" aria-label="Pick a mood">{MOODS.map(m=><button key={m.key} type="button" className={`mood-chip ${latest?.mood===m.key&&Date.now()-latest.at<6*3600000?'current':''}`} onClick={()=>setPick(m.key)} aria-label={m.label}><span aria-hidden>{m.emoji}</span><small>{m.label}</small></button>)}</div>
  {(latest||partners.some(p=>p.latest))&&<div className="mood-status">
   {latest&&<p className="mood-line"><span className="mood-emoji" aria-hidden>{moodOf(latest.mood).emoji}</span><span><strong>You · {moodOf(latest.mood).label}</strong><small>{ago(latest.at)}{latest.shared?'':' · only you'}{latest.note?` · ${latest.note}`:''}</small></span></p>}
   {partners.filter(p=>p.latest&&!solo).map(p=><p key={p.username} className="mood-line partner"><Avatar user={p} size={28}/><span><strong>{p.displayName} · {moodOf(p.latest!.mood).emoji} {moodOf(p.latest!.mood).label}</strong><small>{ago(p.latest!.at)}{p.latest!.note?` · “${p.latest!.note}”`:''}</small></span></p>)}
  </div>}
  {pick&&<MoodDialog mood={pick} partnerName={partnerName} onClose={()=>setPick(null)} onSaved={m=>{setMine(ms=>[m,...ms]);setPick(null)}}/>}
  {history&&<Dialog open onOpenChange={v=>!v&&setHistory(false)}><DialogContent className="editor mood-dialog"><DialogTitle>Your moods</DialogTitle><DialogDescription>Newest first. {partnerName} only sees your latest shared one.</DialogDescription>
   <ul className="mood-history">{mine.map(m=><li key={m.id}><span className="mood-emoji" aria-hidden>{moodOf(m.mood).emoji}</span><span className="grow"><strong>{moodOf(m.mood).label}{!m.shared&&<Lock size={12} aria-label="Only you"/>}</strong><small>{stamp(m.at)}</small>{m.note&&<em>{m.note}</em>}</span><button type="button" className="round-btn" aria-label="Delete this mood" onClick={()=>void remove(m)}><Trash2 size={15}/></button></li>)}</ul>
  </DialogContent></Dialog>}
 </section>;
}

function MoodDialog({mood,partnerName,onClose,onSaved}:{mood:MoodKey;partnerName:string;onClose:()=>void;onSaved:(m:Mood)=>void}){
 const [note,setNote]=useState(''),[shared,setShared]=useState(true),[saving,setSaving]=useState(false),m=moodOf(mood);
 const save=async(e:React.FormEvent)=>{e.preventDefault();if(saving)return;setSaving(true);
  try{const r=await fetch('./api/moods',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mood,note,shared})});const d=await r.json().catch(()=>({})) as {mood?:Mood;error?:string};if(!r.ok||!d.mood)throw Error(d.error??'Couldn’t save your mood.');onSaved(d.mood);toast.success(shared?`Shared with ${partnerName}`:'Mood saved')}
  catch(err){toast.error(err instanceof Error&&err.message!=='Failed to fetch'?err.message:'You’re offline. Try again when you’re connected.')}finally{setSaving(false)}};
 return <Dialog open onOpenChange={v=>!v&&onClose()}><DialogContent className="editor mood-dialog">
  <span className="mood-big" aria-hidden>{m.emoji}</span>
  <DialogTitle>Feeling {m.label.toLowerCase()}</DialogTitle><DialogDescription>{new Date().toLocaleString('en-US',{weekday:'long',hour:'numeric',minute:'2-digit'})}</DialogDescription>
  <form className="form-stack" onSubmit={save}>
   <label className="field">Note (optional)<textarea maxLength={500} rows={3} placeholder="What’s behind it?" value={note} onChange={e=>setNote(e.target.value)}/></label>
   <div className="setting-line compact"><label htmlFor="mood-share">Share with {partnerName}<span className="setting-hint">{shared?'They’ll see this as your latest mood.':'Only you will see it.'}</span></label><Switch id="mood-share" checked={shared} onCheckedChange={setShared}/></div>
   <div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={saving}>{saving?'Saving…':'Save mood'}</button></div>
  </form>
 </DialogContent></Dialog>;
}
