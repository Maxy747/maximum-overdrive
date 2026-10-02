import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:http';
import {newBody,progress,weekly,monthly,towardGoal} from '../lib/body.ts';
import {dayStatus,nextOccurrence,upcoming,weekOf,weekCount,weeklyRecap,recapNote,easyNeedOf,easyTargetOf} from '../lib/tracker.ts';
import {initialState,dayFor,dateKey,dayKey,msUntilDayEnds,shiftDay,fillHistory,complete,fraction,streak,perfectStreak,applyFreezes,freezeBalance,perfectRun,bestStreak,dueReminders,dueNudges,inQuietHours,dailyNudgeOf} from '../lib/tracker.ts';

const origin='http://localhost:4318',dataDir=mkdtempSync(resolve('.selfhost-test-'));
const env={...process.env,PORT:'4318',MAX_DATA_DIR:dataDir,MAX_DEV_MODE:'0',MAX_ALLOWED_LOGIN:'owner@example.test,partner@example.test',MAX_ORIGIN:origin,MAX_BASE_PATH:process.env.MAX_BASE_PATH||'',MAX_COACH_URL:'http://127.0.0.1:4319/v1',MAX_COACH_API_KEY:'test-key',MAX_COACH_MODEL_NAME:'test-model'};
// A stand-in for the local model (OpenAI-style streaming), recording what the coach sent it.
// Logging requests (response_format) get a JSON pick from the schema's own labels, including one the message never mentions.
let coachSeen=null,extractSeen=null,coachAuth=null;const fakeAssistant=createServer((req,res)=>{let raw='';req.on('data',d=>raw+=d);req.on('end',()=>{const body=JSON.parse(raw);coachAuth=req.headers.authorization;
 if(body.response_format){extractSeen=body;const props=body.response_format.json_schema.schema.properties,labels=props.did.items.enum,out={did:labels.filter(l=>/^(Push-ups|Breakfast|Dinner)$/.test(l))};if(props.exercise)out.exercise=[{name:'Push-ups',reps:15,sets:2}];for(const k of Object.keys(props))if(!(k in out))out[k]=0;res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(out)}}]}))}
 coachSeen=body;res.writeHead(200,{'Content-Type':'text/event-stream'});for(const piece of /name test/.test(body.messages.at(-1).content)?['Great job M.A','.X. keep going']:['Nice work ','today.'])res.write('data: '+JSON.stringify({choices:[{delta:{content:piece}}]})+'\n\n');res.end('data: [DONE]\n\n')})});
await new Promise(ok=>fakeAssistant.listen(4319,'127.0.0.1',ok));
const PASSWORDS={max:'test-pass-max-1',sam:'test-pass-sam-1'};
let child;

function run(args,input){return new Promise(done=>{const p=spawn(process.execPath,['selfhost-dist/server.mjs',...args],{env,stdio:['pipe','pipe','pipe']});let out='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>out+=d);p.on('exit',code=>done({code,out}));p.stdin.end(input)})}
async function start(){child=spawn(process.execPath,['selfhost-dist/server.mjs'],{env,stdio:['ignore','pipe','pipe']});await new Promise((ok,fail)=>{child.stdout.on('data',v=>{if(v.toString().includes('MAX listening'))ok()});child.once('error',fail);child.once('exit',code=>fail(Error('Server exited: '+code)))})}
async function stop(){const exited=once(child,'exit');child.kill();await exited}
const tailnet={'Tailscale-User-Login':'owner@example.test'};
function api(path,{cookie,method='GET',body,headers={}}={}){
 const h={...tailnet,...headers};if(cookie)h.Cookie=cookie;if(method!=='GET')h.Origin??=origin;
 if(body!==undefined&&!(body instanceof FormData)){h['Content-Type']='application/json';body=JSON.stringify(body)}
 return fetch(origin+env.MAX_BASE_PATH+path,{method,headers:h,body});
}
async function login(username,password,remember=true){const r=await api('/api/login',{method:'POST',body:{username,password,remember}});return {r,cookie:(r.headers.get('set-cookie')||'').split(';')[0],setCookie:r.headers.get('set-cookie')||''}}
const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5b0f5a10000000049454e44ae426082','hex');
const form=(name,bytes,type)=>{const f=new FormData();f.append('file',new File([bytes],name,{type}));return f};

try{
 // accounts are created from the command line; passwords are hashed, never stored as given
 assert.equal((await run(['set-password','max','Max'],`${PASSWORDS.max}\n${PASSWORDS.max}\n`)).code,0);
 assert.equal((await run(['set-password','sam','Sam'],`${PASSWORDS.sam}\n${PASSWORDS.sam}\n`)).code,0);
 assert.equal((await run(['set-password','mismatch'],'one-password\nanother-one\n')).code,1);
 assert.equal((await run(['set-password','short'],'short\nshort\n')).code,1);
 assert.equal((await run(['set-passwords','max','sam'],'shared-pass-1\nshared-pass-1\n')).code,0,'one password for both');
 assert.equal((await run(['set-password','max'],`${PASSWORDS.max}\n${PASSWORDS.max}\n`)).code,0);assert.equal((await run(['set-password','sam'],`${PASSWORDS.sam}\n${PASSWORDS.sam}\n`)).code,0);
 await start();
 const page=await (await api('/')).text();
 assert.ok(page.includes(`<base href="${env.MAX_BASE_PATH}/">`),'HTML anchors assets even when the proxy strips the mount path');

 // network gate + login required
 assert.equal((await fetch(origin+'/api/accounts')).status,401,'no Tailscale identity');
 assert.equal((await api('/api/state',{headers:{'Tailscale-User-Login':'stranger@example.test'}})).status,401);
 assert.equal((await api('/api/state')).status,401,'no session');
 assert.deepEqual((await (await api('/api/accounts')).json()).accounts.map(a=>a.username),['max','sam']);
 assert.equal((await login('max','wrong-password')).r.status,401);
 assert.equal((await api('/api/login',{method:'POST',body:{username:'max',password:PASSWORDS.max},headers:{Origin:'https://untrusted.test'}})).status,403);
 const max=await login('max',PASSWORDS.max,true),sam=await login('sam',PASSWORDS.sam,false);
 assert.equal(max.r.status,200);assert.equal(sam.r.status,200);
 assert.match(max.setCookie,/HttpOnly/);assert.match(max.setCookie,/SameSite=Strict/);assert.match(max.setCookie,/Max-Age=15552000/,'stay logged in');
 assert.doesNotMatch(sam.setCookie,/Max-Age/,'session cookie when not remembered');

 // Partners: nobody is paired until one invites and the other enters the code.
 assert.equal((await (await api('/api/pair',{cookie:max.cookie})).json()).partner,null,'solo until paired');
 assert.deepEqual((await (await api('/api/users',{cookie:max.cookie})).json()).users.map(u=>u.username),['max'],'only you before pairing');
 const inv=await (await api('/api/pair/invite',{cookie:max.cookie,method:'POST'})).json();assert.match(inv.code,/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
 assert.equal((await api('/api/pair/accept',{cookie:max.cookie,method:'POST',body:{code:inv.code}})).status,400,'not your own code');
 assert.equal((await api('/api/pair/accept',{cookie:sam.cookie,method:'POST',body:{code:'ZZZZ-ZZZZ'}})).status,400);
 assert.equal((await (await api('/api/pair/preview',{cookie:sam.cookie,method:'POST',body:{code:inv.code.toLowerCase().replace('-',' ')}})).json()).from.displayName,'Max','codes ignore case and spacing');
 assert.equal((await api('/api/pair/accept',{cookie:sam.cookie,method:'POST',body:{code:inv.code}})).status,200);
 assert.equal((await (await api('/api/pair',{cookie:max.cookie})).json()).partner.username,'sam');
 assert.equal((await api('/api/pair/accept',{cookie:sam.cookie,method:'POST',body:{code:inv.code}})).status,400,'a code works once');
 assert.equal((await api('/api/pair/invite',{cookie:max.cookie,method:'POST'})).status,409,'no invites while paired');
 assert.equal((await (await api('/api/me',{cookie:max.cookie})).json()).user.displayName,'Max');

 // per-account trackers
 const initial=await (await api('/api/state',{cookie:max.cookie})).json();assert.equal(initial.revision,0);
 const s=initial.state,k=dayKey();s.days[k]=dayFor(s,k);s.days[k].entries[0].checks=[true,true,true];s.days[k].entries[0].exerciseLogs={'0':{reps:12,sets:3}};s.days[k].entries[0].note='Completed the workout and logged the details.';
 const update={state:s,revision:0};
 assert.equal((await api('/api/state',{cookie:max.cookie,method:'PUT',body:update,headers:{Origin:'https://untrusted.test'}})).status,403);
 assert.equal((await api('/api/state',{cookie:max.cookie,method:'PUT',body:update})).status,200);
 assert.equal((await api('/api/state',{cookie:max.cookie,method:'PUT',body:update})).status,409);
 assert.equal((await api('/api/state',{cookie:max.cookie,method:'POST',body:{invalid:true}})).status,400);
 const legacy={...initialState(),projects:[{id:'p',name:'Old',tasks:[],notes:'',links:[],files:[],activity:[]}],captures:[]};
 const restored=await api('/api/state',{cookie:max.cookie,method:'POST',body:legacy});assert.equal(restored.status,200,'old backups still import');assert.equal((await restored.json()).projects,undefined);
 const samState=await (await api('/api/state',{cookie:sam.cookie})).json();
 assert.equal(samState.revision,0,'accounts do not share trackers');assert.equal(samState.state.settings.name,'Sam');

 const diary={id:'diary-test',title:'Imported diary',body:'A long note. '.repeat(5000),date:k,author:'max',created:new Date().toISOString(),updated:new Date().toISOString()};
 // shared journal: both read it, stale writes are rejected
 const entry={id:'e1',title:'Beach day',body:'We walked for hours.',date:k,time:'16:35',location:'Lisbon',photos:[],author:'max',created:new Date().toISOString()};
 const moment={id:'m1',title:'First trip together',icon:'💍',date:'2025-04-11',time:'16:35',color:'purple'};
 assert.equal((await api('/api/shared',{cookie:max.cookie,method:'PUT',body:{shared:{diary:[diary],journal:[entry],moments:[moment],together:'2025-01-05',photoDump:[{id:'p1',name:'dump.jpg',size:10,sensitive:true}]},revision:0}})).status,200);
 const seen=await (await api('/api/shared',{cookie:sam.cookie})).json();assert.equal(seen.revision,1);assert.equal(seen.shared.journal[0].title,'Beach day');assert.equal(seen.shared.photoDump[0].sensitive,true);assert.deepEqual(seen.shared.diary,[diary],'long diary text is preserved and readable by partner');
 assert.equal((await api('/api/shared',{cookie:sam.cookie,method:'PUT',body:{shared:{journal:[],moments:[]},revision:0}})).status,409);
 assert.equal((await api('/api/shared',{cookie:sam.cookie,method:'PUT',body:{shared:{journal:[{...entry,photos:'bad'}],moments:[]},revision:1}})).status,400);
 const comment={id:'c1',author:'sam',text:'I love this day',created:new Date().toISOString()};
 assert.equal((await api('/api/shared',{cookie:sam.cookie,method:'PUT',body:{shared:{...seen.shared,journal:[{...entry,comments:[{...comment,text:''}]}]},revision:1}})).status,400,'empty comment rejected');
 assert.equal((await api('/api/shared',{cookie:sam.cookie,method:'PUT',body:{shared:{...seen.shared,diary:[{...diary,title:'Edited by partner'}],journal:[{...entry,comments:[comment]}]},revision:1}})).status,200);
 assert.equal((await (await api('/api/shared',{cookie:max.cookie})).json()).shared.journal[0].comments[0].text,'I love this day');

 assert.equal((await (await api('/api/shared',{cookie:max.cookie})).json()).shared.diary[0].title,'Edited by partner','partner diary edits persist');
 // files: private by default, shared when uploaded for the journal, images only inline
 const privateFile=await (await api('/api/files',{cookie:max.cookie,method:'POST',body:form('test.txt','MAX attachment test','text/plain')})).json();
 assert.equal(await (await api('/api/files?id='+privateFile.id,{cookie:max.cookie})).text(),'MAX attachment test');
 assert.equal((await api('/api/files?id='+privateFile.id+'&inline=1',{cookie:max.cookie})).headers.get('content-type'),'application/octet-stream');
 assert.equal((await api('/api/files?id='+privateFile.id,{cookie:sam.cookie})).status,404,'other account cannot read private files');
 const sharedPhoto=await (await api('/api/files?shared=1',{cookie:max.cookie,method:'POST',body:form('dot.png',png,'image/png')})).json();
 const inline=await api('/api/files?id='+sharedPhoto.id+'&inline=1',{cookie:sam.cookie});
 assert.equal(inline.status,200);assert.equal(inline.headers.get('content-type'),'image/png');assert.equal(inline.headers.get('content-disposition'),'inline');

 // profile photos (also settable from the command line)
 writeFileSync(join(dataDir,'cli.png'),png);writeFileSync(join(dataDir,'bad.png'),'not an image');
 assert.equal((await run(['set-avatar','max',join(dataDir,'bad.png')])).code,1);
 assert.equal((await run(['set-avatar','max',join(dataDir,'cli.png')])).code,0);
 assert.ok((await (await api('/api/me',{cookie:max.cookie})).json()).user.avatar,'cli avatar set');
 assert.equal((await api('/api/profile/avatar',{cookie:sam.cookie,method:'POST',body:form('fake.png','not an image','image/png')})).status,400);
 const avatar=await (await api('/api/profile/avatar',{cookie:sam.cookie,method:'POST',body:form('me.png',png,'image/png')})).json();
 const users=(await (await api('/api/users',{cookie:max.cookie})).json()).users;
 assert.equal(users.find(u=>u.username==='sam').avatar,avatar.user.avatar);
 assert.equal((await api('/api/files?id='+avatar.user.avatar+'&inline=1',{cookie:max.cookie})).headers.get('content-type'),'image/png');
 const accountList=(await (await api('/api/accounts')).json()).accounts;assert.ok(accountList.find(a=>a.username==='sam').avatarVersion,'login screen knows there is a photo');
 assert.equal((await api('/api/accounts/avatar?u=sam')).headers.get('content-type'),'image/png','profile photo visible on the login screen');
 assert.equal((await fetch(origin+'/api/accounts/avatar?u=sam')).status,401,'still behind the Tailscale gate');
 assert.equal((await api('/api/accounts/avatar?u=nobody')).status,404);

 // daily couple prompt: answer on your own, partner's answer unlocks after yours, only today is writable
 const daily=await (await api('/api/daily',{cookie:max.cookie})).json();
 assert.equal(daily.date,daily.today);assert.ok(daily.question&&daily.task);
 assert.equal((await api('/api/daily',{cookie:max.cookie,method:'PUT',body:{date:daily.today,answer:'Coffee by the sea',taskDone:true}})).status,200);
 const lockedView=(await (await api('/api/daily',{cookie:sam.cookie})).json()).partners.find(p=>p.username==='max');
 assert.equal(lockedView.answered,true);assert.equal(lockedView.answer,null,'hidden until sam answers');assert.equal(lockedView.taskDone,true);
 assert.equal((await api('/api/daily',{cookie:sam.cookie,method:'PUT',body:{date:daily.today,answer:42}})).status,400);
 assert.equal((await api('/api/daily',{cookie:sam.cookie,method:'PUT',body:{date:daily.today,answer:'Movie night'}})).status,200);
 assert.equal((await (await api('/api/daily',{cookie:sam.cookie})).json()).partners.find(p=>p.username==='max').answer,'Coffee by the sea');
 assert.equal((await (await api('/api/daily',{cookie:max.cookie})).json()).partners.find(p=>p.username==='sam').answer,'Movie night');
 assert.equal((await api('/api/daily',{cookie:sam.cookie,method:'PUT',body:{date:shiftDay(daily.today,-1),answer:'too late'}})).status,403);
 assert.equal((await api('/api/daily?date='+shiftDay(daily.today,1),{cookie:sam.cookie})).status,400);
 assert.equal((await (await api('/api/daily?date='+shiftDay(daily.today,-1),{cookie:sam.cookie})).json()).me.answer,'');
 const archiveDb=new DatabaseSync(join(dataDir,'max.sqlite'));archiveDb.prepare("INSERT INTO daily_archive(username,date,kind,text,created,source) VALUES('max','2025-03-03','answer','Mini pancakes','2025-03-03T11:57:58Z','Couple Joy')").run();archiveDb.close();
 const archived=await (await api('/api/daily?date=2025-03-03',{cookie:sam.cookie})).json();assert.equal(archived.archive.length,1);assert.equal(archived.archive[0].text,'Mini pancakes');assert.equal(archived.archive[0].displayName,'Max');

 // hidden photos vault: per person, PIN-locked, enforced on the server (not just hidden in the UI)
 const vaultCookie=r=>((r.headers.get('set-cookie')||'').match(/max_vault=[a-f0-9]+/)||[''])[0];
 assert.deepEqual(await (await api('/api/vault/status',{cookie:max.cookie})).json(),{hasPin:false,unlocked:false,journalLock:false});
 assert.equal((await api('/api/vault',{cookie:max.cookie})).status,403,'locked before any PIN');
 assert.equal((await api('/api/vault/pin',{cookie:max.cookie,method:'POST',body:{pin:'12ab'}})).status,400);
 assert.equal((await api('/api/vault/pin',{cookie:max.cookie,method:'POST',body:{pin:'482913'}})).status,200);
 assert.equal((await api('/api/vault/pin',{cookie:max.cookie,method:'POST',body:{pin:'000000',currentPin:'111111'}})).status,401,'changing the PIN needs the current one');
 // Everyone has their own hidden photos with their own PIN: Sam's starts empty and locked.
 assert.deepEqual(await (await api('/api/vault/status',{cookie:sam.cookie})).json(),{hasPin:false,unlocked:false,journalLock:false},'a separate vault per person');
 assert.equal((await api('/api/vault/unlock',{cookie:sam.cookie,method:'POST',body:{pin:'482913'}})).status,409,'Max’s PIN doesn’t open it');
 assert.equal((await api('/api/vault/unlock',{cookie:max.cookie,method:'POST',body:{pin:'111111'}})).status,401);
 const unlockMax=await api('/api/vault/unlock',{cookie:max.cookie,method:'POST',body:{pin:'482913'}});assert.equal(unlockMax.status,200);
 const maxVault=`${max.cookie}; ${vaultCookie(unlockMax)}`;assert.match(unlockMax.headers.get('set-cookie'),/HttpOnly/);
 const hidden=await (await api('/api/vault/files',{cookie:maxVault,method:'POST',body:form('secret.png',png,'image/png')})).json();
 assert.equal((await api('/api/vault/files',{cookie:maxVault,method:'POST',body:form('fake.png','nope','image/png')})).status,400,'only real images');
 assert.equal((await api('/api/vault/file?id='+hidden.id,{cookie:maxVault})).headers.get('content-type'),'image/png');
 assert.deepEqual((await (await api('/api/vault',{cookie:maxVault})).json()).items.map(i=>i.id),[hidden.id]);
 assert.equal((await api('/api/vault/file?id='+hidden.id,{cookie:max.cookie})).status,403,'no vault cookie, no photo');
 assert.equal((await api('/api/files?id='+hidden.id+'&inline=1',{cookie:max.cookie})).status,404,'vault photos never come through the normal file link');
 assert.equal((await api('/api/files?id='+hidden.id+'&inline=1',{cookie:sam.cookie})).status,404,'not for the partner by id');
 assert.equal((await api('/api/vault/file?id='+hidden.id,{cookie:`${sam.cookie}; ${vaultCookie(unlockMax)}`})).status,403,"Max's unlock cookie does nothing for the partner (her own vault stays locked)");
 for(const who of [max,sam])assert.ok(!(await (await api('/api/files/geo',{cookie:who.cookie})).json()).photos.some(p=>p.id===hidden.id),'hidden photos never reach the shared map');
 assert.equal((await api('/api/vault/files?id='+hidden.id,{cookie:maxVault,method:'DELETE'})).status,200);
 assert.equal((await (await api('/api/vault',{cookie:maxVault})).json()).items.length,0);
 assert.equal((await api('/api/vault/lock',{cookie:maxVault,method:'POST'})).status,200);
 assert.equal((await api('/api/vault',{cookie:maxVault})).status,403,'locked again');
 for(let i=0;i<5;i++)await api('/api/vault/unlock',{cookie:max.cookie,method:'POST',body:{pin:'999999'}});
 assert.equal((await api('/api/vault/unlock',{cookie:max.cookie,method:'POST',body:{pin:'482913'}})).status,429,'five wrong PINs lock it for a while');

 // memory map: GPS read from photo EXIF on upload; only photos you may open are listed
 const gpsJpeg=(lat,lng)=>{const t=Buffer.alloc(128);t.write('II',0,'latin1');t.writeUInt16LE(42,2);t.writeUInt32LE(8,4);t.writeUInt16LE(1,8);t.writeUInt16LE(0x8825,10);t.writeUInt16LE(4,12);t.writeUInt32LE(1,14);t.writeUInt32LE(26,18);t.writeUInt32LE(0,22);
  t.writeUInt16LE(4,26);const ent=(i,tag,type,count,val)=>{const o=28+i*12;t.writeUInt16LE(tag,o);t.writeUInt16LE(type,o+2);t.writeUInt32LE(count,o+4);if(typeof val==='string')t.write(val,o+8,'latin1');else t.writeUInt32LE(val,o+8)};
  ent(0,1,2,2,lat<0?'S':'N');ent(1,2,5,3,80);ent(2,3,2,2,lng<0?'W':'E');ent(3,4,5,3,104);t.writeUInt32LE(0,76);
  const dms=(v,o)=>{v=Math.abs(v);const d=Math.floor(v),m=Math.floor((v-d)*60),sec=Math.round(((v-d)*60-m)*60*1000);[[d,1],[m,1],[sec,1000]].forEach(([n,den],i)=>{t.writeUInt32LE(n,o+i*8);t.writeUInt32LE(den,o+i*8+4)})};dms(lat,80);dms(lng,104);
  const app1=Buffer.concat([Buffer.from([0xff,0xe1]),Buffer.from([0,0]),Buffer.from('Exif\0\0','latin1'),t]);app1.writeUInt16BE(app1.length-2,2);return Buffer.concat([Buffer.from([0xff,0xd8]),app1,Buffer.from([0xff,0xd9])])};
 const geoUp=await (await api('/api/files?shared=1',{cookie:max.cookie,method:'POST',body:form('lisbon.jpg',gpsJpeg(38.7223,-9.1393),'image/jpeg')})).json();
 // Uploads also report when a photo was taken (EXIF DateTimeOriginal), so a new memory can take its date
 {const t=Buffer.alloc(64);t.write('II',0,'latin1');t.writeUInt16LE(42,2);t.writeUInt32LE(8,4);t.writeUInt16LE(1,8);t.writeUInt16LE(0x8769,10);t.writeUInt16LE(4,12);t.writeUInt32LE(1,14);t.writeUInt32LE(26,18);
  t.writeUInt16LE(1,26);t.writeUInt16LE(0x9003,28);t.writeUInt16LE(2,30);t.writeUInt32LE(20,32);t.writeUInt32LE(44,36);t.write('2025:04:27 02:20:00\0',44,'latin1');
  const jpg=Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe1]),Buffer.from([0,t.length+8]),Buffer.from('Exif\0\0','latin1'),t,Buffer.from([0xff,0xd9])]);
  const up=await (await api('/api/files?shared=1',{cookie:max.cookie,method:'POST',body:form('dated.jpg',jpg,'image/jpeg')})).json();assert.deepEqual(up.taken,{date:'2025-04-27',time:'02:20'});}
 assert.ok(geoUp.geo&&Math.abs(geoUp.geo.lat-38.7223)<1e-3&&Math.abs(geoUp.geo.lng+9.1393)<1e-3,'upload reports the GPS from EXIF');
 const privUp=await (await api('/api/files',{cookie:max.cookie,method:'POST',body:form('mine.jpg',gpsJpeg(12.97,77.59),'image/jpeg')})).json();
 const samGeo=(await (await api('/api/files/geo',{cookie:sam.cookie})).json()).photos.map(p=>p.id);
 assert.ok(samGeo.includes(geoUp.id),'shared photos show on both maps');assert.ok(!samGeo.includes(privUp.id),"one person's unshared photos stay off the other's map");
 assert.ok((await (await api('/api/files/geo',{cookie:max.cookie})).json()).photos.some(p=>p.id===privUp.id));
 assert.equal((await api('/api/files/geo')).status,401);
 // moving a shared photo into Max's hidden photos (either partner can hide one from the shared journal)
 assert.equal((await api('/api/vault/move',{cookie:max.cookie,method:'POST',body:{id:'nope'}})).status,400);
 assert.equal((await api('/api/vault/move',{cookie:max.cookie,method:'POST',body:{id:geoUp.id}})).status,200);
 for(const who of [max,sam]){assert.equal((await api('/api/files?id='+geoUp.id+'&inline=1',{cookie:who.cookie})).status,404,'hidden photo leaves the shared link');assert.ok(!(await (await api('/api/files/geo',{cookie:who.cookie})).json()).photos.some(p=>p.id===geoUp.id),'and the map')}
 assert.equal((await api('/api/vault/move',{cookie:max.cookie,method:'POST',body:{id:geoUp.id}})).status,404,'already hidden');

 // M.A.X. coach: for everyone when the server has a model; streams the reply and knows today's progress
 assert.equal((await api('/api/coach/health',{cookie:sam.cookie})).status,200,'the partner has the coach too');
 assert.deepEqual(await (await api('/api/features',{cookie:sam.cookie})).json(),{vault:true,coach:true,coachOn:true});
 assert.deepEqual(await (await api('/api/coach/health',{cookie:max.cookie})).json(),{ok:true,available:true,loaded:true});
 const coach=await api('/api/coach/chat',{cookie:max.cookie,method:'POST',body:{messages:[{role:'user',content:'How am I doing?'}]}});
 assert.equal(coach.status,200);const coachSse=await coach.text();assert.match(coachSse,/"type":"token"/);assert.match(coachSse,/"answer":"Nice work today."/);
 assert.equal(coachAuth,'Bearer test-key','the API key is sent');assert.equal(coachSeen.model,'test-model');assert.ok(!('id_slot' in coachSeen)&&!('cache_prompt' in coachSeen),'no llama.cpp-only fields for other APIs');
 const sys=coachSeen.messages[0];assert.equal(sys.role,'system');assert.match(sys.content,/coach inside/);assert.equal(extractSeen,null,'questions skip the logging pass');assert.match(sys.content,/TODAY:/);assert.match(sys.content,/Main goals: \d+ of \d+ done/);
 assert.equal(coachSeen.messages.at(-1).content,'How am I doing?');
 // A birthday three days out (set on the partner’s account) shows up in what the coach knows, so it reminds them.
 {const soon=shiftDay(dayKey(),3);
  assert.equal((await api('/api/profile/birthday',{cookie:sam.cookie,method:'PUT',body:{birthday:shiftDay(dayKey(),1)+'x'}})).status,400);
  assert.equal((await api('/api/profile/birthday',{cookie:sam.cookie,method:'PUT',body:{birthday:'2999-01-01'}})).status,400,'not in the future');
  const b=await (await api('/api/profile/birthday',{cookie:sam.cookie,method:'PUT',body:{birthday:`2002-${soon.slice(5)}`}})).json();assert.equal(b.user.birthday,`2002-${soon.slice(5)}`);
  assert.equal((await (await api('/api/users',{cookie:max.cookie})).json()).users.find(u=>u.username==='sam').birthday,`2002-${soon.slice(5)}`,'the partner sees it');
  await (await api('/api/coach/chat',{cookie:max.cookie,method:'POST',body:{messages:[{role:'user',content:'Anything coming up?'}]}})).text();
  assert.match(coachSeen.messages[0].content,/Coming up: .*Sam’s \d+\w\w birthday in 3 days/,'the coach knows a birthday is coming');}
 const kick=await api('/api/coach/chat',{cookie:max.cookie,method:'POST',body:{messages:[],kickoff:true}});await kick.text();assert.match(coachSeen.messages.at(-1).content,/Check in on me/,'M.A.X. opens the day');
 // It fills in the tracker: only items the message mentions (Dinner is dropped), reps and sets when said, and the reply knows
 const logged=await (await api('/api/coach/chat',{cookie:max.cookie,method:'POST',body:{messages:[{role:'user',content:'did 15 pushups x2 and had breakfast'}]}})).text();
 assert.equal(extractSeen.id_slot,undefined,'llama.cpp slots only when talking to llama.cpp');assert.equal(extractSeen.model,'test-model');
 const logAct=JSON.parse(logged.split('\n\n').find(l=>l.includes('"type":"actions"')).slice(6));
 assert.deepEqual(logAct.actions.find(a=>a.goal==='body'),{goal:'body',check:[0],logs:{'0':{reps:15,sets:2}}});assert.ok(logAct.summary.some(x=>/Push-ups 15×2/.test(x)));assert.ok(!logAct.summary.join().includes('Dinner'),'unmentioned items are dropped');
 assert.match(coachSeen.messages[0].content,/Just logged from their message: .*Push-ups 15×2/);
 extractSeen=null;await (await api('/api/coach/chat',{cookie:max.cookie,method:'POST',body:{messages:[{role:'user',content:'gonna do squats later'}]}})).text();assert.equal(extractSeen,null,'plans are not logged');
 // The model calling Max "M.A.X." is fixed in the stream and the final answer
 const named=await (await api('/api/coach/chat',{cookie:max.cookie,method:'POST',body:{messages:[{role:'user',content:'name test'}]}})).text();
 assert.ok(!named.includes('M.A'),'no M.A.X. in the reply');assert.match(named,/"answer":"Great job Max keep going"/);
 // Every exchange is saved for History, by day: your message, what was logged, and the reply
 {const hist=await (await api('/api/coach/history',{cookie:max.cookie})).json();assert.ok(hist.days.length>=1);
  const day=await (await api('/api/coach/history?day='+hist.days[0].day,{cookie:max.cookie})).json();
  assert.ok(day.entries.some(e=>e.role==='user'&&/15 pushups/.test(e.content)));assert.ok(day.entries.some(e=>e.role==='logged'&&/Push-ups 15×2/.test(e.content)));assert.ok(day.entries.some(e=>e.role==='assistant'));
  const theirs=await (await api('/api/coach/history',{cookie:sam.cookie})).json();assert.deepEqual(theirs.days,[],'the partner has their own (empty) history, never yours');}
 // Switching the coach off in Profile: no coach for that person; insight and advice come from their own numbers.
 {const cur=await (await api('/api/state',{cookie:sam.cookie})).json();cur.state.settings.coach=false;
  assert.equal((await api('/api/state',{cookie:sam.cookie,method:'PUT',body:{state:cur.state,revision:cur.revision}})).status,200);
  assert.equal((await api('/api/coach/health',{cookie:sam.cookie})).status,404,'coach switched off');
  assert.equal((await (await api('/api/features',{cookie:sam.cookie})).json()).coachOn,false);}
 // Right-now insight when the app opens: from the coach, or from their own numbers with the coach off
 {const i=await (await api('/api/insight',{cookie:max.cookie,method:'POST'})).json();assert.equal(i.source,'coach');assert.ok(i.text);
  const j=await (await api('/api/insight',{cookie:sam.cookie,method:'POST'})).json();assert.equal(j.source,'rules');assert.ok(j.text.length>10);}
 // Daily advice: Coach MAX writes it (pending until ready), the partner gets advice from her own numbers straight away
 {let a=await (await api('/api/advice',{cookie:max.cookie})).json();for(let i=0;i<20&&a.pending;i++){await new Promise(r=>setTimeout(r,100));a=await (await api('/api/advice',{cookie:max.cookie})).json()}
  assert.equal(a.source,'coach');assert.ok(a.text.length>3);
  const p=await (await api('/api/advice',{cookie:sam.cookie})).json();assert.equal(p.source,'rules');assert.ok(p.text.length>20);}
 assert.equal((await api('/api/coach/chat',{cookie:max.cookie,method:'POST',body:{messages:[]}})).status,400);
 assert.equal((await api('/api/coach/chat',{method:'POST',body:{messages:[]}})).status,401,'needs a login');

 // Flexible goals, low-energy days, weekly recap and reminder targets
 {const k=dayKey(),mon=weekOf(k),st=initialState();st.goals=st.goals.map(g=>({...g,created:shiftDay(mon,-14)}));
  const body=st.goals.find(g=>g.id==='body');body.perWeek=3;
  const finishAll=(key,skipBody)=>{const d=dayFor(st,key);for(const e of d.entries){if(skipBody&&e.goal.id==='body')continue;e.checks=e.checks.map(()=>true);e.value=e.goal.target}st.days[key]=d};
  finishAll(mon,true);assert.equal(dayStatus(st,mon),'done','a flexible goal left undone doesn’t spoil the day');
  finishAll(mon,false);assert.equal(weekCount(st,'body',k),1);
  const low=dayFor(st,shiftDay(mon,-7));low.lowEnergy=true;for(const e of low.entries){e.easy=true;if(e.goal.id==='body'){e.checks=[true,false,false,false]}else{e.checks=e.checks.map(()=>true);e.value=e.goal.kind==='duration'?e.goal.target:e.goal.target}}st.days[shiftDay(mon,-7)]=low;
  assert.equal(easyNeedOf(body),2,'body needs half of its 3 on a low day (rounded up)');assert.equal(easyTargetOf(st.goals.find(g=>g.id==='sleep')),7,'sleep stays the same');
  assert.equal(complete(low.entries.find(e=>e.goal.id==='food')),true);assert.equal(dayStatus(st,shiftDay(mon,-7)),'logged','a finished low-energy day keeps the streak but isn’t perfect');
  const r=weeklyRecap(st,shiftDay(mon,-7),shiftDay(mon,-1));assert.equal(r.low,1);assert.equal(r.goals.find(g=>g.id==='body').planned,3,'flexible goals are planned per week');assert.ok(recapNote(r).length>10);
  const due=dueNudges({...st,settings:{...st.settings,reminders:true,quietStart:'00:00',quietEnd:'00:01'},goals:st.goals.map(g=>g.id==='food'?{...g,reminders:[{time:'13:00',item:1}]}:g)},k,'13:00');
  const food=due.find(n=>n.key==='goal-food-13:00');if(food)assert.equal(food.target,'goal:food','a reminder opens its goal');
  const monday=weekOf(k);assert.ok(dueNudges({...st,settings:{...st.settings,reminders:true,quietStart:'00:00',quietEnd:'00:01'}},monday,'09:00').some(n=>n.target==='recap'),'Monday recap nudge');}

 // Reminders stop once something is logged (even under target); sleep under target gets a "sleep fix" nudge instead
 {const k=dayKey(),st=initialState();st.settings={...st.settings,reminders:true,quietStart:'00:00',quietEnd:'00:01',evening:{enabled:true,time:'21:30'}};
  st.goals=st.goals.map(g=>g.id==='sleep'?{...g,reminders:[{time:'09:00'}]}:g);
  const nudges=t=>dueNudges(st,k,t,{dailyAnswered:true});
  assert.ok(nudges('09:00').some(n=>n.key==='goal-sleep-09:00'),'nothing logged: the reminder comes');
  assert.match(nudges('21:30').find(n=>n.key==='evening').body,/Sleep \(not logged\)/);
  const d=dayFor(st,k);d.entries.find(e=>e.goal.id==='sleep').value=5;st.days[k]=d;
  assert.ok(!nudges('09:00').some(n=>n.key==='goal-sleep-09:00'),'5 of 7 hours logged: no more "log it" reminders');
  assert.ok(!/Sleep/.test(nudges('21:30').find(n=>n.key==='evening')?.body??''),'not listed as open in the evening');
  const fix=nudges('22:30').find(n=>n.key==='sleepfix-sleep');assert.match(fix.body,/5 of 7 hours/);
  d.entries.find(e=>e.goal.id==='sleep').value=7.5;assert.ok(!nudges('22:30').some(n=>n.key.startsWith('sleepfix')),'enough sleep: no sleep fix');}

 // Countdowns: yearly ones roll over to the next date (29 Feb → 28 Feb), one-offs drop off once past
 assert.equal(nextOccurrence({date:'2001-10-07',repeat:'yearly'},'2026-09-25'),'2026-10-07');
 assert.equal(nextOccurrence({date:'2001-03-01',repeat:'yearly'},'2026-09-25'),'2027-03-01');
 assert.equal(nextOccurrence({date:'2000-02-29',repeat:'yearly'},'2026-09-25'),'2027-02-28');
 assert.deepEqual(upcoming([{id:'a',title:'Past',icon:'x',date:'2026-01-01',time:'',color:'pink'},{id:'b',title:'Trip',icon:'x',date:'2026-12-01',time:'',color:'pink'},{id:'c',title:'Bday',icon:'x',date:'1999-10-01',time:'',color:'pink',repeat:'yearly'}],'2026-09-25').map(x=>x.m.id),['c','b']);
 {const cur=await (await api('/api/shared',{cookie:max.cookie})).json();cur.shared.moments=[...cur.shared.moments,{id:'cd-1',title:'Her birthday',icon:'🎂',date:'2001-10-07',time:'',color:'pink',repeat:'yearly'}];
  assert.equal((await api('/api/shared',{cookie:max.cookie,method:'PUT',body:{shared:cur.shared,revision:cur.revision}})).status,200);
  assert.equal((await (await api('/api/shared',{cookie:sam.cookie})).json()).shared.moments.find(m=>m.id==='cd-1').repeat,'yearly','the yearly flag is kept');}

 // Couple stats: daily questions answered, out of the question pool
 {const st=await (await api('/api/daily/stats',{cookie:max.cookie})).json();assert.ok(st.total>0&&st.answered>=0&&st.questions<=st.total&&st.both>=0);assert.equal((await api('/api/daily/stats')).status,401);}

 // Export everything: a valid zip with data.json first and photos, never hidden-vault ones
 {const r=await api('/api/export',{cookie:sam.cookie});assert.equal(r.status,200);assert.match(r.headers.get('content-disposition'),/max-export-sam-/);
  const z=Buffer.from(await r.arrayBuffer());assert.equal(z.readUInt32LE(0),0x04034b50);const nameLen=z.readUInt16LE(26),size=z.readUInt32LE(18);
  assert.equal(z.subarray(30,30+nameLen).toString(),'data.json');const data=JSON.parse(z.subarray(30+nameLen,30+nameLen+size).toString());assert.equal(data.user.username,'sam');assert.ok(Array.isArray(data.shared.journal));
  const end=z.length-22;assert.equal(z.readUInt32LE(end),0x06054b50);const peek=new DatabaseSync(join(dataDir,'max.sqlite'),{readOnly:true}),vaulted=peek.prepare('SELECT id FROM files WHERE vault=1').all().map(f=>f.id);peek.close();for(const id of vaulted)assert.ok(!z.includes(Buffer.from(id)),'vault photos are never exported');
  assert.equal((await api('/api/export')).status,401);}

 // Name and nickname: the nickname is what everyone sees; bad input is refused
 assert.equal((await api('/api/profile',{cookie:max.cookie,method:'PUT',body:{nickname:'   ',name:'Max Doe'}})).status,400);
 const prof=await (await api('/api/profile',{cookie:max.cookie,method:'PUT',body:{nickname:'  Maxi ',name:'Max Doe'}})).json();
 assert.deepEqual([prof.user.displayName,prof.user.name],['Maxi','Max Doe']);
 assert.equal((await (await api('/api/users',{cookie:sam.cookie})).json()).users.find(u=>u.username==='max').displayName,'Maxi','partner sees the nickname');
 await api('/api/profile',{cookie:max.cookie,method:'PUT',body:{nickname:'Max',name:'Max Doe'}});

 // Moods: saved with a time and note; the partner sees only the latest shared one, never private ones
 assert.equal((await api('/api/moods',{cookie:max.cookie,method:'POST',body:{mood:'nope'}})).status,400);
 const shared1=await (await api('/api/moods',{cookie:max.cookie,method:'POST',body:{mood:'tired',note:'long day',shared:true}})).json();
 assert.equal(shared1.mood.mood,'tired');assert.ok(Math.abs(shared1.mood.at-Date.now())<60000);
 await new Promise(r=>setTimeout(r,5));await api('/api/moods',{cookie:max.cookie,method:'POST',body:{mood:'sad',note:'secret',shared:false}});
 const moodSeen=await (await api('/api/moods',{cookie:sam.cookie})).json();
 assert.equal(moodSeen.partners[0].latest.mood,'tired','partner sees the latest shared mood');assert.ok(!JSON.stringify(moodSeen).includes('secret'),'private moods never reach the partner');
 const own=await (await api('/api/moods',{cookie:max.cookie})).json();assert.deepEqual(own.mine.map(m=>m.mood),['sad','tired']);
 assert.equal((await (await api('/api/moods?id='+shared1.mood.id,{cookie:sam.cookie,method:'DELETE'})).json()).deleted,0,'only your own moods can be deleted');
 assert.equal((await (await api('/api/moods?id='+shared1.mood.id,{cookie:max.cookie,method:'DELETE'})).json()).deleted,1);
 assert.equal((await (await api('/api/moods',{cookie:sam.cookie})).json()).partners[0].latest,null);

 // Journal Recently deleted: both of you can bin items, stamped with your own name; the bin survives a round trip
 {const cur=await (await api('/api/shared',{cookie:sam.cookie})).json();
  const memory={id:'bin-memory',title:'Binned',body:'x',date:'2026-01-02',time:'',location:'',photos:[],author:'sam',created:new Date().toISOString(),comments:[{id:'bin-c',author:'sam',text:'hi',created:new Date().toISOString()}]};
  const put=(item)=>api('/api/shared',{cookie:sam.cookie,method:'PUT',body:{shared:{...cur.shared,journalTrash:[...(cur.shared.journalTrash??[]),item]},revision:cur.revision}});
  assert.equal((await put({id:'bin-memory',kind:'memory',deletedAt:new Date().toISOString(),deletedBy:'max',memory})).status,403,'cannot bin in someone else’s name');
  assert.equal((await put({id:'bin-memory',kind:'memory',deletedAt:new Date().toISOString(),deletedBy:'sam',memory})).status,200);
  const back=await (await api('/api/shared',{cookie:max.cookie})).json();assert.equal(back.shared.journalTrash.at(-1).memory.comments[0].text,'hi','the whole memory is kept in the bin');}

 // Recently deleted: either partner can bin photos (fresh timestamp, own name); delete forever only what's in the bin
 const binUp=await (await api('/api/files?shared=1',{cookie:max.cookie,method:'POST',body:form('bin.png',png,'image/png')})).json();
 const keepUp=await (await api('/api/files?shared=1',{cookie:max.cookie,method:'POST',body:form('keep.png',png,'image/png')})).json();
 const putTrash=async(who,item)=>{const cur=await (await api('/api/shared',{cookie:who.cookie})).json();cur.shared.photoTrash=[...(cur.shared.photoTrash??[]),item];return (await api('/api/shared',{cookie:who.cookie,method:'PUT',body:{shared:cur.shared,revision:cur.revision}})).status};
 const binItem={id:binUp.id,name:'bin.png',size:binUp.size,deletedAt:new Date().toISOString(),deletedBy:'max'};
 assert.equal(await putTrash(sam,binItem),403,'not in someone else’s name');
 assert.equal(await putTrash(max,{...binItem,deletedAt:new Date(Date.now()-10*86400000).toISOString()}),403,'no backdating into an instant purge');
 assert.equal(await putTrash(max,binItem),200);
 assert.equal((await (await api('/api/files/purge',{cookie:sam.cookie,method:'POST',body:{ids:[keepUp.id]}})).json()).deleted,0,'the partner can’t purge what isn’t binned either');
 assert.equal((await (await api('/api/files/purge',{cookie:max.cookie,method:'POST',body:{ids:[keepUp.id]}})).json()).deleted,0,'only photos in Recently deleted');
 assert.equal((await api('/api/files?id='+keepUp.id+'&inline=1',{cookie:max.cookie})).status,200);
 assert.equal((await (await api('/api/files/purge',{cookie:max.cookie,method:'POST',body:{ids:[binUp.id]}})).json()).deleted,1);
 assert.equal((await api('/api/files?id='+binUp.id+'&inline=1',{cookie:max.cookie})).status,404,'deleted for good');

 // body goal: direction-aware progress, weekly and monthly changes
 const gain=newBody(56,76,'2026-09-01');gain.entries.push({date:'2026-09-14',kg:56.4,weekly:true},{date:'2026-09-22',kg:57.1,weekly:true});
 assert.deepEqual([progress(gain).dir,progress(gain).done,progress(gain).remaining],['gain',1.1,18.9]);
 assert.equal(weekly(gain,'2026-09-24').change,0.7,'this week vs last weigh-in before it');assert.deepEqual([monthly(gain,'2026-09-24').from,monthly(gain,'2026-09-24').to,monthly(gain,'2026-09-24').change],[56,57.1,1.1]);
 const loss=newBody(80,60,'2026-09-01');loss.entries.push({date:'2026-09-23',kg:79.2,weekly:true});
 assert.deepEqual([progress(loss).dir,progress(loss).done,progress(loss).remaining],['loss',0.8,19.2]);assert.equal(weekly(loss,'2026-09-24').change,-0.8);
 assert.equal(towardGoal(loss,-0.8),true);assert.equal(towardGoal(gain,-0.3),false,'a dip is shown neutrally, not as progress');
 const over=newBody(80,60);over.entries.push({date:dateKey(),kg:58});assert.equal(progress(over).pct,100,'display clamps at 100');assert.equal(progress(over).done,22,'raw progress kept');
 assert.equal(weekly(newBody(56,76,'2026-09-01'),'2026-09-24').due,true,'weigh-in due when none this week');
 // tracking day runs 5:30 am to 5:30 am
 assert.equal(dayKey(new Date(2026,8,25,2,0)),'2026-09-24','2 am still counts for the day before');assert.equal(dayKey(new Date(2026,8,25,5,29)),'2026-09-24');assert.equal(dayKey(new Date(2026,8,25,5,30)),'2026-09-25','new day at 5:30');
 assert.equal(msUntilDayEnds(new Date(2026,8,24,23,30)),6*3600000,'6h left at 11:30 pm');assert.equal(msUntilDayEnds(new Date(2026,8,25,5,30)),24*3600000);
 // checklists can finish before every item: Body is any 3 of 4 exercises
 const bodyGoal=initialState().goals.find(g=>g.id==='body');assert.equal(bodyGoal.items.length,4);assert.equal(bodyGoal.need,3);
 const bodyEntry={goal:bodyGoal,checks:[true,true,false,false],value:0,note:'',rest:false};assert.equal(complete(bodyEntry),false);bodyEntry.checks[3]=true;assert.equal(complete(bodyEntry),true,'3 of 4 is enough');assert.equal(fraction(bodyEntry),1);


 // push notifications: device registration (delivery itself needs a real phone)
 const {publicKey}=await (await api('/api/push/key',{cookie:max.cookie})).json();assert.ok(publicKey.length>80,'VAPID public key');
 assert.equal((await api('/api/push/test',{cookie:max.cookie,method:'POST'})).status,502,'no device yet');
 assert.equal((await api('/api/push/subscribe',{cookie:max.cookie,method:'POST',body:{subscription:{endpoint:'http://insecure.example/x',keys:{p256dh:'a',auth:'b'}}}})).status,400,'https endpoints only');
 assert.equal((await api('/api/push/subscribe',{cookie:max.cookie,method:'POST',body:{subscription:{endpoint:'https://push.example.test/abc',keys:{p256dh:'BPk',auth:'xyz'}}}})).status,200);
 assert.equal((await api('/api/push/unsubscribe',{cookie:max.cookie,method:'POST',body:{endpoint:'https://push.example.test/abc'}})).status,200);
 assert.equal((await api('/api/push/key')).status,401,'needs login');

 // logout ends that session only
 assert.equal((await api('/api/logout',{cookie:max.cookie,method:'POST'})).status,200);
 assert.equal((await api('/api/me',{cookie:max.cookie})).status,401);
 assert.equal((await api('/api/me',{cookie:sam.cookie})).status,200);

 // restart: sessions, trackers and the journal persist
 await stop();await start();
 assert.equal((await api('/api/me',{cookie:sam.cookie})).status,200);
 const again=await login('max',PASSWORDS.max);
 const persisted=await (await api('/api/state',{cookie:again.cookie})).json();
 assert.equal(persisted.revision,1);assert.deepEqual(persisted.state.days[k].entries[0].exerciseLogs,{'0':{reps:12,sets:3}});assert.equal(complete(persisted.state.days[k].entries[0]),true);
 // And the server refuses it too: a logged past day sent back blank is kept, and the device is told to reload.
 {const cur=await (await api('/api/state',{cookie:again.cookie})).json();const st=cur.state,past=shiftDay(dayKey(),-3);
  st.days[past]=dayFor(st,past);st.days[past].reflection='A day worth keeping';
  const first=await (await api('/api/state',{cookie:again.cookie,method:'PUT',body:{state:st,revision:cur.revision}})).json();
  const blanked=structuredClone(st);blanked.days[past]=dayFor({...blanked,days:{}},past);
  const second=await (await api('/api/state',{cookie:again.cookie,method:'PUT',body:{state:blanked,revision:first.revision}})).json();
  assert.deepEqual(second.adjusted,[past],'the server says which days it kept');
  assert.equal((await (await api('/api/state',{cookie:again.cookie})).json()).state.days[past].reflection,'A day worth keeping','a blanked past day is not saved');}
 assert.equal((await (await api('/api/shared',{cookie:again.cookie})).json()).shared.moments[0].icon,'💍');

 // five wrong passwords lock the account for a while
 for(let i=0;i<5;i++)assert.equal((await login('sam','nope-nope')).r.status,401);
 assert.equal((await login('sam',PASSWORDS.sam)).r.status,429);

 // changing a password signs that account out everywhere
 assert.equal((await run(['set-password','sam'],'another-pass-1\nanother-pass-1\n')).code,0);
 assert.equal((await api('/api/me',{cookie:sam.cookie})).status,401);

 // tracker model
 const history=initialState();history.goals.forEach(g=>g.created=shiftDay(k,-3));history.days[shiftDay(k,-3)]=dayFor(history,shiftDay(k,-3));fillHistory(history,k);const old=JSON.stringify(history.days[shiftDay(k,-1)]);history.goals[0].items=['Changed routine'];assert.equal(JSON.stringify(dayFor(history,shiftDay(k,-1))),old);
 const streakState=initialState();streakState.goals=[{...streakState.goals[0],created:shiftDay(k,-2)}];for(let i=-2;i<=0;i++){const d=dayFor(streakState,shiftDay(k,i));d.entries[0].checks=[true,true,true];streakState.days[shiftDay(k,i)]=d}assert.equal(streak(streakState),3);streakState.days[shiftDay(k,-1)].entries[0].rest=true;assert.equal(streak(streakState),3,'marking a rest day counts as updating');
 // streak = days you updated anything; perfect streak = days with every essential done
 const act=initialState();act.goals=act.goals.map(g=>({...g,created:shiftDay(k,-3)}));const put=(i,fn)=>{const key=shiftDay(k,i),d=dayFor(act,key);fn(d);act.days[key]=d};
 put(-3,d=>{for(const e of d.entries)if(e.goal.essential){e.checks=e.checks.map(()=>true);e.value=e.goal.target}});put(-2,d=>{d.entries[1].note='ate well'});put(-1,d=>{d.entries[0].checks[0]=true});
 assert.equal(streak(act),3,'a note or a single tick keeps the streak');assert.equal(perfectStreak(act),0,'perfect streak needs every essential');
 put(0,d=>{for(const e of d.entries)if(e.goal.essential){e.checks=e.checks.map(()=>true);e.value=e.goal.target}});assert.equal(streak(act),4);assert.equal(perfectStreak(act),1);
 delete act.days[shiftDay(k,-2)];assert.equal(streak(act),2,'a day with nothing updated breaks it');
 const choiceEntry=dayFor(initialState(),k).entries.find(e=>e.goal.id==='control');assert.equal(choiceEntry.goal.kind,'choice');assert.equal(complete(choiceEntry),false);choiceEntry.checks=[false,true];assert.equal(complete(choiceEntry),true);
 const anyEntry=dayFor(initialState(),k).entries.find(e=>e.goal.id==='personal');assert.equal(anyEntry.goal.kind,'any');assert.equal(complete(anyEntry),false);anyEntry.checks[2]=true;assert.equal(complete(anyEntry),true);assert.equal(fraction(anyEntry),1);
 // streak freezes: 7 perfect days earn one, a miss inside a live streak spends one, finishing the day later refunds it
 const fz=initialState();fz.goals=[{...fz.goals[0],created:shiftDay(k,-10)}];
 const doneDay=key=>{const d=dayFor(fz,key);d.entries[0].checks=[true,true,true];fz.days[key]=d};
 for(let i=-9;i<=-3;i++)doneDay(shiftDay(k,i));fz.days[shiftDay(k,-2)]=dayFor(fz,shiftDay(k,-2));doneDay(shiftDay(k,-1));
 fz.freezes={since:shiftDay(k,-9),earned:[],used:[]};
 assert.equal(applyFreezes(fz,k),true);
 assert.ok(fz.freezes.earned.some(e=>e.reason==='week'&&e.date===shiftDay(k,-3)),'week freeze after 7 perfect days');
 const months=new Set([shiftDay(k,-9).slice(0,7),k.slice(0,7)]).size;
 assert.equal(fz.freezes.earned.filter(e=>e.reason==='month').length,months,'one freeze per calendar month');
 assert.deepEqual(fz.freezes.used,[shiftDay(k,-2)],'missed day covered');
 assert.equal(streak(fz),8,'frozen day bridges the streak without counting');
 assert.equal(freezeBalance(fz),months+1-1);
 assert.equal(applyFreezes(fz,k),false,'running again changes nothing');
 doneDay(shiftDay(k,-2));applyFreezes(fz,k);assert.deepEqual(fz.freezes.used,[],'finishing the day refunds the freeze');assert.equal(streak(fz),9);
 assert.equal(perfectRun(fz,k),9);assert.equal(bestStreak(fz,k),9);
 const noStreak=initialState();noStreak.goals=[{...noStreak.goals[0],created:shiftDay(k,-3)}];noStreak.freezes={since:shiftDay(k,-3),earned:[],used:[]};
 applyFreezes(noStreak,k);assert.deepEqual(noStreak.freezes.used,[],'no freeze spent when there is no streak to save');
 assert.equal((await api('/api/state',{cookie:again.cookie,method:'POST',body:fz})).status,200,'freezes pass validation');
 // reminder rules shared by the server scheduler
 assert.equal(inQuietHours('23:30','23:00','08:00'),true);assert.equal(inQuietHours('07:59','23:00','08:00'),true);assert.equal(inQuietHours('12:00','23:00','08:00'),false);assert.equal(inQuietHours('12:00','09:00','09:00'),false);
 const rs=initialState();rs.settings.reminders=true;rs.goals=rs.goals.map(g=>({...g,created:shiftDay(k,-1)}));rs.goals.find(g=>g.id==='food').reminder='13:00';rs.goals.find(g=>g.id==='control').reminder='13:00';rs.goals.find(g=>g.id==='control').private=true;
 assert.deepEqual(dueReminders(rs,k,'13:00').map(r=>r.title).sort(),['Fuel your day','Your private check-in'],'private goals stay private on the lock screen');
 assert.deepEqual(dueReminders(rs,k,'13:01'),[]);
 const doneFood=dayFor(rs,k);doneFood.entries.find(e=>e.goal.id==='food').checks=[true,true,true];rs.days[k]=doneFood;
 assert.deepEqual(dueReminders(rs,k,'13:00').map(r=>r.id),['control'],'finished goals are skipped');
 rs.settings.quietStart='12:00';rs.settings.quietEnd='14:00';assert.deepEqual(dueReminders(rs,k,'13:00'),[],'quiet hours');
 rs.settings.reminders=false;rs.settings.quietStart=rs.settings.quietEnd='00:00';assert.deepEqual(dueReminders(rs,k,'13:00'),[],'switched off');
 // every nudge: item-linked goal times, custom reminders, evening check-in, daily question
 assert.deepEqual([initialState().settings.quietStart,initialState().settings.quietEnd],['00:00','07:00'],'default quiet hours 12am-7am');
 const ns=initialState();ns.settings.reminders=true;ns.goals=ns.goals.map(g=>({...g,created:shiftDay(k,-1)}));const food=ns.goals.find(g=>g.id==='food');food.reminders=[{time:'08:30',item:0},{time:'13:30',item:1}];
 const wd=new Date(k+'T12:00:00').getDay();
 assert.deepEqual(dueNudges(ns,k,'08:30').map(n=>[n.key,n.title]),[['goal-food-08:30',food.items[0]]],'item-linked goal time');
 const fd=dayFor(ns,k);fd.entries.find(e=>e.goal.id==='food').checks[0]=true;ns.days[k]=fd;
 assert.deepEqual(dueNudges(ns,k,'08:30'),[],'item already ticked');assert.equal(dueNudges(ns,k,'13:30').length,1,'next meal still reminds');
 // Body can rest two days in a row; a third rest in a row doesn't count (Body is not done that day).
 {const {restAllowed}=await import('../lib/tracker.ts');const rs=initialState();rs.goals=rs.goals.map(g=>({...g,created:shiftDay(k,-5)}));
  const finish=(key,rest)=>{const d=dayFor(rs,key);for(const e of d.entries){if(e.goal.id==='body'&&rest){e.rest=true;continue}e.checks=e.checks.map(()=>true);e.value=e.goal.target}rs.days[key]=d};
  finish(shiftDay(k,-2),true);finish(shiftDay(k,-1),true);finish(k,true);
  assert.equal(dayStatus(rs,shiftDay(k,-1)),'done','second rest day in a row still makes a perfect day');
  assert.equal(restAllowed(rs,k,rs.days[k].entries.find(e=>e.goal.id==='body')),false,'no third rest day in a row');
  assert.equal(dayStatus(rs,k),'logged','a third rest in a row means Body is not done');}
 // Two devices changing the same day: both edits survive the merge (it used to be whole-day, last one wins).
 {const {mergeTracker}=await import('../app/offline.ts');const base=initialState();base.goals=base.goals.map(g=>({...g,created:shiftDay(k,-1)}));base.days[k]=dayFor(base,k);
  const phone=structuredClone(base),computer=structuredClone(base),entry=(s,id)=>s.days[k].entries.find(e=>e.goal.id===id);
  entry(phone,'food').checks[0]=true;entry(phone,'food').times=['08:10',null,null];entry(phone,'body').exerciseLogs={'0':{reps:20,sets:2}};entry(phone,'body').checks[0]=true;
  entry(computer,'sleep').value=7;entry(computer,'food').checks[2]=true;entry(computer,'body').exerciseLogs={'2':{reps:15,sets:2}};entry(computer,'body').checks[2]=true;computer.days[k].reflection='Good day';
  const merged=mergeTracker(base,computer,phone),m=id=>merged.days[k].entries.find(e=>e.goal.id===id);
  assert.deepEqual(m('food').checks,[true,false,true],'both devices’ meals kept');assert.deepEqual(m('food').times,['08:10',null,null]);
  assert.equal(m('sleep').value,7,'sleep from the computer');assert.equal(merged.days[k].reflection,'Good day');
  assert.deepEqual(Object.keys(m('body').exerciseLogs).sort(),['0','2'],'both exercises’ reps kept');assert.deepEqual(m('body').checks,[true,false,true,false]);
  // A device asleep since before two days were logged fills them in blank: that must never replace the real days.
  const past=shiftDay(k,-1),logged=structuredClone(base);logged.days[past]=dayFor(logged,past);logged.days[past].entries.find(e=>e.goal.id==='food').checks=[true,true,false];logged.days[past].reflection='Real day';
  const sleepy=structuredClone(base);sleepy.days[past]=dayFor(sleepy,past);
  const healed=mergeTracker(base,sleepy,logged);assert.equal(healed.days[past].reflection,'Real day','a blank day from a sleeping device never wins');assert.deepEqual(healed.days[past].entries.find(e=>e.goal.id==='food').checks,[true,true,false]);}

 // timed goals: a meal window opening and closing unticked, and bedtime 30 minutes before the sleep plan
 {const ts=initialState();ts.settings.reminders=true;const td=dayFor(ts,k);ts.days[k]=td;
  assert.deepEqual(dueNudges(ts,k,'07:00').map(n=>n.key),['window-food-0'],'breakfast window opens');
  assert.deepEqual(dueNudges(ts,k,'10:00').map(n=>n.key),['missed-food-0'],'breakfast missed when its window closes unticked');
  td.entries.find(e=>e.goal.id==='food').checks[0]=true;assert.deepEqual(dueNudges(ts,k,'10:00'),[],'ticked breakfast: no missed nudge');
  assert.deepEqual(dueNudges(ts,k,'23:00').map(n=>n.key),['bedtime'],'bedtime nudge 30 minutes before 11:30 pm');
  ts.goals.find(g=>g.id==='food').windows=[];assert.deepEqual(dueNudges(ts,k,'07:00'),[],'timing can be turned off');
  // A count goal (water) keeps reminding after the first glasses, with the tally, until the target is reached.
  {const water={id:'water',title:'Drink water',category:'Water',description:'',items:[],target:8,kind:'count',unit:'glasses',essential:false,private:false,days:[0,1,2,3,4,5,6],reminder:'',reminders:[{time:'12:00'}],archived:false,created:shiftDay(k,-1)};
   const ws=initialState();ws.settings.reminders=true;ws.goals.push(water);const wd=dayFor(ws,k);ws.days[k]=wd;wd.entries.find(e=>e.goal.id==='water').value=3;
   assert.deepEqual(dueNudges(ws,k,'12:00').map(n=>[n.key,n.body]),[['goal-water-12:00','3 of 8 glasses so far · tap to add one']],'water keeps reminding after 3 glasses');
   wd.entries.find(e=>e.goal.id==='water').value=8;assert.deepEqual(dueNudges(ws,k,'12:00'),[],'and stops at 8');}
  // Couple things hidden: no daily-question reminder.
  {const hs=initialState();hs.settings.reminders=true;hs.days[k]=dayFor(hs,k);const t=dailyNudgeOf(hs).time;
   assert.ok(dueNudges(hs,k,t,{dailyAnswered:false}).some(n=>n.key==='daily'),'daily question reminder normally');
   hs.settings.hideCouple=true;assert.ok(!dueNudges(hs,k,t,{dailyAnswered:false}).some(n=>n.key==='daily'),'not while couple things are hidden');}
  td.entries.find(e=>e.goal.id==='sleep').noSleep=true;assert.ok(dueNudges(ts,k,'22:30').some(n=>n.key==='sleepfix-sleep'&&n.title.includes('Early night')),'a no-sleep night gets an early-night nudge');}
 ns.settings.customReminders=[{id:'w',title:'Wake up',emoji:'☀️',time:'06:30',days:[wd],note:'',enabled:true},{id:'x',title:'Off',emoji:'',time:'06:30',days:[wd],note:'',enabled:false},{id:'y',title:'Other day',emoji:'',time:'06:30',days:[(wd+1)%7],note:'',enabled:true}];
 assert.deepEqual(dueNudges(ns,k,'06:30').map(n=>n.title),['☀️ Wake up'],'custom reminders ring in quiet hours, only when on and on their days');
 ns.days[k].entries.find(e=>e.goal.essential&&e.goal.id!=='food').goal.private=true;
 const ev=dueNudges(ns,k,'21:30').find(n=>n.key==='evening');assert.ok(ev&&/still open/.test(ev.title)&&/a private goal/.test(ev.body)&&/few words/.test(ev.body),'evening check-in lists open goals, hides private names');
 const allDone=dayFor(ns,k);for(const e of allDone.entries){if(e.goal.essential){e.checks=e.checks.map(()=>true);e.value=e.goal.target}}allDone.reflection='Good day';ns.days[k]=allDone;
 assert.equal(dueNudges(ns,k,'21:30').some(n=>n.key==='evening'),false,'evening check-in stays silent when the day is done');
 assert.deepEqual(dueNudges(ns,k,'20:00',{dailyAnswered:false,question:'Q?'}).map(n=>[n.key,n.body,n.view]),[['daily','Q?','Journal']]);assert.deepEqual(dueNudges(ns,k,'20:00',{dailyAnswered:true}),[],'answered');
 ns.settings.evening={enabled:false,time:'21:30'};ns.days[k].reflection='';assert.equal(dueNudges(ns,k,'21:30').length,0,'evening switched off');
 ns.settings.quietStart='19:00';ns.settings.quietEnd='23:59';assert.deepEqual(dueNudges(ns,k,'20:00',{dailyAnswered:false}),[],'daily question respects quiet hours');
 const withRem=initialState();withRem.settings.customReminders=ns.settings.customReminders;withRem.settings.evening={enabled:true,time:'22:00'};withRem.goals[0].reminders=[{time:'09:00',item:1}];withRem.settings.timeZone='Pacific/Kiritimati';
 const saved=await api('/api/state',{cookie:again.cookie,method:'POST',body:withRem});assert.equal(saved.status,200);const back=await saved.json();assert.equal(back.settings.customReminders.length,3);assert.equal(back.settings.evening.time,'22:00');assert.deepEqual(back.goals[0].reminders,[{time:'09:00',item:1}],'reminder fields survive validation');
 // The question's day is the tracking day there (it changes at 5:30 am local), not the calendar date.
 const kiri=new Intl.DateTimeFormat('en-CA',{timeZone:'Pacific/Kiritimati',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()-330*60000));assert.equal(back.settings.timeZone,'Pacific/Kiritimati');const cur=await (await api('/api/state',{cookie:again.cookie})).json();cur.state.settings.timeZone='Pacific/Kiritimati';assert.equal((await api('/api/state',{cookie:again.cookie,method:'PUT',body:{state:cur.state,revision:cur.revision}})).status,200);assert.equal((await api(`/api/daily?date=${kiri}`,{cookie:again.cookie})).status,200,'daily question uses each person own date, not the server clock');
 const badChoice=initialState();badChoice.goals.find(g=>g.id==='control').items=['Only one'];assert.equal((await api('/api/state',{cookie:again.cookie,method:'POST',body:badChoice})).status,400);

 console.log('PASS: accounts & hashed passwords, Tailscale gate, login/logout, stay-logged-in cookies, lockout, CSRF, per-account trackers, shared journal with conflict protection, private vs shared files, profile photos, restart persistence, history snapshots, streaks, choice and any-one goals, daily couple prompts, imported answer archive, memory comments, photo dump, cli avatars, streak freezes, hidden photos vault (per person), recently deleted, countdowns, moods, names & nicknames, export, flexible goals, low-energy days, weekly recap, reminders after partial logs & sleep fix, M.A.X. coach, memory map & photo GPS, body goals, push notifications & reminder rules, custom reminders & evening/daily nudges, per-person time zones, login photos.');
}finally{if(child?.exitCode===null)await stop();fakeAssistant.close();rmSync(dataDir,{recursive:true,force:true})}
