// npm run demo: a throwaway server full of example data, to try the app or take screenshots.
// Two partners, Alex and Sam, with three weeks of goals, a weight goal, moods, a shared journal with photos,
// countdowns, a diary, the daily question, and each one's own private journal. Everything goes through the real
// API, so it's exactly what the app would store. Data lives in .selfhost-demo/ and is replaced on every run.
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readdirSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {deflateSync,crc32} from 'node:zlib';
import {dayFor,dayKey,shiftDay} from '../lib/tracker.ts';
import {newBody} from '../lib/body.ts';

const port=Number(process.env.DEMO_PORT||4340),origin=`http://localhost:${port}`,dir=resolve('.selfhost-demo'),outbox=join(dir,'outbox');
const people={alex:{name:'Alex',email:'alex@example.com',password:'demo-alex-1234'},sam:{name:'Sam',email:'sam@example.com',password:'demo-sam-1234'}};

if(!existsSync('selfhost-dist/server.mjs')){console.log('Building first…');if(spawnSync(process.execPath,['scripts/build-selfhost.mjs'],{stdio:'inherit'}).status)process.exit(1)}
rmSync(dir,{recursive:true,force:true});mkdirSync(dir,{recursive:true});
const server=spawn(process.execPath,['selfhost-dist/server.mjs'],{env:{...process.env,PORT:String(port),MAX_DEV_MODE:'1',MAX_DATA_DIR:dir,MAX_MAIL_OUTBOX:outbox,MAX_SIGNUP:'open',MAX_ORIGIN:''},stdio:['ignore','pipe','inherit']});
await new Promise((ok,fail)=>{server.stdout.on('data',d=>{if(String(d).includes('MAX listening'))ok()});server.once('exit',c=>fail(Error('Server exited: '+c)))});
const stop=()=>{server.kill();process.exit(0)};process.on('SIGINT',stop);process.on('SIGTERM',stop);

// ----- API helpers -----
async function api(path,{cookie,method='GET',body}={}){
 const headers={Origin:origin};if(cookie)headers.Cookie=cookie;
 if(body!==undefined&&!(body instanceof FormData)){headers['Content-Type']='application/json';body=JSON.stringify(body)}
 const r=await fetch(origin+path,{method,headers,body});const data=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(`${method} ${path}: ${r.status} ${data.error??''}`);return {data,cookie:(r.headers.get('set-cookie')||'').split(';')[0]};
}
const codeFor=email=>{for(const f of readdirSync(outbox).sort().reverse()){const m=JSON.parse(readFileSync(join(outbox,f),'utf8'));if(m.to===email)return m.text.match(/\b(\d{6})\b/)[1]}};
async function signUp(p){await api('/api/signup',{method:'POST',body:{name:p.name,email:p.email,password:p.password}});return (await api('/api/signup/verify',{method:'POST',body:{email:p.email,code:codeFor(p.email)}})).cookie}

// ----- placeholder photos: soft two-colour gradients with a "sun", as PNGs -----
function png(w,h,[a,b],sun){
 const raw=Buffer.alloc((w*3+1)*h);
 for(let y=0;y<h;y++){raw[y*(w*3+1)]=0;for(let x=0;x<w;x++){const t=(x/w*0.35+y/h*0.65),d=Math.hypot(x-sun[0]*w,y-sun[1]*h)/(w*0.18),glow=Math.max(0,1-d)**2;
  for(let c=0;c<3;c++)raw[y*(w*3+1)+1+x*3+c]=Math.min(255,Math.round(a[c]+(b[c]-a[c])*t+glow*(255-a[c])*0.8))}}
 const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(td)>>>0);return Buffer.concat([len,td,crc])};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;
 return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const palettes=[[[255,140,105],[110,60,160]],[[90,170,255],[30,40,110]],[[255,200,120],[220,90,120]],[[120,220,180],[30,90,110]],[[200,160,255],[60,40,120]],[[255,170,200],[90,50,110]],[[150,210,255],[255,180,150]],[[100,200,130],[40,70,60]]];
async function upload(cookie,i,space=''){const f=new FormData();f.append('file',new File([png(640,480,palettes[i%palettes.length],[0.25+0.5*((i*37)%10)/10,0.3+0.1*(i%3)])],`photo-${i+1}.png`,{type:'image/png'}));return (await api(`/api/files?shared=1${space}`,{cookie,method:'POST',body:f})).data}

// ----- people, paired -----
const alex=await signUp(people.alex),sam=await signUp(people.sam);
const {code}=(await api('/api/pair/invite',{cookie:alex,method:'POST'})).data;await api('/api/pair/accept',{cookie:sam,method:'POST',body:{code}});
const today=dayKey(),ago=n=>shiftDay(today,-n);

// ----- goals and three weeks of days -----
function finish(e){const g=e.goal;
 if(g.kind==='checklist')e.checks=g.items.map((_,i)=>i<(g.need??g.items.length));
 else if(g.kind==='checkbox')e.checks=[true];
 else if(g.kind==='any')e.checks=g.items.map((_,i)=>i===0);
 else if(g.kind==='choice'){e.checks=[false,true];e.resists=[Date.now()-3600000]}
 else e.value=g.kind==='duration'?Math.round((g.target+0.4-Math.random()*0.6)*10)/10:g.target;}
async function fill(cookie,name,{skip=[],weight,notes={}}){
 const {data}=await api('/api/state',{cookie});const s=data.state;
 for(const g of s.goals)g.created=ago(22);
 for(let n=21;n>=0;n--){const k=ago(n),d=dayFor(s,k);
  for(const e of d.entries){if(!e.goal.essential&&Math.random()<0.4)continue;if(skip.includes(n)&&e.goal.essential&&e.goal.id!=='sleep')continue;finish(e)}
  if(n===0){// today: halfway there
   for(const e of d.entries){if(e.goal.id==='body'){e.checks=e.checks.map((_,i)=>i<2);e.exerciseLogs={'0':{reps:20,sets:2},'1':{reps:12,sets:2}}}if(e.goal.id==='food')e.checks=e.checks.map((_,i)=>i<2);if(['work','digital','content'].includes(e.goal.id)){e.checks=e.checks.map(()=>false);e.value=0}}
   d.focus=notes.focus??'';}
  if(notes[n])d.reflection=notes[n];
  s.days[k]=d;}
 if(weight){s.body=newBody(weight[0],weight[1],ago(84));s.body.entries=Array.from({length:13},(_,i)=>({date:ago(84-i*7),kg:Math.round((weight[0]+(weight[2]-weight[0])*i/12+(Math.random()-0.5)*0.4)*10)/10,weekly:true}))}
 s.settings.name=name;
 await api('/api/state',{cookie,method:'PUT',body:{state:s,revision:data.revision}});
}
await fill(alex,'Alex',{skip:[15,16],weight:[82,76,78.6],notes:{1:'Long walk after work, and finally fixed the bike.',focus:'Finish the portfolio draft'}});
await fill(sam,'Sam',{skip:[9],notes:{1:'Good day. Called mum and cooked something new.'}});

// ----- birthdays, moods, the daily question -----
await api('/api/profile/birthday',{cookie:sam,method:'PUT',body:{birthday:`1998-${shiftDay(today,11).slice(5)}`}});
await api('/api/profile/birthday',{cookie:alex,method:'PUT',body:{birthday:'1997-03-21'}});
await api('/api/moods',{cookie:sam,method:'POST',body:{mood:'loved',note:'Coffee in bed ☕',shared:true}});
await api('/api/moods',{cookie:alex,method:'POST',body:{mood:'great',note:'Gym done before 8',shared:true}});
{const {today:qday}=(await api('/api/daily',{cookie:alex})).data;
 await api('/api/daily',{cookie:alex,method:'PUT',body:{date:qday,answer:'The bookshop afternoon. No phones, just us.'}});
 await api('/api/daily',{cookie:sam,method:'PUT',body:{date:qday,answer:'When you made pancakes at midnight.'}})}

// ----- the shared journal -----
const photos=[];for(let i=0;i<8;i++)photos.push(await upload(alex,i));
const at=(n,t)=>new Date(`${ago(n)}T${t}:00`).toISOString();
const memory=(id,title,body,n,time,location,[lat,lng],ph,author,comments=[])=>({id,title,body,date:ago(n),time,location,lat,lng,photos:ph,author,created:at(n,time),comments});
{const {data}=await api('/api/shared',{cookie:alex});
 const shared={...data.shared,together:ago(412),
  journal:[
   memory('m1','Sunset at the viewpoint','We stayed until the lights came on across the river.',38,'19:42','Miradouro da Senhora do Monte, Lisbon, Portugal',[38.7192,-9.1327],photos.slice(0,2),'alex',[{id:'c1',author:'sam',text:'Best evening of the summer.',created:at(37,'09:10')}]),
   memory('m2','First hike of the year','Muddy, steep and worth it.',24,'10:15','Pena Park, Sintra, Portugal',[38.7876,-9.3906],photos.slice(2,4),'sam'),
   memory('m3','Pasta night','Fresh pasta from scratch. Flour everywhere.',11,'20:30','Home, Porto, Portugal',[41.1496,-8.6109],[photos[4]],'alex'),
   memory('m4','Bookshop afternoon','Two hours, four books, one very patient cat.',3,'15:05','Livraria Lello, Porto, Portugal',[41.1469,-8.6149],[photos[5]],'sam',[{id:'c2',author:'alex',text:'The cat chose us.',created:at(3,'18:00')}]),
  ],
  moments:[
   {id:'k1',title:'Trip to Kyoto',icon:'✈️',date:shiftDay(today,24),time:'07:30',color:'blue'},
   {id:'k2',title:'Our anniversary',icon:'💍',date:ago(412),time:'',color:'pink',repeat:'yearly'},
   {id:'k3',title:'Moved in together',icon:'🏡',date:ago(130),time:'',color:'teal'},
  ],
  diary:[{id:'d1',title:'Things we want to do this year',body:'Learn to make ramen. See the cherry blossoms. Run a 10k together. Finish the puzzle on the shelf.',date:ago(30),author:'sam',created:at(30,'21:00'),updated:at(30,'21:00')}],
  photoDump:photos.slice(6).map(p=>({...p})).concat(photos.slice(0,2).map(p=>({...p})))};
 await api('/api/shared',{cookie:alex,method:'PUT',body:{shared,revision:data.revision}});}

// ----- Alex's own journal (Sam never sees it) -----
{const mine=[await upload(alex,6,'&space=mine')];const {data}=await api('/api/shared?space=mine',{cookie:alex});
 await api('/api/shared?space=mine',{cookie:alex,method:'PUT',body:{revision:data.revision,shared:{...data.shared,
  journal:[memory('p1','Morning run','5 km without stopping, first time this year.',6,'07:10','Parque da Cidade, Porto, Portugal',[41.1695,-8.6766],mine,'alex')],
  diary:[{id:'pd1',title:'Notes to self',body:'Slow down on weekends. Sleep before midnight. Call grandma on Sundays.',date:ago(2),author:'alex',created:at(2,'22:30'),updated:at(2,'22:30')}]}}});}

console.log(`\nDemo ready at ${origin}\n  Alex: ${people.alex.email} / ${people.alex.password}\n  Sam:  ${people.sam.email} / ${people.sam.password}\nPress Ctrl+C to stop. Data: ${dir}\n`);
