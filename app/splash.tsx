'use client';
import {useEffect,useRef,useState} from 'react';

// Opening animation, once per app launch: the logo fades in and glows, the name writes itself in, then the screen
// gives way to the app while the logo glides into its place at the top left (whichever MAX logo is showing).
// Skipped when Reduce Motion is on.
const NAME='MAXIMUM OVERDRIVE';
const KEY='max-splash-shown';
type Phase='logo'|'name'|'fly'|'done';

function shouldPlay(){
 try{if(sessionStorage.getItem(KEY))return false;sessionStorage.setItem(KEY,'1')}catch{}
 return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
// The logo the app is showing right now (sidebar on a computer, top bar on a phone, or the login card).
function targetLogo(splash:HTMLElement|null){
 return [...document.querySelectorAll<HTMLImageElement>('img.app-logo,img.mobile-logo')].find(el=>!splash?.contains(el)&&el.offsetParent!==null&&el.getBoundingClientRect().width>0)??null;
}

export function Splash(){
 const [play]=useState(shouldPlay),[phase,setPhase]=useState<Phase>(play?'logo':'done'),[flight,setFlight]=useState<{x:number;y:number;s:number}|null>(null);
 const root=useRef<HTMLDivElement>(null),logo=useRef<HTMLImageElement>(null);
 // While it plays, <html data-splash="playing"> holds the Today page's entrance (cards settling in, the first-open glow)
 // so it runs when the page is actually visible, not underneath.
 useEffect(()=>{if(!play)return;const html=document.documentElement;html.dataset.splash='playing';
  const t1=setTimeout(()=>setPhase('name'),900);
  // Then fly to the page's logo, but only once the app has really loaded (no loading screen left). Until then the logo
  // keeps breathing (up to 30 s), so the old loading screen never shows through. The real logo hides until it lands.
  const t2=setTimeout(()=>{let tries=0;const land=()=>{const target=targetLogo(root.current),me=logo.current,loading=!!document.querySelector('main.loading');
   if((loading||!target||!me)&&tries++<300)return void setTimeout(land,100);
   if(target&&me){const a=me.getBoundingClientRect(),b=target.getBoundingClientRect();target.style.visibility='hidden';
    setFlight({x:b.left+b.width/2-(a.left+a.width/2),y:b.top+b.height/2-(a.top+a.height/2),s:b.width/a.width});
    setTimeout(()=>{target.style.visibility=''},760)}
   setPhase('fly');delete html.dataset.splash;setTimeout(()=>setPhase('done'),800)};land()},2300);
  return()=>{clearTimeout(t1);clearTimeout(t2);delete html.dataset.splash}},[play]);
 if(phase==='done')return null;
 return <div ref={root} className={`splash ${phase}`} aria-hidden>
  <img ref={logo} className="splash-logo" src="./max-logo-v2.png" alt="" style={flight?{transform:`translate(${flight.x}px,${flight.y}px) scale(${flight.s})`}:undefined}/>
  <p className="splash-name">{NAME.split('').map((c,i)=><span key={i} style={{animationDelay:`${i*45}ms`}}>{c===' '?' ':c}</span>)}</p>
 </div>;
}
