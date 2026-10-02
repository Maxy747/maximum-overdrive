'use client';
import {useCallback,useEffect,useState} from 'react';
import {Heart,ChevronLeft,ChevronRight,Lock,CircleCheck,CalendarDays} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {daysSince,shiftDay,type User} from '@/lib/tracker';
import {Avatar} from './avatar';
import {DatePicker} from './date-picker';

type Partner=User&{answered:boolean;answer:string|null;taskDone:boolean};
type ArchiveItem=User&{kind:'answer'|'comment';text:string;source:string};
type Daily={date:string;today:string;question:string;task:string;me:{answer:string;taskDone:boolean};partners:Partner[];archive:ArchiveItem[]};
const longDate=(key:string)=>new Date(key+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});

async function getDaily(date:string){const r=await fetch(`./api/daily?date=${date}`,{cache:'no-store'});const data=await r.json().catch(()=>({})) as Daily&{error?:string};if(!r.ok)throw Error(data.error??'Could not load today’s question.');return data}
async function putDaily(body:{date:string;answer?:string;taskDone?:boolean}){const r=await fetch('./api/daily',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok){const data=await r.json().catch(()=>({})) as {error?:string};throw Error(data.error??'Could not save. Please retry.')}}

// The heart badge on Today: days together, and the door to the daily couple prompt.
export function DailyButton({together,today,me}:{together:string;today:string;me:User}){
 const [open,setOpen]=useState(false),[status,setStatus]=useState<Daily|null>(null);
 const refresh=useCallback(()=>{getDaily(today).then(setStatus).catch(()=>{})},[today]);
 useEffect(()=>{refresh();const t=setInterval(refresh,120000);return()=>clearInterval(t)},[refresh]);
 // The Journal's "Questions answered" card opens today's question.
 useEffect(()=>{const open=()=>setOpen(true);window.addEventListener('max:open-daily',open);return()=>window.removeEventListener('max:open-daily',open)},[]);
 const n=together&&together<=today?daysSince(together,today):null,pending=!!status&&(!status.me.answer||!status.me.taskDone);
 return <>
  <button className="streak-badge love daily-badge" onClick={()=>setOpen(true)} title={together?`Together since ${new Date(together+'T12:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}`:undefined} aria-label={`${n!==null?`${n} days together. `:''}Open today’s couple question${pending?', not finished yet':''}`}>
   <Heart size={16} aria-hidden/>{n!==null?<><strong>{n}</strong>{n===1?'day':'days'}</>:<strong>Daily</strong>}{pending&&<span className="badge-dot" aria-hidden/>}
  </button>
  {open&&<DailyDialog today={today} me={me} onClose={()=>{setOpen(false);refresh()}}/>}
 </>;
}

function DailyDialog({today,me,onClose}:{today:string;me:User;onClose:()=>void}){
 const [date,setDate]=useState(today),[data,setData]=useState<Daily|null>(null),[draft,setDraft]=useState(''),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const load=useCallback(async(quiet=false)=>{try{const d=await getDaily(date);setData(d);if(!quiet){setDraft(d.me.answer);setEditing(!d.me.answer)}setError('')}catch(e){if(!quiet)setError(e instanceof Error?e.message:'Could not load.')}},[date]);
 // Keep polling so the partner's answer shows up while the dialog is open.
 useEffect(()=>{setData(null);void load();const t=setInterval(()=>void load(true),20000);return()=>clearInterval(t)},[load]);
 const isToday=!!data&&data.date===data.today;
 const saveAnswer=async()=>{if(!data||!draft.trim())return;setBusy(true);try{await putDaily({date:data.date,answer:draft.trim()});await load()}catch(e){setError(e instanceof Error?e.message:'Could not save.')}finally{setBusy(false)}};
 const toggleTask=async()=>{if(!data)return;const next=!data.me.taskDone;setData({...data,me:{...data.me,taskDone:next}});setBusy(true);try{await putDaily({date:data.date,taskDone:next});await load(true)}catch(e){setData({...data});setError(e instanceof Error?e.message:'Could not save.')}finally{setBusy(false)}};
 return <Dialog open onOpenChange={v=>!v&&onClose()}><DialogContent className="editor daily-dialog">
  <div className="daily-nav">
   <button className="iconbtn" aria-label="Previous day" onClick={()=>setDate(shiftDay(date,-1))}><ChevronLeft size={18}/></button>
   <div className="daily-heading"><DialogTitle className="daily-title">{date===today?'Today, together':longDate(date)}<DatePicker value={date} onChange={v=>{if(v<=today)setDate(v)}} max={today} label="Choose a date" className="daily-calendar"><CalendarDays size={16}/></DatePicker></DialogTitle><DialogDescription>{date===today?'Answer on your own. Your partner’s answer unlocks once you share yours.':'This day has passed, so answers are read-only.'}</DialogDescription>{date!==today&&<button type="button" className="link-btn daily-today" onClick={()=>setDate(today)}>Back to today</button>}</div>
   <button className="iconbtn" aria-label="Next day" disabled={date>=today} onClick={()=>setDate(shiftDay(date,1))}><ChevronRight size={18}/></button>
  </div>
  {!data?<p className="muted">{error||'Loading…'}</p>:<>
   <section className="daily-card">
    <p className="eyebrow">Question of the day</p>
    <h3>{data.question}</h3>
    <div className="daily-answer mine">
     <div className="daily-who"><Avatar user={me} size={28}/>You</div>
     {isToday&&editing?<>
      <textarea className="note" rows={3} maxLength={2000} placeholder="Your answer…" aria-label="Your answer" value={draft} onChange={e=>setDraft(e.target.value)}/>
      <div className="daily-actions">{data.me.answer&&<button className="link-btn" onClick={()=>{setDraft(data.me.answer);setEditing(false)}}>Cancel</button>}<button className="primary" disabled={busy||!draft.trim()} onClick={()=>void saveAnswer()}>{busy?'Saving…':data.me.answer?'Update answer':'Share my answer'}</button></div>
     </>:data.me.answer?<><p className="daily-text">{data.me.answer}</p>{isToday&&<button className="link-btn" onClick={()=>setEditing(true)}>Edit</button>}</>:<p className="muted">You didn’t answer this day.</p>}
    </div>
    {data.partners.map(p=><div className="daily-answer" key={p.username}>
     <div className="daily-who"><Avatar user={p} size={28}/>{p.displayName}</div>
     {p.answer!==null?(p.answered?<p className="daily-text">{p.answer}</p>:<p className="muted">{isToday?`${p.displayName} hasn’t answered yet.`:`${p.displayName} didn’t answer.`}</p>)
      :<p className="daily-locked"><Lock size={15} aria-hidden/>{p.answered?`${p.displayName} answered. Share yours to see it.`:`${p.displayName} hasn’t answered yet.`}</p>}
    </div>)}
   </section>
   <section className="daily-card">
    <p className="eyebrow">{isToday?'Little task for today':'Little task'}</p>
    <h3>{data.task}</h3>
    <div className="daily-task-row">
     <button className={`task-toggle ${data.me.taskDone?'done':''}`} disabled={!isToday||busy} aria-pressed={data.me.taskDone} onClick={()=>void toggleTask()}><CircleCheck size={18} aria-hidden/>{data.me.taskDone?'You did it':isToday?'Mark as done':'Not done'}</button>
     {data.partners.map(p=><span key={p.username} className={`task-partner ${p.taskDone?'done':''}`}><Avatar user={p} size={22}/>{p.taskDone?'Done':'Not yet'}</span>)}
    </div>
   </section>
   {data.archive.length>0&&<section className="daily-card daily-archive">
    <p className="eyebrow">From {data.archive[0].source} · {data.archive.length} {data.archive.length===1?'answer':'answers'}</p>
    {data.archive.map((a,i)=><div className="daily-answer" key={i}><div className="daily-who"><Avatar user={a} size={24}/>{a.displayName}{a.kind==='comment'&&<span className="archive-kind">comment</span>}</div><p className="daily-text">{a.text}</p></div>)}
   </section>}
   {error&&<p className="login-error" role="alert">{error}</p>}
  </>}
 </DialogContent></Dialog>;
}
