'use client';
import {useCallback,useEffect,useRef,useState,type CSSProperties} from 'react';
import {Sparkles} from 'lucide-react';

// A quick insight about right now, under Today's cards. Asked for when the app opens, when you come back after 5+ minutes
// away, and a few seconds after your progress changes (so it never talks about goals you've since finished). Tap the
// sparkle for a new one, once every 2 minutes. The coach writes it for accounts that have it; the rest get it from their numbers.
type Insight={text:string;source:'coach'|'rules';at:number;progress:string};
const KEY='max-insight',NEXT_KEY='max-insight-next',STALE=30*60000,AWAY=5*60000,COOLDOWN=2*60000;
const cached=(progress:string):Insight|null=>{try{const v=JSON.parse(sessionStorage.getItem(KEY)??'null') as Insight|null;return v&&v.progress===progress&&Date.now()-v.at<STALE?v:null}catch{return null}};
const readNext=()=>{try{return Number(localStorage.getItem(NEXT_KEY))||0}catch{return 0}};

export function InsightCard({progress}:{progress:string}){
 const [insight,setInsight]=useState<Insight|null>(()=>cached(progress)),[loading,setLoading]=useState(!insight);
 const [next,setNext]=useState(readNext),[now,setNow]=useState(Date.now);
 const live=useRef(true),progressRef=useRef(progress);progressRef.current=progress;
 const load=useCallback((fresh=false)=>{
  setLoading(true);const asked=progressRef.current;
  fetch('./api/insight',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({fresh})})
   .then(r=>r.ok?r.json() as Promise<{text:string;source:'coach'|'rules';next?:number}>:Promise.reject())
   .then(d=>{if(!live.current)return;const v={text:d.text,source:d.source,at:Date.now(),progress:asked};setInsight(v);try{sessionStorage.setItem(KEY,JSON.stringify(v))}catch{}
    const n=Date.now()+(d.next??COOLDOWN);setNext(n);try{localStorage.setItem(NEXT_KEY,String(n))}catch{}})
   .catch(()=>{}).finally(()=>{if(live.current)setLoading(false)});
 },[]);
 useEffect(()=>{live.current=true;let hiddenAt=0;
  const vis=()=>{if(document.hidden)hiddenAt=Date.now();else if(hiddenAt&&Date.now()-hiddenAt>AWAY){hiddenAt=0;load()}};
  document.addEventListener('visibilitychange',vis);return()=>{live.current=false;document.removeEventListener('visibilitychange',vis)}},[load]);
 // Progress changed (or first open): refresh after a short pause, so a burst of taps asks only once.
 useEffect(()=>{if(cached(progress))return;const t=setTimeout(()=>load(),insight?6000:0);return()=>clearTimeout(t)},[progress]);
 // Cooldown ring on the sparkle.
 const wait=Math.max(0,next-now);
 useEffect(()=>{if(wait<=0)return;const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t)},[wait>0]);
 if(!insight&&!loading)return null;
 const ready=!loading&&wait<=0,secs=Math.ceil(wait/1000);
 return <section className="insight-card" aria-live="polite" aria-label="Right now">
  <button type="button" className={`insight-icon ${loading?'spinning':''} ${ready?'ready':''}`} disabled={!ready} onClick={()=>load(true)}
   style={{'--wait':`${wait/COOLDOWN*360}deg`} as CSSProperties}
   aria-label={loading?'Coach MAX is thinking':ready?'New insight':`New insight in ${Math.floor(secs/60)}:${String(secs%60).padStart(2,'0')}`}
   title={loading?'Thinking…':ready?'New insight':`New insight in ${Math.floor(secs/60)}:${String(secs%60).padStart(2,'0')}`}><Sparkles size={14}/></button>
  <p>{insight&&!(loading&&!insight)?<><strong>{insight.source==='coach'?'Coach MAX':'Right now'}</strong> <span className={loading?'insight-stale':''}>{insight.text}</span></>:<span className="insight-pending">Coach MAX is looking at your day<span className="advice-dots" aria-hidden><i/><i/><i/></span></span>}</p>
 </section>;
}
