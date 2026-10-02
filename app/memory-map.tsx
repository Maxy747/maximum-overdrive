'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {X,MapPin,ZoomIn,Heart,ChevronRight,Images} from 'lucide-react';

import type {DumpPhoto,JournalEntry,SharedState,User} from '@/lib/tracker';
import type {MutateShared} from './shared';
import {photoSrc} from './photos';
import {placeName,searchPlaces,townOf} from './geo';
import {PhotoViewer} from './photo-dump';

// OpenStreetMap's standard tiles: free, no key, fine for a private two-person app (attribution required and shown).
// They are darkened with a CSS filter (.mm-tiles in globals.css) so the map matches the app.
export const TILES='https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const ATTRIBUTION='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
// OSM requires a Referer on tile requests; the app's own policy (same-origin) sends none, so tiles opt in to
// sending just the site's origin (never page paths).
export const TILE_OPTIONS={maxZoom:19,attribution:ATTRIBUTION,className:'mm-tiles',referrerPolicy:'strict-origin-when-cross-origin' as const};

type Point={lat:number;lng:number;memory?:JournalEntry;photo?:DumpPhoto};
type Cluster={lat:number;lng:number;points:Point[]};
const CLUSTER_PX=54;
const longDate=(d:string)=>new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});

// Shared memories and shared photos with a place. Sensitive ones are left out while privacy is on.
// Hidden-vault photos never reach this screen: the server excludes them from /api/files/geo.
export default function MemoryMap({shared,mutate,privacy,users,onOpenMemory}:{shared:SharedState;mutate:MutateShared;privacy:boolean;users:User[];onOpenMemory:(id:string)=>void}){
 const box=useRef<HTMLDivElement>(null),el=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),layer=useRef<L.LayerGroup|null>(null),fitted=useRef(false);
 const [photoGeo,setPhotoGeo]=useState<Map<string,{lat:number;lng:number}>>(new Map()),[selected,setSelected]=useState<Cluster|null>(null),[title,setTitle]=useState(''),[zoomed,setZoomed]=useState<DumpPhoto|null>(null),[placing,setPlacing]=useState(0);

 useEffect(()=>{let live=true;fetch('./api/files/geo',{cache:'no-store'}).then(async r=>(r.ok?await r.json():{photos:[]}) as {photos:{id:string;lat:number;lng:number}[]}).then(d=>{if(live)setPhotoGeo(new Map(d.photos.map(p=>[p.id,{lat:p.lat,lng:p.lng}])))}).catch(()=>{});return()=>{live=false}},[]);

 const points=useMemo(()=>{
  const out:Point[]=[],inMemories=new Set<string>();
  for(const e of shared.journal){
   for(const p of e.photos)inMemories.add(p.id);
   if(privacy&&e.sensitive)continue;
   const g=e.lat!==undefined&&e.lng!==undefined?{lat:e.lat,lng:e.lng}:e.photos.map(p=>photoGeo.get(p.id)).find(Boolean);
   if(g)out.push({...g,memory:e});
  }
  for(const p of shared.photoDump??[]){if(inMemories.has(p.id)||(privacy&&p.sensitive))continue;const g=photoGeo.get(p.id);if(g)out.push({...g,photo:p})}
  return out;
 },[shared,privacy,photoGeo]);

 // Memories that have a place name but no coordinates yet are placed once (for both of you).
 useEffect(()=>{
  if(!navigator.onLine)return;
  const todo=shared.journal.filter(e=>e.location.trim()&&e.lat===undefined&&!e.photos.some(p=>photoGeo.has(p.id))).filter(e=>{try{return !localStorage.getItem('max-geo-miss:'+e.location)}catch{return true}});
  if(!todo.length)return;let live=true;setPlacing(todo.length);
  void (async()=>{for(const e of todo){if(!live)break;try{const [hit]=await searchPlaces(e.location);if(hit)mutate(s=>{const x=s.journal.find(j=>j.id===e.id);if(x&&x.lat===undefined){x.lat=hit.lat;x.lng=hit.lng}});else try{localStorage.setItem('max-geo-miss:'+e.location,'1')}catch{}}catch{break}setPlacing(n=>Math.max(0,n-1))}if(live)setPlacing(0)})();
  return()=>{live=false};
 },[shared.journal,photoGeo,mutate]);

 // Fill the space between the tabs and the bottom bar.
 useEffect(()=>{
  const size=()=>{const b=box.current;if(!b)return;const nav=window.innerWidth<=760?document.querySelector<HTMLElement>('.sidebar')?.offsetHeight??0:0;b.style.height=`${Math.max(320,window.innerHeight-b.getBoundingClientRect().top-nav-12)}px`;map.current?.invalidateSize()};
  size();window.addEventListener('resize',size);const t=setTimeout(size,350);return()=>{window.removeEventListener('resize',size);clearTimeout(t)};
 },[]);

 useEffect(()=>{
  if(!el.current||map.current)return;
  const m=L.map(el.current,{zoomControl:false,attributionControl:true,worldCopyJump:true}).setView([12.9,76.2],6);
  L.tileLayer(TILES,TILE_OPTIONS).addTo(m);
  L.control.zoom({position:'topright'}).addTo(m);
  layer.current=L.layerGroup().addTo(m);map.current=m;
  m.on('click',()=>setSelected(null));
  return()=>{m.remove();map.current=null;layer.current=null};
 },[]);

 // Group markers that would overlap at the current zoom.
 useEffect(()=>{
  const m=map.current,g=layer.current;if(!m||!g)return;
  const draw=()=>{
   g.clearLayers();const z=m.getZoom(),clusters:(Cluster&{px:L.Point})[]=[];
   for(const p of points){const px=m.project([p.lat,p.lng],z),near=clusters.find(c=>c.px.distanceTo(px)<CLUSTER_PX);if(near)near.points.push(p);else clusters.push({lat:p.lat,lng:p.lng,points:[p],px})}
   for(const c of clusters){
    const cover=c.points.map(p=>p.memory?.photos[0]??p.photo).find(Boolean),memories=c.points.filter(p=>p.memory).length;
    // The memory's own cover framing, when it has one. Loaded straight away (lazy images can stall inside map panes).
    const framing=c.points.map(p=>p.memory).find(m=>m?.photos[0]&&m.photos[0].id===cover?.id&&m.coverPos?.id===cover.id)?.coverPos;
    const html=`<div class="mm-pin${memories?' has-memory':''}">${cover?`<img src="${photoSrc(cover)}" alt="" decoding="async"${framing?` style="object-position:${framing.x}% ${framing.y}%"`:''}/>`:'<span class="mm-heart">❤</span>'}${c.points.length>1?`<b>${c.points.length}</b>`:''}</div>`;
    const marker=L.marker([c.lat,c.lng],{icon:L.divIcon({html,className:'mm-icon',iconSize:[50,50],iconAnchor:[25,25]}),keyboard:true,title:`${c.points.length} here`}).on('click',ev=>{L.DomEvent.stopPropagation(ev);setSelected({lat:c.lat,lng:c.lng,points:c.points})}).addTo(g);
    // A photo that can't load (moved to hidden, deleted) shows the heart instead of an empty circle.
    marker.getElement()?.querySelector('img')?.addEventListener('error',ev=>{(ev.currentTarget as HTMLImageElement).replaceWith(Object.assign(document.createElement('span'),{className:'mm-heart',textContent:'❤'}))},{once:true});
   }
  };
  draw();m.on('zoomend',draw);
  if(!fitted.current&&points.length){fitted.current=true;m.fitBounds(L.latLngBounds(points.map(p=>[p.lat,p.lng] as [number,number])),{padding:[48,48],maxZoom:13})}
  return()=>{m.off('zoomend',draw)};
 },[points]);

 // Card title: the town most memories here mention, otherwise the place name for the spot.
 useEffect(()=>{
  if(!selected){setTitle('');return}
  const towns=selected.points.map(p=>p.memory?.location).filter((v):v is string=>!!v?.trim()).map(townOf),best=[...new Set(towns)].sort((a,b)=>towns.filter(t=>t===b).length-towns.filter(t=>t===a).length)[0];
  const distinct=new Set(towns).size;if(best){setTitle(distinct>1?`${best} +${distinct-1} more`:best);return}
  setTitle('This place');let live=true;placeName(selected.lat,selected.lng).then(n=>{if(live)setTitle(townOf(n))}).catch(()=>{});return()=>{live=false};
 },[selected]);

 const memories=(selected?.points.filter(p=>p.memory).map(p=>p.memory!)??[]).sort((a,b)=>b.date.localeCompare(a.date));
 const photos=selected?[...memories.flatMap(e=>e.photos),...selected.points.filter(p=>p.photo).map(p=>p.photo!)]:[];
 const who=(name:string)=>users.find(u=>u.username===name)?.displayName??name;
 const zoomIn=()=>{if(!selected||!map.current)return;map.current.fitBounds(L.latLngBounds(selected.points.map(p=>[p.lat,p.lng] as [number,number])),{padding:[60,60],maxZoom:16});setSelected(null)};

 return <div className="memory-map" ref={box}>
  <div ref={el} className="mm-canvas" role="application" aria-label="Map of your shared memories"/>
  {placing>0&&<div className="mm-status" role="status">Placing {placing} memor{placing===1?'y':'ies'} on the map…</div>}
  {!points.length&&!placing&&<div className="mm-empty"><MapPin size={20} aria-hidden/><strong>No places yet</strong><span>Add a location to a memory, or add photos taken with location on.</span></div>}
  {selected&&<div className="mm-card" role="dialog" aria-label={`Memories in ${title}`}>
   <div className="mm-card-head"><div><h3>{title}</h3><p>{memories.length} memor{memories.length===1?'y':'ies'} · {photos.length} photo{photos.length===1?'':'s'}</p></div>
    <div className="mm-card-actions">{selected.points.length>1&&<button type="button" className="round-btn" aria-label="Zoom in here" onClick={zoomIn}><ZoomIn size={17}/></button>}<button type="button" className="round-btn" aria-label="Close" onClick={()=>setSelected(null)}><X size={17}/></button></div></div>
   {photos.length>0&&<div className="mm-strip">{photos.slice(0,12).map(p=><button key={p.id} type="button" aria-label="Open photo" onClick={()=>setZoomed(p)}><img src={photoSrc(p)} alt="" loading="lazy"/></button>)}{photos.length>12&&<span className="mm-more"><Images size={14} aria-hidden/>+{photos.length-12}</span>}</div>}
   {memories.length>0&&<><p className="mm-latest">Latest memory · {longDate(memories[0].date)}</p><ul className="mm-list">{memories.slice(0,6).map(e=><li key={e.id}><button type="button" onClick={()=>onOpenMemory(e.id)}><span className="mm-title">{e.title||'Untitled memory'}</span><span className="mm-meta"><Heart size={11} aria-hidden/>Added by {who(e.author)} · {longDate(e.date)}</span><ChevronRight size={16} aria-hidden/></button></li>)}</ul></>}
  </div>}
  {zoomed&&<PhotoViewer photos={photos.some(x=>x.id===zoomed.id)?photos:[zoomed]} index={Math.max(0,photos.findIndex(x=>x.id===zoomed.id))} onClose={()=>setZoomed(null)}/>}
 </div>;
}
