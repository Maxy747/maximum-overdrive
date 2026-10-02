'use client';
import {useCallback,useEffect,useState} from 'react';
import {ChevronLeft,LogIn,UserPlus,MailCheck,KeyRound} from 'lucide-react';
import {Toaster} from 'sonner';
import type {User} from '@/lib/tracker';
import Tracker from './tracker';
import {Avatar} from './avatar';
import {Splash} from './splash';
import {forgetDevice,forgetUser,isOfflineError,lastUser,rememberUser} from './offline';

type Account={username:string;displayName:string;avatarVersion?:string|null};
// What this server allows (GET /api/config): 'setup' until the first account exists.
export type Config={signup:'setup'|'open'|'invite'|'closed';email:boolean;picker:boolean;appName?:string};
const accountPhoto=(a:Account)=>a.avatarVersion?`./api/accounts/avatar?u=${encodeURIComponent(a.username)}&v=${a.avatarVersion}`:undefined;

export default function App(){
 const [user,setUser]=useState<User|null>(null),[users,setUsers]=useState<User[]>([]),[phase,setPhase]=useState<'loading'|'out'|'in'>('loading'),[accounts,setAccounts]=useState<Account[]>([]),[config,setConfig]=useState<Config|null>(null),[offline,setOffline]=useState(false);
 const showLogin=useCallback(async()=>{setUser(null);setPhase('out');try{
  const c=await (await fetch('./api/config',{cache:'no-store'})).json() as Config;setConfig(c);
  if(c.picker){const r=await fetch('./api/accounts',{cache:'no-store'});const data=await r.json() as {accounts?:Account[]};setAccounts(data.accounts??[])}else setAccounts([]);
  setOffline(false)}catch(e){setAccounts([]);setOffline(isOfflineError(e))}},[]);
 // The server said this session is no longer valid: stop opening MAX offline as this account.
 const signedOut=useCallback(()=>{forgetUser();void showLogin()},[showLogin]);
 const loadUsers=useCallback(async(me:User)=>{try{const r=await fetch('./api/users',{cache:'no-store'});if(r.ok){const list=(await r.json() as {users:User[]}).users;setUsers(list);rememberUser(me,list)}}catch{}},[]);
 const signedIn=useCallback((u:User)=>{setUser(u);setPhase('in');rememberUser(u);void loadUsers(u)},[loadUsers]);
 // Offline, open as whoever was signed in last on this phone; their data is kept on the phone too.
 useEffect(()=>{void (async()=>{try{const r=await fetch('./api/me',{cache:'no-store'});if(r.ok)signedIn((await r.json() as {user:User}).user);else signedOut()}catch(e){const last=isOfflineError(e)?lastUser():null;if(last){setUser(last.user);setUsers(last.users);setPhase('in')}else void showLogin()}})()},[signedIn,signedOut,showLogin]);
 const logout=useCallback(async()=>{try{await fetch('./api/logout',{method:'POST'})}catch{}if(user)await forgetDevice(user.username);void showLogin()},[showLogin,user]);
 const changeUser=useCallback((u:User)=>{setUser(u);setUsers(list=>{const next=list.map(x=>x.username===u.username?u:x);rememberUser(u,next);return next})},[]);
 return <><Splash/>{phase==='loading'?<main className="loading boot" aria-busy><img className="boot-logo" src="./max-logo-v2.png" alt="MAX"/></main>
  :phase==='out'||!user?<><Login accounts={accounts} config={config} offline={offline} onRetry={()=>void showLogin()} onLogin={signedIn}/><Toaster theme="dark" position="top-center"/></>
  :<Tracker key={user.username} user={user} users={users} onLogout={logout} onUnauthorized={signedOut} onUserChange={changeUser}/>}</>;
}

// Every screen before you're in: pick yourself (when the server shows accounts), log in, create an account,
// confirm the emailed code, or reset a forgotten password.
type Screen='login'|'signup'|'verify'|'forgot'|'reset';
async function post<T>(path:string,body:unknown):Promise<{ok:boolean;status:number;data:T&{error?:string}}>{
 const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 return {ok:r.ok,status:r.status,data:await r.json().catch(()=>({})) as T&{error?:string}};
}

function Login({accounts,config,offline,onRetry,onLogin}:{accounts:Account[];config:Config|null;offline:boolean;onRetry:()=>void;onLogin:(u:User)=>void}){
 const setup=config?.signup==='setup',canSignUp=setup||config?.signup==='open'||config?.signup==='invite';
 const [screen,setScreen]=useState<Screen>(setup?'signup':'login'),[picked,setPicked]=useState<Account|null>(accounts.length===1?accounts[0]:null);
 const [id,setId]=useState(''),[name,setName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[code,setCode]=useState(''),[invite,setInvite]=useState(()=>{try{return (new URLSearchParams(window.location.search).get('pair')??'').toUpperCase().slice(0,9)}catch{return ''}});
 const [remember,setRemember]=useState(true),[error,setError]=useState(''),[note,setNote]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{if(accounts.length===1)setPicked(accounts[0])},[accounts]);
 // The first account is made on the sign-up screen; once it exists (e.g. after logging out of it), start at log in.
 useEffect(()=>{setScreen(setup?'signup':'login')},[setup]);
 const go=(s:Screen)=>{setScreen(s);setError('');setNote('');setCode('');if(s!=='reset')setPassword('')};
 // Runs one request. Errors from the server are shown as they are.
 const run=async(e:React.FormEvent,fn:()=>Promise<void>)=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{await fn()}catch(err){setError(err instanceof Error?err.message:'Something went wrong. Please retry.')}finally{setBusy(false)}};
 const done=(u?:User)=>{if(!u)throw Error('Could not sign in. Please retry.');setPassword('');onLogin(u)};

 const login=(e:React.FormEvent)=>run(e,async()=>{
  const r=await post<{user?:User;verify?:boolean;email?:string}>('./api/login',{username:picked?.username??id.trim(),password,remember});
  if(r.data.verify&&r.data.email){setEmail(r.data.email);go('verify');setNote(r.data.error??'');return}
  if(!r.ok)throw Error(r.data.error??'Could not log in. Please retry.');done(r.data.user);
 });
 const signup=(e:React.FormEvent)=>run(e,async()=>{
  const r=await post<{user?:User;verify?:boolean;email?:string}>('./api/signup',{name:name.trim(),email:email.trim(),password,...(invite.trim()?{invite:invite.trim()}:{})});
  if(!r.ok)throw Error(r.data.error??'Could not create the account. Please retry.');
  if(r.data.verify){setEmail(r.data.email??email);go('verify');return}done(r.data.user);
 });
 const verify=(e:React.FormEvent)=>run(e,async()=>{
  const r=await post<{user?:User}>('./api/signup/verify',{email,code,remember});if(!r.ok)throw Error(r.data.error??'That code didn’t work.');done(r.data.user);
 });
 const resend=async()=>{setError('');await post('./api/signup/resend',{email}).catch(()=>null);setNote('If a code can be sent, a new one is on its way. It can take a minute.')};
 const forgot=(e:React.FormEvent)=>run(e,async()=>{
  const r=await post('./api/password/forgot',{email:email.trim()});if(!r.ok)throw Error(r.data.error??'Could not send a code. Please retry.');
  go('reset');setNote(`If ${email.trim()} has an account, we sent it a code.`);
 });
 const reset=(e:React.FormEvent)=>run(e,async()=>{
  const r=await post<{user?:User}>('./api/password/reset',{email:email.trim(),code,password});if(!r.ok)throw Error(r.data.error??'Could not reset the password.');done(r.data.user);
 });

 const pw=(label:string,auto:'current-password'|'new-password')=><label className="field">{label}<input type="password" name="password" autoComplete={auto} required minLength={auto==='new-password'?8:undefined} maxLength={200} value={password} onChange={e=>setPassword(e.target.value)}/></label>;
 const codeField=<label className="field">6-digit code<input className="code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))}/></label>;
 const messages=<>{note&&<p className="login-note" role="status">{note}</p>}{error&&<p className="login-error" role="alert">{error}</p>}</>;
 const back=(to:Screen,label='Back to log in')=><button type="button" className="login-back" onClick={()=>go(to)}><ChevronLeft size={16}/>{label}</button>;

 let body:React.ReactNode;
 if(offline)body=<><p className="muted">You’re offline. Connect to the internet to log in.</p><button type="button" className="primary login-submit" onClick={onRetry}>Try again</button></>;
 else if(!config)body=<p className="muted">Loading…</p>;
 else if(screen==='signup')body=<form className="login-form" onSubmit={e=>void signup(e)}>
  {!setup&&back('login')}
  <h1>{setup?'Welcome! Create the first account':'Create your account'}</h1>
  {setup&&<p className="muted">You’ll be this server’s admin.</p>}
  <label className="field">Your name<input name="name" autoComplete="nickname" required maxLength={30} autoFocus value={name} onChange={e=>setName(e.target.value)}/></label>
  <label className="field">Email{!config.email&&<span className="setting-hint">Optional: this server can’t send email</span>}<input type="email" name="email" autoComplete="email" required={config.email} maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></label>
  {pw('Password (8+ characters)','new-password')}
  {(config.signup==='invite'||invite)&&<label className="field">{config.signup==='invite'?'Invite code':'Partner’s invite code'}<input name="invite" autoComplete="off" required maxLength={20} value={invite} onChange={e=>setInvite(e.target.value.toUpperCase())}/>{config.signup!=='invite'&&<span className="setting-hint">You’ll be partners once your account is ready. Already have an account? Log in instead.</span>}</label>}
  {messages}
  <button className="primary login-submit" disabled={busy}><UserPlus size={17}/>{busy?'Creating…':'Create account'}</button>
 </form>;
 else if(screen==='verify')body=<form className="login-form" onSubmit={e=>void verify(e)}>
  {back('login')}
  <MailCheck size={40} className="login-icon" aria-hidden/>
  <h1>Check your email</h1><p className="muted">We sent a 6-digit code to <strong>{email}</strong>.</p>
  {codeField}{messages}
  <button className="primary login-submit" disabled={busy||code.length!==6}>{busy?'Checking…':'Confirm'}</button>
  <button type="button" className="login-link" onClick={()=>void resend()}>Send a new code</button>
 </form>;
 else if(screen==='forgot')body=<form className="login-form" onSubmit={e=>void forgot(e)}>
  {back('login')}
  <KeyRound size={40} className="login-icon" aria-hidden/>
  <h1>Forgot your password?</h1><p className="muted">Enter your account’s email and we’ll send you a code.</p>
  <label className="field">Email<input type="email" name="email" autoComplete="email" required autoFocus maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></label>
  {messages}<button className="primary login-submit" disabled={busy}>{busy?'Sending…':'Send code'}</button>
 </form>;
 else if(screen==='reset')body=<form className="login-form" onSubmit={e=>void reset(e)}>
  {back('forgot','Use another email')}
  <h1>Choose a new password</h1>
  {codeField}{pw('New password (8+ characters)','new-password')}{messages}
  <button className="primary login-submit" disabled={busy||code.length!==6}>{busy?'Saving…':'Save and log in'}</button>
 </form>;
 else if(config.picker&&accounts.length&&!picked)body=<>
  <h1>Who&apos;s here?</h1>
  <div className="profile-picker">{accounts.map(a=><button key={a.username} className="profile-tile" onClick={()=>{setPicked(a);setError('')}}><Avatar user={{displayName:a.displayName,avatar:null}} src={accountPhoto(a)} size={76}/><span>{a.displayName}</span></button>)}</div>
  {canSignUp&&<button type="button" className="login-link" onClick={()=>go('signup')}>Create an account</button>}
 </>;
 else body=<form className="login-form" onSubmit={e=>void login(e)}>
  {picked?<>
   {accounts.length>1&&<button type="button" className="login-back" onClick={()=>{setPicked(null);setPassword('');setError('')}}><ChevronLeft size={16}/>Not {picked.displayName}?</button>}
   <Avatar user={{displayName:picked.displayName,avatar:null}} src={accountPhoto(picked)} size={84}/>
   <h1>Hi, {picked.displayName}</h1>
   <input type="text" name="username" autoComplete="username" value={picked.username} readOnly hidden/>
  </>:<>
   <h1>Log in</h1>
   <label className="field">Email or username<input name="username" autoComplete="username" required autoFocus maxLength={254} value={id} onChange={e=>setId(e.target.value)}/></label>
  </>}
  {pw('Password','current-password')}
  <label className="remember"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>Stay logged in</label>
  {messages}
  <button className="primary login-submit" disabled={busy||!password}><LogIn size={17}/>{busy?'Logging in…':'Log in'}</button>
  <div className="login-links">
   {config.email&&<button type="button" className="login-link" onClick={()=>{if(!email&&id.includes('@'))setEmail(id.trim());go('forgot')}}>Forgot password?</button>}
   {canSignUp&&<button type="button" className="login-link" onClick={()=>go('signup')}>Create an account</button>}
  </div>
 </form>;

 return <main className="login-screen">
  <div className="login-card">
   <div className="login-brand"><img className="brandmark app-logo" src="./max-logo-v2.png" alt="MAX"/><div><strong>MAXIMUM</strong><small>OVERDRIVE</small></div></div>
   <p className="login-tagline">A little better.<br/>A little more you.</p>
   {body}
  </div>
 </main>;
}
