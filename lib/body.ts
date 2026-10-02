// Long-term weight goal. Direction comes from the numbers (target above start = gain, below = loss),
// so nothing assumes "higher is better". Built around weekly weigh-ins and monthly trends, not daily ones.
// Self-contained (no imports) so the server tests can load it directly.
const dateKey=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const shiftDay=(key:string,n:number)=>{const d=new Date(key+'T12:00:00');d.setDate(d.getDate()+n);return dateKey(d)};

export type WeighIn={date:string;kg:number;weekly?:boolean};
export type BodyGoal={start:number;target:number;startDate:string;entries:WeighIn[]};
export type Direction='gain'|'loss';

export const directionOf=(g:Pick<BodyGoal,'start'|'target'>):Direction=>g.target>=g.start?'gain':'loss';
const round=(n:number)=>Math.round(n*10)/10;
// The starting weight counts as the first weigh-in (on the goal's start date), so logging on day one never erases it.
const sorted=(g:BodyGoal)=>[{date:g.startDate,kg:g.start},...g.entries].sort((a,b)=>a.date.localeCompare(b.date));
const lastBefore=(list:WeighIn[],date:string)=>[...list].reverse().find(e=>e.date<date);
const lastIn=(list:WeighIn[],from:string,to:string)=>[...list].reverse().find(e=>e.date>=from&&e.date<=to);

// Weeks run Monday to Sunday.
export function weekStart(date:string){const d=new Date(date+'T12:00:00'),back=(d.getDay()+6)%7;return shiftDay(date,-back)}
const monthStart=(date:string)=>date.slice(0,8)+'01';

export function current(g:BodyGoal){return sorted(g).at(-1)?.kg??g.start}

// Progress toward the goal. `done` is positive when moving the right way; `pct` is clamped for display.
export function progress(g:BodyGoal){
 const dir=directionOf(g),now=current(g),amount=Math.abs(g.target-g.start);
 const done=dir==='gain'?now-g.start:g.start-now;
 return {dir,now,amount:round(amount),done:round(done),remaining:round(Math.max(0,amount-done)),pct:amount?Math.min(100,Math.max(0,done/amount*100)):100,reached:done>=amount};
}

// This week's weigh-in (the weekly check-in if there is one) against the last weigh-in before this week.
export function weekly(g:BodyGoal,today=dateKey()){
 const list=sorted(g),from=weekStart(today);
 const inWeek=list.filter(e=>e.date>=from&&e.date<=today),official=[...inWeek].reverse().find(e=>e.weekly)??inWeek.at(-1);
 const prev=lastBefore(list,from)??(official?lastBefore(list,official.date):undefined);
 return {entry:official??null,change:official&&prev?round(official.kg-prev.kg):null,due:!official};
}

// The month so far: last weigh-in before the month (or its first one) to the latest in the month.
export function monthly(g:BodyGoal,today=dateKey()){
 const list=sorted(g),from=monthStart(today),inMonth=list.filter(e=>e.date>=from&&e.date<=today);
 const startEntry=lastBefore(list,from)??inMonth[0],latest=inMonth.at(-1);
 return {label:new Date(today+'T12:00:00').toLocaleDateString('en-US',{month:'long'}),from:startEntry?.kg??null,to:latest?.kg??null,change:startEntry&&latest?round(latest.kg-startEntry.kg):null};
}

// One point per week (latest weigh-in that week) for the trend chart.
export function weeklySeries(g:BodyGoal,weeks=12,today=dateKey()){
 const list=sorted(g),out:{week:string;kg:number}[]=[];
 for(let i=weeks-1;i>=0;i--){const from=shiftDay(weekStart(today),-7*i),to=shiftDay(from,6),e=lastIn(list,from,to);if(e)out.push({week:from,kg:e.kg})}
 return out;
}

// Change over the last four weekly points, when there's enough data.
export function fourWeekTrend(g:BodyGoal,today=dateKey()){const s=weeklySeries(g,5,today);return s.length>=3?round(s.at(-1)!.kg-s[0].kg):null}

// Is a change moving toward the goal? Used for gentle colour only; fluctuations are never shown as failure.
export const towardGoal=(g:BodyGoal,change:number|null)=>change===null||change===0?null:(directionOf(g)==='gain')===(change>0);
export const signed=(n:number)=>`${n>0?'+':n<0?'−':'±'}${Math.abs(n).toFixed(1)} kg`;

export const newBody=(start:number,target:number,today=dateKey()):BodyGoal=>({start,target,startDate:today,entries:[]});
