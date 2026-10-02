'use client';
import {useRef,type CSSProperties,type KeyboardEvent,type PointerEvent} from 'react';
import {Flame,Minus,Plus,Skull} from 'lucide-react';
import {dayKey,daysSince,resistLine,type Entry,type ResistStreak} from '@/lib/tracker';

// Self-control "how many times": up to 10+ as equal steps. Drawn by hand instead of a native range input, so the
// filled part always ends exactly under the handle (a native track's fill drifts from its thumb, worst at the ends
// and on iPhone). One colour at a time, running green -> yellow -> red as the count rises.
const TOP=11; // 11 means "10+"
const STOPS:[number,number,number][]=[[75,224,138],[245,200,74],[255,92,122]];
function colorAt(t:number){
 const [a,b,k]=t<.5?[STOPS[0],STOPS[1],t*2]:[STOPS[1],STOPS[2],(t-.5)*2];
 return `rgb(${a.map((c,i)=>Math.round(c+(b[i]-c)*k)).join(' ')})`;
}
const label=(v:number)=>v>10?'10+':String(v);

const TITLE='How many times?',MIN=1;

export function TimesSlider({value,onChange}:{value:number;onChange:(value:number)=>void}){
 const steps=TOP-MIN+1;
 const v=Math.min(TOP,Math.max(MIN,Math.round(Number.isFinite(value)?value:MIN))),track=useRef<HTMLDivElement|null>(null),dragging=useRef(false);
 const set=(n:number)=>{n=Math.min(TOP,Math.max(MIN,n));if(n!==v){onChange(n);try{navigator.vibrate?.(4)}catch{/* no haptics */}}};
 // Each step owns an equal slice of the track, so the step under the finger is simply which slice it's in.
 const fromPointer=(e:PointerEvent)=>{const r=track.current?.getBoundingClientRect();if(!r?.width)return;set(MIN+Math.floor((e.clientX-r.left)/r.width*steps))};
 const keys=(e:KeyboardEvent)=>{const n={ArrowRight:v+1,ArrowUp:v+1,ArrowLeft:v-1,ArrowDown:v-1,Home:MIN,End:TOP,PageUp:v+3,PageDown:v-3}[e.key];if(n!==undefined){e.preventDefault();set(n)}};
 const i=v-MIN,pos=`${(i+.5)/steps*100}%`;
 return <div className={`times-slider${v>10?' max':''}`} style={{'--times-color':colorAt(i/(steps-1)),'--times-pos':pos,'--times-steps':steps} as CSSProperties}>
  <div className="times-head"><span className="times-title">{TITLE}</span><span className="times-value" key={v}><small>×</small>{label(v)}</span></div>
  <div ref={track} className="times-track" role="slider" tabIndex={0} aria-label={`${TITLE}: how many times`} aria-valuemin={MIN} aria-valuemax={TOP} aria-valuenow={v} aria-valuetext={v>10?'more than 10':String(v)}
   onKeyDown={keys}
   onPointerDown={e=>{dragging.current=true;e.currentTarget.setPointerCapture(e.pointerId);fromPointer(e)}}
   onPointerMove={e=>{if(dragging.current)fromPointer(e)}}
   onPointerUp={()=>{dragging.current=false}} onPointerCancel={()=>{dragging.current=false}}>
   <div className="times-steps" aria-hidden>{Array.from({length:steps},(_,k)=><span key={k} className={k<=i&&v>0?'on':''}/>)}</div>
   <span className="times-knob" aria-hidden/>
  </div>
  <div className="times-scale" aria-hidden>{[MIN,5,TOP].map(n=><span key={n} className={n<=v?'on':''} style={{left:`${(n-MIN+.5)/steps*100}%`}}>{label(n)}</span>)}</div>
 </div>;
}

// Self-control's choice buttons also keep the resistance streak's moments: "Chose not to do it" logs one, un-choosing
// it takes today's back, and "Chose to do it" resets the streak (dropping a resist tapped by mistake a moment ago).
export function markChoice(x:Entry,i:number,on:boolean){
 const now=Date.now();
 if(i===1){if(on)x.resists=[...(x.resists??[]),now].slice(-100);else delete x.resists}
 else if(i===0){if(on){x.didAt=now;const kept=(x.resists??[]).filter(t=>now-t>60000);if(kept.length)x.resists=kept;else delete x.resists}else delete x.didAt}
}

// Resisted again: each tap is one more moment, with the reward line for where the streak now stands.
export function ResistLogger({entry:e,streak,update}:{entry:Entry;streak?:ResistStreak;update:(fn:(e:Entry)=>void)=>void}){
 const today=e.resists?.length??0,n=streak?.current??0;
 const line=resistLine(n);
 return <div className="resist-logger" style={{'--times-color':'rgb(75 224 138)'} as CSSProperties}>
  {line&&<p className="times-line resist-line" key={`${n}-${line}`}>{line}</p>}
  <div className="resist-row">
   <button type="button" className="resist-minus" aria-label="Take back the last one" disabled={today<=1} onClick={()=>update(x=>{x.resists=(x.resists??[]).slice(0,-1)})}><Minus size={16}/></button>
   <button type="button" className="resist-plus" onClick={()=>{update(x=>{x.resists=[...(x.resists??[]),Date.now()].slice(-100)});try{navigator.vibrate?.(8)}catch{/* no haptics */}}}><Plus size={16} aria-hidden/>I resisted again</button>
  </div>
  <p className="resist-today">{today===1?'Resisted once today':`Resisted ${today} times today`}</p>
 </div>;
}

// The small streak stat under the meter: resisting counts up (orange flame), giving in counts down (red, negative).
export function ResistCard({streak}:{streak:ResistStreak}){
 const last=streak.last==null?null:daysSince(dayKey(new Date(streak.last)),dayKey());
 const when=last==null?'Not yet':last===0?'Today':last===1?'Yesterday':`${last} days ago`;
 const bad=streak.current<0,n=Math.abs(streak.current);
 return <div className={`resist-card ${bad?'bad':streak.current?'lit':''}`} aria-label={bad?`Bad streak minus ${n}`:`Resistance streak ${n}`}>
  <div className="resist-main"><small>{bad?'Bad streak':'Resistance streak'}</small><strong>{bad?<Skull size={18} aria-hidden/>:<Flame size={18} aria-hidden/>}{bad?`−${n}`:n}</strong><span>{bad?`${n===1?'time':'times'} in a row`:`${n===1?'time':'times'} resisted`}</span></div>
  <dl><div><dt>Last resisted</dt><dd>{when}</dd></div><div><dt>Best streak</dt><dd>{streak.best}</dd></div>{streak.worst<0&&<div><dt>Worst</dt><dd>−{Math.abs(streak.worst)}</dd></div>}</dl>
 </div>;
}