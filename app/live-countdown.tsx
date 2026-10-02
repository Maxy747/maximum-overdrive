'use client';
import {useEffect,useState} from 'react';

// A ticking "3d 04h 12m 09s" to the start of a day (or its time, if the countdown has one). Used on birthday cards in
// Coming up; it stops at zero and the card itself says "Today".
export function LiveCountdown({date,time}:{date:string;time?:string}){
 const target=new Date(`${date}T${time||'00:00'}:00`).getTime(),[now,setNow]=useState(Date.now);
 useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t)},[]);
 const left=Math.max(0,target-now);if(!left)return null;
 const s=Math.floor(left/1000),d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60),sec=s%60,p=(n:number)=>String(n).padStart(2,'0');
 return <span className="live-countdown" aria-hidden>{d>0&&<><b>{d}</b>d </>}<b>{p(h)}</b>h <b>{p(m)}</b>m <b>{p(sec)}</b>s</span>;
}
