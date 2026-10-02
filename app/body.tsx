'use client';
import {useState} from 'react';
import {Scale,Plus,Trash2,Target,TrendingUp,TrendingDown,ChevronRight,Pencil} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Switch} from '@/components/ui/switch';
import {toast} from 'sonner';
import {dateKey} from '@/lib/tracker';
import {current,directionOf,fourWeekTrend,monthly,newBody,progress,signed,towardGoal,weekly,weeklySeries,type BodyGoal} from '@/lib/body';
import type {State} from '@/lib/tracker';
import type {Mutate} from './tracker';
import {DatePicker} from './date-picker';

const kg=(n:number)=>`${n.toFixed(1)} kg`;
const shortDate=(d:string)=>new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
const label=(g:BodyGoal)=>directionOf(g)==='gain'?'Build':'Lean';
// Moving toward the goal gets the accent; the other way stays neutral. Never red: weight naturally fluctuates.
const tone=(g:BodyGoal,change:number|null)=>towardGoal(g,change)?'toward':'neutral';

// Progress tab: the long-term goal, this week, this month and the weekly trend.
export function BodyPanel({state,mutate}:{state:State;mutate:Mutate}){
 const g=state.body,[open,setOpen]=useState<false|'weigh'|'goal'>(false);
 if(!g)return <BodySetup mutate={mutate}/>;
 const p=progress(g),w=weekly(g),m=monthly(g),trend=fourWeekTrend(g),series=weeklySeries(g,12);
 return <section className={`project-panel body-panel dir-${p.dir}`}>
  <div className="body-head">
   <div><span className="body-mode">{label(g)}</span><h2>{kg(current(g)).replace(' kg','')} → {kg(g.target)}<button type="button" className="body-edit-goal" aria-label="Change the goal (start, target, start date)" title="Change goal" onClick={()=>setOpen('goal')}><Pencil size={14}/></button></h2><p className="muted">Started at {kg(g.start)} · {p.dir==='gain'?'+':'−'}{p.amount} kg goal · weekly weigh-ins</p></div>
   <button type="button" className="chip-btn active" onClick={()=>setOpen('weigh')}><Scale size={15} aria-hidden/>{w.due?'Weigh in':'Update'}</button>
  </div>
  <div className="body-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.pct)} aria-label={`${p.done} of ${p.amount} kilograms`}><span style={{width:`${p.pct}%`}}/></div>
  <div className="body-bar-meta"><span><strong>{Math.max(0,p.done).toFixed(1)}</strong> / {p.amount} kg</span><span>{p.reached?'Goal reached ❤️':`${p.remaining.toFixed(1)} kg to go`}</span></div>
  <div className="overview overview-compact body-stats">
   <div className="overview-card"><span className="stat-label">This week</span><div className="stat-number">{w.entry?kg(w.entry.kg):'—'}</div><p className={`muted change ${tone(g,w.change)}`}>{w.entry?(w.change===null?'First weigh-in':signed(w.change)):'Weigh-in due'}</p></div>
   <div className="overview-card"><span className="stat-label">{m.label}</span><div className="stat-number">{m.to!==null?kg(m.to):'—'}</div><p className={`muted change ${tone(g,m.change)}`}>{m.from!==null&&m.to!==null?`from ${m.from.toFixed(1)} · ${signed(m.change!)}`:'No weigh-in yet'}</p></div>
   <div className="overview-card"><span className="stat-label">Overall</span><div className="stat-number">{signed(Math.round((current(g)-g.start)*10)/10)}</div><p className="muted">{p.remaining.toFixed(1)} kg remaining</p></div>
  </div>
  {series.length>=2?<Trend g={g} series={series}/>:<p className="setting-hint body-hint">Your weekly trend shows up after two weigh-ins. Once a week is enough.</p>}
  {trend!==null&&<p className={`body-trend change ${tone(g,trend)}`}>{towardGoal(g,trend)?<TrendingUp size={15} aria-hidden/>:<TrendingDown size={15} aria-hidden/>}4-week trend {signed(trend)}{towardGoal(g,trend)===false?' · normal ups and downs, the long run is what counts':''}</p>}
  {open&&<WeighIn g={g} mutate={mutate} goalFirst={open==='goal'} onClose={()=>setOpen(false)}/>}
 </section>;
}

// No weight goal yet: one card to start one (start and target, starting today).
function BodySetup({mutate}:{mutate:Mutate}){
 const [open,setOpen]=useState(false),[start,setStart]=useState(''),[target,setTarget]=useState('');
 const save=(e:React.FormEvent)=>{e.preventDefault();const a=Math.round(Number(start)*10)/10,b=Math.round(Number(target)*10)/10;if(!(a>=20&&a<=400&&b>=20&&b<=400)||a===b)return void toast.error('Enter your current weight and a different target in kg.');mutate(s=>{if(!s.body)s.body=newBody(a,b)});toast.success('Weight goal started');setOpen(false)};
 return <section className="project-panel body-panel body-setup">
  <div className="body-head"><div><span className="body-mode">Weight</span><h2>Weight goal</h2><p className="muted">Optional. Track a long-term weight goal with weekly weigh-ins.</p></div>
   <button type="button" className="chip-btn active" onClick={()=>setOpen(true)}><Target size={15} aria-hidden/>Set a goal</button></div>
  {open&&<Dialog open onOpenChange={v=>!v&&setOpen(false)}><DialogContent className="editor body-dialog"><DialogTitle>Weight goal</DialogTitle><DialogDescription>Your current weight counts as today’s weigh-in. You can change both later.</DialogDescription>
   <form className="form-stack" onSubmit={save}>
    <div className="form-grid"><label className="field">Now (kg)<input type="number" inputMode="decimal" step="0.1" min="20" max="400" required value={start} onChange={e=>setStart(e.target.value)}/></label><label className="field">Target (kg)<input type="number" inputMode="decimal" step="0.1" min="20" max="400" required value={target} onChange={e=>setTarget(e.target.value)}/></label></div>
    <div className="form-actions"><button type="button" className="secondary" onClick={()=>setOpen(false)}>Cancel</button><button className="primary"><Plus size={16} aria-hidden/>Start</button></div>
   </form>
  </DialogContent></Dialog>}
 </section>;
}

// Today: one quiet line with the goal, tapping through to Progress.
export function BodyMini({state,onOpen}:{state:State;onOpen:()=>void}){
 const g=state.body;if(!g)return null;
 const p=progress(g),w=weekly(g);
 return <button type="button" className={`body-mini dir-${p.dir}`} onClick={onOpen} aria-label={`${label(g)} goal: ${p.done} of ${p.amount} kilograms. Open progress.`}>
  <span className="body-mode">{label(g)}</span>
  <span className="body-mini-main"><strong>{current(g).toFixed(1)} → {g.target} kg</strong><span className="body-bar small"><span style={{width:`${p.pct}%`}}/></span></span>
  <span className="body-mini-side">{w.due?<em>Weigh-in due</em>:p.reached?<>Goal reached</>:<>{p.remaining.toFixed(1)} kg to go</>}<ChevronRight size={16} aria-hidden/></span>
 </button>;
}

function Trend({g,series}:{g:BodyGoal;series:{week:string;kg:number}[]}){
 const W=320,H=110,pad=14,vals=[...series.map(s=>s.kg),g.start,g.target],min=Math.min(...vals)-0.5,max=Math.max(...vals)+0.5;
 const x=(i:number)=>pad+i*(W-2*pad)/Math.max(1,series.length-1),y=(v:number)=>H-pad-(v-min)/(max-min)*(H-2*pad);
 const line=series.map((s,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(s.kg).toFixed(1)}`).join(' ');
 return <figure className="body-chart" aria-label={`Weekly weigh-ins: ${series.map(s=>s.kg).join(', ')} kilograms`}>
  <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img">
   <defs><linearGradient id="body-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--body-accent)" stopOpacity=".35"/><stop offset="100%" stopColor="var(--body-accent)" stopOpacity="0"/></linearGradient></defs>
   <line x1={pad} x2={W-pad} y1={y(g.target)} y2={y(g.target)} className="body-target"/>
   <path d={`${line} L${x(series.length-1).toFixed(1)},${H-pad} L${x(0).toFixed(1)},${H-pad} Z`} fill="url(#body-fill)"/>
   <path d={line} className="body-line"/>
   {series.map((s,i)=><circle key={s.week} cx={x(i)} cy={y(s.kg)} r={i===series.length-1?4:2.5} className="body-dot"/>)}
  </svg>
  <figcaption><span>{shortDate(series[0].week)}</span><span className="body-target-label"><Target size={11} aria-hidden/>{g.target} kg</span><span>This week</span></figcaption>
 </figure>;
}

// goalFirst: opened from the pencil, with "Change goal" already open.
function WeighIn({g,mutate,onClose,goalFirst=false}:{g:BodyGoal;mutate:Mutate;onClose:()=>void;goalFirst?:boolean}){
 const [value,setValue]=useState(String(current(g))),[date,setDate]=useState(dateKey()),[official,setOfficial]=useState(true),[editGoal,setEditGoal]=useState(goalFirst),[start,setStart]=useState(String(g.start)),[target,setTarget]=useState(String(g.target)),[startDate,setStartDate]=useState(g.startDate);
 const recent=[...g.entries].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8);
 const save=(e:React.FormEvent)=>{e.preventDefault();const n=Math.round(Number(value)*10)/10;if(!(n>=20&&n<=400))return void toast.error('Enter your weight in kg.');
  mutate(s=>{const b=s.body!;const list=b.entries.filter(x=>x.date!==date);list.push({date,kg:n,...(official?{weekly:true}:{})});b.entries=list.sort((a,c)=>a.date.localeCompare(c.date))});
  toast.success('Weigh-in saved');onClose()};
 const saveGoal=()=>{const a=Math.round(Number(start)*10)/10,b=Math.round(Number(target)*10)/10;if(!(a>=20&&a<=400&&b>=20&&b<=400)||a===b)return void toast.error('Enter a start and a different target in kg.');if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||startDate>dateKey())return void toast.error('Pick a start date up to today.');mutate(s=>{s.body={...s.body!,start:a,target:b,startDate}});toast.success('Goal updated');if(goalFirst)onClose();else setEditGoal(false)};
 return <Dialog open onOpenChange={v=>!v&&onClose()}><DialogContent className="editor body-dialog"><DialogTitle>Weigh-in</DialogTitle><DialogDescription>Once a week is plenty. Same time and conditions each week gives the clearest trend.</DialogDescription>
  <form className="form-stack" onSubmit={save}>
   <label className="field">Weight (kg)<input type="number" inputMode="decimal" step="0.1" min="20" max="400" required value={value} onChange={e=>setValue(e.target.value)}/></label>
   <div className="field">Date<DatePicker value={date} onChange={setDate} max={dateKey()} label="Weigh-in date" className="date-field"><span>{shortDate(date)}</span></DatePicker></div>
   <div className="setting-line compact"><label htmlFor="weekly-checkin">Weekly check-in<span className="setting-hint">Counts as this week’s official weigh-in</span></label><Switch id="weekly-checkin" checked={official} onCheckedChange={setOfficial}/></div>
   <div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary"><Plus size={16} aria-hidden/>Save</button></div>
  </form>
  {recent.length>0&&<div className="body-history"><h3>Recent</h3><ul>{recent.map(e=><li key={e.date}><span>{shortDate(e.date)}{e.weekly&&<em>weekly</em>}</span><strong>{kg(e.kg)}</strong><button type="button" className="rem-x" aria-label={`Delete weigh-in from ${shortDate(e.date)}`} onClick={()=>{mutate(s=>{s.body!.entries=s.body!.entries.filter(x=>x.date!==e.date)})}}><Trash2 size={14}/></button></li>)}</ul></div>}
  <details ref={el=>{if(el&&goalFirst&&!el.dataset.shown){el.dataset.shown='1';requestAnimationFrame(()=>el.scrollIntoView({block:'center'}))}}} className="read-more body-goal-edit" open={editGoal} onToggle={e=>setEditGoal((e.target as HTMLDetailsElement).open)}><summary>Change goal</summary>
   <div className="form-grid"><label className="field">Start (kg)<input type="number" inputMode="decimal" step="0.1" value={start} onChange={e=>setStart(e.target.value)}/></label><label className="field">Target (kg)<input type="number" inputMode="decimal" step="0.1" value={target} onChange={e=>setTarget(e.target.value)}/></label></div>
   <div className="field">Started on<DatePicker value={startDate} onChange={setStartDate} max={dateKey()} label="When the goal started" className="date-field" jumpYears><span>{shortDate(startDate)}</span></DatePicker><span className="setting-hint">Your starting weight counts as a weigh-in on this day.</span></div>
   <button type="button" className="chip-btn" onClick={saveGoal}>Save goal</button>
  </details>
 </DialogContent></Dialog>;
}
