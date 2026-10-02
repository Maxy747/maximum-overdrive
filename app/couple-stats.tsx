'use client';
import {useEffect,useState} from 'react';
import {daysSince,isBirthday,STAT_TONES,type SharedState,type StatTone} from '@/lib/tracker';
import {townOf} from './geo';

// Stats at the bottom of the Journal, each card opening its part of the app. On your own there's no
// days-together or daily-question card.
export type StatTarget='profile'|'daily'|'map'|'timeline'|'milestones'|'photos'|'diary';
type Card={key:string;n:number|string;label:string;icon:string;tone:string;to:StatTarget};

// Places come from each memory's location ("Spot, Town, Country"): the town is the part before the country.
function places(shared:SharedState){
 const towns=new Set<string>(),countries=new Set<string>();
 for(const e of shared.journal){const loc=e.location?.trim();if(!loc)continue;const parts=loc.split(',').map(p=>p.trim()).filter(Boolean);
  towns.add(townOf(loc).toLowerCase());if(parts.length>1&&!/\d/.test(parts.at(-1)!))countries.add(parts.at(-1)!.toLowerCase())}
 return {towns:towns.size,countries:countries.size};
}

// Colours: "Colours" in the header, then tap a card to try the next colour. Saved on your account.
export function CoupleStats({colors={},setColor,solo=false,shared,together,onOpen}:{colors?:Partial<Record<string,StatTone>>;setColor?:(key:string,tone:StatTone)=>void;solo?:boolean;shared:SharedState;together:string;onOpen:(to:StatTarget)=>void}){
 const [editing,setEditing]=useState(false),[q,setQ]=useState<{answered:number;both:number;questions:number;total:number}|null>(null);
 useEffect(()=>{if(solo)return;fetch('./api/daily/stats',{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{answered:number;both:number;questions:number;total:number}>:null).then(d=>{if(d)setQ(d)}).catch(()=>{})},[solo]);
 const {towns,countries}=places(shared),days=together?Math.max(0,daysSince(together)):0;
 const cards:Card[]=([
  {key:'days',n:days,label:'Days together',icon:'❤️',tone:'rose',to:'profile'},
  {key:'questions',n:q?`${Math.round(q.questions/Math.max(1,q.total)*100)}%`:'…',label:q?`Questions answered · ${q.answered}`:'Questions answered',icon:'💬',tone:'amber',to:'daily'},
  {key:'cities',n:towns,label:towns===1?'City visited':'Cities visited',icon:'🧭',tone:'blue',to:'map'},
  {key:'countries',n:countries,label:countries===1?'Country visited':'Countries visited',icon:'🛂',tone:'purple',to:'map'},
  {key:'memories',n:shared.journal.length,label:shared.journal.length===1?'Memory created':'Memories created',icon:'📷',tone:'green',to:'timeline'},
  {key:'special',n:shared.moments.filter(m=>!isBirthday(m)).length,label:shared.moments.filter(m=>!isBirthday(m)).length===1?'Special day':'Special days',icon:'📅',tone:'teal',to:'milestones'},
  {key:'photos',n:shared.photoDump?.filter(p=>!p.sensitive).length??0,label:'Photos',icon:'🖼️',tone:'pink',to:'photos'},
  {key:'diary',n:shared.diary?.length??0,label:(shared.diary?.length??0)===1?'Diary entry':'Diary entries',icon:'📔',tone:'night',to:'diary'},
 ] as Card[]).filter(c=>!solo||(c.key!=='days'&&c.key!=='questions'));
 return <section className="couple-stats" aria-label={solo?'Journal stats':'Couple stats'}>
  <div className="couple-stats-head"><h2>{solo?'Journal Stats':'Couple Stats'}</h2>{setColor&&<button type="button" className={`chip-btn ${editing?'active':''}`} onClick={()=>setEditing(v=>!v)}>{editing?'Done':'Colours'}</button>}</div>
  {editing&&<p className="setting-hint">Tap a card to change its colour.</p>}
  <div className={`couple-stats-grid${solo?' solo':''}`}>{cards.map(c=><button key={c.key} type="button" className={`stat-card tone-${colors[c.key]??c.tone}${editing?' recolor':''}`} onClick={()=>{if(!editing)return onOpen(c.to);const now=colors[c.key]??c.tone as StatTone;setColor?.(c.key,STAT_TONES[(STAT_TONES.indexOf(now)+1)%STAT_TONES.length])}} aria-label={editing?`${c.label}: ${colors[c.key]??c.tone}. Tap for the next colour.`:`${c.n} ${c.label}. Open.`}>
   <span className="stat-icon" aria-hidden>{c.icon}</span><strong>{c.n}</strong><span>{c.label}</span>
  </button>)}</div>
 </section>;
}
