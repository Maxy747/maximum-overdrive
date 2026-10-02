'use client';
import {Moon,MoonStar,Sun} from 'lucide-react';
import {DEFAULT_SLEEP,fmtTime,fmtWindow,isSleepGoal,itemTiming,sleepHours,sleepPlanOf,sleepReport,type SleepPlan,type TimeWindow} from '@/lib/timing';
import type {Entry,Goal} from '@/lib/tracker';

// The time chip on a timed item (lib/timing): its window before it's done, when it was done after (tap to correct
// it when logging afterwards), or "missed" once the window is over.
export function TimeChip({w,checked,at,now,onAt}:{w:TimeWindow;checked:boolean;at?:string|null;now:string|null;onAt:(t:string|null)=>void}){
 const t=itemTiming(w,checked,at,now);
 const text=t==='upcoming'?fmtWindow(w):t==='due'?`now · till ${fmtTime(w.to)}`:t==='missed'?'missed':t==='late'?`${fmtTime(at!)} · late`:at?`${fmtTime(at)} ✓`:'on time';
 return <span className={`time-chip ${t}`} title={`Window ${fmtWindow(w)}`}>
  {text}
  {checked&&<input type="time" aria-label="When you did it" value={at??''} onChange={e=>onAt(e.target.value||null)}/>}
 </span>;
}

// Sleep: when you got into bed and woke up. Both set fills in the hours; the flags say what to fix tonight.
export function SleepTimes({entry:e,plan,target,update}:{entry:Entry;plan:SleepPlan|null;target:number;update:(fn:(e:Entry)=>void)=>void}){
 const set=(key:'bed'|'wake',v:string)=>update(x=>{if(v)x[key]=v;else delete x[key];delete x.noSleep;if(x.bed&&x.wake)x.value=sleepHours(x.bed,x.wake)});
 // Didn't or couldn't sleep: an answer in itself (0 hours, logged), not a blank waiting to be filled.
 const noSleep=()=>update(x=>{if(x.noSleep){delete x.noSleep;return}x.noSleep=true;x.value=0;delete x.bed;delete x.wake});
 if(e.noSleep)return <div className="sleep-times">
  <button type="button" className="no-sleep-toggle on" aria-pressed onClick={noSleep}><MoonStar size={15} aria-hidden/>Didn’t / couldn’t sleep</button>
  <p className="no-sleep-note">Rough night. Go easy today, skip the late caffeine, and make tonight an early one.</p>
 </div>;
 const r=sleepReport(plan,e,target),flags=[
  r.lateBed&&`Late night · aim ${fmtTime(plan!.bedBy)}`,
  r.lateWake&&`Woke late · aim ${fmtTime(plan!.wakeBy)}`,
  r.tooMuch&&'Overslept',
  r.short&&'Short night',
 ].filter(Boolean) as string[];
 const onPlan=!!(e.bed&&e.wake)&&!flags.length;
 return <div className="sleep-times">
  <div className="sleep-time-row">
   <label className={`sleep-time ${r.lateBed?'late':''}`}><Moon size={15} aria-hidden/><span>In bed</span><input type="time" value={e.bed??''} onChange={ev=>set('bed',ev.target.value)}/></label>
   <label className={`sleep-time ${r.lateWake?'late':''}`}><Sun size={15} aria-hidden/><span>Woke up</span><input type="time" value={e.wake??''} onChange={ev=>set('wake',ev.target.value)}/></label>
  </div>
  {(flags.length>0||onPlan)&&<div className="sleep-flags">{onPlan?<span className="ok">On schedule ✓</span>:flags.map(f=><span key={f}>{f}</span>)}</div>}
  <div className="sleep-foot">
   {!e.bed&&!e.wake&&plan&&(plan.bedBy||plan.wakeBy)?<p className="sleep-plan">Plan: {plan.bedBy&&`bed by ${fmtTime(plan.bedBy)}`}{plan.bedBy&&plan.wakeBy&&' · '}{plan.wakeBy&&`up by ${fmtTime(plan.wakeBy)}`}</p>:<span/>}
   <button type="button" className="no-sleep-toggle" aria-pressed={false} onClick={noSleep}><MoonStar size={14} aria-hidden/>Didn’t sleep</button>
  </div>
 </div>;
}

// Goal editor: Sleep's plan (bed by, up by).
export function GoalTiming({g,setG}:{g:Goal;setG:(fn:(g:Goal)=>Goal)=>void;items?:string[]}){
 if(isSleepGoal(g)){
  const p=sleepPlanOf(g)??DEFAULT_SLEEP,set=(k:keyof SleepPlan,v:string)=>setG(o=>({...o,sleepPlan:{...(sleepPlanOf(o)??DEFAULT_SLEEP),[k]:v}}));
  return <div className="field goal-timing"><span>Sleep plan</span>
   <div className="timing-row"><span className="timing-item">In bed by</span><input type="time" value={p.bedBy} onChange={e=>set('bedBy',e.target.value)}/></div>
   <div className="timing-row"><span className="timing-item">Up by</span><input type="time" value={p.wakeBy} onChange={e=>set('wakeBy',e.target.value)}/></div>
   <span className="setting-hint">M.A.X. calls out late nights, late mornings and oversleeping. Clear a time to stop tracking it.</span>
  </div>;
 }
 // Checklist tasks set their times in their own rows (app/items-editor).
 return null;
}
