'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowUp,Cpu,RotateCcw,Info,NotebookPen,CheckCircle2,Undo2,History,ChevronLeft} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {toast} from 'sonner';
import {dayKey,dayFor,complete,needOf,streak,perfectStreak,weekOf,weeklyRecap,type Entry,type State} from '@/lib/tracker';
import {progress as bodyProgress} from '@/lib/body';
import type {CoachAction} from '@/lib/coach-log';

// M.A.X., your coach: checks in on your day, nudges what's left and keeps you honest.
// Talks to /api/coach, which forwards to the configured model (selfhost/coach.mjs).
// `logged`: what M.A.X. filled in on the tracker from the message before it, with the entries as they were (for Undo).
type Logged={day:string;summary:string[];before:Entry[];undone?:boolean};
type Msg={role:'user'|'assistant';content:string;error?:boolean;pending?:boolean;saved?:boolean;status?:string;logged?:Logged};
type Health={ok:boolean;available:boolean;loaded:boolean};

// Preset questions. "Log for me" starts a message for you to finish instead of sending.
const CHIPS:[string,string][]=[
 ['Check in','Check in on me. How am I doing today?'],['What’s left?','What do I still need to do today?'],['Plan my day','Help me plan the rest of my day.'],
 ['Log for me','LOG:'],['How’s my week?','How is my week going so far?'],['My streaks','How are my streaks looking, and what keeps them alive today?'],
 ['Weight goal','How is my weight goal going, and what should I focus on this week?'],['Motivate me','Give me a push to get going right now.'],
 ['Low on energy','I’m low on energy today. What’s the smallest version of today that still counts?'],['I’m struggling','I’m struggling today and don’t feel like doing anything.'],
 ['Sleep better','Help me get to bed on time tonight.'],['Focus on work','Help me focus and make progress on work right now.'],
 ['Wrap up','Help me wrap up and reflect on today.'],['Reflect with me','Ask me a question to help me reflect on today.'],
];
// Today at a glance, console-style: each goal, streaks, the week, weight.
// Opened from the ⓘ button in the coach's header.
function TodayPanel({state,privacy}:{state:State;privacy:boolean}){
 const key=dayKey(),day=dayFor(state,key),ess=day.entries.filter(e=>e.goal.essential&&!e.rest),done=ess.filter(complete).length,week=weeklyRecap(state,weekOf(key),key);
 const label=(e:Entry)=>e.goal.private&&privacy?'PRIVATE':e.goal.category.toUpperCase();
 const value=(e:Entry)=>{if(e.rest)return 'rest';if(e.goal.private&&privacy)return complete(e)?'done':'open';const g=e.goal;
  if(g.kind==='count'||g.kind==='duration')return `${e.value} / ${g.target} ${g.unit}`;
  if(g.kind==='checkbox')return complete(e)?'done':'not yet';
  const ticked=g.items.map((it,idx)=>({it,idx})).filter(x=>e.checks[x.idx]).map(({it,idx})=>{const l=e.exerciseLogs?.[String(idx)];return it.split('·')[0].trim()+(l?` ${l.reps}×${l.sets}`:'')});
  return g.kind==='checklist'?`${e.checks.filter(Boolean).length}/${needOf(g)}${ticked.length?` · ${ticked.join(', ')}`:''}`:(ticked.join(', ')||'not yet')};
 const rows:[string,string,boolean?][]=[['GOALS',`${done}/${ess.length} done`,done===ess.length&&ess.length>0],...day.entries.filter(e=>!e.rest).map(e=>[label(e),value(e),complete(e)] as [string,string,boolean]),
  ['STREAK',`${streak(state)} days · perfect ${perfectStreak(state)}`],['THIS WEEK',`${week.perfect} perfect · ${week.logged} showed up · ${week.missed} missed`],
  ...(state.body?[['WEIGHT',`${bodyProgress(state.body).now} → ${state.body.target} kg`] as [string,string]]:[]),...(day.lowEnergy?[['ENERGY','low-energy day · smaller goals'] as [string,string]]:[])];
 return <section className="coach-panel" id="coach-today" aria-label="Today at a glance">
  <p className="coach-panel-head"><span>TODAY · {new Date(key+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',day:'numeric',month:'short'}).toUpperCase()}</span></p>
  <dl>{rows.map(([k,v,ok],i)=><div key={i} className={ok?'ok':''}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
 </section>;
}
// One conversation per tracking day (5:30 am to 5:30 am), kept on this phone and cleared on logout.
const KEY='max-assistant';
function loadToday():Msg[]{try{const d=JSON.parse(localStorage.getItem(KEY)??'null') as {day?:string;messages?:Msg[]}|null;return d?.day===dayKey()?(d.messages??[]).filter(m=>!m.pending).slice(-30):[]}catch{return []}}

// Past chats with M.A.X., saved on the server by day: pick a day to read it back.
type LogEntry={role:'user'|'assistant'|'logged'|'reset';content:string;at:number};
const longDay=(d:string)=>new Date(d+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
function CoachHistory({onClose}:{onClose:()=>void}){
 const [days,setDays]=useState<{day:string;count:number;preview:string|null}[]|null>(null),[open,setOpen]=useState<{day:string;entries:LogEntry[]}|null>(null),[error,setError]=useState('');
 useEffect(()=>{fetch('./api/coach/history',{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{days:{day:string;count:number;preview:string|null}[]}>:Promise.reject()).then(d=>setDays(d.days)).catch(()=>setError('Couldn’t load your history. Check your connection.'))},[]);
 const show=(day:string)=>fetch(`./api/coach/history?day=${day}`,{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{day:string;entries:LogEntry[]}>:Promise.reject()).then(setOpen).catch(()=>toast.error('Couldn’t open that day.'));
 const time=(at:number)=>new Date(at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
 return <Dialog open onOpenChange={v=>!v&&onClose()}><DialogContent className="editor coach-history">
  {open?<>
   <div className="coach-history-top"><button type="button" className="round-btn" aria-label="Back to all days" onClick={()=>setOpen(null)}><ChevronLeft size={18}/></button><div><DialogTitle>{longDay(open.day)}</DialogTitle><DialogDescription>{open.entries.filter(e=>e.role==='user').length} messages</DialogDescription></div></div>
   <div className="coach-history-log">{open.entries.map((e,i)=>e.role==='reset'?<p key={i} className="coach-history-reset">Started over</p>:e.role==='logged'
    ?<div key={i} className="coach-logged"><CheckCircle2 size={15} aria-hidden/><span><strong>Logged</strong>{e.content}</span></div>
    :<div key={i} className={`assistant-msg ${e.role}`}><p>{e.content}</p><small>{time(e.at)}</small></div>)}</div>
  </>:<>
   <DialogTitle>Chat history</DialogTitle><DialogDescription>Every conversation with M.A.X., by day.</DialogDescription>
   {error?<p className="muted">{error}</p>:!days?<p className="muted">Loading…</p>:!days.length?<p className="muted">Nothing yet. Your chats are saved here from now on.</p>:
    <ul className="coach-history-days">{days.map(d=><li key={d.day}><button type="button" onClick={()=>void show(d.day)}><strong>{longDay(d.day)}</strong><span>{d.preview??'M.A.X. checked in'}</span></button></li>)}</ul>}
  </>}
 </DialogContent></Dialog>;
}

type CoachProps={state:State;privacy:boolean;onSaveReflection:(text:string)=>void;onLog:(day:string,actions:CoachAction[])=>Entry[];onUndoLog:(day:string,before:Entry[])=>void};
function CoachChat({state,privacy,onSaveReflection,onLog,onUndoLog}:CoachProps){
 const [messages,setMessages]=useState<Msg[]>(loadToday),[input,setInput]=useState(''),[busy,setBusy]=useState(false),[health,setHealth]=useState<Health|null>(null);
 const [showToday,setShowToday]=useState(false),[showHistory,setShowHistory]=useState(false),[synced,setSynced]=useState(false);
 const list=useRef<HTMLDivElement>(null),abort=useRef<AbortController|null>(null),kicked=useRef(false),field=useRef<HTMLInputElement>(null);
 useEffect(()=>{fetch('./api/coach/health?prime=1',{cache:'no-store'}).then(r=>r.json() as Promise<Health>).then(setHealth).catch(()=>setHealth({ok:false,available:false,loaded:false}))},[]);
 useEffect(()=>{try{localStorage.setItem(KEY,JSON.stringify({day:dayKey(),messages:messages.filter(m=>!m.pending).slice(-30)}))}catch{}list.current?.scrollTo({top:list.current.scrollHeight,behavior:'smooth'})},[messages]);
 useEffect(()=>()=>abort.current?.abort(),[]);

 const syncRef=useRef<(()=>Promise<void>)|null>(null),busyRef=useRef(false);busyRef.current=busy;
 const update=(fn:(m:Msg)=>Msg)=>setMessages(ms=>{const copy=[...ms];copy[copy.length-1]=fn(copy[copy.length-1]);return copy});
 const stream=useCallback(async(history:{role:string;content:string}[],kickoff=false)=>{
  setMessages(ms=>[...ms.filter(m=>!(m.pending&&m.status?.startsWith('Still'))),{role:'assistant',content:'',pending:true}]);setBusy(true);busyRef.current=true;
  const controller=new AbortController();abort.current=controller;
  try{
   const r=await fetch('./api/coach/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:history.slice(-10),kickoff}),signal:controller.signal});
   if(!r.ok||!r.body){const d=await r.json().catch(()=>({})) as {error?:string};throw Error(d.error??'M.A.X. is offline right now.')}
   const reader=r.body.getReader(),decoder=new TextDecoder();let buffer='';
   for(;;){
    const {done,value}=await reader.read();if(done)break;
    buffer+=decoder.decode(value,{stream:true});const events=buffer.split('\n\n');buffer=events.pop()??'';
    for(const raw of events){
     const line=raw.split('\n').find(l=>l.startsWith('data: '));if(!line)continue;
     let e:{type:string;text?:string;answer?:string;error?:string;day?:string;actions?:CoachAction[];summary?:string[]};try{e=JSON.parse(line.slice(6))}catch{continue}
     if(e.type==='token')update(m=>({...m,content:m.content+(e.text??''),status:undefined}));
     else if(e.type==='status')update(m=>({...m,status:e.text}));
     else if(e.type==='actions'&&e.day&&e.actions?.length){const before=onLog(e.day,e.actions),day=e.day,summary=e.summary??[];update(m=>({...m,status:undefined,logged:{day,summary,before}}))}
     else if(e.type==='done')update(m=>({...m,content:e.answer||m.content,pending:false}));
     else if(e.type==='error')update(m=>({...m,content:e.error??'Something went wrong.',error:true,pending:false}));
    }
   }
   update(m=>m.pending?{...m,pending:false,content:m.content||'No answer came back.',error:!m.content}:m);
   setHealth(h=>h&&{...h,loaded:true});
  }catch(err){if(!controller.signal.aborted)update(m=>({...m,content:err instanceof Error?err.message:'M.A.X. is offline right now.',error:true,pending:false}))}
  finally{setBusy(false);busyRef.current=false;abort.current=null;setTimeout(()=>void syncRef.current?.(),1500)}
 },[onLog]);

 // Today's chat comes from the server (the same on every device signed in as you): everything after the last Start over.
 // This phone's copy shows instantly and is kept for offline; it also keeps Undo for things logged from this phone.
 // Re-checked when MAX comes back to the front and every 15 s while open, but never while an answer is streaming in.
 const sync=useCallback(async()=>{
  try{
   const r=await fetch(`./api/coach/history?day=${dayKey()}`,{cache:'no-store'});if(!r.ok)return;
   const {entries}=await r.json() as {entries:{role:string;content:string;at:number}[]};if(busyRef.current)return;
   const from=entries.map(e=>e.role).lastIndexOf('reset')+1,server:Msg[]=[];let pendingLog:string[]=[];
   for(const e of entries.slice(from)){if(e.role==='logged'){pendingLog.push(e.content);continue}if(e.role!=='user'&&e.role!=='assistant')continue;
    const m:Msg={role:e.role,content:e.content};if(e.role==='assistant'&&pendingLog.length){m.logged={day:dayKey(),summary:pendingLog,before:[]};pendingLog=[]}server.push(m)}
   // Their last message is saved but the answer isn't yet (it's still being written, e.g. they left mid-reply): show it coming.
   const last=entries.at(-1),answering=last?.role==='user'&&Date.now()-last.at<3*60000;
   setMessages(local=>{
    if(local.some(m=>m.pending&&!m.status?.startsWith('Still')))return local;
    // Keep this phone's extras (Undo, "saved to reflection") on messages that match, and anything that failed to send.
    const merged=server.map(m=>{const same=local.find(l=>l.role===m.role&&l.content===m.content);return same?{...m,...(same.logged?{logged:same.logged}:{}),...(same.saved?{saved:true}:{})}:m});
    const tip=server.at(-1),match=tip?local.map(l=>l.role===tip.role&&l.content===tip.content).lastIndexOf(true):-1;
    const failed=local.slice(match+1).filter((m,i,a)=>m.error||(m.role==='user'&&a[i+1]?.error));
    return [...merged,...failed,...(answering?[{role:'assistant' as const,content:'',pending:true,status:'Still answering…'}]:[])];
   });
   if(answering)setTimeout(()=>void sync(),4000);
  }catch{/* offline: keep this phone's copy */}
 },[]);
 syncRef.current=sync;
 useEffect(()=>{let live=true;void sync().finally(()=>{if(live)setSynced(true)});
  const vis=()=>{if(document.visibilityState==='visible')void sync()};document.addEventListener('visibilitychange',vis);
  const t=setInterval(()=>{if(document.visibilityState==='visible')void sync()},15000);
  return()=>{live=false;document.removeEventListener('visibilitychange',vis);clearInterval(t)}},[sync]); // M.A.X. opens the conversation each day (once the account's chat for today is known to be empty).
 useEffect(()=>{if(synced&&!kicked.current&&!messages.length){kicked.current=true;void stream([],true)}},[synced,messages.length,stream]);

 const history=()=>messages.filter(m=>!m.error&&!m.pending).map(m=>({role:m.role,content:m.content}));
 const ask=(text:string)=>{const q=text.trim().slice(0,600);if(!q||busy)return;const h=[...history(),{role:'user',content:q}];setMessages(ms=>[...ms,{role:'user',content:q}]);setInput('');void stream(h)};
 const save=(i:number)=>{const m=messages[i];if(!m||m.saved)return;onSaveReflection(m.content);setMessages(ms=>ms.map((x,j)=>j===i?{...x,saved:true}:x));toast.success('Saved to today’s reflection')};
 const undoLog=(i:number)=>{const l=messages[i]?.logged;if(!l||l.undone)return;onUndoLog(l.day,l.before);setMessages(ms=>ms.map((x,j)=>j===i&&x.logged?{...x,logged:{...x.logged,undone:true}}:x));toast('Undone')};
 const restart=()=>{kicked.current=true;setMessages([]);void fetch('./api/coach/reset',{method:'POST'}).catch(()=>{}).finally(()=>void stream([],true))};

 const status=!health?'Checking…':!health.ok||!health.available?'Offline':health.loaded?'Here for you':'Asleep · wakes in about 30 s';
 return <div className="coach-chat">
  <div className="assistant-head"><span className={`assistant-orb ${health?.ok&&health.available?'on':''} ${busy?'thinking':''}`} aria-hidden><Cpu size={20}/></span>
   <div><h2>M.A.X.</h2><p className="muted">Your coach · <span className={`assistant-status ${health?.ok&&health.available?'on':''}`}>{status}</span></p></div>
   <div className="coach-head-actions"><button type="button" className="round-btn" aria-label="Chat history" title="Chat history" onClick={()=>setShowHistory(true)}><History size={16}/></button><button type="button" className={`round-btn ${showToday?'active':''}`} aria-label="Today’s progress" title="Today’s progress" aria-expanded={showToday} aria-controls="coach-today" onClick={()=>setShowToday(v=>!v)}><Info size={16}/></button><button type="button" className="round-btn" aria-label="Start over" title="Start over" disabled={busy} onClick={restart}><RotateCcw size={16}/></button></div>
  </div>
  {showToday&&<TodayPanel state={state} privacy={privacy}/>}
  {showHistory&&<CoachHistory onClose={()=>setShowHistory(false)}/>}
  <div className="assistant-list" ref={list} aria-live="polite">
   {messages.map((m,i)=><div key={i} className={`assistant-msg ${m.role} ${m.error?'error':''}`}>
    {m.logged&&<div className={`coach-logged ${m.logged.undone?'undone':''}`}><CheckCircle2 size={15} aria-hidden/><span><strong>{m.logged.undone?'Undone':'Logged'}</strong>{m.logged.summary.join(' · ')}</span>{!m.logged.undone&&m.logged.before.length>0&&<button type="button" onClick={()=>undoLog(i)} aria-label="Undo what M.A.X. logged"><Undo2 size={13} aria-hidden/>Undo</button>}</div>}
    {m.content?<p>{m.content}</p>:m.pending&&<span className="assistant-typing" aria-label={m.status??'M.A.X. is thinking'}><i/><i/><i/>{m.status&&<em>{m.status}</em>}</span>}
    {m.role==='user'&&m.content.length>=20&&<button type="button" className={`save-reflection ${m.saved?'saved':''}`} disabled={m.saved} onClick={()=>save(i)}><NotebookPen size={12} aria-hidden/>{m.saved?'Saved to reflection':'Save to today’s reflection'}</button>}
   </div>)}
  </div>
  <div className="assistant-chips">{CHIPS.map(([label,text])=><button key={label} type="button" className="chip-btn" disabled={busy} onClick={()=>{if(text==='LOG:'){setInput('Today I did ');field.current?.focus();return}ask(text)}}>{label}</button>)}</div>
  <form className="assistant-input" onSubmit={e=>{e.preventDefault();ask(input)}}>
   <input ref={field} value={input} onChange={e=>setInput(e.target.value)} maxLength={600} placeholder="Tell M.A.X. about your day" aria-label="Message M.A.X." enterKeyHint="send"/>
   <button className="round-btn send" aria-label="Send" disabled={busy||!input.trim()}><ArrowUp size={18}/></button>
  </form>
 </div>;
}

// The M.A.X. tab. The TV turn-on plays once per app session; leaving the app (hidden) or restarting resets it.
let tvSeen=false;
if(typeof document!=='undefined')document.addEventListener('visibilitychange',()=>{if(document.hidden)tvSeen=false});

export function CoachPage(props:CoachProps){
 const [anim]=useState<'tv'|'return'>(()=>tvSeen?'return':'tv');
 useEffect(()=>{tvSeen=true},[]);
 return <div className="coach-page"><div className={`coach-screen anim-${anim}`}><CoachChat {...props}/></div></div>;
}
