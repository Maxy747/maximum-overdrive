'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';

const fmtHours=(v:number)=>{const h=Math.floor(v),m=Math.round((v-h)*60);return m?`${h}h ${m}m`:`${h}h`};

// Horizontal ruler you swipe to pick an amount: hours of sleep by default (15-minute steps up to 24h), or anything
// counted in whole steps (glasses of water) with `step`, `max`, `tick` and `format`.
// Two things keep it from sticking: the value it just sent (echoing back from the save a moment later) doesn't scroll
// it mid-swipe, and the space before the first and after the last tick is real elements measured from the ruler's
// width (iPhone Safari drops a scroller's end padding, so the last marks couldn't reach the needle).
export function HourRuler({value,target,label,onChange,step=0.25,max=24,tick=16,format=fmtHours,hint}:{value:number;target:number;label:string;onChange:(v:number)=>void;step?:number;max?:number;tick?:number;format?:(v:number)=>string;hint?:string}){
 const clamp=(v:number)=>Math.min(max,Math.max(0,v));
 const ref=useRef<HTMLDivElement>(null),[shown,setShown]=useState(clamp(value)),[pad,setPad]=useState(0);
 const frame=useRef(0),sent=useRef<number|null>(null),busyUntil=useRef(0),touching=useRef(false),programmatic=useRef(false),placed=useRef(false);
 const place=(v:number,smooth=false)=>{const el=ref.current;if(!el)return;programmatic.current=!smooth;el.scrollTo({left:v/step*tick,behavior:smooth?'smooth':'auto'});if(!smooth)requestAnimationFrame(()=>{programmatic.current=false})};
 // Spacers: half the window minus half a tick on each side, so 0 and the maximum can both sit under the needle.
 useLayoutEffect(()=>{const el=ref.current;if(!el)return;const measure=()=>setPad(Math.max(0,el.clientWidth/2-tick/2));measure();const ro=new ResizeObserver(measure);ro.observe(el);return()=>ro.disconnect()},[tick]);
 // Put the ruler on the saved value when it opens, or when the value is changed somewhere else (the +1 button, bed
 // and wake times). Not while the finger is on it, and not for the value it sent itself.
 useEffect(()=>{if(!pad)return;const v=clamp(value);if(sent.current!==null&&Math.abs(v-sent.current)<step/2){sent.current=null;return}if(touching.current||Date.now()<busyUntil.current)return;setShown(v);place(v,placed.current);placed.current=true},[value,pad]);// eslint-disable-line react-hooks/exhaustive-deps
 const onScroll=()=>{if(programmatic.current)return;busyUntil.current=Date.now()+400;cancelAnimationFrame(frame.current);frame.current=requestAnimationFrame(()=>{const el=ref.current;if(!el)return;const v=clamp(Math.round(el.scrollLeft/tick)*step);if(v!==shown){setShown(v);sent.current=v;onChange(v);try{navigator.vibrate?.(4)}catch{/* no haptics */}}})};
 const nudge=(d:number)=>{const v=clamp(shown+d);busyUntil.current=Date.now()+400;setShown(v);sent.current=v;onChange(v);place(v,true)};
 const ticks=Array.from({length:Math.round(max/step)+1},(_,i)=>Math.round(i*step*100)/100);
 return <div className="hour-ruler">
  <div className="ruler-readout"><strong>{format(shown)}</strong><span>/ {format(target)}{shown>=target?' ✓':''}</span></div>
  <div className="ruler-window">
   <div ref={ref} className="ruler-track" onScroll={onScroll} role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={shown} aria-valuetext={format(shown)}
    onTouchStart={()=>{touching.current=true}} onTouchEnd={()=>{touching.current=false;busyUntil.current=Date.now()+400}} onTouchCancel={()=>{touching.current=false}}
    onKeyDown={e=>{if(e.key==='ArrowRight'||e.key==='ArrowUp'){e.preventDefault();nudge(step)}if(e.key==='ArrowLeft'||e.key==='ArrowDown'){e.preventDefault();nudge(-step)}}}>
    <div className="ruler-ticks"><span className="ruler-pad" style={{width:pad}} aria-hidden/>{ticks.map(t=><span key={t} style={{flexBasis:tick}} className={`tick ${t%1===0?'hour':t%0.5===0?'half':''} ${t===target?'goal':''}`}>{t%1===0&&<em>{t}</em>}</span>)}<span className="ruler-pad" style={{width:pad}} aria-hidden/></div>
   </div>
   <span className="ruler-needle" aria-hidden/>
  </div>
  <p className="ruler-hint">{hint??`Swipe to set · up to ${format(max)}`}</p>
 </div>;
}
