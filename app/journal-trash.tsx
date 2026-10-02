'use client';
import {ChevronLeft,Images,NotebookPen,MessageCircle,RotateCcw,Trash2,Lock} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {toast} from 'sonner';
import {TRASH_DAYS,type JournalTrash,type SharedState,type User} from '@/lib/tracker';
import {useHoldReveal} from './privacy';
import {confirmAction} from './confirm';
import type {MutateShared} from './shared';

// The journal's Recently deleted. Deleting a memory, milestone, diary entry or comment moves it here
// for TRASH_DAYS days (the server empties older ones); Restore puts it back where it was.
type Kind=JournalTrash['kind'];

export function moveToBin(s:SharedState,kind:Kind,id:string,by:string,memoryId?:string){
 const item:JournalTrash={id,kind,deletedAt:new Date().toISOString(),deletedBy:by};
 if(kind==='memory'){const e=s.journal.find(x=>x.id===id);if(!e)return;s.journal=s.journal.filter(x=>x.id!==id);item.memory=e}
 else if(kind==='milestone'){const m=s.moments.find(x=>x.id===id);if(!m)return;s.moments=s.moments.filter(x=>x.id!==id);item.milestone=m}
 else if(kind==='diary'){const d=(s.diary??[]).find(x=>x.id===id);if(!d)return;s.diary=(s.diary??[]).filter(x=>x.id!==id);item.diary=d}
 else{const e=s.journal.find(x=>x.id===memoryId),c=e?.comments?.find(x=>x.id===id);if(!e||!c)return;e.comments=(e.comments??[]).filter(x=>x.id!==id);item.comment=c;item.memoryId=memoryId}
 s.journalTrash=[item,...(s.journalTrash??[]).filter(x=>x.id!==id)];
}

// Memories come back first, so a comment restored in the same go can find its memory.
export function restoreFromBin(s:SharedState,ids:string[]){
 const order:Kind[]=['memory','milestone','diary','comment'];
 const items=(s.journalTrash??[]).filter(t=>ids.includes(t.id)).sort((a,b)=>order.indexOf(a.kind)-order.indexOf(b.kind)),back=new Set<string>();
 for(const t of items){
  if(t.kind==='memory'&&t.memory){
   // Only photos that still exist come back. One sitting in the photos' Recently deleted rejoins this memory if it's restored later.
   const dump=new Set((s.photoDump??[]).map(p=>p.id));
   for(const p of s.photoTrash??[])if(t.memory.photos.some(x=>x.id===p.id)&&!p.memoryIds?.includes(t.id))p.memoryIds=[...(p.memoryIds??[]),t.id].slice(-100);
   if(!s.journal.some(x=>x.id===t.id))s.journal.push({...t.memory,photos:t.memory.photos.filter(p=>dump.has(p.id))});back.add(t.id);
  }else if(t.kind==='milestone'&&t.milestone){if(s.moments.length>=100)continue;if(!s.moments.some(x=>x.id===t.id))s.moments.push(t.milestone);back.add(t.id)}
  else if(t.kind==='diary'&&t.diary){const list=s.diary??(s.diary=[]);if(!list.some(x=>x.id===t.id))list.push(t.diary);back.add(t.id)}
  else if(t.kind==='comment'&&t.comment){
   // Its memory may itself be in the bin; then the comment goes back into that copy.
   const e=s.journal.find(x=>x.id===t.memoryId)??(s.journalTrash??[]).find(x=>x.kind==='memory'&&x.id===t.memoryId&&!back.has(x.id))?.memory;
   if(!e)continue;if(!(e.comments??[]).some(x=>x.id===t.id))e.comments=[...(e.comments??[]),t.comment].sort((a,b)=>a.created.localeCompare(b.created));back.add(t.id);
  }
 }
 s.journalTrash=(s.journalTrash??[]).filter(t=>!back.has(t.id));
 return back.size;
}

const LABEL:Record<Kind,string>={memory:'Memory',milestone:'Milestone',diary:'Diary entry',comment:'Comment'};
// Asks first, moves the item to the bin, then offers Undo for a few seconds.
export async function deleteToBin(mutate:MutateShared,kind:Kind,id:string,by:string,opts:{title:string;body?:string;memoryId?:string}){
 if(!await confirmAction({title:opts.title,body:opts.body??`It moves to Recently deleted, where you can restore it for ${TRASH_DAYS} days.`}))return false;
 mutate(s=>moveToBin(s,kind,id,by,opts.memoryId));
 toast(`${LABEL[kind]} deleted`,{description:'Moved to Recently deleted',duration:6000,action:{label:'Undo',onClick:()=>mutate(s=>{restoreFromBin(s,[id])})}});
 return true;
}

const daysLeft=(t:JournalTrash)=>Math.max(0,TRASH_DAYS-Math.floor((Date.now()-Date.parse(t.deletedAt))/86400000));
function describe(t:JournalTrash){
 if(t.kind==='memory')return {title:t.memory?.title||'Untitled memory',icon:<Images size={19}/>};
 if(t.kind==='milestone')return {title:t.milestone?.title||'Milestone',icon:<span className="bin-emoji">{t.milestone?.icon||'❤️'}</span>};
 if(t.kind==='diary')return {title:t.diary?.title||'Untitled entry',icon:<NotebookPen size={19}/>};
 return {title:`“${t.comment?.text??''}”`,icon:<MessageCircle size={19}/>};
}

export function JournalBin({items,mutate,users,privacy,onClose}:{items:JournalTrash[];mutate:MutateShared;users:User[];privacy:boolean;onClose:()=>void}){
 const sorted=[...items].sort((a,b)=>b.deletedAt.localeCompare(a.deletedAt)),{revealed,props:hold}=useHoldReveal();
 const name=(u:string)=>users.find(x=>x.username===u)?.displayName??u;
 const restore=(ids:string[])=>{let n=0;mutate(s=>{n=restoreFromBin(s,ids)});setTimeout(()=>{if(n)toast.success(n>1?`${n} items restored`:'Restored');if(n<ids.length)toast.error(ids.length>1?'Some items couldn’t go back (their memory is gone).':'This couldn’t go back: its memory is gone.')},0)};
 const purge=async(ids:string[])=>{if(!ids.length)return;if(!await confirmAction({title:ids.length>1?`Delete ${ids.length} items forever?`:'Delete this forever?',body:'This can’t be undone.',action:'Delete forever'}))return;mutate(s=>{s.journalTrash=(s.journalTrash??[]).filter(t=>!ids.includes(t.id))});toast.success(ids.length>1?'Deleted forever':'Deleted forever')};
 return <Dialog open onOpenChange={v=>!v&&onClose()}><DialogContent className="journal-editor photo-dump trash-view journal-bin" showCloseButton={false}>
  <div className="dump-top">
   <button className="round-btn" aria-label="Back" onClick={onClose}><ChevronLeft size={22}/></button>
   <div className="dump-heading"><DialogTitle>Recently deleted</DialogTitle><DialogDescription>{sorted.length} item{sorted.length===1?'':'s'} · deleted for good after {TRASH_DAYS} days</DialogDescription></div>
   <span/>
  </div>
  <div className="dump-scroll">
   {sorted.length>0&&<div className="trash-actions"><button type="button" className="chip-btn" onClick={()=>restore(sorted.map(t=>t.id))}><RotateCcw size={15} aria-hidden/>Restore all</button><button type="button" className="chip-btn danger-text" onClick={()=>void purge(sorted.map(t=>t.id))}><Trash2 size={15} aria-hidden/>Delete all</button></div>}
   <ul className="bin-list">{sorted.map(t=>{const d=describe(t),masked=privacy&&!!t.memory?.sensitive&&!revealed.has(t.id);return <li key={t.id} className="bin-row">
    <span className="bin-icon" aria-hidden>{masked?<Lock size={18}/>:d.icon}</span>
    <span className="bin-text" {...hold(t.id,masked)}><strong>{masked?'Sensitive memory · hold to show':d.title}</strong><span>{LABEL[t.kind]} · deleted by {name(t.deletedBy)} · {daysLeft(t)}d left</span></span>
    <button type="button" className="round-btn" aria-label={`Restore ${LABEL[t.kind].toLowerCase()}`} title="Restore" onClick={()=>restore([t.id])}><RotateCcw size={17}/></button>
    <button type="button" className="round-btn bin-purge" aria-label={`Delete ${LABEL[t.kind].toLowerCase()} forever`} title="Delete forever" onClick={()=>void purge([t.id])}><Trash2 size={17}/></button>
   </li>})}</ul>
   {!sorted.length&&<p className="muted vault-empty">Nothing here. Deleted memories, milestones, diary entries and comments stay here for {TRASH_DAYS} days.</p>}
  </div>
 </DialogContent></Dialog>;
}
