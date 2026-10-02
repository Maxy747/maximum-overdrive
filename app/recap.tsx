'use client';
import {useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Sparkles,TrendingUp,TrendingDown} from 'lucide-react';
import {toast} from 'sonner';
import {dayKey,shiftDay,weekOf,weeklyRecap,recapNote,type State} from '@/lib/tracker';
import type {Mutate} from './tracker';

// Weekly recap: what you finished, missed and improved (Monday to Sunday), with a short note from Coach MAX.
// Early in the week it opens on last week, which is the one worth reviewing.
const short=(k:string)=>new Date(k+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
export function WeeklyRecap({state,mutate,canCoach,focus}:{state:State;mutate:Mutate;canCoach:boolean;focus?:number}){
 const today=dayKey(),thisWeek=weekOf(today),weekday=(new Date(today+'T12:00:00').getDay()+6)%7;
 const [start,setStart]=useState(weekday<=1?shiftDay(thisWeek,-7):thisWeek),[asking,setAsking]=useState(false),ref=useRef<HTMLElement>(null);
 // Opened from the Monday notification: last week, scrolled into view.
 useEffect(()=>{if(focus){setStart(shiftDay(thisWeek,-7));ref.current?.scrollIntoView({behavior:'smooth',block:'start'})}},[focus,thisWeek]);
 const r=weeklyRecap(state,start,today),note=state.recaps?.[start],finished=r.end<today;
 const ask=async()=>{setAsking(true);try{const res=await fetch('./api/coach/recap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({start})});const d=await res.json().catch(()=>({})) as {text?:string;error?:string};if(!res.ok||!d.text)throw Error(d.error??'Coach MAX couldn’t answer right now.');const text=d.text;mutate(s=>{const all={...s.recaps,[start]:text.slice(0,1500)};s.recaps=Object.fromEntries(Object.entries(all).sort(([a],[b])=>b.localeCompare(a)).slice(0,12))})}catch(e){toast.error(e instanceof Error?e.message:'Coach MAX couldn’t answer right now.')}finally{setAsking(false)}};
 return <section className="recap-card" ref={ref} aria-label="Weekly recap">
  <div className="recap-head">
   <button type="button" className="round-btn" aria-label="Previous week" onClick={()=>setStart(shiftDay(start,-7))}><ChevronLeft size={18}/></button>
   <div><h2>{start===thisWeek?'This week':start===shiftDay(thisWeek,-7)?'Last week':'Week in review'}</h2><p className="muted">{short(r.start)} – {short(r.end)}{!finished&&start===thisWeek?' · so far':''}</p></div>
   <button type="button" className="round-btn" aria-label="Next week" disabled={start>=thisWeek} onClick={()=>setStart(shiftDay(start,7))}><ChevronRight size={18}/></button>
  </div>
  {r.days===0?<p className="muted">Nothing tracked this week.</p>:<>
   <div className="recap-stats"><span><strong>{r.perfect}</strong>perfect</span><span><strong>{r.logged}</strong>showed up</span><span><strong>{r.missed}</strong>missed</span>{r.low>0&&<span className="low"><strong>{r.low}</strong>low energy</span>}</div>
   <ul className="recap-goals">{r.goals.map(g=>{const pct=Math.round(g.done/g.planned*100),prev=g.prevPlanned?Math.round(g.prevDone/g.prevPlanned*100):null,delta=prev===null?0:pct-prev;return <li key={g.id}>
    <span className="recap-label">{g.label}{g.perWeek?<small> · {g.perWeek}×/week</small>:null}</span>
    <span className="recap-bar" aria-hidden><i style={{width:`${pct}%`}}/></span>
    <span className="recap-num">{g.done}/{g.planned}{delta>=15?<TrendingUp size={13} className="up" aria-label="Better than the week before"/>:delta<=-15?<TrendingDown size={13} className="down" aria-label="Lower than the week before"/>:null}</span>
   </li>})}</ul>
   <div className="recap-note"><Sparkles size={15} aria-hidden/><div><strong>Coach MAX</strong><p>{note??recapNote(r)}</p>{canCoach&&!note&&<button type="button" className="link-btn" disabled={asking} onClick={()=>void ask()}>{asking?'Coach MAX is thinking… (about 30 s)':finished?'Get Coach MAX’s reflection':'Get a mid-week reflection'}</button>}</div></div>
  </>}
 </section>;
}
