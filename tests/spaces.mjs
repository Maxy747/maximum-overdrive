// Spaces and partners: everyone has their own journal, pairing by invite code shares the inviter's, leaving gives
// the joiner their own back, and nobody outside a space can see into it. Also the upgrade from one shared journal.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,readdirSync,readFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const port=4329,origin=`http://localhost:${port}`,dataDir=mkdtempSync(resolve('.selfhost-test-')),outbox=join(dataDir,'outbox');
const baseEnv={...process.env,PORT:String(port),MAX_DATA_DIR:dataDir,MAX_DEV_MODE:'0',MAX_ORIGIN:origin,MAX_BASE_PATH:'',MAX_MAIL_OUTBOX:outbox,MAX_SIGNUP:'open',MAX_ALLOWED_LOGIN:'',MAX_ACCOUNT_PICKER:''};
let child,env=baseEnv;
async function start(extra={}){env={...baseEnv,...extra};child=spawn(process.execPath,['selfhost-dist/server.mjs'],{env,stdio:['ignore','pipe','pipe']});
 await new Promise((ok,fail)=>{child.stdout.on('data',v=>{if(v.toString().includes('MAX listening'))ok()});child.once('exit',code=>fail(Error('Server exited: '+code)))})}
async function stop(){const exited=once(child,'exit');child.kill();await exited}
function api(path,{cookie,method='GET',body}={}){const h={};if(cookie)h.Cookie=cookie;if(method!=='GET')h.Origin=origin;
 if(body!==undefined&&!(body instanceof FormData)){h['Content-Type']='application/json';body=JSON.stringify(body)}return fetch(origin+path,{method,headers:h,body})}
const cookieOf=r=>(r.headers.get('set-cookie')||'').split(';')[0];
const lastCode=to=>{const f=readdirSync(outbox).sort().map(x=>JSON.parse(readFileSync(join(outbox,x),'utf8'))).filter(m=>m.to===to).at(-1);return f?.text.match(/\b(\d{6})\b/)?.[1]};
async function signUp(name,email,extra={}){
 const r=await (await api('/api/signup',{method:'POST',body:{name,email,password:'pass-'+name.toLowerCase()+'-123',...extra}})).json();assert.equal(r.verify,true,JSON.stringify(r));
 const v=await api('/api/signup/verify',{method:'POST',body:{email,code:lastCode(email)}});assert.equal(v.status,200);return cookieOf(v);
}
const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5b0f5a10000000049454e44ae426082','hex');
const photo=()=>{const f=new FormData();f.append('file',new File([png],'p.png',{type:'image/png'}));return f};
const journal=async c=>(await (await api('/api/shared',{cookie:c})).json());
const write=async(c,title)=>{const cur=await journal(c);const e={id:'e-'+title,title,body:'',date:'2026-01-01',time:'',location:'',photos:[],author:'x',created:new Date().toISOString()};
 const r=await api('/api/shared',{cookie:c,method:'PUT',body:{shared:{...cur.shared,journal:[...cur.shared.journal,e]},revision:cur.revision}});assert.equal(r.status,200)};
const titles=async c=>(await journal(c)).shared.journal.map(e=>e.title);

try{
 await start();
 const alex=await signUp('Alex','alex@example.test'),sam=await signUp('Sam','sam@example.test'),kim=await signUp('Kim','kim@example.test');
 // Solo: everyone has their own journal.
 await write(alex,'Alex solo');await write(sam,'Sam solo');
 assert.deepEqual(await titles(alex),['Alex solo']);assert.deepEqual(await titles(sam),['Sam solo'],'solo journals are separate');
 const alexPhoto=await (await api('/api/files?shared=1',{cookie:alex,method:'POST',body:photo()})).json();
 assert.equal((await api(`/api/files?id=${alexPhoto.id}&inline=1`,{cookie:sam})).status,404,'another person’s shared photo is private until you pair');
 assert.deepEqual((await (await api('/api/users',{cookie:kim})).json()).users.map(u=>u.displayName),['Kim'],'you only see yourself');

 // Alex invites Sam: they get a new, shared journal. Both keep their own, which the other never sees.
 const {code}=await (await api('/api/pair/invite',{cookie:alex,method:'POST'})).json();
 assert.equal((await api('/api/pair/accept',{cookie:sam,method:'POST',body:{code}})).status,200);
 assert.deepEqual(await titles(sam),[],'a new shared journal starts empty');
 await write(sam,'Together');assert.deepEqual(await titles(alex),['Together'],'both see the shared journal');
 const mine=async c=>(await (await api('/api/shared?space=mine',{cookie:c})).json()).shared.journal.map(e=>e.title);
 assert.deepEqual(await mine(alex),['Alex solo']);assert.deepEqual(await mine(sam),['Sam solo'],'your own journal is kept');
 {const cur=await (await api('/api/shared?space=mine',{cookie:sam})).json();const e={id:'secret',title:'Sam secret',body:'',date:'2026-01-01',time:'',location:'',photos:[],author:'x',created:new Date().toISOString()};
  assert.equal((await api('/api/shared?space=mine',{cookie:sam,method:'PUT',body:{shared:{...cur.shared,journal:[...cur.shared.journal,e]},revision:cur.revision}})).status,200)}
 assert.deepEqual(await mine(sam),['Sam solo','Sam secret']);assert.ok(!(await titles(alex)).includes('Sam secret'),'the partner never sees your own journal');
 assert.equal((await api(`/api/files?id=${alexPhoto.id}&inline=1`,{cookie:sam})).status,404,'photos in your own journal stay yours after pairing');
 const ours=await (await api('/api/files?shared=1',{cookie:sam,method:'POST',body:photo()})).json();
 const samPrivate=await (await api('/api/files?shared=1&space=mine',{cookie:sam,method:'POST',body:photo()})).json();
 assert.equal((await api(`/api/files?id=${ours.id}&inline=1`,{cookie:alex})).status,200,'photos in the shared journal are visible to the partner');
 assert.equal((await api(`/api/files?id=${samPrivate.id}&inline=1`,{cookie:alex})).status,404,'photos in your own journal are not');
 assert.deepEqual((await (await api('/api/users',{cookie:sam})).json()).users.map(u=>u.displayName).sort(),['Alex','Sam']);

 // Kim sees none of it.
 assert.deepEqual(await titles(kim),[]);assert.equal((await api('/api/shared?space=ours',{cookie:kim})).status,404,'no shared journal on your own');
 for(const id of [alexPhoto.id,ours.id,samPrivate.id])assert.equal((await api(`/api/files?id=${id}&inline=1`,{cookie:kim})).status,404);
 assert.deepEqual((await (await api('/api/files/geo',{cookie:kim})).json()).photos,[]);
 assert.deepEqual((await (await api('/api/users',{cookie:kim})).json()).users.map(u=>u.displayName),['Kim']);
 await api('/api/moods',{cookie:alex,method:'POST',body:{mood:'great',note:'hi',shared:true}});
 assert.equal((await (await api('/api/moods',{cookie:sam})).json()).partners[0].latest.note,'hi','partner sees shared moods');
 assert.deepEqual((await (await api('/api/moods',{cookie:kim})).json()).partners,[],'strangers never do');
 assert.notEqual((await api('/api/vault/move',{cookie:kim,method:'POST',body:{id:ours.id}})).status,200,'nobody outside can take the photo');
 const kimCode=(await (await api('/api/pair/invite',{cookie:kim,method:'POST'})).json()).code;
 assert.equal((await api('/api/pair/accept',{cookie:alex,method:'POST',body:{code:kimCode}})).status,409,'no third person in a couple');
 assert.equal((await api('/api/pair/invite',{cookie:alex,method:'POST'})).status,409);

 // Sam leaves: the shared journal is hidden from both (not deleted); own journals are untouched.
 assert.equal((await api('/api/pair/leave',{cookie:sam,method:'POST'})).status,200);
 assert.deepEqual(await titles(sam),['Sam solo','Sam secret']);assert.deepEqual(await titles(alex),['Alex solo']);
 assert.equal((await (await api('/api/pair',{cookie:alex})).json()).partner,null);
 assert.equal((await api(`/api/files?id=${ours.id}&inline=1`,{cookie:alex})).status,404,'after leaving, the shared photos are hidden');
 assert.equal((await api(`/api/files?id=${ours.id}&inline=1`,{cookie:sam})).status,200,'but your own uploads are still yours');
 // Pairing again brings the same shared journal back.
 const again=(await (await api('/api/pair/invite',{cookie:sam,method:'POST'})).json()).code;
 assert.equal((await api('/api/pair/accept',{cookie:alex,method:'POST',body:{code:again}})).status,200);
 assert.deepEqual(await titles(alex),['Together'],'re-pairing brings the shared journal back');
 assert.equal((await api('/api/pair/leave',{cookie:alex,method:'POST'})).status,200);

 // Lock my journal: the same PIN as hidden photos. While locked, the server refuses the journal and its photos.
 {const kimPhoto=await (await api('/api/files?shared=1&space=mine',{cookie:kim,method:'POST',body:photo()})).json(),src=c=>api('/api/files?id='+kimPhoto.id+'&inline=1',{cookie:c});
  assert.equal((await api('/api/vault/journal-lock',{cookie:kim,method:'PUT',body:{enabled:true,pin:'12'}})).status,400);
  assert.equal((await api('/api/vault/journal-lock',{cookie:kim,method:'PUT',body:{enabled:true,pin:'4827'}})).status,200,'turning it on sets the PIN when there is none');
  const locked=await api('/api/shared',{cookie:kim});assert.equal(locked.status,403);assert.equal((await locked.json()).locked,true);
  assert.equal((await src(kim)).status,404,'its photos too');
  assert.equal((await api('/api/vault/unlock',{cookie:kim,method:'POST',body:{pin:'0000'}})).status,401);
  const u=await api('/api/vault/unlock',{cookie:kim,method:'POST',body:{pin:'4827'}}),open=kim+'; '+((u.headers.get('set-cookie')||'').match(/max_vault=[a-f0-9]+/)||[''])[0];
  assert.equal((await api('/api/shared',{cookie:open})).status,200,'the PIN opens it');
  assert.equal((await src(open)).status,200);
  assert.equal((await api('/api/vault/journal-lock',{cookie:kim,method:'PUT',body:{enabled:false,pin:'1111'}})).status,401,'turning it off needs the PIN');
  assert.equal((await api('/api/vault/journal-lock',{cookie:kim,method:'PUT',body:{enabled:false,pin:'4827'}})).status,200);
  assert.equal((await api('/api/shared',{cookie:kim})).status,200,'unlocked for good once it is off');}
 // A partner's lock covers only their own journal, never the shared one.
 {const c=(await (await api('/api/pair/invite',{cookie:sam,method:'POST'})).json()).code;assert.equal((await api('/api/pair/accept',{cookie:alex,method:'POST',body:{code:c}})).status,200);
  assert.equal((await api('/api/vault/journal-lock',{cookie:sam,method:'PUT',body:{enabled:true,pin:'5555'}})).status,200);
  assert.equal((await api('/api/shared?space=mine',{cookie:sam})).status,403);assert.equal((await api('/api/shared',{cookie:sam})).status,200,'the shared journal stays open');
  assert.equal((await api('/api/vault/journal-lock',{cookie:sam,method:'PUT',body:{enabled:false,pin:'5555'}})).status,200);
  assert.equal((await api('/api/pair/leave',{cookie:alex,method:'POST'})).status,200);}
 // Entering codes is rate limited.
 for(let i=0;i<10;i++)await api('/api/pair/preview',{cookie:kim,method:'POST',body:{code:'AAAA-AAAA'}});
 assert.equal((await api('/api/pair/preview',{cookie:kim,method:'POST',body:{code:'AAAA-AAAA'}})).status,429);

 // Invite-only server: signing up needs a code, and using one pairs you once the email is confirmed.
 await stop();await start({MAX_SIGNUP:'invite'});
 assert.equal((await api('/api/signup',{method:'POST',body:{name:'Dee',email:'dee@example.test',password:'dee-pass-1234'}})).status,403);
 assert.equal((await api('/api/signup',{method:'POST',body:{name:'Dee',email:'dee@example.test',password:'dee-pass-1234',invite:'BAD0-CODE'}})).status,403);
 const deeCode=(await (await api('/api/pair/invite',{cookie:sam,method:'POST'})).json()).code;
 const dee=await signUp('Dee','dee@example.test',{invite:deeCode});
 assert.equal((await (await api('/api/pair',{cookie:dee})).json()).partner.displayName,'Sam','signing up with a code pairs you');
 assert.deepEqual(await titles(dee),[],'a new shared journal');

 // Upgrade: an old server with one journal for everyone ('main') keeps its two accounts together as partners.
 await stop();
 const old=mkdtempSync(resolve('.selfhost-test-'));
 {const d=new DatabaseSync(join(old,'max.sqlite'));
  d.exec("CREATE TABLE users (username TEXT PRIMARY KEY, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, avatar TEXT); CREATE TABLE shared (id TEXT PRIMARY KEY, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0); CREATE TABLE files (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, shared INTEGER NOT NULL DEFAULT 0);");
  d.prepare("INSERT INTO users VALUES('one','One','x',NULL),('two','Two','x',NULL),('three','Three','x',NULL)").run();
  d.prepare("INSERT INTO shared VALUES('main',?,5)").run(JSON.stringify({journal:[],moments:[{id:'birthday-two',title:'Two’s birthday',icon:'🎂',date:'2001-05-06',time:'',color:'pink',repeat:'yearly'}]}));d.prepare("INSERT INTO files VALUES('f1','one','a.png',1,1)").run();d.close()}
 await start({MAX_DATA_DIR:old});await stop();
 {const d=new DatabaseSync(join(old,'max.sqlite'));const rows=Object.fromEntries(d.prepare('SELECT username,space_id FROM users').all().map(r=>[r.username,r.space_id]));
  const couples=Object.fromEntries(d.prepare('SELECT username,couple_id FROM users').all().map(r=>[r.username,r.couple_id]));
  assert.deepEqual([couples.one,couples.two,couples.three],['main','main',null],'the old journal becomes the two oldest accounts’ shared journal');
  assert.deepEqual([rows.one,rows.two,rows.three],[null,null,null],'everyone gets their own journal on first use');
  assert.equal(d.prepare("SELECT space_id FROM files WHERE id='f1'").get().space_id,'main');
  assert.equal(d.prepare("SELECT role FROM users WHERE username='one'").get().role,'admin');
  assert.equal(d.prepare("SELECT birthday FROM users WHERE username='two'").get().birthday,'2001-05-06','birthday countdowns move onto the account');d.close()}
 rmSync(old,{recursive:true,force:true});
 await start();
 console.log('PASS: own journal per person (kept private after pairing), pairing by invite code adds a shared journal, photos go to the journal they’re for, strangers see nothing (journals, photos, map, names, moods), no third partner, leaving hides the shared journal, re-pairing brings it back, journal PIN lock, code rate limit, invite-only sign-up pairs on confirm, upgrade from one shared journal.');
}finally{try{await stop()}catch{}rmSync(dataDir,{recursive:true,force:true})}
