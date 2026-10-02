'use client';
import {useState} from 'react';
import {Check,Plus,Pencil,X} from 'lucide-react';
import {Dialog,DialogTrigger,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {stretchReps,type Entry} from '@/lib/tracker';
// "Couldn't do it" (sore, injured, no time) is an answer too: kept in `couldnt`, so the exercise shows as that
// instead of blank, reminders stop, and M.A.X. asks what got in the way rather than nagging.
const setCouldnt=(e:Entry,index:number,on:boolean)=>{const rest=(e.couldnt??[]).filter(i=>i!==index);if(on)e.couldnt=[...rest,index].sort((a,b)=>a-b);else if(rest.length)e.couldnt=rest;else delete e.couldnt};
export function ExerciseLog({entry,index,item,update}:{entry:Entry;index:number;item:string;update:(fn:(e:Entry)=>void)=>void}){
 const [open,setOpen]=useState(false),[reps,setReps]=useState(''),[sets,setSets]=useState('');
 const log=entry.exerciseLogs?.[String(index)],couldnt=!!entry.couldnt?.includes(index);
 const name=item.split('·')[0].trim();
 const changeOpen=(value:boolean)=>{if(value){setReps(log?String(log.reps):'');setSets(log?String(log.sets):'')}setOpen(value)};
 return <Dialog open={open} onOpenChange={changeOpen}><DialogTrigger asChild><button className={'exercise-row '+(entry.checks[index]?'logged':couldnt?'couldnt':'')} aria-label={'Log '+name}>
 <span className="exercise-check" aria-hidden="true">{entry.checks[index]?<Check size={17}/>:couldnt?<X size={17}/>:<Plus size={17}/>}</span><span className="exercise-copy"><strong>{name}</strong><small>{log?`${log.reps} reps × ${log.sets} sets · ${log.reps*log.sets} total reps`:entry.checks[index]?'Completed · add reps and sets':couldnt?'Couldn’t do it today':item.includes('·')?(entry.stretch?'Stretch: '+stretchReps(item.split('·').slice(1).join('·').trim()):'Target: '+item.split('·').slice(1).join('·').trim()):'Add reps and sets'}</small></span><Pencil size={15} aria-hidden="true"/></button></DialogTrigger>
 <DialogContent className="editor exercise-dialog" data-category="body"><DialogTitle>{name}</DialogTitle><DialogDescription>How many reps and sets did you do? Saving marks this exercise complete.</DialogDescription><form className="form-stack" onSubmit={event=>{event.preventDefault();const r=Number(reps),s=Number(sets);if(!Number.isInteger(r)||!Number.isInteger(s)||r<1||s<1||r>10000||s>1000)return;update(e=>{e.exerciseLogs??={};e.exerciseLogs[String(index)]={reps:r,sets:s};e.checks[index]=true;setCouldnt(e,index,false)});setOpen(false)}}>
 <div className="form-grid"><label className="field">Reps per set<input autoFocus required type="number" inputMode="numeric" min="1" max="10000" step="1" placeholder="e.g. 20" value={reps} onChange={e=>setReps(e.target.value)}/></label><label className="field">Sets completed<input required type="number" inputMode="numeric" min="1" max="1000" step="1" placeholder="e.g. 2" value={sets} onChange={e=>setSets(e.target.value)}/></label></div>
 <p className="muted">{Number(reps)>0&&Number(sets)>0?`${Number(reps)*Number(sets)} total reps`:'Enter what you actually completed.'}</p>
 <button type="button" className={`couldnt-btn ${couldnt?'on':''}`} aria-pressed={couldnt} onClick={()=>{update(e=>{if(!couldnt){if(e.exerciseLogs)delete e.exerciseLogs[String(index)];e.checks[index]=false}setCouldnt(e,index,!couldnt)});setOpen(false)}}><X size={15} aria-hidden/>{couldnt?'Undo “couldn’t do it”':'Couldn’t do it today'}</button>
 <div className="form-actions">{(log||entry.checks[index])&&<button type="button" className="secondary" onClick={()=>{update(e=>{if(e.exerciseLogs)delete e.exerciseLogs[String(index)];e.checks[index]=false});setOpen(false)}}>Clear log</button>}<button type="button" className="secondary" onClick={()=>setOpen(false)}>Cancel</button><button className="primary">Save exercise</button></div></form></DialogContent></Dialog>
}
