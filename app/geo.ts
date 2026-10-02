'use client';
// Place search and names via OpenStreetMap's Nominatim (free, no key). Requests send the site origin as
// Referer (their usage policy asks apps to identify themselves). Their policy allows about one
// request per second, so calls are queued. Only used when you search, drop a pin or place a memory.
const NOMINATIM='https://nominatim.openstreetmap.org';
export type Place={name:string;lat:number;lng:number;label?:string};
type Result={lat:string;lon:string;name?:string;display_name?:string;address?:Record<string,string>};

let queue=Promise.resolve(),last=0;
function throttled<T>(fn:()=>Promise<T>):Promise<T>{
 const run=queue.then(async()=>{const wait=last+1100-Date.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));last=Date.now();return fn()});
 queue=run.then(()=>undefined,()=>undefined);return run;
}

// "Mahatma Gandhi Park, Mangaluru, India" — the same shape as the locations already in the journal.
function nameOf(r:Result,withState=false){
 const a=r.address??{},city=a.city||a.town||a.village||a.suburb||a.county||a.state_district||a.state||'';
 const spot=r.name&&r.name!==city?r.name:a.road||a.neighbourhood||'';
 return [spot,city,withState?a.state:'',a.country].filter((v,i,arr)=>v&&arr.indexOf(v)===i).join(', ')||r.display_name||'Pinned place';
}

export function searchPlaces(q:string):Promise<Place[]>{
 return throttled(async()=>{const r=await fetch(`${NOMINATIM}/search?format=jsonv2&addressdetails=1&limit=5&accept-language=en&q=${encodeURIComponent(q)}`,{referrerPolicy:'strict-origin-when-cross-origin'});if(!r.ok)throw Error('Search is unavailable right now.');// `label` adds the state so similar results can be told apart; the saved name stays short.
  const seen=new Set<string>();return (await r.json() as Result[]).map(x=>({name:nameOf(x),label:nameOf(x,true),lat:Number(x.lat),lng:Number(x.lon)})).filter(p=>!seen.has(p.label)&&!!seen.add(p.label))});
}

export function placeName(lat:number,lng:number):Promise<string>{
 const key=`max-place:${lat.toFixed(3)},${lng.toFixed(3)}`;
 try{const hit=localStorage.getItem(key);if(hit)return Promise.resolve(hit)}catch{}
 return throttled(async()=>{const r=await fetch(`${NOMINATIM}/reverse?format=jsonv2&addressdetails=1&zoom=16&accept-language=en&lat=${lat}&lon=${lng}`,{referrerPolicy:'strict-origin-when-cross-origin'});if(!r.ok)throw Error('Could not name this place.');const name=nameOf(await r.json() as Result);try{localStorage.setItem(key,name)}catch{}return name});
}

// The town in a stored location: drop the country and postcodes, keep the last part left.
// "74, 1st Cross Road, Bengaluru, India" → "Bengaluru".
export function townOf(location:string){
 const parts=location.split(',').map(s=>s.trim()).filter(Boolean);if(parts.length>1)parts.pop();
 const named=parts.filter(p=>!/^\d[\d\s-]*$/.test(p));return named.at(-1)??location.trim();
}
