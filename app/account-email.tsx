'use client';
import {useEffect,useState} from 'react';
import {MailCheck} from 'lucide-react';
import {toast} from 'sonner';

type Account={email:string|null;verified:boolean;role:string;emailEnabled:boolean};

// Profile: the email on your account (for logging in and resetting a password). Accounts made on the command line
// start without one; adding it sends a code to confirm it's yours. Hidden when the server can't send email.
export function AccountEmail(){
 const [account,setAccount]=useState<Account|null>(null),[editing,setEditing]=useState(false),[email,setEmail]=useState(''),[sentTo,setSentTo]=useState(''),[code,setCode]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{fetch('./api/account',{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<Account>:null).then(setAccount).catch(()=>{})},[]);
 if(!account?.emailEnabled)return null;
 const call=async(path:string,body:unknown)=>{setBusy(true);try{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json().catch(()=>({})) as {error?:string;email?:string};if(!r.ok)throw Error(d.error??'Please retry.');return d}catch(e){toast.error(e instanceof Error?e.message:'Please retry.');return null}finally{setBusy(false)}};
 const send=async(e:React.FormEvent)=>{e.preventDefault();const d=await call('./api/account/email',{email:email.trim()});if(d){setSentTo(d.email??email.trim());setCode('');toast.success('Code sent. Check your email.')}};
 const confirm=async(e:React.FormEvent)=>{e.preventDefault();const d=await call('./api/account/email/verify',{email:sentTo,code});if(d){setAccount({...account,email:sentTo,verified:true});setEditing(false);setSentTo('');toast.success('Email confirmed')}};
 return <section className="project-panel data-panel">
  <h2>Email</h2>
  {!editing?<div className="setting-line compact"><span>{account.email??'No email yet'}<span className="setting-hint">{account.email?(account.verified?'Confirmed · used to log in and reset your password':'Not confirmed yet'):'Add one to log in with it and reset a forgotten password'}</span></span>
   <button type="button" className="chip-btn" onClick={()=>{setEditing(true);setEmail(account.email??'')}}>{account.email?'Change':'Add email'}</button></div>
  :!sentTo?<form className="form-stack" onSubmit={e=>void send(e)}>
   <label className="field">Email<input type="email" autoComplete="email" required maxLength={254} autoFocus value={email} onChange={e=>setEmail(e.target.value)}/></label>
   <div className="form-actions"><button type="button" className="secondary" onClick={()=>setEditing(false)}>Cancel</button><button className="primary" disabled={busy}>Send code</button></div>
  </form>
  :<form className="form-stack" onSubmit={e=>void confirm(e)}>
   <p className="muted"><MailCheck size={15} aria-hidden/> We sent a 6-digit code to <strong>{sentTo}</strong>.</p>
   <label className="field">6-digit code<input className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))}/></label>
   <div className="form-actions"><button type="button" className="secondary" onClick={()=>setSentTo('')}>Back</button><button className="primary" disabled={busy||code.length!==6}>Confirm</button></div>
  </form>}
 </section>;
}
