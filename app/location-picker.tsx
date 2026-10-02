'use client';
import {useEffect,useRef,useState} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {Search,LocateFixed,MapPin} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {toast} from 'sonner';
import {placeName,searchPlaces,type Place} from './geo';
import {TILE_OPTIONS,TILES} from './memory-map';

// Pick where a memory happened: search, tap the map, or use this phone's location.
export default function LocationPicker({initial,onClose,onPick}:{initial:{name:string;lat?:number;lng?:number};onClose:()=>void;onPick:(p:Place|null)=>void}){
 // The dialog mounts its content a moment after this component, so the map starts once the element exists.
 const [el,setEl]=useState<HTMLDivElement|null>(null),map=useRef<L.Map|null>(null),pin=useRef<L.Marker|null>(null);
 const [place,setPlace]=useState<Place|null>(initial.lat!==undefined&&initial.lng!==undefined?{name:initial.name,lat:initial.lat,lng:initial.lng}:null);
 const [query,setQuery]=useState(initial.lat===undefined?initial.name:''),[results,setResults]=useState<Place[]>([]),[busy,setBusy]=useState(false);
 const icon=L.divIcon({html:'<div class="mm-drop"></div>',className:'mm-icon',iconSize:[28,28],iconAnchor:[14,28]});

 const drop=(p:Place,fly=true)=>{setPlace(p);const m=map.current;if(!m)return;if(pin.current)pin.current.setLatLng([p.lat,p.lng]);else pin.current=L.marker([p.lat,p.lng],{icon}).addTo(m);if(fly)m.flyTo([p.lat,p.lng],Math.max(m.getZoom(),14),{duration:.6})};
 const name=async(lat:number,lng:number)=>{drop({name:'Finding the name…',lat,lng},false);try{const n=await placeName(lat,lng);setPlace(p=>p&&p.lat===lat&&p.lng===lng?{...p,name:n}:p)}catch{setPlace(p=>p&&p.lat===lat?{...p,name:'Pinned place'}:p)}};

 useEffect(()=>{
  if(!el)return;
  const m=L.map(el,{zoomControl:false}).setView(place?[place.lat,place.lng]:[12.9,76.2],place?14:6);
  L.tileLayer(TILES,TILE_OPTIONS).addTo(m);
  L.control.zoom({position:'topright'}).addTo(m);map.current=m;
  if(place)pin.current=L.marker([place.lat,place.lng],{icon}).addTo(m);
  m.on('click',e=>{void name(Math.round(e.latlng.lat*1e6)/1e6,Math.round(e.latlng.lng*1e6)/1e6)});
  // Re-measure after the dialog's open animation settles.
  const t=[150,400,800].map(ms=>setTimeout(()=>m.invalidateSize(),ms));
  return()=>{t.forEach(clearTimeout);m.remove();map.current=null;pin.current=null};
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[el]);

 const search=async(e:React.FormEvent)=>{e.preventDefault();if(!query.trim())return;setBusy(true);try{const r=await searchPlaces(query.trim());setResults(r);if(!r.length)toast('No places found. Try a town name, or tap the map.')}catch(err){toast.error(err instanceof Error?err.message:'Search failed.')}finally{setBusy(false)}};
 const locate=()=>{if(!navigator.geolocation)return void toast.error('Location isn’t available on this device.');setBusy(true);navigator.geolocation.getCurrentPosition(pos=>{setBusy(false);const lat=Math.round(pos.coords.latitude*1e6)/1e6,lng=Math.round(pos.coords.longitude*1e6)/1e6;map.current?.flyTo([lat,lng],15,{duration:.6});void name(lat,lng)},()=>{setBusy(false);toast.error('Allow location for MAX in Settings to use this.')},{enableHighAccuracy:true,timeout:10000})};

 return <Dialog open onOpenChange={v=>!v&&onClose()}><DialogContent className="editor location-picker"><DialogTitle>Add location</DialogTitle><DialogDescription>Search, tap the map, or use where you are now. It shows on your shared map.</DialogDescription>
  <form className="lp-search" onSubmit={search}><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search a place" aria-label="Search a place" enterKeyHint="search"/><button className="round-btn" aria-label="Search" disabled={busy}><Search size={17}/></button><button type="button" className="round-btn" aria-label="Use my location" onClick={locate} disabled={busy}><LocateFixed size={17}/></button></form>
  {results.length>0&&<ul className="lp-results">{results.map((r,i)=><li key={i}><button type="button" onClick={()=>{drop(r);setResults([])}}><MapPin size={14} aria-hidden/>{r.label??r.name}</button></li>)}</ul>}
  <div ref={setEl} className="lp-map"/>
  {place&&<label className="field">Place name<input value={place.name} maxLength={200} onChange={e=>setPlace({...place,name:e.target.value})}/></label>}
  <div className="form-actions">{initial.lat!==undefined&&<button type="button" className="secondary danger-text" onClick={()=>onPick(null)}>Remove</button>}<button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="button" className="primary" disabled={!place||place.name==='Finding the name…'} onClick={()=>place&&onPick({...place,name:place.name.trim()||'Pinned place'})}>Use this place</button></div>
 </DialogContent></Dialog>;
}
