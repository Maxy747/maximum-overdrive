'use client';
import {useEffect,useState} from 'react';
import {Flame,ChevronLeft,ChevronRight,Snowflake,Trophy,Hourglass,Sparkles,Check} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {streak,perfectStreak,bestStreak,freezeBalance,perfectRun,dayStatus,msUntilDayEnds,type State} from '@/lib/tracker';

const weekdays=['M','T','W','T','F','S','S'];
const monthKey=(key:string)=>key.slice(0,7);
const shiftMonth=(m:string,n:number)=>{const [y,mo]=m.split('-').map(Number);const d=new Date(y,mo-1+n,1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`};

// The flame badge on Today; opens the big streak view.
export function StreakButton({state,today,viewing,onPickDay}:{state:State;today:string;viewing?:string;onPickDay?:(key:string)=>void}){
 const [open,setOpen]=useState(false),n=streak(state),frozen=freezeBalance(state),perfect=dayStatus(state,today)==='done';
 return <>
  <button className={`streak-badge streak-btn${n?'':' cold'}${perfect?' perfect':''}`} onClick={()=>setOpen(true)} aria-label={`${n} day streak${perfect?', perfect day today':''}, ${frozen} streak freeze${frozen===1?'':'s'}. Open streak details.`}>
   <Flame size={16} aria-hidden/><strong>{n}</strong>{n===1?'day':'days'}{perfect&&<Sparkles size={13} className="perfect-spark" aria-hidden/>}
  </button>
  {open&&<StreakDialog state={state} today={today} viewing={viewing} onPick={onPickDay?k=>{onPickDay(k);setOpen(false)}:undefined} onClose={()=>setOpen(false)}/>}
 </>;
}

function StreakDialog({state,today,viewing,onPick,onClose}:{state:State;today:string;viewing?:string;onPick?:(key:string)=>void;onClose:()=>void}){
 const [month,setMonth]=useState(monthKey(today)),[freezeInfo,setFreezeInfo]=useState(false);
 const n=streak(state),p=perfectStreak(state),best=bestStreak(state,today),frozen=freezeBalance(state),run=perfectRun(state,today)%7,used=new Set(state.freezes?.used??[]);
 const first=[...Object.keys(state.days),...state.goals.map(g=>g.created)].sort()[0]??today;
 const [y,m]=month.split('-').map(Number),daysInMonth=new Date(y,m,0).getDate(),offset=(new Date(y,m-1,1).getDay()+6)%7;
 const cells=Array.from({length:offset+daysInMonth},(_,i)=>i<offset?null:`${month}-${String(i-offset+1).padStart(2,'0')}`);
 const status=(key:string)=>{
  if(key>today)return 'future';if(key<first)return 'before';
  const st=dayStatus(state,key);
  if(st==='done')return 'perfect';if(st==='logged')return 'done';if(used.has(key))return 'frozen';if(st==='none')return 'rest';
  return key===today?'pending':'missed';
 };
 const label={perfect:'perfect day, all 5 done',done:'updated',frozen:'saved by a freeze',missed:'nothing updated',rest:'nothing scheduled',pending:'not updated yet',future:'',before:''} as const;
 const perfectThisMonth=cells.filter(c=>c&&status(c)==='perfect').length,todayStatus=status(today);
 return <Dialog open onOpenChange={v=>!v&&onClose()}><DialogContent className="editor streak-dialog">
  <DialogTitle className="sr-only">Your streak</DialogTitle>
  <DialogDescription className="sr-only">{n} day streak. Best {best}. {frozen} streak freezes.</DialogDescription>
  <div className={`streak-hero ${n?'':'cold'}`}>
   <div className="big-fire" aria-hidden><span className="fire-glow"/><span className="fire-emoji">🔥</span></div>
   <strong className="streak-number">{n}</strong>
   <span className="streak-caption">day streak{n===0&&' · update anything today to start one'}</span>
   {p>0&&<span className="perfect-line"><Sparkles size={14} aria-hidden/>{p} perfect day{p===1?'':'s'} in a row</span>}
   {todayStatus==='pending'?<DayCountdown/>:todayStatus==='done'?<span className="day-countdown safe"><Check size={14} aria-hidden/>Streak safe today · finish all 5 for a perfect day</span>:todayStatus==='perfect'?<span className="day-countdown perfect"><Sparkles size={14} aria-hidden/>Perfect day</span>:null}
  </div>
  <div className="streak-stats">
   <div className="stat-tile"><span className="stat-icon"><Trophy size={20} aria-hidden/></span><strong>{best}</strong><span>best streak</span></div>
   <button type="button" className={`stat-tile freeze-stat ${freezeInfo?'open':''}`} aria-expanded={freezeInfo} aria-controls="freeze-info" onClick={()=>setFreezeInfo(v=>!v)} aria-label={`${frozen} streak freeze${frozen===1?'':'s'} ready. ${run} of 7 perfect days toward the next one. Tap for details.`}>
    <span className="freeze-ring" aria-hidden><svg viewBox="0 0 44 44"><circle className="ring-track" cx="22" cy="22" r="19"/><circle className="ring-fill" cx="22" cy="22" r="19" strokeDasharray={`${run/7*119.4} 119.4`}/></svg><Snowflake size={18}/></span>
    <strong>{frozen}</strong><span>{frozen===1?'freeze':'freezes'} · {run}/7</span>
   </button>
   <div className="stat-tile"><span className="stat-icon perfect-icon"><Sparkles size={20} aria-hidden/></span><strong>{perfectThisMonth}</strong><span>perfect this month</span></div>
  </div>
  {freezeInfo&&<div id="freeze-info" className="freeze-info">
   <p><strong>{run} / 7</strong> perfect days toward your next freeze.</p>
   <div className="freeze-bar" aria-hidden><span style={{width:`${run/7*100}%`}}/></div>
   <p>Your streak grows every day you update anything. A freeze saves it automatically on a day you don’t. The streak stays alive, but that day doesn’t count.</p>
   <p className="muted">You get <strong>1 every month</strong>, plus <strong>1 for every 7 days in a row</strong> with all 5 main tasks done.</p>
  </div>}
  <section className="streak-calendar" aria-label="Streak calendar">
   <div className="streak-cal-head">
    <button className="iconbtn" aria-label="Previous month" onClick={()=>setMonth(shiftMonth(month,-1))} disabled={month<=monthKey(first)}><ChevronLeft size={18}/></button>
    <strong>{new Date(y,m-1,1).toLocaleDateString('en-US',{month:'long',year:'numeric'})}</strong>
    <button className="iconbtn" aria-label="Next month" onClick={()=>setMonth(shiftMonth(month,1))} disabled={month>=monthKey(today)}><ChevronRight size={18}/></button>
   </div>
   <div className="streak-grid">
    {weekdays.map((d,i)=><span key={'w'+i} className="streak-wd">{d}</span>)}
    {cells.map((key,i)=>{if(!key)return <span key={'e'+i}/>;const st=status(key),day=Number(key.slice(8));
     const content=st==='perfect'?<span aria-hidden className="perfect-flame">🔥</span>:st==='done'?<span aria-hidden>🔥</span>:st==='frozen'?<Snowflake size={15} aria-hidden/>:day,cls=`streak-day ${st} ${key===today?'today':''} ${key===viewing&&key!==today?'viewing':''}`,name=`${new Date(key+'T12:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric'})}${label[st]?`: ${label[st]}`:''}`;
     return onPick&&st!=='future'&&st!=='before'?<button key={key} type="button" className={cls} aria-label={`Open ${name}`} title={name} onClick={()=>onPick(key)}>{content}</button>:<span key={key} className={cls} title={label[st]?name:undefined} aria-label={label[st]?name:undefined}>{content}</span>})}
   </div>
   {onPick&&<p className="streak-tip">Tap a day to open it on Today.</p>}<div className="streak-legend"><span><i className="lg perfect"/>Perfect</span><span><i className="lg done"/>Updated</span><span><i className="lg frozen"/>Freeze used</span><span><i className="lg missed"/>Missed</span></div>
  </section>
 </DialogContent></Dialog>;
}

// Today's day ends at 5:30 am. Shown while today isn't finished yet.
function DayCountdown(){
 const [left,setLeft]=useState(()=>msUntilDayEnds());
 useEffect(()=>{const t=setInterval(()=>setLeft(msUntilDayEnds()),30000);return()=>clearInterval(t)},[]);
 const h=Math.floor(left/3600000),m=Math.floor(left%3600000/60000);
 return <span className={`day-countdown ${left<3*3600000?'soon':''}`}><Hourglass size={14} aria-hidden/>{h?`${h}h ${m}m`:`${m}m`} left today · resets at 5:30 AM</span>;
}
