'use client';
import {useEffect,useState} from 'react';
import {Lock} from 'lucide-react';
import {toast} from 'sonner';
import {Switch} from '@/components/ui/switch';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';

const pinOk=(p:string)=>/^\d{4,12}$/.test(p);
async function send(path:string,body:unknown,method='POST'){const r=await fetch(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json().catch(()=>({})) as {error?:string};if(!r.ok)throw Error(d.error??'Please retry.');return d}
const PinInput=({value,onChange,label,autoFocus=false}:{value:string;onChange:(v:string)=>void;label:string;autoFocus?:boolean})=>
 <label className="field">{label}<input className="code-input" type="password" inputMode="numeric" autoComplete="off" maxLength={12} required autoFocus={autoFocus} value={value} onChange={e=>onChange(e.target.value.replace(/\D/g,'').slice(0,12))}/></label>;

// Journal: your own journal is locked. The same PIN (and the same 15-minute unlock) as Hidden photos.
export function JournalLocked({onUnlocked}:{onUnlocked:()=>void}){
 const [pin,setPin]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const unlock=async(e:React.FormEvent)=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{await send('./api/vault/unlock',{pin});setPin('');onUnlocked()}catch(err){setError((err as Error).message);setPin('')}finally{setBusy(false)}};
 return <form className="journal-locked" onSubmit={e=>void unlock(e)}>
  <span className="pin-icon" aria-hidden><Lock size={26}/></span>
  <h2>Your journal is locked</h2>
  <p className="muted">Enter your PIN to open it. It locks again after 15 minutes.</p>
  <PinInput value={pin} onChange={setPin} label="PIN" autoFocus/>
  {error&&<p className="login-error" role="alert">{error}</p>}
  <button className="primary" disabled={busy||!pinOk(pin)}>{busy?'Unlocking…':'Unlock'}</button>
 </form>;
}

// Profile: "Lock my journal". Turning it on or off asks for the PIN (or to choose one, if there isn't one yet).
export function JournalLockSetting({solo}:{solo:boolean}){
 const [status,setStatus]=useState<{hasPin:boolean;journalLock:boolean}|null>(null),[asking,setAsking]=useState<boolean|null>(null),[pin,setPin]=useState(''),[again,setAgain]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{fetch('./api/vault/status',{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{hasPin:boolean;journalLock:boolean}>:null).then(setStatus).catch(()=>{})},[]);
 if(!status)return null;
 const choosing=asking===true&&!status.hasPin;
 const save=async(e:React.FormEvent)=>{e.preventDefault();if(asking===null||busy)return;if(choosing&&pin!==again)return void toast.error('Those PINs didn’t match.');
  setBusy(true);try{await send('./api/vault/journal-lock',{enabled:asking,pin},'PUT');setStatus({hasPin:true,journalLock:asking});toast.success(asking?'Your journal is locked with your PIN':'Journal lock is off');setAsking(null);setPin('');setAgain('');if(asking)setTimeout(()=>window.location.reload(),500)}
  catch(err){toast.error((err as Error).message);setPin('')}finally{setBusy(false)}};
 return <>
  <div className="setting-line compact"><label htmlFor="journal-lock">Lock my journal<span className="setting-hint">{solo?'Your journal':'Your own journal (Mine)'} opens only with your PIN · the same PIN as Hidden photos</span></label><Switch id="journal-lock" checked={status.journalLock} onCheckedChange={v=>{setAsking(v);setPin('');setAgain('')}}/></div>
  {asking!==null&&<Dialog open onOpenChange={v=>!v&&setAsking(null)}><DialogContent className="editor"><DialogTitle>{asking?(status.hasPin?'Lock your journal':'Choose a PIN'):'Turn off the journal lock'}</DialogTitle>
   <DialogDescription>{asking?(status.hasPin?'Enter your PIN. From now on your journal opens only with it.':'4 to 12 digits. It locks your journal and your Hidden photos. Only you know it.'):'Enter your PIN to turn the lock off.'}</DialogDescription>
   <form className="form-stack" onSubmit={e=>void save(e)}>
    <PinInput value={pin} onChange={setPin} label={choosing?'New PIN':'PIN'} autoFocus/>
    {choosing&&<PinInput value={again} onChange={setAgain} label="Repeat it"/>}
    <div className="form-actions"><button type="button" className="secondary" onClick={()=>setAsking(null)}>Cancel</button><button className="primary" disabled={busy||!pinOk(pin)||(choosing&&!pinOk(again))}>{asking?'Lock':'Turn off'}</button></div>
   </form>
  </DialogContent></Dialog>}
 </>;
}
