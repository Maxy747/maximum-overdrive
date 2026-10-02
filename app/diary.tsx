'use client';
import {useEffect,useState} from 'react';
import {NotebookPen,Plus,Pencil,Trash2,MoreHorizontal} from 'lucide-react';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from '@/components/ui/dropdown-menu';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {dateKey,type DiaryEntry,type User} from '@/lib/tracker';
import type {MutateShared} from './shared';

const displayDate=(date:string)=>new Date(date+'T12:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});

const entryTitle=(entry:DiaryEntry)=>entry.title||'Untitled entry';
// Newest first.
const sortKey=(entry:DiaryEntry)=>entry.date;
const entryDate=(entry:DiaryEntry)=>displayDate(entry.date);

export function Diary({entries,mutate,me,users,compose=0,onDelete}:{entries:DiaryEntry[];mutate:MutateShared;me:User;users:User[];compose?:number;onDelete:(id:string)=>Promise<boolean>}){
 const [draft,setDraft]=useState<DiaryEntry|null>(null),[reading,setReading]=useState<string|null>(null);
 const current=entries.find(e=>e.id===reading);
 const author=(name:string)=>users.find(u=>u.username===name)?.displayName??name;
 const create=()=>{const now=new Date().toISOString();setDraft({id:crypto.randomUUID(),title:'',body:'',date:dateKey(),author:me.username,created:now,updated:now})};
 // Opened from a "+" menu: start a new entry straight away.
 useEffect(()=>{if(compose){const now=new Date().toISOString();setReading(null);setDraft({id:crypto.randomUUID(),title:'',body:'',date:dateKey(),author:me.username,created:now,updated:now})}},[compose,me.username]);
 return <section className="diary-section" aria-label="Shared diary">
  <div className="diary-heading"><div><h2>Our Diary</h2><p>A place for your thoughts. Shared with both of you.</p></div><button className="primary" onClick={create}><Plus size={17}/>Write</button></div>
  {entries.length?<ol className="diary-list">{[...entries].sort((a,b)=>sortKey(b).localeCompare(sortKey(a))||b.created.localeCompare(a.created)).map(e=><li key={e.id}><button className="diary-entry" onClick={()=>setReading(e.id)}><span className="diary-meta">{entryDate(e)} · {author(e.author)}</span><strong>{entryTitle(e)}</strong><span className="diary-excerpt">{e.body}</span></button></li>)}</ol>:<div className="journal-empty"><NotebookPen size={32}/><h3>Your thoughts belong here.</h3><p>Write about today, or paste an entry from your notes.</p><button className="primary" onClick={create}><Plus size={16}/>Write your first entry</button></div>}
  {current&&<Dialog open onOpenChange={v=>!v&&setReading(null)}><DialogContent className="diary-dialog diary-reading"><DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="round-btn diary-more" aria-label="More options"><MoreHorizontal size={18}/></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="journal-add-menu"><DropdownMenuItem onSelect={()=>{setDraft({...current});setReading(null)}}><Pencil size={17}/>Edit entry</DropdownMenuItem><DropdownMenuItem className="menu-danger" onSelect={()=>void onDelete(current.id).then(ok=>{if(ok)setReading(null)})}><Trash2 size={17}/>Delete entry</DropdownMenuItem></DropdownMenuContent></DropdownMenu><DialogTitle>{entryTitle(current)}</DialogTitle><DialogDescription>{entryDate(current)} · {author(current.author)} · Shared diary</DialogDescription><div className="diary-body">{current.body}</div></DialogContent></Dialog>}
  {draft&&<DiaryEditor key={draft.id} entry={draft} onClose={()=>setDraft(null)} onSave={entry=>{mutate(s=>{const list=s.diary??(s.diary=[]),i=list.findIndex(e=>e.id===entry.id);if(i<0)list.push(entry);else list[i]=entry});setDraft(null);setReading(entry.id)}}/>}
 </section>;
}

function DiaryEditor({entry,onClose,onSave}:{entry:DiaryEntry;onClose:()=>void;onSave:(entry:DiaryEntry)=>void}){
 const [draft,setDraft]=useState(entry);
 const close=()=>{if(JSON.stringify(draft)===JSON.stringify(entry)||window.confirm('Discard your unsaved diary changes?'))onClose()};
 return <Dialog open onOpenChange={v=>!v&&close()}><DialogContent className="diary-dialog"><DialogTitle>{entry.body?'Edit diary entry':'Write in our diary'}</DialogTitle><DialogDescription>You both can read and edit this entry. Save when you’re ready.</DialogDescription><form className="diary-form" onSubmit={ev=>{ev.preventDefault();if(draft.body.trim())onSave({...draft,title:draft.title.trim(),body:draft.body.trim(),updated:new Date().toISOString()})}}><label className="field">Date{<input type="date" required max={dateKey()} value={draft.date} onChange={e=>setDraft(d=>({...d,date:e.target.value}))}/>}</label><label className="field">Title<input maxLength={150} placeholder="Give this entry a title" value={draft.title} onChange={e=>setDraft(d=>({...d,title:e.target.value}))}/></label><label className="field diary-writing">Your entry<textarea required maxLength={100000} placeholder="What’s on your mind? You can paste your iCloud note here." value={draft.body} onChange={e=>setDraft(d=>({...d,body:e.target.value}))}/></label><div className="diary-actions"><button type="button" className="secondary" onClick={close}>Cancel</button><button className="primary" disabled={!draft.body.trim()}>Save entry</button></div></form></DialogContent></Dialog>;
}
