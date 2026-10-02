'use client';
import {useEffect,useRef,useState} from 'react';
import {ChevronDown,ChevronUp,Clock,Plus,X} from 'lucide-react';
import {fmtWindow,windowsOf,type TimeWindow} from '@/lib/timing';
import type {Goal} from '@/lib/tracker';

// The goal editor's task list: one row per task instead of a "one per line" text box. Enter adds the next row,
// Backspace on an empty row removes it, arrows reorder, and each task's time window (lib/timing) sits in its row
// behind the clock. Body tasks split into the exercise and its target ("Push-ups" + "20 × 2", saved as
// "Push-ups · 20 × 2", the format the exercise log already reads).
const MAX_ITEMS=30;
const same=(a:string,b:string)=>a.trim().toLowerCase()===b.trim().toLowerCase();
const split=(item:string)=>{const i=item.indexOf('·');return i<0?[item,'']:[item.slice(0,i).trim(),item.slice(i+1).trim()]};
const join=(name:string,detail:string)=>detail.trim()?`${name.trim()} · ${detail.trim()}`:name;

export function ItemsEditor({kind,category,list,setList,g,setG}:{kind:Goal['kind'];category:string;list:string[];setList:(l:string[])=>void;g?:Goal;setG?:(fn:(g:Goal)=>Goal)=>void}){
// A single checkbox can grow into a checklist: adding a second task is allowed, and the editor saves it as a checklist.
 const single=kind==='checkbox'&&list.filter(x=>x.trim()).length<=1&&list.length<=1,timed=!!g&&!!setG&&['checklist','checkbox','any'].includes(kind),body=category.trim().toLowerCase()==='body';
 const rows=list.length?list:[''];
 const refs=useRef<(HTMLInputElement|null)[]>([]),focusAt=useRef<number|null>(null),[openTime,setOpenTime]=useState<number|null>(null);
 useEffect(()=>{if(focusAt.current!==null){refs.current[focusAt.current]?.focus();focusAt.current=null}});

 const windows=timed?windowsOf({...g!,kind,items:rows.map(r=>r.trim()).filter(Boolean)}):[];
 const windowOf=(item:string)=>item.trim()?windows.find(w=>same(w.item,item))??null:null;
 // Windows are stored by task name, so they follow renames and go when a task goes.
 const putWindows=(fn:(ws:TimeWindow[])=>TimeWindow[])=>setG?.(o=>({...o,windows:fn(windowsOf({...o,kind,items:rows.map(r=>r.trim()).filter(Boolean)}))}));
 const setWindow=(item:string,w:TimeWindow|null)=>putWindows(ws=>[...ws.filter(x=>!same(x.item,item)),...(w?[w]:[])]);

 const change=(i:number,v:string)=>{const old=rows[i],next=[...rows];next[i]=v;setList(next);if(timed&&windowOf(old)&&v.trim())putWindows(ws=>ws.map(w=>same(w.item,old)?{...w,item:v.trim()}:w))};
 const add=(at=rows.length)=>{if(rows.length>=MAX_ITEMS)return;const next=[...rows];next.splice(at,0,'');setList(next);focusAt.current=at};
 const remove=(i:number)=>{const old=rows[i],next=rows.filter((_,j)=>j!==i);setList(next.length?next:['']);if(timed&&windowOf(old))setWindow(old,null);setOpenTime(null);focusAt.current=Math.max(0,i-1)};
 const move=(i:number,d:number)=>{const j=i+d;if(j<0||j>=rows.length)return;const next=[...rows];[next[i],next[j]]=[next[j],next[i]];setList(next);setOpenTime(null)};

 return <div className="items-editor">
  <ol>{rows.map((item,i)=>{const [name,detail]=body?split(item):[item,''],w=windowOf(item),input=(value:string,set:(v:string)=>void,props:{placeholder:string;className?:string;label:string})=>
   <input ref={props.className?undefined:el=>{refs.current[i]=el}} className={props.className} value={value} maxLength={150} placeholder={props.placeholder} aria-label={props.label} enterKeyHint={single?'done':'next'}
    onChange={e=>set(e.target.value)}
    onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();add(i+1)}else if(e.key==='Backspace'&&!item&&rows.length>1&&!props.className){e.preventDefault();remove(i)}}}/>;
   return <li key={i} className="item-row">
    <div className="item-main">
     {!single&&<span className="item-num" aria-hidden>{i+1}</span>}
     <div className="item-fields">
      {body?<>{input(name,v=>change(i,join(v,detail)),{placeholder:'Exercise',label:`Exercise ${i+1}`})}{input(detail,v=>change(i,join(name,v)),{placeholder:'20 × 2',className:'item-detail',label:`Target for exercise ${i+1}`})}</>
       :input(item,v=>change(i,v),{placeholder:single?'What counts as done?':kind==='choice'?`Option ${i+1}`:`Task ${i+1}`,label:single?'Task':`${kind==='choice'?'Option':'Task'} ${i+1}`})}
      {w&&openTime!==i&&<button type="button" className="item-when" onClick={()=>setOpenTime(i)}>{fmtWindow(w)}</button>}
     </div>
     {timed&&<button type="button" className={`item-icon ${w?'on':''}`} aria-label={w?`Change the time for ${item||'this task'}`:`Add a time for ${item||'this task'}`} aria-expanded={openTime===i} disabled={!item.trim()}
      onClick={()=>{if(!w)setWindow(item.trim(),{item:item.trim(),from:'09:00',to:'11:00'});setOpenTime(openTime===i?null:i)}}><Clock size={15}/></button>}
     {!single&&rows.length>1&&<div className="item-move"><button type="button" aria-label="Move up" disabled={i===0} onClick={()=>move(i,-1)}><ChevronUp size={13}/></button><button type="button" aria-label="Move down" disabled={i===rows.length-1} onClick={()=>move(i,1)}><ChevronDown size={13}/></button></div>}
     {!single&&<button type="button" className="item-icon item-remove" aria-label={`Remove ${item||'this row'}`} disabled={rows.length===1&&!item} onClick={()=>remove(i)}><X size={15}/></button>}
    </div>
    {timed&&w&&openTime===i&&<div className="item-time">
     <label>From<input type="time" value={w.from} onChange={e=>e.target.value&&setWindow(item,{...w,from:e.target.value})}/></label>
     <label>Until<input type="time" value={w.to} onChange={e=>e.target.value&&setWindow(item,{...w,to:e.target.value})}/></label>
     <button type="button" className="link-btn" onClick={()=>{setWindow(item,null);setOpenTime(null)}}>No time</button>
    </div>}
   </li>})}</ol>
  {<button type="button" className="item-add" disabled={rows.length>=MAX_ITEMS} onClick={()=>add()}><Plus size={16} aria-hidden/>{kind==='choice'?'Add option':body?'Add exercise':'Add item'}</button>}
  {timed&&<p className="setting-hint">Tap the clock to give a task a time. Late or missed ones get a reminder, and M.A.X. mentions them.</p>}
 </div>;
}
