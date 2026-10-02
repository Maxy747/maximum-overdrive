// Sign-up, email verification, login by email, forgotten passwords and adding an email later.
// Mails go to an outbox folder instead of SMTP, so the test can read the codes.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,readdirSync,readFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const port=4328,origin=`http://localhost:${port}`,dataDir=mkdtempSync(resolve('.selfhost-test-')),outbox=join(dataDir,'outbox');
const baseEnv={...process.env,PORT:String(port),MAX_DATA_DIR:dataDir,MAX_DEV_MODE:'0',MAX_ORIGIN:origin,MAX_BASE_PATH:'',MAX_MAIL_OUTBOX:outbox,MAX_SIGNUP:'open',MAX_ALLOWED_LOGIN:'',MAX_ACCOUNT_PICKER:''};
let child,env=baseEnv;

async function start(extra={}){env={...baseEnv,...extra};child=spawn(process.execPath,['selfhost-dist/server.mjs'],{env,stdio:['ignore','pipe','pipe']});
 await new Promise((ok,fail)=>{child.stdout.on('data',v=>{if(v.toString().includes('MAX listening'))ok()});child.once('exit',code=>fail(Error('Server exited: '+code)))})}
async function stop(){const exited=once(child,'exit');child.kill();await exited}
function run(args,input){return new Promise(done=>{const p=spawn(process.execPath,['selfhost-dist/server.mjs',...args],{env,stdio:['pipe','pipe','pipe']});let out='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>out+=d);p.on('exit',code=>done({code,out}));p.stdin.end(input)})}
function api(path,{cookie,method='GET',body}={}){const h={};if(cookie)h.Cookie=cookie;if(method!=='GET')h.Origin=origin;if(body!==undefined){h['Content-Type']='application/json';body=JSON.stringify(body)}return fetch(origin+path,{method,headers:h,body})}
const cookieOf=r=>(r.headers.get('set-cookie')||'').split(';')[0];
const mails=()=>{try{return readdirSync(outbox).sort().map(f=>JSON.parse(readFileSync(join(outbox,f),'utf8')))}catch{return []}};
const lastCode=to=>{const m=mails().filter(x=>x.to===to).at(-1);return m?.text.match(/\b(\d{6})\b/)?.[1]};
const sql=q=>{const d=new DatabaseSync(join(dataDir,'max.sqlite'));try{return d.prepare(q).all()}finally{d.close()}};

try{
 await start();
 // A new server asks for the first account; it becomes the admin.
 assert.equal((await (await api('/api/config')).json()).signup,'setup');
 assert.equal((await api('/api/accounts')).status,404,'no account list before login on an open server');
 const bad=await api('/api/signup',{method:'POST',body:{name:'Alex',email:'not-an-email',password:'long-enough-1'}});assert.equal(bad.status,400);
 assert.equal((await api('/api/signup',{method:'POST',body:{name:'Alex',email:'alex@example.test',password:'short'}})).status,400);
 const s1=await (await api('/api/signup',{method:'POST',body:{name:'Alex Kim',email:'Alex@Example.test',password:'alex-pass-123'}})).json();
 assert.deepEqual(s1,{verify:true,email:'alex@example.test'});
 const code=lastCode('alex@example.test');assert.match(code,/^\d{6}$/,'a 6-digit code is emailed');
 assert.equal(sql("SELECT code_hash FROM email_codes").every(r=>!r.code_hash.includes(code)),true,'codes are stored hashed');
 // Not verified yet: login is refused (and sends a fresh code).
 const early=await api('/api/login',{method:'POST',body:{username:'alex@example.test',password:'alex-pass-123'}});
 assert.equal(early.status,403);assert.equal((await early.json()).verify,true);
 const code2=lastCode('alex@example.test');
 // Wrong codes count; the right one signs you in.
 assert.equal((await api('/api/signup/verify',{method:'POST',body:{email:'alex@example.test',code:'000000'===code2?'111111':'000000'}})).status,400);
 const v=await api('/api/signup/verify',{method:'POST',body:{email:'alex@example.test',code:code2}});assert.equal(v.status,200);
 const alex=cookieOf(v),me=await (await api('/api/me',{cookie:alex})).json();assert.equal(me.user.displayName,'Alex Kim');assert.equal(me.user.username,'alex-kim');
 assert.equal((await (await api('/api/account',{cookie:alex})).json()).role,'admin','first account is the admin');
 assert.equal((await api('/api/signup/verify',{method:'POST',body:{email:'alex@example.test',code:code2}})).status,400,'a code works once');
 assert.equal((await (await api('/api/config')).json()).signup,'open');

 // Log in by email (any case) or by username.
 assert.equal((await api('/api/login',{method:'POST',body:{username:'ALEX@example.test',password:'alex-pass-123'}})).status,200);
 assert.equal((await api('/api/login',{method:'POST',body:{username:'alex-kim',password:'alex-pass-123'}})).status,200);
 assert.equal((await api('/api/login',{method:'POST',body:{username:'alex@example.test',password:'wrong-pass-1'}})).status,401);

 // Signing up with a taken email looks the same from outside; the owner gets a heads-up instead of a code.
 await stop();await start();// clears the one-mail-a-minute throttle
 const before=mails().length;
 const dup=await (await api('/api/signup',{method:'POST',body:{name:'Mallory',email:'alex@example.test',password:'other-pass-123'}})).json();
 assert.deepEqual(dup,{verify:true,email:'alex@example.test'});
 const note=mails().slice(before).at(-1);assert.match(note.subject,/tried to sign up/);assert.doesNotMatch(note.text,/\b\d{6}\b/);
 assert.equal(sql("SELECT COUNT(*) AS n FROM users")[0].n,1,'no second account');
 assert.equal((await api('/api/login',{method:'POST',body:{username:'alex@example.test',password:'alex-pass-123'}})).status,200,'the real password still works');

 // Second person: a member, and names get a unique username.
 await api('/api/signup',{method:'POST',body:{name:'Alex Kim',email:'sam@example.test',password:'sam-pass-1234'}});
 // Five wrong codes end the code.
 for(let i=0;i<4;i++)assert.equal((await api('/api/signup/verify',{method:'POST',body:{email:'sam@example.test',code:'999999'===lastCode('sam@example.test')?'888888':'999999'}})).status,400);
 const locked=await (await api('/api/signup/verify',{method:'POST',body:{email:'sam@example.test',code:'999999'===lastCode('sam@example.test')?'888888':'999999'}})).json();assert.match(locked.error,/Too many/);
 assert.equal((await api('/api/signup/verify',{method:'POST',body:{email:'sam@example.test',code:lastCode('sam@example.test')}})).status,400,'even the right code is dead now');
 // Resend right away is throttled (one a minute), so make the old one expire from the database side and ask again.
 await api('/api/signup/resend',{method:'POST',body:{email:'sam@example.test'}});
 assert.equal(mails().filter(m=>m.to==='sam@example.test').length,1,'resend waits a minute');
 await stop();await start();// restarting clears the in-memory throttle
 await api('/api/signup/resend',{method:'POST',body:{email:'sam@example.test'}});
 const sam=cookieOf(await api('/api/signup/verify',{method:'POST',body:{email:'sam@example.test',code:lastCode('sam@example.test')}}));
 const samMe=await (await api('/api/me',{cookie:sam})).json();assert.equal(samMe.user.username,'alex-kim-2');
 assert.equal((await (await api('/api/account',{cookie:sam})).json()).role,'member');

 // Forgot password: same answer for unknown emails; the code resets the password and signs out other sessions.
 assert.equal((await api('/api/password/forgot',{method:'POST',body:{email:'nobody@example.test'}})).status,200);
 assert.equal(mails().filter(m=>m.to==='nobody@example.test').length,0);
 await stop();await start();
 assert.equal((await api('/api/password/forgot',{method:'POST',body:{email:'sam@example.test'}})).status,200);
 const rc=lastCode('sam@example.test');
 assert.equal((await api('/api/password/reset',{method:'POST',body:{email:'sam@example.test',code:rc,password:'short'}})).status,400);
 const reset=await api('/api/password/reset',{method:'POST',body:{email:'sam@example.test',code:rc,password:'sam-new-pass-1'}});assert.equal(reset.status,200);
 assert.equal((await api('/api/me',{cookie:sam})).status,401,'old sessions are signed out');
 assert.equal((await api('/api/login',{method:'POST',body:{username:'sam@example.test',password:'sam-pass-1234'}})).status,401);
 assert.equal((await api('/api/login',{method:'POST',body:{username:'sam@example.test',password:'sam-new-pass-1'}})).status,200);

 // An account made on the command line has no email; it can add (and confirm) one.
 assert.equal((await run(['set-password','casey','Casey'],'casey-pass-12\ncasey-pass-12\n')).code,0);
 const casey=cookieOf(await api('/api/login',{method:'POST',body:{username:'casey',password:'casey-pass-12'}}));
 assert.equal((await (await api('/api/account',{cookie:casey})).json()).email,null);
 assert.equal((await api('/api/account/email',{cookie:casey,method:'POST',body:{email:'alex@example.test'}})).status,409,'taken email');
 assert.equal((await api('/api/account/email',{cookie:casey,method:'POST',body:{email:'casey@example.test'}})).status,200);
 assert.equal((await api('/api/account/email/verify',{cookie:casey,method:'POST',body:{email:'casey@example.test',code:lastCode('casey@example.test')}})).status,200);
 assert.equal((await api('/api/login',{method:'POST',body:{username:'casey@example.test',password:'casey-pass-12'}})).status,200);

 // Closed and invite-only servers refuse sign-ups (invite codes come with partner invites).
 await stop();await start({MAX_SIGNUP:'closed'});
 assert.equal((await api('/api/signup',{method:'POST',body:{name:'Dee',email:'dee@example.test',password:'dee-pass-1234'}})).status,403);
 await stop();await start({MAX_SIGNUP:'invite'});
 assert.equal((await api('/api/signup',{method:'POST',body:{name:'Dee',email:'dee@example.test',password:'dee-pass-1234'}})).status,403);
 // Behind the Tailscale gate the account picker is on, as before.
 await stop();await start({MAX_ALLOWED_LOGIN:'owner@example.test'});
 assert.equal((await api('/api/config')).status,401,'without the Tailscale header nothing is reachable');
 await stop();await start({MAX_ACCOUNT_PICKER:'1'});
 assert.equal((await api('/api/accounts')).status,200);
 // MAX_FEATURES turns optional parts off for everyone, on the server (not just in the app).
 await stop();await start({MAX_FEATURES:'coach'});
 {const c=cookieOf(await api('/api/login',{method:'POST',body:{username:'alex@example.test',password:'alex-pass-123'}}));
  assert.equal((await (await api('/api/features',{cookie:c})).json()).vault,false);assert.equal((await api('/api/vault/status',{cookie:c})).status,404,'no vault when it is off');}
 console.log('PASS: first account is admin, sign-up with email code, hashed codes, login blocked until verified, login by email or username, duplicate email hidden, code tries and single use, resend throttle, unique usernames, forgot/reset password, add email later, closed and invite-only sign-up, account picker gating, MAX_FEATURES.');
}finally{try{await stop()}catch{}rmSync(dataDir,{recursive:true,force:true})}
