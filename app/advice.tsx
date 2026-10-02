'use client';
import {useEffect,useRef,useState} from 'react';
import {Sun} from 'lucide-react';

// Today's advice, at the top of Progress. Written fresh at 6 am (by the coach for accounts that have it, from your own numbers
// otherwise); if it isn't ready yet, Coach MAX writes it now and this checks back until it is.
type Advice={day:string;text?:string;source?:'coach'|'rules';pending?:boolean};
export function AdviceCard({focus}:{focus?:number}){
 const [advice,setAdvice]=useState<Advice|null>(null),[failed,setFailed]=useState(false),ref=useRef<HTMLElement>(null);
 useEffect(()=>{let live=true,tries=0,timer:ReturnType<typeof setTimeout>;
  const load=()=>fetch('./api/advice',{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<Advice>:Promise.reject()).then(a=>{if(!live)return;setAdvice(a);if(a.pending&&tries++<40)timer=setTimeout(load,6000)}).catch(()=>{if(live)setFailed(true)});
  void load();return()=>{live=false;clearTimeout(timer)}},[]);
 // Opened from the 6 am notification: scrolled into view.
 useEffect(()=>{if(focus)ref.current?.scrollIntoView({behavior:'smooth',block:'start'})},[focus]);
 if(failed&&!advice)return null;
 const date=new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
 return <section className="advice-card" ref={ref} aria-label="Today’s advice">
  <div className="advice-head"><span className="advice-icon" aria-hidden><Sun size={16}/></span><div><h2>{advice?.source==='rules'?'Today’s advice':'Coach MAX · Today’s advice'}</h2><p className="muted">{date} · refreshes at 6 am</p></div></div>
  {!advice||advice.pending?<p className="advice-text advice-pending">Coach MAX is thinking about your day<span className="advice-dots" aria-hidden><i/><i/><i/></span></p>:<p className="advice-text">{advice.text}</p>}
 </section>;
}
