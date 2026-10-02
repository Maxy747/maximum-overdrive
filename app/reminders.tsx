'use client';
import {useState} from 'react';
import {Plus,X,Trash2,Clock,Sunset,MessageCircleHeart,ListChecks,Shield} from 'lucide-react';
import {Switch} from '@/components/ui/switch';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {toast} from 'sonner';
import {dailyNudgeOf,eveningOf,goalReminders,type CustomReminder,type Goal,type GoalReminder,type State} from '@/lib/tracker';
import type {Mutate} from './tracker';

const DAYS=['S','M','T','W','T','F','S'],DAY_NAMES=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const EMOJIS=['⏰','⚖️','☀️','🍳','🥗','🍲','💪','💧','💊','📖','🧘','🚶','🌙','📝','❤️'];
const PRESETS:Omit<CustomReminder,'id'|'enabled'|'note'>[]=[
 {title:'Wake up',emoji:'☀️',time:'07:00',days:[0,1,2,3,4,5,6]},
 {title:'Breakfast',emoji:'🍳',time:'08:30',days:[0,1,2,3,4,5,6]},
 {title:'Drink water',emoji:'💧',time:'11:00',days:[0,1,2,3,4,5,6]},
 {title:'Lunch',emoji:'🥗',time:'13:30',days:[0,1,2,3,4,5,6]},
 {title:'Workout',emoji:'💪',time:'18:00',days:[1,2,3,4,5]},
 {title:'Dinner',emoji:'🍲',time:'20:30',days:[0,1,2,3,4,5,6]},
 {title:'Wind down',emoji:'🌙',time:'23:00',days:[0,1,2,3,4,5,6]},
 {title:'Weekly weigh-in',emoji:'⚖️',time:'08:00',days:[0]},
];
const clock12=(t:string)=>{const [h,m]=t.split(':').map(Number);return `${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}`};
const daysLabel=(days:number[])=>days.length===7?'Every day':days.join()==='1,2,3,4,5'?'Weekdays':days.join()==='0,6'?'Weekends':days.map(d=>DAY_NAMES[d]).join(', ');
const blank=():CustomReminder=>({id:crypto.randomUUID(),title:'',emoji:'⏰',time:'09:00',days:[0,1,2,3,4,5,6],note:'',enabled:true});

// Everything MAX can remind you about, below the notification switch in Profile → Reminders.
export function ReminderSettings({state,mutate,privacy}:{state:State;mutate:Mutate;privacy:boolean}){
 const [editing,setEditing]=useState<{r:CustomReminder;isNew:boolean}|null>(null);
 const custom=[...(state.settings.customReminders??[])].sort((a,b)=>a.time.localeCompare(b.time));
 const evening=eveningOf(state),daily=dailyNudgeOf(state);
 const save=(r:CustomReminder)=>mutate(s=>{const list=s.settings.customReminders??(s.settings.customReminders=[]);const i=list.findIndex(x=>x.id===r.id);if(i<0)list.push(r);else list[i]=r});
 const remove=(id:string)=>mutate(s=>{s.settings.customReminders=(s.settings.customReminders??[]).filter(x=>x.id!==id)});
 return <>
  <GoalTimes state={state} mutate={mutate} privacy={privacy}/>
  <div className="rem-block">
   <div className="rem-head"><span><strong>Your reminders</strong><span className="setting-hint">Wake up, meals, water, anything. They ring even in quiet hours.</span></span><button type="button" className="chip-btn" onClick={()=>setEditing({r:blank(),isNew:true})}><Plus size={15} aria-hidden/>Add</button></div>
   {custom.length?<ul className="rem-list">{custom.map(r=><li key={r.id} className={r.enabled?'':'off'}>
    <button type="button" className="rem-item" onClick={()=>setEditing({r:structuredClone(r),isNew:false})} aria-label={`Edit ${r.title}`}><span className="rem-emoji" aria-hidden>{r.emoji||'⏰'}</span><span className="rem-text"><strong>{r.title}</strong><span>{clock12(r.time)} · {daysLabel(r.days)}</span></span></button>
    <Switch checked={r.enabled} aria-label={`${r.title} on`} onCheckedChange={v=>mutate(s=>{const x=s.settings.customReminders?.find(y=>y.id===r.id);if(x)x.enabled=v})}/>
   </li>)}</ul>
   :<div className="rem-presets">{PRESETS.slice(0,6).map(p=><button key={p.title} type="button" className="chip-btn" onClick={()=>{save({...p,id:crypto.randomUUID(),note:'',enabled:true});toast.success(`${p.title} reminder added · ${clock12(p.time)}`)}}><span aria-hidden>{p.emoji}</span>{p.title}</button>)}</div>}
  </div>
  <div className="setting-line compact rem-timed"><label htmlFor="evening-on"><Sunset size={16} aria-hidden/>Evening check-in<span className="setting-hint">Only if goals are open or you haven’t written about your day</span></label><span className="rem-controls">{evening.enabled&&<input type="time" aria-label="Evening check-in time" value={evening.time} onChange={e=>{const t=e.target.value;if(t)mutate(s=>{s.settings.evening={...eveningOf(s),time:t}})}}/>}<Switch id="evening-on" checked={evening.enabled} onCheckedChange={v=>mutate(s=>{s.settings.evening={...eveningOf(s),enabled:v}})}/></span></div>
  <div className="setting-line compact rem-timed"><label htmlFor="daily-on"><MessageCircleHeart size={16} aria-hidden/>Daily question<span className="setting-hint">Only if you haven’t answered today’s question yet</span></label><span className="rem-controls">{daily.enabled&&<input type="time" aria-label="Daily question reminder time" value={daily.time} onChange={e=>{const t=e.target.value;if(t)mutate(s=>{s.settings.dailyNudge={...dailyNudgeOf(s),time:t}})}}/>}<Switch id="daily-on" checked={daily.enabled} onCheckedChange={v=>mutate(s=>{s.settings.dailyNudge={...dailyNudgeOf(s),enabled:v}})}/></span></div>
  <p className="setting-hint rem-tz">Times follow your phone’s time zone{state.settings.timeZone?` · ${state.settings.timeZone.replace(/_/g,' ')}`:''}.</p>
  {editing&&<CustomEditor key={editing.r.id} reminder={editing.r} isNew={editing.isNew} onClose={()=>setEditing(null)} onSave={r=>{save(r);setEditing(null);toast.success(editing.isNew?'Reminder added':'Reminder saved')}} onDelete={()=>{remove(editing.r.id);setEditing(null);toast.success('Reminder deleted')}}/>}
 </>;
}

// Reminder times per goal. Editable even when main cards are locked. On checklists a time can belong
// to one item (Food → Lunch at 13:30), so it stays quiet once that item is ticked.
function GoalTimes({state,mutate,privacy}:{state:State;mutate:Mutate;privacy:boolean}){
 const goals=state.goals.filter(g=>!g.archived),total=goals.reduce((n,g)=>n+goalReminders(g).length,0);
 const update=(id:string,fn:(list:GoalReminder[])=>GoalReminder[])=>mutate(s=>{const g=s.goals.find(x=>x.id===id);if(!g)return;const list=fn(goalReminders(g)).sort((a,b)=>a.time.localeCompare(b.time));g.reminder='';g.reminders=list.length?list:undefined});
 return <details className="rem-block read-more rem-goals">
  <summary><ListChecks size={15} aria-hidden/>Goal times · {total?`${total} set`:'none yet'}</summary>
  <p className="setting-hint">Each time only rings if that goal (or item) isn’t done yet.</p>
  {goals.map(g=><GoalRow key={g.id} goal={g} hidden={privacy&&g.private} onChange={fn=>update(g.id,fn)}/>)}
 </details>;
}

function GoalRow({goal:g,hidden,onChange}:{goal:Goal;hidden:boolean;onChange:(fn:(list:GoalReminder[])=>GoalReminder[])=>void}){
 const times=goalReminders(g),itemized=['checklist','any'].includes(g.kind)&&g.items.length>1;
 return <div className="rem-goal">
  <div className="rem-goal-head"><span>{hidden?<><Shield size={14} aria-hidden/> Private goal</>:<><strong>{g.category}</strong> <span className="muted">{g.title}</span></>}</span>
   <button type="button" className="chip-btn small" aria-label={`Add a reminder time for ${hidden?'private goal':g.category}`} disabled={times.length>=12} onClick={()=>onChange(list=>[...list,{time:list.at(-1)?.time??'09:00'}])}><Clock size={13} aria-hidden/>Add time</button></div>
  {times.length>0&&<div className="rem-times">{times.map((r,i)=><span key={i} className="rem-time">
   <input type="time" aria-label="Reminder time" value={r.time} onChange={e=>{const t=e.target.value;if(t)onChange(list=>list.map((x,j)=>j===i?{...x,time:t}:x))}}/>
   {itemized&&!hidden&&<select aria-label="Remind about" value={r.item??''} onChange={e=>onChange(list=>list.map((x,j)=>j===i?(e.target.value===''?{time:x.time}:{time:x.time,item:Number(e.target.value)}):x))}><option value="">Whole goal</option>{g.items.map((it,k)=><option key={k} value={k}>{it}</option>)}</select>}
   <button type="button" className="rem-x" aria-label="Remove this time" onClick={()=>onChange(list=>list.filter((_,j)=>j!==i))}><X size={14}/></button>
  </span>)}</div>}
 </div>;
}

function CustomEditor({reminder,isNew,onClose,onSave,onDelete}:{reminder:CustomReminder;isNew:boolean;onClose:()=>void;onSave:(r:CustomReminder)=>void;onDelete:()=>void}){
 const [r,setR]=useState(reminder);const set=<K extends keyof CustomReminder>(k:K,v:CustomReminder[K])=>setR(x=>({...x,[k]:v}));
 const toggleDay=(d:number)=>setR(x=>({...x,days:x.days.includes(d)?x.days.filter(y=>y!==d):[...x.days,d].sort()}));
 const submit=(e:React.FormEvent)=>{e.preventDefault();const title=r.title.trim();if(!title)return void toast.error('Give the reminder a name.');if(!r.days.length)return void toast.error('Pick at least one day.');onSave({...r,title:title.slice(0,60),note:r.note.trim().slice(0,120)})};
 return <Dialog open onOpenChange={v=>!v&&onClose()}><DialogContent className="editor rem-editor"><DialogTitle>{isNew?'New reminder':'Edit reminder'}</DialogTitle><DialogDescription>Sent to this account’s phones at the time you pick.</DialogDescription>
  <form className="form-stack" onSubmit={submit}>
   {isNew&&<div className="rem-presets" aria-label="Suggestions">{PRESETS.map(p=><button key={p.title} type="button" className={`chip-btn ${r.title===p.title?'active':''}`} onClick={()=>setR(x=>({...x,...p}))}><span aria-hidden>{p.emoji}</span>{p.title}</button>)}</div>}
   <div className="rem-emojis" role="radiogroup" aria-label="Icon">{EMOJIS.map(e=><button key={e} type="button" role="radio" aria-checked={r.emoji===e} className={r.emoji===e?'active':''} onClick={()=>set('emoji',e)}>{e}</button>)}</div>
   <label className="field">Name<input value={r.title} maxLength={60} placeholder="Wake up, lunch, take vitamins…" onChange={e=>set('title',e.target.value)}/></label>
   <label className="field">Time<input type="time" required value={r.time} onChange={e=>e.target.value&&set('time',e.target.value)}/></label>
   <div className="field">Days<div className="rem-days">{DAYS.map((d,i)=><button key={i} type="button" aria-pressed={r.days.includes(i)} aria-label={DAY_NAMES[i]} className={r.days.includes(i)?'active':''} onClick={()=>toggleDay(i)}>{d}</button>)}</div></div>
   <label className="field">Message <span className="setting-hint">optional</span><input value={r.note} maxLength={120} placeholder="Shown under the title" onChange={e=>set('note',e.target.value)}/></label>
   <div className="form-actions">{!isNew&&<button type="button" className="secondary danger-text" onClick={onDelete}><Trash2 size={15} aria-hidden/>Delete</button>}<button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary">{isNew?'Add reminder':'Save'}</button></div>
  </form>
 </DialogContent></Dialog>;
}
