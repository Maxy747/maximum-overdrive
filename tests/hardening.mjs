// Running it for other people: deleting your account, disabled accounts, admin commands, per-IP limits behind a proxy,
// the storage quota, and the privacy and terms pages.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync,mkdtempSync,readdirSync,readFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const port=4331,origin=`http://localhost:${port}`,dataDir=mkdtempSync(resolve('.selfhost-test-')),outbox=join(dataDir,'outbox');
const baseEnv={...process.env,PORT:String(port),MAX_DATA_DIR:dataDir,MAX_DEV_MODE:'0',MAX_ORIGIN:origin,MAX_BASE_PATH:'',MAX_MAIL_OUTBOX:outbox,MAX_SIGNUP:'open',MAX_ALLOWED_LOGIN:'',MAX_ACCOUNT_PICKER:'',
 MAX_OPERATOR:'Example Operator',MAX_CONTACT_EMAIL:'owner@example.test',MAX_SMTP_URL:'',MAX_COACH_URL:''};
let child,env=baseEnv;
async function start(extra={}){env={...baseEnv,...extra};child=spawn(process.execPath,['selfhost-dist/server.mjs'],{env,stdio:['ignore','pipe','pipe']});
 await new Promise((ok,fail)=>{child.stdout.on('data',v=>{if(v.toString().includes('MAX listening'))ok()});child.once('exit',code=>fail(Error('Server exited: '+code)))})}
async function stop(){if(!child||child.exitCode!==null||child.signalCode)return;const exited=once(child,'exit');child.kill();await exited}
function run(args){return new Promise(done=>{const p=spawn(process.execPath,['selfhost-dist/server.mjs',...args],{env,stdio:['pipe','pipe','pipe']});let out='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>out+=d);p.on('exit',code=>done({code,out}));p.stdin.end()})}
function api(path,{cookie,method='GET',body,ip}={}){const h={};if(cookie)h.Cookie=cookie;if(ip)h['X-Forwarded-For']=ip;if(method!=='GET')h.Origin=origin;
 if(body!==undefined&&!(body instanceof FormData)){h['Content-Type']='application/json';body=JSON.stringify(body)}return fetch(origin+path,{method,headers:h,body,redirect:'manual'})}
const cookieOf=r=>(r.headers.get('set-cookie')||'').split(';')[0];
const lastCode=to=>readdirSync(outbox).sort().map(f=>JSON.parse(readFileSync(join(outbox,f),'utf8'))).filter(m=>m.to===to).at(-1)?.text.match(/\b(\d{6})\b/)?.[1];
async function signUp(name,email,ip){const r=await api('/api/signup',{method:'POST',ip,body:{name,email,password:`pass-${name}-1234`}});assert.equal(r.status,200,await r.clone().text());
 const v=await api('/api/signup/verify',{method:'POST',ip,body:{email,code:lastCode(email)}});assert.equal(v.status,200);return cookieOf(v)}
const file=(bytes,name='a.txt')=>{const f=new FormData();f.append('file',new File([Buffer.alloc(bytes,65)],name,{type:'text/plain'}));return f};
const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5b0f5a10000000049454e44ae426082','hex');
const photo=()=>{const f=new FormData();f.append('file',new File([png],'p.png',{type:'image/png'}));return f};
const sql=(q,...a)=>{const d=new DatabaseSync(join(dataDir,'max.sqlite'));try{return d.prepare(q).all(...a)}finally{d.close()}};

try{
 // Behind a proxy (MAX_TRUST_PROXY=1) each client address has its own sign-up limit.
 await start({MAX_TRUST_PROXY:'1',MAX_SIGNUPS_PER_HOUR:'3',MAX_USER_STORAGE_MB:'0.01'});
 const alex=await signUp('alex','alex@example.test','203.0.113.1');// first account: the admin, not counted
 const sam=await signUp('sam','sam@example.test','203.0.113.1');const kimCookie=await signUp('kim','kim@example.test','203.0.113.1');await signUp('lee','lee@example.test','203.0.113.1');
 assert.equal((await api('/api/signup',{method:'POST',ip:'203.0.113.1',body:{name:'Spam',email:'spam@example.test',password:'spam-pass-1234'}})).status,429,'sign-ups per IP are limited');
 assert.equal((await api('/api/signup',{method:'POST',ip:'198.51.100.7',body:{name:'Dee',email:'dee@example.test',password:'dee-pass-1234'}})).status,200,'another address is not');

 // The policy pages describe this server, and sign-up links to them.
 const config=await (await api('/api/config')).json();assert.deepEqual(config.legal,{privacy:'./privacy',terms:'./terms'});
 const privacy=await (await api('/privacy')).text();assert.match(privacy,/Example Operator/);assert.match(privacy,/owner@example\.test/);assert.match(privacy,/Delete my account/);
 assert.doesNotMatch(privacy,/AI coach/,'no coach section when there is no coach');
 assert.match(await (await api('/terms')).text(),/at least 16 years old/);

 // Storage quota (10 KB here): what's used shows in the account, and uploads past it are refused.
 assert.equal((await api('/api/files',{cookie:kim(),method:'POST',body:file(6000)})).status,200);
 function kim(){return kimCookie}
 assert.equal((await api('/api/files',{cookie:kim(),method:'POST',body:file(6000)})).status,413,'over the quota');
 const acct=await (await api('/api/account',{cookie:kim()})).json();assert.equal(acct.storage.used,6000);assert.equal(acct.storage.limit,10000);
 assert.equal((await api('/api/files',{cookie:kim(),method:'POST',body:file(3000)})).status,200,'what fits still goes in');

 // Alex and Sam are partners with a shared journal (with photos), and each has their own.
 const {code}=await (await api('/api/pair/invite',{cookie:alex,method:'POST'})).json();assert.equal((await api('/api/pair/accept',{cookie:sam,method:'POST',body:{code}})).status,200);
 const samPhoto=await (await api('/api/files?shared=1',{cookie:sam,method:'POST',body:photo()})).json(),samPrivate=await (await api('/api/files?shared=1&space=mine',{cookie:sam,method:'POST',body:photo()})).json();
 {const cur=await (await api('/api/shared',{cookie:sam})).json();
  const e={id:'e1',title:'Our trip',body:'',date:'2026-01-01',time:'',location:'',photos:[samPhoto],author:'sam',created:new Date().toISOString()};
  assert.equal((await api('/api/shared',{cookie:sam,method:'PUT',body:{shared:{...cur.shared,journal:[e],moments:[{id:'k1',title:'Anniversary',icon:'💍',date:'2025-05-05',time:'',color:'pink',repeat:'yearly'}]},revision:cur.revision}})).status,200)}
 await api('/api/moods',{cookie:sam,method:'POST',body:{mood:'great',note:'hi',shared:true}});

 // Deleting needs the password.
 assert.equal((await api('/api/account',{cookie:sam,method:'DELETE',body:{password:'wrong-password'}})).status,401);
 const del=await api('/api/account',{cookie:sam,method:'DELETE',body:{password:'pass-sam-1234'}});assert.equal(del.status,200);assert.match(del.headers.get('set-cookie'),/max_session=;/);
 assert.equal((await api('/api/me',{cookie:sam})).status,401,'signed out');
 assert.deepEqual(sql("SELECT username FROM users WHERE username='sam'"),[]);
 for(const t of ['trackers WHERE user_id','moods WHERE username','files WHERE user_id','sessions WHERE username'])assert.equal(sql(`SELECT COUNT(*) AS n FROM ${t}='sam'`)[0].n,0,`nothing of sam's left in ${t.split(' ')[0]}`);
 assert.ok(!existsSync(join(dataDir,'files',samPrivate.id)),'their own photos are gone from disk');
 // The partner keeps the shared journal, now in their own journal, photos included.
 assert.equal((await (await api('/api/pair',{cookie:alex})).json()).partner,null);
 const kept=await (await api('/api/shared',{cookie:alex})).json();assert.deepEqual(kept.shared.journal.map(e=>e.title),['Our trip']);assert.ok(kept.shared.moments.some(m=>m.title==='Anniversary'));
 assert.equal((await api(`/api/files?id=${samPhoto.id}&inline=1`,{cookie:alex})).status,200,'the shared photo now belongs to the partner');
 assert.deepEqual((await (await api('/api/moods',{cookie:alex})).json()).partners,[]);
 assert.deepEqual((await (await api('/api/users',{cookie:alex})).json()).users.map(u=>u.username),['alex']);
 // The email can be used again.
 assert.equal((await api('/api/signup',{method:'POST',ip:'198.51.100.8',body:{name:'Sam',email:'sam@example.test',password:'pass-sam-5678'}})).status,200);

 // Admin commands.
 await stop();
 const list=await run(['list-users']);assert.equal(list.code,0);assert.match(list.out,/alex\talex\talex@example\.test\tadmin\tactive/);
 assert.equal((await run(['delete-user','lee'])).code,1,'delete-user needs --yes');
 assert.equal((await run(['disable-user','kim'])).code,0);
 await start();
 assert.equal((await api('/api/me',{cookie:kim()})).status,401,'a disabled account is signed out');
 const off=await api('/api/login',{method:'POST',body:{username:'kim@example.test',password:'pass-kim-1234'}});assert.equal(off.status,403);assert.match((await off.json()).error,/disabled/);
 await stop();assert.equal((await run(['enable-user','kim'])).code,0);assert.equal((await run(['set-role','kim','admin'])).code,0);
 assert.equal((await run(['delete-user','alex','--yes'])).code,0);
 assert.equal(sql("SELECT role FROM users WHERE username='kim'")[0].role,'admin');
 await start();
 assert.equal((await api('/api/login',{method:'POST',body:{username:'kim@example.test',password:'pass-kim-1234'}})).status,200,'enabled again');

 // Without MAX_TRUST_PROXY the header is ignored: every request counts as the same address.
 await stop();await start({MAX_SIGNUPS_PER_HOUR:'1'});
 assert.equal((await api('/api/signup',{method:'POST',ip:'192.0.2.1',body:{name:'One',email:'one@example.test',password:'one-pass-1234'}})).status,200);
 assert.equal((await api('/api/signup',{method:'POST',ip:'192.0.2.2',body:{name:'Two',email:'two@example.test',password:'two-pass-1234'}})).status,429,'a made-up X-Forwarded-For does not get around the limit');
 // Failed logins per IP, across accounts: 30 per 15 minutes.
 for(let i=0;i<30;i++)await api('/api/login',{method:'POST',body:{username:`nobody${i}@example.test`,password:'x-wrong-pass'}});
 assert.equal((await api('/api/login',{method:'POST',body:{username:'kim@example.test',password:'pass-kim-1234'}})).status,429,'too many failed logins from one address');

 // Your own policy pages instead of the built-in ones.
 await stop();await start({MAX_PRIVACY_URL:'https://example.test/privacy'});
 const own=await api('/privacy');assert.equal(own.status,302);assert.equal(own.headers.get('location'),'https://example.test/privacy');
 assert.equal((await (await api('/api/config')).json()).legal.privacy,'https://example.test/privacy');
 console.log('PASS: per-IP sign-up limit behind a proxy, spoofed X-Forwarded-For ignored without one, failed logins per IP, privacy and terms pages (built-in or your own), storage quota, delete account (password, everything removed, files off disk, partner keeps the shared journal and photos, email reusable), disabled accounts, list-users, set-role, delete-user, admin handed on.');
}finally{try{await stop()}catch{}rmSync(dataDir,{recursive:true,force:true})}
