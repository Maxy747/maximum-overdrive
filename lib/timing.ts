// Timed goals: when things should happen, not just whether they did. Shared by the app (chips on the check-in),
// the server (reminders when a window opens or closes) and the coach (which calls out late or missed ones).
//
// A checklist item can have a window (Breakfast 07:00 to 10:00); ticking it records the time (`entry.times[i]`, HH:MM,
// editable when logging afterwards). Sleep has a plan (in bed by, up by); logging bed and wake times fills in the hours
// and flags a late night, a late wake-up, too much or too little sleep.
import {DEFAULT_SLEEP,fmtTime,isSleepGoal,itemsOf,sleepPlanOf,toMin,windowFor,windowsOf,type Entry,type Goal} from './tracker';
export {DEFAULT_SLEEP,fmtTime,isSleepGoal,itemsOf,sleepPlanOf,toMin,windowFor,windowsOf};

export type {TimeWindow,SleepPlan} from './tracker';
import type {TimeWindow,SleepPlan} from './tracker';
export type Timing='upcoming'|'due'|'on-time'|'late'|'missed';

// Minutes into the tracking day, which starts at 5:30 am: 1 am comes after 11 pm.
export const dayMin=(t:string)=>{const m=toMin(t);return m<330?m+1440:m};
// Bedtimes: anything before 6 pm counts as after midnight (a 2 am bedtime is later than 11:30 pm, not earlier).
const bedMin=(t:string)=>{const m=toMin(t);return m<1080?m+1440:m};
export const clockNow=(d=new Date())=>`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
export const fmtWindow=(w:TimeWindow)=>`${fmtTime(w.from)}–${fmtTime(w.to)}`;

/** Where an item stands: `at` is when it was ticked, `now` the time today (null for a day that's over). */
export function itemTiming(w:TimeWindow,checked:boolean,at:string|null|undefined,now:string|null):Timing{
 if(checked)return at&&dayMin(at)>dayMin(w.to)?'late':'on-time';
 if(now===null)return 'missed';
 const n=dayMin(now);return n<dayMin(w.from)?'upcoming':n<=dayMin(w.to)?'due':'missed';
}

export const sleepHours=(bed:string,wake:string)=>Math.round(((toMin(wake)-toMin(bed)+1440)%1440)/60*4)/4;
export type SleepReport={lateBed:boolean;lateWake:boolean;tooMuch:boolean;short:boolean};
/** Too much is more than 2 hours over the target; late means after the plan's time. */
export function sleepReport(plan:SleepPlan|null,e:Pick<Entry,'bed'|'wake'|'value'>,target:number):SleepReport{
 return {
  lateBed:!!(plan?.bedBy&&e.bed&&bedMin(e.bed)>bedMin(plan.bedBy)),
  lateWake:!!(plan?.wakeBy&&e.wake&&toMin(e.wake)>toMin(plan.wakeBy)),
  tooMuch:e.value>target+2,
  short:e.value>0&&e.value<target,
 };
}

/** Plain-language timing facts for the coach, e.g. "Breakfast: logged at 10:45 am, late (window 7 am–10 am)". */
export function timingFacts(def:Goal,e:Entry,now:string|null):string[]{
 if(e.rest||def.private)return [];
 if(isSleepGoal(def)){
  const plan=sleepPlanOf(def);if(!plan||(!e.bed&&!e.wake))return [];
  const r=sleepReport(plan,e,def.target),bits=[];
  if(e.bed)bits.push(`in bed at ${fmtTime(e.bed)}${plan.bedBy?` (aim ${fmtTime(plan.bedBy)}${r.lateBed?', late':''})`:''}`);
  if(e.wake)bits.push(`up at ${fmtTime(e.wake)}${plan.wakeBy?` (aim ${fmtTime(plan.wakeBy)}${r.lateWake?', late':''})`:''}`);
  if(r.tooMuch)bits.push(`${e.value} h is too much sleep (target ${def.target})`);
  return [`Sleep timing last night: ${bits.join(', ')}.`];
 }
 return itemsOf(def).flatMap((item,i)=>{
  const w=windowFor(def,item);if(!w)return [];
  const t=itemTiming(w,!!e.checks[i],e.times?.[i],now),win=fmtWindow(w);
  return [`${item}: ${t==='on-time'?`done${e.times?.[i]?` at ${fmtTime(e.times[i]!)}`:''}, on time`:t==='late'?`done at ${fmtTime(e.times![i]!)}, late (window ${win})`:t==='missed'?`missed (window ${win} is over)`:t==='due'?`due now (window ${win})`:`coming up (${win})`}.`];
 });
}
