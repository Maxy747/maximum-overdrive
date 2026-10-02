import {createServer} from 'node:http';
import {DatabaseSync,backup as sqliteBackup} from 'node:sqlite';
import {mkdirSync,existsSync,readFileSync,writeFileSync,statSync,unlinkSync,openSync,readSync,closeSync,readdirSync} from 'node:fs';
import {join,resolve,extname} from 'node:path';
import {crc32} from 'node:zlib';
import {setDefaultAutoSelectFamilyAttemptTimeout} from 'node:net';
import {randomUUID,randomBytes,scrypt,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {stateSchema,sharedSchema} from '../lib/state-schema';
import {withBirthdays,initialState,initialShared,dateKey,dueNudges,upcoming,MOODS,moodOf,weeklyRecap,recapNote,weekCount,weekOf,isFlexible,inQuietHours,TRASH_DAYS,dayFor,complete,fraction,needOf,streak,perfectStreak,dayStatus,shiftDay,DAY_START_MINUTES,resistStreak} from '../lib/tracker';
import {progress as bodyProgress,weekly as bodyWeekly} from '../lib/body';
import {coachAvailable,coachLoaded,coachReply,coachExtract,primeExtract,warmCoach} from './coach.mjs';
import {logPlan,actionsFrom,applyActions,describeActions,looksLoggable} from '../lib/coach-log';
import {promptFor,dailyQuestions} from '../lib/daily';
import {timingFacts,itemTiming,itemsOf,windowFor} from '../lib/timing';
import {blankDay} from '../app/offline';
import {jpegGps,jpegTaken} from './exif.mjs';
import {createAccounts} from './accounts.mjs';
import {createSpaces} from './spaces.mjs';
import webpush from 'web-push';
// A slow network can take ~0.8 s to open a connection to Apple's push service; Node's default of 250 ms per address
// made every push time out (IPv6 isn't routed here either). Give each address 2.5 s.
setDefaultAutoSelectFamilyAttemptTimeout(2500);

// ---------- storage ----------
const base=resolve(process.env.MAX_DATA_DIR||'data'),publicDir=fileURLToPath(new URL('./public/',import.meta.url));
mkdirSync(base,{recursive:true,mode:0o700});mkdirSync(join(base,'files'),{recursive:true,mode:0o700});
const db=new DatabaseSync(join(base,'max.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS trackers (user_id TEXT PRIMARY KEY, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, avatar TEXT);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS shared (id TEXT PRIMARY KEY, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS daily (date TEXT NOT NULL, username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE, answer TEXT NOT NULL DEFAULT '', task_done INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL, PRIMARY KEY(date,username));
CREATE TABLE IF NOT EXISTS daily_archive (id INTEGER PRIMARY KEY, username TEXT NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, created TEXT NOT NULL, source TEXT NOT NULL, UNIQUE(username,kind,created,text));
CREATE INDEX IF NOT EXISTS daily_archive_date ON daily_archive(date);`);
if(!db.prepare('PRAGMA table_info(files)').all().some(c=>c.name==='shared'))db.exec('ALTER TABLE files ADD COLUMN shared INTEGER NOT NULL DEFAULT 0');
if(!db.prepare('PRAGMA table_info(files)').all().some(c=>c.name==='vault'))db.exec('ALTER TABLE files ADD COLUMN vault INTEGER NOT NULL DEFAULT 0');
db.exec('CREATE TABLE IF NOT EXISTS app_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS vault_items (id TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE, added_by TEXT NOT NULL, created TEXT NOT NULL); CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, username TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created TEXT NOT NULL);');

// Spaces: your journal, and your partner if you have one (selfhost/spaces.mjs).
const spaces=createSpaces({db,json,readJson,publicUser:u=>publicUser(u),
 notify:(to,who)=>{const name=db.prepare('SELECT display_name FROM users WHERE username=?').get(who)?.display_name??'Your partner';pushTo(to,{view:'Journal',title:`${name} is now your partner 💜`,body:'You have a shared journal now. Your own journal stays private.',tag:`paired-${who}`,url:'/'}).catch(()=>{})}});
// Photos you may open: your own, and the ones shared into your journals. (Hidden-vault photos are excluded separately.)
const VISIBLE_FILE='(f.user_id=? OR (f.shared=1 AND f.space_id IN (?,?)))',visibleArgs=username=>{const [a,b]=spaces.spacesOf(username);return [username,a??'',b??'']};
// Countdowns and birthdays from both your journals (yours and the shared one).
const momentsOf=username=>{const seen=new Set();return withBirthdays(spaces.spacesOf(username).flatMap(sp=>sharedDoc(sp).moments??[]),spaces.circleOf(username)).filter(m=>!seen.has(m.id)&&seen.add(m.id))};

// ---------- passwords (scrypt, never stored in plain text) ----------
const SCRYPT={N:16384,r:8,p:1,maxmem:64*1024*1024},scryptAsync=promisify(scrypt);
function hashPassword(password){const salt=randomBytes(16),hash=scryptSync(password,salt,64,SCRYPT);return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`}
async function verifyPassword(password,stored){const [kind,N,r,p,salt,hash]=String(stored).split('$');if(kind!=='scrypt'||!salt||!hash)return false;const expected=Buffer.from(hash,'base64'),actual=await scryptAsync(password,Buffer.from(salt,'base64'),expected.length,{N:Number(N),r:Number(r),p:Number(p),maxmem:SCRYPT.maxmem});return expected.length>0&&timingSafeEqual(actual,expected)}
const validUsername=name=>/^[a-z0-9_-]{2,32}$/.test(name);

// ---------- command line: account management ----------
async function readPasswords(){
 const stdin=process.stdin;
 if(!stdin.isTTY){let data='';stdin.setEncoding('utf8');for await(const chunk of stdin)data+=chunk;const lines=data.split(/\r?\n/);return [lines[0]??'',lines[1]??lines[0]??'']}
 const ask=prompt=>new Promise((done,fail)=>{let value='';process.stdout.write(prompt);stdin.setRawMode(true);stdin.resume();stdin.setEncoding('utf8');const onData=text=>{for(const c of text){if(c==='\r'||c==='\n'){stdin.setRawMode(false);stdin.pause();stdin.off('data',onData);process.stdout.write('\n');return done(value)}if(c==='\u0003'){stdin.setRawMode(false);process.stdout.write('\n');return fail(Error('Cancelled.'))}if(c==='\u007f'||c==='\b')value=value.slice(0,-1);else value+=c}};stdin.on('data',onData)});
 return [await ask('New password: '),await ask('Repeat password: ')];
}
async function cli(command,args){
 if(command==='set-password'){
  const username=String(args[0]||'').toLowerCase();if(!validUsername(username))throw Error('Usage: node server.mjs set-password <username> [Display Name]  (username: 2-32 of a-z 0-9 _ -)');
  const [password,repeat]=await readPasswords();
  if(password!==repeat)throw Error('The passwords did not match.');if(password.length<8||password.length>200)throw Error('Use a password between 8 and 200 characters.');
  const existing=db.prepare('SELECT display_name FROM users WHERE username=?').get(username);
  const displayName=(args.slice(1).join(' ').trim()||existing?.display_name||username[0].toUpperCase()+username.slice(1)).slice(0,60);
  db.prepare('INSERT INTO users(username,display_name,password_hash) VALUES(?,?,?) ON CONFLICT(username) DO UPDATE SET display_name=excluded.display_name,password_hash=excluded.password_hash').run(username,displayName,hashPassword(password));
  db.prepare('DELETE FROM sessions WHERE username=?').run(username);
  return console.log(`Password set for ${displayName} (${username}). Existing sessions were signed out.`);
 }
 if(command==='set-passwords'){
  const names=args.map(a=>String(a).toLowerCase());if(!names.length||!names.every(validUsername))throw Error('Usage: node server.mjs set-passwords <username> <username>...  (one password for all listed accounts)');
  const [password,repeat]=await readPasswords();
  if(password!==repeat)throw Error('The passwords did not match.');if(password.length<8||password.length>200)throw Error('Use a password between 8 and 200 characters.');
  for(const username of names){
   const displayName=db.prepare('SELECT display_name FROM users WHERE username=?').get(username)?.display_name??username[0].toUpperCase()+username.slice(1);
   db.prepare('INSERT INTO users(username,display_name,password_hash) VALUES(?,?,?) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash').run(username,displayName,hashPassword(password));
   db.prepare('DELETE FROM sessions WHERE username=?').run(username);
  }
  return console.log(`Password set for ${names.join(', ')}. Existing sessions were signed out.`);
 }
 if(command==='set-avatar'){
  const username=String(args[0]||'').toLowerCase(),path=args.slice(1).join(' ');
  if(!validUsername(username)||!path)throw Error('Usage: node server.mjs set-avatar <username> <image file>');
  const user=db.prepare('SELECT avatar FROM users WHERE username=?').get(username);if(!user)throw Error(`No account called ${username}.`);
  const bytes=readFileSync(path);if(bytes.length>5000000)throw Error('Choose a photo smaller than 5 MB.');if(!imageType(bytes))throw Error('Use a JPEG, PNG, WebP, GIF or AVIF photo.');
  const id=storeFile(username,'avatar'+extname(path),bytes,true);db.prepare('UPDATE users SET avatar=? WHERE username=?').run(id,username);
  if(user.avatar&&/^[-a-f0-9]{36}$/.test(user.avatar)){db.prepare('DELETE FROM files WHERE id=? AND user_id=?').run(user.avatar,username);try{unlinkSync(join(base,'files',user.avatar))}catch{}}
  return console.log(`Profile photo set for ${username}.`);
 }
 if(command==='list-users'){const rows=db.prepare('SELECT username,display_name FROM users ORDER BY username').all();return console.log(rows.length?rows.map(r=>`${r.username}\t${r.display_name}`).join('\n'):'No accounts yet.')}
 if(command==='migrate-owner'){
  const [from,to]=[String(args[0]||''),String(args[1]||'').toLowerCase()];if(!from||!validUsername(to))throw Error('Usage: node server.mjs migrate-owner <old-owner-id> <username>');
  if(db.prepare('SELECT 1 FROM trackers WHERE user_id=?').get(to))throw Error(`${to} already has tracker data; refusing to overwrite it.`);
  const moved=db.prepare('UPDATE trackers SET user_id=? WHERE user_id=?').run(to,from).changes,files=db.prepare('UPDATE files SET user_id=? WHERE user_id=?').run(to,from).changes;
  return console.log(`Moved ${moved} tracker and ${files} file record(s) from ${from} to ${to}.`);
 }
 // Bring back days that were wiped blank, from a backup copy of the database. Only days that are blank now are
 // filled; a day with anything logged is never touched.
 if(command==='restore-days'){
  const [username,file,...days]=args;if(!username||!file||!days.length)throw Error('Usage: node server.mjs restore-days <username> <backup.sqlite> <YYYY-MM-DD>...');
  const backup=new DatabaseSync(file,{readOnly:true}),old=JSON.parse(backup.prepare('SELECT data FROM trackers WHERE user_id=?').get(username)?.data??'null');backup.close();
  const row=db.prepare('SELECT data,revision FROM trackers WHERE user_id=?').get(username);if(!old||!row)throw Error('No tracker for that account in both copies.');
  const live=JSON.parse(row.data),done=[];
  for(const k of days){const from=old.days?.[k];if(!from||blankDay(from)){console.log(`${k}: nothing logged in the backup, skipped`);continue}
   if(live.days?.[k]&&!blankDay(live.days[k])){console.log(`${k}: already has progress now, left alone`);continue}
   live.days[k]=from;done.push(k)}
  if(!done.length)return console.log('Nothing restored.');
  const valid=stateSchema.safeParse(live);if(!valid.success)throw Error('The restored tracker failed validation; nothing was changed.');
  db.prepare('UPDATE trackers SET data=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(valid.data),username);
  return console.log(`Restored ${done.join(', ')} for ${username} (revision ${row.revision} -> ${row.revision+1}).`);
 }
 throw Error('Commands: set-password <username> [Display Name] | set-passwords <username>... | set-avatar <username> <image> | list-users | migrate-owner <old-owner-id> <username> | restore-days <username> <backup.sqlite> <day>...');
}
if(process.argv[2]){try{await cli(process.argv[2],process.argv.slice(3));db.close();process.exit(0)}catch(e){console.error(e.message);db.close();process.exit(1)}}

// ---------- configuration ----------
const port=Number(process.env.PORT||4317),dev=process.env.MAX_DEV_MODE==='1';
const origin=dev?`http://localhost:${port}`:process.env.MAX_ORIGIN;
const tailnetLogins=(process.env.MAX_ALLOWED_LOGIN||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
if(!dev&&!origin)throw Error('MAX_ORIGIN must be configured.');
const secureCookie=origin.startsWith('https://');
const basePath=(process.env.MAX_BASE_PATH||'').replace(/\/$/,'');
// Optional parts of the app, for everyone on this server: MAX_FEATURES=vault,coach (the default). Leave one out to turn it off.
// The coach also needs a model (selfhost/coach.mjs), and each person can switch it off in Profile.
const FEATURES=new Set((process.env.MAX_FEATURES??'vault,coach').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean));
const vaultOn=()=>FEATURES.has('vault');
const coachFor=username=>FEATURES.has('coach')&&trackerOf(username)?.settings?.coach!==false;
if(basePath&&!/^\/[a-z0-9-]+$/.test(basePath))throw Error('Invalid MAX_BASE_PATH');

// ---------- push notifications (Web Push; on iPhone this needs iOS 16.4+ and MAX added to the Home Screen) ----------
const kv=key=>db.prepare('SELECT value FROM app_kv WHERE key=?').get(key)?.value??null;
if(!kv('vapid_public')){const keys=webpush.generateVAPIDKeys();db.prepare("INSERT INTO app_kv(key,value) VALUES('vapid_public',?),('vapid_private',?)").run(keys.publicKey,keys.privateKey)}
const VAPID_PUBLIC=kv('vapid_public');
webpush.setVapidDetails(process.env.MAX_PUSH_SUBJECT||(secureCookie?origin:'mailto:max@localhost.invalid'),VAPID_PUBLIC,kv('vapid_private'));
async function pushTo(username,payload){
 const subs=db.prepare('SELECT endpoint,p256dh,auth FROM push_subs WHERE username=?').all(username);let sent=0;
 await Promise.all(subs.map(async s=>{try{await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth}},JSON.stringify(payload),{TTL:3600,urgency:'high'});sent++}catch(e){if(e?.statusCode===404||e?.statusCode===410)db.prepare('DELETE FROM push_subs WHERE endpoint=?').run(s.endpoint);else console.error('push failed:',e?.statusCode??e?.code??e?.message,e?.body??'')}}));
 return {sent,total:subs.length};
}
if(!db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name='full_name'").get())db.exec('ALTER TABLE users ADD COLUMN full_name TEXT');
if(!db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name='birthday'").get()){
 db.exec('ALTER TABLE users ADD COLUMN birthday TEXT');
 // Birthdays used to be "birthday-<username>" countdowns in the journal; they're on the account now.
 for(const row of db.prepare('SELECT data FROM shared').all()){try{for(const m of JSON.parse(row.data).moments??[])if(typeof m.id==='string'&&m.id.startsWith('birthday-')&&/^\d{4}-\d{2}-\d{2}$/.test(m.date))db.prepare('UPDATE users SET birthday=COALESCE(birthday,?) WHERE username=?').run(m.date,m.id.slice(9))}catch{}}
}
const trackerOf=username=>{const row=db.prepare('SELECT data FROM trackers WHERE user_id=?').get(username);try{return row?JSON.parse(row.data):null}catch{return null}};
// Dates and times in each person's own time zone (their phone reports it). The server clock may be UTC.
const DEFAULT_TZ=process.env.MAX_TIMEZONE||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',tzFormats=new Map();
function localAt(d,tz){
 let f=tzFormats.get(tz||DEFAULT_TZ);
 if(!f){try{f=new Intl.DateTimeFormat('en-CA',{timeZone:tz||DEFAULT_TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})}catch{return localAt(d,DEFAULT_TZ)}tzFormats.set(tz||DEFAULT_TZ,f)}
 const p=Object.fromEntries(f.formatToParts(d).map(x=>[x.type,x.value]));
 return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};
}
const tzOf=username=>trackerOf(username)?.settings?.timeZone;
// Partner activity respects the recipient's own switches (partner updates, hide couple things) and quiet hours.
function notifyPartners(fromUser,payload){
 for(const u of [spaces.partnerOf(fromUser.username)].filter(Boolean).map(username=>({username}))){
  const s=trackerOf(u.username)?.settings,{time}=localAt(new Date(),s?.timeZone);if(s&&(s.notifyPartner===false||s.hideCouple||inQuietHours(time,s.quietStart,s.quietEnd)))continue;
  pushTo(u.username,payload).catch(()=>{});
 }
}
// Reminders: goal times, your own reminders, the evening check-in and the daily-question nudge.
// Checked every 20s. Minutes missed while the server was restarting (up to 15) are caught up, and
// each nudge is recorded so it is sent once per day even across restarts and deploys.
db.exec('CREATE TABLE IF NOT EXISTS sent_nudges (key TEXT PRIMARY KEY, at INTEGER NOT NULL)');
// Moods: each person's own log. Only entries marked shared ever reach the partner (checked here, not in the app).
db.exec('CREATE TABLE IF NOT EXISTS moods (id TEXT PRIMARY KEY, username TEXT NOT NULL, mood TEXT NOT NULL, note TEXT NOT NULL, shared INTEGER NOT NULL, at INTEGER NOT NULL)');
db.exec('CREATE INDEX IF NOT EXISTS moods_user_at ON moods(username, at)');
// Daily advice (Progress tab): written fresh each morning at 6 am, by Coach MAX (the local model) for the assistant
// profile, or from the person's own numbers for everyone else. Kept one per person per day.
db.exec('CREATE TABLE IF NOT EXISTS coach_advice (username TEXT NOT NULL, day TEXT NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(username, day))');
const adviceBusy=new Set(),insightCache=new Map();
const trackingDay=username=>localAt(new Date(Date.now()-DAY_START_MINUTES*60000),tzOf(username)).date;
function ruleAdvice(s,today){
 const w=weeklyRecap(s,shiftDay(today,-6),today),y=dayStatus(s,shiftDay(today,-1));
 const opener=y==='done'?'Yesterday was a perfect day.':y==='logged'?'You showed up yesterday.':y==='missed'?'Yesterday slipped, and that’s okay.':'New day, fresh start.';
 const weak=w.goals.filter(g=>g.label!=='A private goal'&&g.label.toLowerCase()!=='sleep'&&g.planned).sort((a,b)=>a.done/a.planned-b.done/b.planned)[0];
 return weak&&weak.done<weak.planned?`${opener} Put ${weak.label} first today: it’s at ${weak.done}/${weak.planned} this week. One small win is enough to turn it around.`:`${opener} Every goal is on track this week, so keep the rhythm: do the easiest one first and let the rest follow.`;
}
async function makeAdvice(username){
 const day=trackingDay(username),have=db.prepare('SELECT text,source FROM coach_advice WHERE username=? AND day=?').get(username,day);if(have)return {day,...have};
 const u=db.prepare('SELECT username,display_name AS displayName FROM users WHERE username=?').get(username);if(!u)return null;
 const saved=trackerOf(username),s=saved?.settings?saved:initialState(u.displayName);
 let text='',source='rules';
 if(coachFor(username)&&coachAvailable()&&!adviceBusy.has(username)){adviceBusy.add(username);
  try{text=(await coachReply([{role:'system',content:coachPrompt(u)},{role:'user',content:'It is morning. Give me today’s advice in 2-3 short sentences: look at how my last few days went, name the one goal to put first today, and give one small concrete step.'}],()=>{},AbortSignal.timeout(180000))).replace(/M\.A\.X\.?/g,u.displayName).trim();source='coach'}
  catch(e){console.error('advice:',e?.message)}finally{adviceBusy.delete(username)}}
 if(!text){text=ruleAdvice(s,day);source='rules'}
 db.prepare('INSERT OR REPLACE INTO coach_advice(username,day,text,source,at) VALUES(?,?,?,?,?)').run(username,day,text.slice(0,1200),source,Date.now());
 db.prepare("DELETE FROM coach_advice WHERE at<?").run(Date.now()-90*86400000);
 return {day,text,source};
}
// Coach chat log: every exchange with M.A.X. (the message, what it logged, the reply), by tracking day, kept for History.
db.exec('CREATE TABLE IF NOT EXISTS coach_log (id INTEGER PRIMARY KEY, username TEXT NOT NULL, day TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, at INTEGER NOT NULL)');
db.exec('CREATE INDEX IF NOT EXISTS coach_log_user_day ON coach_log(username, day)');
const logCoach=(username,day,role,content)=>{if(content?.trim())db.prepare('INSERT INTO coach_log(username,day,role,content,at) VALUES(?,?,?,?,?)').run(username,day,role,content.slice(0,4000),Date.now())};
const moodRow=r=>r&&{id:r.id,username:r.username,mood:r.mood,note:r.note,shared:!!r.shared,at:r.at};
let lastMinute=Math.floor(Date.now()/60000)-1;
function reminderTick(){
 const now=Math.floor(Date.now()/60000);if(now<=lastMinute)return;
 const from=Math.max(lastMinute+1,now-15);lastMinute=now;
 const users=db.prepare('SELECT DISTINCT username FROM push_subs').all(),record=db.prepare('INSERT OR IGNORE INTO sent_nudges(key,at) VALUES(?,?)');
 for(let minute=from;minute<=now;minute++){
  for(const {username} of users){
   const state=trackerOf(username);if(!state?.settings)continue;
   const {date,time}=localAt(new Date(minute*60000),state.settings.timeZone);
   const qday=localAt(new Date((minute-DAY_START_MINUTES)*60000),state.settings.timeZone).date;
   const answered=!!db.prepare("SELECT 1 FROM daily WHERE date=? AND username=? AND answer<>''").get(qday,username);
   for(const n of dueNudges(state,date,time,{dailyAnswered:answered,question:promptFor(qday).question})){
    if(record.run(`${date}|${username}|${n.key}`,Date.now()).changes!==1)continue;
    pushTo(username,{title:n.title,body:n.body,tag:n.key,view:n.key==='evening'&&coachFor(username)&&!n.target?'Coach':n.view,...(n.target?{target:n.target}:{})}).catch(()=>{});
   }
   // Daily advice: refreshed at 6 am their time with a notification (asked for at 6 am, so it goes out in quiet hours too).
   if(time==='06:00'&&record.run(`${date}|${username}|advice`,Date.now()).changes===1){
    void makeAdvice(username).then(a=>{if(a)pushTo(username,{title:`☀️ ${a.source==='coach'?'Coach MAX':'Today'}: your advice for today`,body:a.text.slice(0,140),tag:`advice-${a.day}`,view:'Progress',target:'advice'}).catch(()=>{})}).catch(()=>{});
   }
   // Countdowns, at 9 am their time: the day before and on the day; birthdays also 7 and 3 days out. Birthdays say
   // which one ("Sam’s 24th birthday"), and your own birthday gets a happy birthday instead of a reminder.
   // At midnight on someone else's birthday (even in quiet hours): be the first to wish them.
   if(time==='09:00'||time==='00:00'){
    const nth=n=>`${n}${n%100>=11&&n%100<=13?'th':['th','st','nd','rd'][n%10]??'th'}`;
    for(const {m,next} of upcoming(momentsOf(username),date)){
     const days=Math.round((new Date(next+'T12:00:00')-new Date(date+'T12:00:00'))/86400000),bday=m.id.startsWith('birthday-');
     const whose=bday?m.id.slice(9):'',mine=whose===username,name=bday?db.prepare('SELECT display_name FROM users WHERE username=?').get(whose)?.display_name??'Someone':'';
     const age=Number(next.slice(0,4))-Number(m.date.slice(0,4)),which=age>0?`${nth(age)} `:'',title=bday?`${name}’s ${which}birthday`:m.title;
     // Couple things hidden: shared countdowns and the other person's birthday stay quiet (your own birthday doesn't).
     if(state.settings.hideCouple&&!mine)continue;
     let n=null;
     if(time==='00:00'){if(bday&&!mine&&days===0)n={title:`🎉 It’s ${name}’s birthday!`,body:`Be the first to wish ${name} a happy ${which}birthday.`}}
     else if(!inQuietHours(time,state.settings.quietStart,state.settings.quietEnd)){
      if(days===0)n=mine?{title:`🎂 Happy ${which}birthday, ${name}!`,body:'Have the best day. You deserve it.'}:{title:`${m.icon} Today: ${title}`,body:'The day is here. Make it special.'};
      else if(days===1)n={title:`${m.icon} Tomorrow: ${title}`,body:'One more sleep to go.'};
      else if(bday&&(days===7||days===3))n={title:`${m.icon} ${days} days to ${title}`,body:mine?'Your birthday is almost here 🎉':'Time to plan something special.'};
     }
     if(!n)continue;
     const key=`countdown-${m.id}-${next}-${time==='00:00'?'midnight':days}`;if(record.run(`${date}|${username}|${key}`,Date.now()).changes!==1)continue;
     pushTo(username,{...n,tag:key,view:'Journal'}).catch(()=>{});
    }
   }
  }
 }
 db.prepare('DELETE FROM sent_nudges WHERE at<?').run(Date.now()-3*86400000);
}
setInterval(reminderTick,20000).unref();
// Snapshots: a full copy of the database every 6 hours in data/snapshots, kept forever (each is under a megabyte).
// Taken live with SQLite's backup API, so the app keeps running. This is on top of the PC/NAS backups and doesn't
// depend on the PC being on, so a bad day can always be restored from within the last 6 hours.
const SNAPSHOTS=join(base,'snapshots');
async function snapshot(){
 try{mkdirSync(SNAPSHOTS,{recursive:true});
  const last=readdirSync(SNAPSHOTS).filter(f=>/^max-.*\.sqlite$/.test(f)).sort().at(-1);
  if(last&&Date.now()-statSync(join(SNAPSHOTS,last)).mtimeMs<6*3600000-5*60000)return;
  const stamp=new Date().toISOString().slice(0,16).replace('T','_').replace(':','');
  await sqliteBackup(db,join(SNAPSHOTS,`max-${stamp}.sqlite`));console.log(`snapshot saved: max-${stamp}.sqlite`);
 }catch(e){console.error('snapshot:',e.message)}
}
setTimeout(()=>void snapshot(),60000).unref();setInterval(()=>void snapshot(),15*60000).unref();

// ---------- sessions ----------
const COOKIE='max_session',REMEMBER_SECONDS=180*86400,SESSION_SECONDS=86400;
const tokenHash=token=>createHash('sha256').update(token).digest('hex');
function readCookie(req,name){for(const part of String(req.headers.cookie||'').split(';')){const i=part.indexOf('=');if(i>0&&part.slice(0,i).trim()===name)return part.slice(i+1).trim()}return ''}
function currentUser(req){const token=readCookie(req,COOKIE);if(!/^[a-f0-9]{64}$/.test(token))return null;return db.prepare('SELECT u.username,u.display_name AS displayName,u.full_name AS name,u.avatar,u.birthday FROM sessions s JOIN users u ON u.username=s.username WHERE s.token_hash=? AND s.expires>?').get(tokenHash(token),Date.now())??null}
const cookieHeader=(value,maxAge)=>`${COOKIE}=${value}; Path=${basePath}/; HttpOnly; SameSite=Strict${secureCookie?'; Secure':''}${maxAge==null?'':`; Max-Age=${maxAge}`}`;
const pruneSessions=()=>db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
pruneSessions();setInterval(pruneSessions,3600000).unref();
// Five wrong passwords lock that account's login for five minutes.
// Hidden photos: one shared vault, unlocked per browser with the PIN for a short time.
const VAULT_COOKIE='max_vault',VAULT_SECONDS=15*60,vaultSessions=new Map();
const validPin=pin=>typeof pin==='string'&&/^\d{4,12}$/.test(pin);
const vaultPinHash=username=>db.prepare('SELECT value FROM app_kv WHERE key=?').get('vault_pin:'+username)?.value??null;
function vaultUnlocked(req,username){const token=readCookie(req,VAULT_COOKIE);if(!/^[a-f0-9]{64}$/.test(token))return false;const key=tokenHash(token),s=vaultSessions.get(key);if(s&&s.expires<Date.now()){vaultSessions.delete(key);return false}return !!s&&s.username===username}
// Your own journal can be locked with your hidden-photos PIN (Profile). While it is, the server refuses the journal,
// its photos, its map pins and its part of the export until this browser is unlocked (the same 15-minute unlock).
const mineLockOn=username=>vaultOn()&&kv('mine_lock:'+username)==='1';
/** The id of your own journal while it's locked for this request, else null. */
const lockedSpace=(req,username)=>mineLockOn(username)&&!vaultUnlocked(req,username)?spaces.personalOf(username):null;
const vaultCookie=(value,maxAge)=>`${VAULT_COOKIE}=${value}; Path=${basePath}/api; HttpOnly; SameSite=Strict${secureCookie?'; Secure':''}; Max-Age=${maxAge}`;
const failures=new Map();
const isLocked=name=>(failures.get(name)?.until??0)>Date.now();
function recordFailure(name){const f=failures.get(name)??{count:0,until:0};f.count++;if(f.count>=5){f.count=0;f.until=Date.now()+300000}failures.set(name,f)}
const DUMMY_HASH=hashPassword(randomBytes(16).toString('hex'));
function startSession(res,username,remember){const token=randomBytes(32).toString('hex'),seconds=remember?REMEMBER_SECONDS:SESSION_SECONDS;db.prepare('INSERT INTO sessions(token_hash,username,expires) VALUES(?,?,?)').run(tokenHash(token),username,Date.now()+seconds*1000);res.setHeader('Set-Cookie',cookieHeader(token,remember?REMEMBER_SECONDS:null))}
// "Who's here?" lists every account before login: only behind the Tailscale gate, in dev, or when asked for.
const accountPicker=process.env.MAX_ACCOUNT_PICKER==='1'||(process.env.MAX_ACCOUNT_PICKER!=='0'&&(dev||tailnetLogins.length>0));

// ---------- helpers ----------
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
async function body(req,limit){let size=0;const parts=[];for await(const part of req){size+=part.length;if(size>limit){const e=new Error('Request too large');e.status=413;throw e}parts.push(part)}return Buffer.concat(parts)}
async function readJson(req,limit){const raw=(await body(req,limit)).toString();try{return JSON.parse(raw||'{}')}catch{const e=new Error('Invalid JSON');e.status=400;throw e}}
async function readUpload(req,limit){const bytes=await body(req,limit+1000000),form=await new Request('http://localhost',{method:'POST',headers:{'Content-Type':req.headers['content-type']||''},body:bytes}).formData(),file=form.get('file');return file instanceof File&&file.size<=limit?file:null}
function imageType(b){if(b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return'image/jpeg';const a=b.toString('latin1',0,12);if(a.startsWith('\x89PNG\r\n\x1a\n'))return'image/png';if(a.startsWith('GIF87a')||a.startsWith('GIF89a'))return'image/gif';if(a.startsWith('RIFF')&&a.slice(8,12)==='WEBP')return'image/webp';if(a.slice(4,12)==='ftypavif')return'image/avif';return null}
function storeFile(owner,name,bytes,shared,vault=false,space=null){const id=randomUUID();writeFileSync(join(base,'files',id),bytes,{mode:0o600});db.prepare('INSERT INTO files(id,user_id,name,size,shared,vault,space_id) VALUES(?,?,?,?,?,?,?)').run(id,owner,name.slice(0,150),bytes.length,shared?1:0,vault?1:0,shared?space??spaces.spaceOf(owner):null);if(!vault)recordGeo(id,jpegGps(bytes));return id}
// Photo locations for the memory map, read from each photo's EXIF once (null = no GPS in the photo).
db.exec('CREATE TABLE IF NOT EXISTS file_geo (id TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE, lat REAL, lng REAL)');
// Coach: at most 15 messages a minute per person, so the i3 isn't swamped.
const coachHits=new Map();
function coachLimiter(username){const now=Date.now(),hits=(coachHits.get(username)??[]).filter(t=>now-t<60000);if(hits.length>=15)return false;hits.push(now);coachHits.set(username,hits);return true}
// What the coach knows: today's goals from the person's own tracker, streaks, reflection and weight goal.
// Today's tracking day in the person's own time zone.
// Sleep is last night's sleep: logged once, not something to work on during the day. It's kept out of the 'still open'
// lists and told to the coach separately, so a short night becomes 'go to bed a bit earlier tonight', not a task.
const isSleep=e=>e?.goal?.kind==='duration'&&String(e.goal.category).toLowerCase()==='sleep';
function sleepFact(day){const e=day.entries.find(x=>isSleep(x)&&!x.rest&&!x.goal.private);if(!e)return null;
 if(e.noSleep)return "Sleep: they didn't or couldn't sleep at all last night. Be gentle and practical: go easy today, no late caffeine, and an early night tonight.";
 return !(e.value>0)?"Sleep: last night isn't logged yet. It's logged once in the morning; it can't be worked on during the day."
  :e.value>=e.goal.target?`Sleep: ${e.value} of ${e.goal.target} ${e.goal.unit} last night, on target.`
  :`Sleep: only ${e.value} of ${e.goal.target} ${e.goal.unit} last night (short). Nothing to do about it today; tonight they should wind down and get to bed a little earlier, and keep a steady bedtime.`}
function coachToday(user){
 const s=trackerOf(user.username);if(!s?.settings||!Array.isArray(s.goals))return null;
 const today=localAt(new Date(Date.now()-DAY_START_MINUTES*60000),s.settings.timeZone).date;
 return {s,today,day:structuredClone(s.days?.[today]??dayFor(s,today))};
}
// `logged`: what the app just filled in from their last message (already applied to `t.day`).
function coachPrompt(user,t=coachToday(user),logged=[]){
 const s=t?.s,name=user.displayName||user.username;
 const facts=[];
 if(t){
  const tz=s.settings.timeZone,now=new Date(),clock=localAt(now,tz),today=t.today;
  const weekday=new Intl.DateTimeFormat('en-US',{weekday:'long',timeZone:tz||undefined}).format(now);
  const day=t.day,label=e=>e.goal.private?'a private goal':e.goal.category;
  const detail=e=>e.goal.kind==='checklist'?` (${e.checks.filter(Boolean).length}/${needOf(e.goal)} done)`:['count','duration'].includes(e.goal.kind)?` (${e.value}/${e.goal.target} ${e.goal.unit})`:'';
  const weekly=day.entries.filter(e=>e.goal.essential&&!e.rest&&isFlexible(e.goal));
  const ess=day.entries.filter(e=>e.goal.essential&&!e.rest&&!isFlexible(e.goal)&&!isSleep(e)),bonus=day.entries.filter(e=>!e.goal.essential&&!e.rest);
  const done=ess.filter(complete),open=ess.filter(e=>!complete(e));
  facts.push(`It is ${weekday}, ${clock.time} for them. Their day resets at 5:30 am.`);
  facts.push(`Main goals: ${done.length} of ${ess.length} done.${done.length?` Done: ${done.map(label).join(', ')}.`:''}${open.length?` Still open: ${open.map(e=>label(e)+(fraction(e)>0?detail(e):'')).join(', ')}.`:''}`);
  {const w=weeklyRecap(s,weekOf(today),today);if(w.days)facts.push(`This week so far (day ${w.days} of 7): ${w.perfect} perfect, ${w.logged} showed up, ${w.missed} missed.${w.best?` Strongest: ${w.best}.`:''}${w.focus?` Needs work: ${w.focus}.`:''}`)}
  if(weekly.length)facts.push(`Weekly goals: ${weekly.map(e=>`${label(e)} ${weekCount(s,e.goal.id,today)}/${e.goal.perWeek} this week`).join(', ')}.`);
  {const sl=sleepFact(day);if(sl)facts.push(sl)}
  // When things happened: late or missed meals, late nights and mornings (lib/timing).
  for(const e of day.entries){const def=s.goals.find(g=>g.id===e.goal.id)??e.goal;facts.push(...timingFacts(def,e,clock.time))}
  // Exercises (or items) they said they couldn't do today: understanding, not pushy.
  for(const e of day.entries){if(!e.couldnt?.length||e.goal.private)continue;const names=e.couldnt.map(i=>String(e.goal.items[i]??'').split('·')[0].trim()).filter(Boolean);if(names.length)facts.push(`${e.goal.category}: couldn't do ${names.join(', ')} today. Ask what got in the way (sore, injured, no time) and suggest something lighter.`)}
  if(day.energy==='full')facts.push('Full energy today: they chose stretch goals (every exercise, +25% reps). Push them a little.');
  if(day.lowEnergy)facts.push('Today is a low-energy day: they switched to smaller goals. Be extra gentle; smaller wins count.');
  if(bonus.length)facts.push(`Bonus goals done: ${bonus.filter(complete).map(label).join(', ')||'none yet'}.`);
  facts.push(`Reflection for today: ${day.reflection?.trim()?'written':'not written yet'}.`);
  facts.push(`Streak: ${streak(s)} days of showing up; ${perfectStreak(s)} perfect days in a row. Yesterday was ${({done:'a perfect day',logged:'updated but not perfect',missed:'missed',none:'a rest day'})[dayStatus(s,shiftDay(today,-1))]}.`);
  {const r=resistStreak(s);if(r.best||r.worst)facts.push(r.current<0?`Self-control: gave in ${-r.current} time${r.current===-1?'':'s'} in a row (best resisting streak ${r.best}). Be firm but kind: the next resist starts a new streak.`:`Self-control resistance streak: resisted ${r.current} time${r.current===1?'':'s'} in a row (best ${r.best}). Cheer it on.`)}
  if(s.body){const p=bodyProgress(s.body),w=bodyWeekly(s.body);facts.push(`Weight goal: ${p.dir==='gain'?'gain':'lose'} weight, ${s.body.start} to ${s.body.target} kg; now ${p.now} kg, ${p.remaining} kg to go. Weekly weigh-in ${w.due?'is due':'is done'}.`)}
 }
 // Kept short on purpose: every prompt token costs time on the i3, and the short version gave sharper replies.
 // Coming up in the next week (birthdays in the next two): the coach reminds them to plan, get a gift, or be first to wish.
 {const today=trackingDay(user.username),nth=n=>`${n}${n%100>=11&&n%100<=13?'th':['th','st','nd','rd'][n%10]??'th'}`;
  const soon=upcoming(momentsOf(user.username),today).map(({m,next})=>({m,next,days:Math.round((new Date(next+'T12:00:00')-new Date(today+'T12:00:00'))/86400000)}))
   .filter(x=>x.days<=(x.m.id.startsWith('birthday-')?14:7)&&(!trackerOf(user.username)?.settings?.hideCouple||x.m.id===`birthday-${user.username}`)).slice(0,4).map(({m,next,days})=>{
    const when=days===0?'today':days===1?'tomorrow':`in ${days} days (${new Date(next+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})})`;
    if(!m.id.startsWith('birthday-'))return `${m.title} ${when}`;
    const whose=m.id.slice(9),age=Number(next.slice(0,4))-Number(m.date.slice(0,4)),which=age>0?`${nth(age)} `:'';
    return whose===user.username?`their own ${which}birthday ${when}`:`${db.prepare('SELECT display_name FROM users WHERE username=?').get(whose)?.display_name??'someone'}’s ${which}birthday ${when}`});
  if(soon.length)facts.push(`Coming up: ${soon.join('; ')}.`)}
 {const m=db.prepare('SELECT mood,note,at FROM moods WHERE username=? ORDER BY at DESC LIMIT 1').get(user.username);if(m&&Date.now()-m.at<18*3600000)facts.push(`Latest mood: ${moodOf(m.mood).label}${m.note?` ("${m.note.slice(0,120)}")`:''}.`)}
 if(logged.length)facts.push(`Just logged from their message: ${logged.join('; ')}.`);
 // The person is called Max and the coach M.A.X.: a 3B model mixes them up unless told plainly (the reply is also cleaned up).
 return `You are the coach inside ${name}'s habits app (the app calls you "M.A.X."). The person you're talking to is ${name}; call them ${name}, never "M.A.X.". Talk like a caring older brother: warm, direct, a bit playful. `+
  `Keep them accountable and get them to log what they did. Reply in 2-3 short sentences, one question at most. `+
  `Use only the TODAY facts, never invent numbers. Praise one specific win, then nudge one open goal with a small next step. `+
  `If they are struggling, be kind first, then practical. No lists, at most one emoji, no medical or extreme diet advice. `+
  `The app fills in their tracker by itself from what they tell you. Never say you logged, added or updated something unless it is under "Just logged"; if it is, confirm it in a few words. If something they did isn't logged, tell them to tap it on the Today page. `+
  `Sleep is last night's sleep and can't be done or improved during the day: never list it as something left to do or tackle. If it was short, mention it kindly and suggest getting to bed a little earlier tonight; if it isn't logged, just ask them to log it. `+
  `Timing matters too: if a meal was late or missed, or they went to bed late, woke up late or overslept, say so plainly but kindly, ask them to do better, and remind them of the next meal window or tonight's bedtime. `+
  `If "Coming up" has someone's birthday, remind them in a sentence: plan something or get a gift early, and on the eve, stay up to be the first to wish them. If it's their own birthday, celebrate it. `+
  `If they describe their day, suggest saving it to today's reflection.`+
  (facts.length?`\n\nTODAY:\n- ${facts.join('\n- ')}`:'');
}
const sharedDoc=space=>{try{return JSON.parse(db.prepare('SELECT data FROM shared WHERE id=?').get(space)?.data??'null')??initialShared()}catch{return initialShared()}};
// Removes a shared (or the person's own) photo file for good. Never vault photos or profile pictures.
function purgeFile(id,username){
 const f=username?db.prepare(`SELECT 1 FROM files f WHERE f.id=? AND f.vault=0 AND ${VISIBLE_FILE}`).get(id,...visibleArgs(username)):db.prepare('SELECT 1 FROM files WHERE id=? AND vault=0').get(id);
 if(!f||db.prepare('SELECT 1 FROM users WHERE avatar=?').get(id))return false;
 db.prepare('DELETE FROM files WHERE id=?').run(id);try{unlinkSync(join(base,'files',id))}catch{}
 return true;
}
// Recently deleted empties itself: photos older than TRASH_DAYS (and entries whose file is gone) are removed.
function purgeOldTrash(){for(const row of db.prepare('SELECT id,data FROM shared').all())purgeSpaceTrash(row)}
function purgeSpaceTrash(row){
 let doc;try{doc=JSON.parse(row.data)}catch{return}
 const cutoff=Date.now()-TRASH_DAYS*86400000,keep=[];let changed=false;
 for(const p of doc.photoTrash??[]){const expired=Date.parse(p.deletedAt)<cutoff;if(expired)purgeFile(p.id);if(expired||!db.prepare('SELECT 1 FROM files WHERE id=?').get(p.id)){changed=true;continue}keep.push(p)}
 const trashKept=(doc.journalTrash??[]).filter(t=>!(Date.parse(t.deletedAt)<cutoff));if(trashKept.length!==(doc.journalTrash??[]).length){doc.journalTrash=trashKept;changed=true}
 if(changed){doc.photoTrash=keep;db.prepare('UPDATE shared SET data=?,revision=revision+1 WHERE id=?').run(JSON.stringify(doc),row.id)}
}
setTimeout(purgeOldTrash,5000).unref();setInterval(purgeOldTrash,6*3600000).unref();
function recordGeo(id,g){db.prepare('INSERT OR REPLACE INTO file_geo(id,lat,lng) VALUES(?,?,?)').run(id,g?.lat??null,g?.lng??null);return g}
function readHead(id,size=262144){const fd=openSync(join(base,'files',id),'r');try{const b=Buffer.alloc(size);return b.subarray(0,readSync(fd,b,0,size,0))}finally{closeSync(fd)}}
// Only photos this person may open: shared ones or their own. Hidden-vault photos are excluded here, not just in the UI.
function visibleGeo(username,hidden=null){
 for(const {id} of db.prepare(`SELECT f.id FROM files f LEFT JOIN file_geo g ON g.id=f.id WHERE g.id IS NULL AND f.vault=0 AND ${VISIBLE_FILE}`).all(...visibleArgs(username))){try{recordGeo(id,existsSync(join(base,'files',id))?jpegGps(readHead(id)):null)}catch{recordGeo(id,null)}}
 return db.prepare(`SELECT f.id,g.lat,g.lng,f.space_id FROM files f JOIN file_geo g ON g.id=f.id WHERE g.lat IS NOT NULL AND f.vault=0 AND ${VISIBLE_FILE}`).all(...visibleArgs(username)).filter(f=>!hidden||f.space_id!==hidden).map(({space_id,...f})=>f);
}
// displayName is the nickname, used everywhere in the app; name is the person's real name (Profile only).
const publicUser=u=>({username:u.username,displayName:u.displayName,...(u.name?{name:u.name}:{}),avatar:u.avatar??null,...(u.birthday?{birthday:u.birthday}:{})});
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const gatePage='<!doctype html><html><meta name="viewport" content="width=device-width"><title>Maximum Overdrive</title><body style="background:#100e18;color:#ede3ff;font:18px system-ui;padding:10vw"><h1>Maximum Overdrive</h1><p>This is a private space.</p><p>Connect Tailscale on your phone or computer, then reopen this link.</p></body></html>';

const accounts=createAccounts({db,dev,json,readJson,hashPassword,verifyPassword,dummyHash:DUMMY_HASH,validUsername,isLocked,recordFailure,clearFailures:name=>failures.delete(name),startSession,publicUser,picker:accountPicker,
 checkInvite:spaces.checkInvite,rememberInvite:spaces.rememberInvite,onReady:spaces.onAccountReady});

// ---------- server ----------
const server=createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self' https://nominatim.openstreetmap.org; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
 const url=new URL(req.url,'http://localhost');
 if(basePath&&url.pathname===basePath){res.writeHead(308,{Location:basePath+'/'});return res.end()}
 if(basePath&&url.pathname.startsWith(basePath+'/'))url.pathname=url.pathname.slice(basePath.length);
 if(url.pathname==='/health'&&req.method==='GET')return json(res,200,{ok:true});
 // Optional network gate: only the listed Tailscale identities may reach the app at all.
 if(!dev&&tailnetLogins.length&&!tailnetLogins.includes(String(req.headers['tailscale-user-login']||'').toLowerCase())){
  if(url.pathname.startsWith('/api/'))return json(res,401,{error:'Connect using Tailscale to open MAX.'});
  res.writeHead(401,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(gatePage);
 }
 if(['POST','PUT','DELETE','PATCH'].includes(req.method)&&req.headers.origin!==origin)return json(res,403,{error:'Invalid request origin.'});
 try{
  // ----- public auth endpoints -----
  if(await accounts.handle(req,res,url))return;
  if(!accountPicker&&url.pathname.startsWith('/api/accounts'))return json(res,404,{error:'Not found.'});
  if(url.pathname==='/api/accounts'&&req.method==='GET')return json(res,200,{accounts:db.prepare('SELECT username,display_name AS displayName,avatar FROM users ORDER BY rowid').all().map(a=>({username:a.username,displayName:a.displayName,avatarVersion:a.avatar?a.avatar.slice(0,8):null}))});
  // Profile photos only, so "Who's here?" can show faces before login. Other files still need a session.
  if(url.pathname==='/api/accounts/avatar'&&req.method==='GET'){const u=db.prepare('SELECT avatar FROM users WHERE username=?').get(String(url.searchParams.get('u')||'').toLowerCase());const id=u?.avatar;if(!id||!/^[-a-f0-9]{36}$/.test(id)||db.prepare('SELECT 1 FROM files WHERE id=? AND vault=1').get(id)||!existsSync(join(base,'files',id)))return json(res,404,{error:'No photo.'});const bytes=readFileSync(join(base,'files',id)),image=imageType(bytes);if(!image)return json(res,404,{error:'No photo.'});res.writeHead(200,{'Content-Type':image,'Content-Disposition':'inline','Cache-Control':'private, max-age=3600'});return res.end(bytes)}
  if(url.pathname==='/api/logout'&&req.method==='POST'){const token=readCookie(req,COOKIE);if(/^[a-f0-9]{64}$/.test(token))db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));{const vt=readCookie(req,VAULT_COOKIE);if(vt)vaultSessions.delete(tokenHash(vt))}res.setHeader('Set-Cookie',[cookieHeader('',0),vaultCookie('',0)]);return json(res,200,{ok:true})}

  // ----- everything else under /api needs a session -----
  const user=url.pathname.startsWith('/api/')?currentUser(req):null;
  if(url.pathname.startsWith('/api/')&&!user)return json(res,401,{error:'Please log in.'});
  if(url.pathname==='/api/me'&&req.method==='GET')return json(res,200,{user:publicUser(user)});
  if(await accounts.handleSignedIn(req,res,url,user))return;
  if(await spaces.handle(req,res,url,user))return;
  if(url.pathname==='/api/features'&&req.method==='GET')return json(res,200,{vault:vaultOn(),coach:FEATURES.has('coach')&&coachAvailable(),coachOn:coachFor(user.username)});
  // Your name and nickname. The nickname is what the app calls you everywhere (and what your partner sees).
  if(url.pathname==='/api/profile'&&req.method==='PUT'){
   const p=await readJson(req,5000),nickname=typeof p.nickname==='string'?p.nickname.trim().replace(/\s+/g,' '):'',name=typeof p.name==='string'?p.name.trim().replace(/\s+/g,' '):'';
   if(!nickname||nickname.length>30)return json(res,400,{error:'Choose a nickname up to 30 characters.'});
   if(name.length>60)return json(res,400,{error:'Keep your name under 60 characters.'});
   db.prepare('UPDATE users SET display_name=?,full_name=? WHERE username=?').run(nickname,name||null,user.username);
   return json(res,200,{user:publicUser({...user,displayName:nickname,name})});
  }
  // Your birthday (YYYY-MM-DD, or '' to clear): on your account, so it follows you whichever journal you're in.
  if(url.pathname==='/api/profile/birthday'&&req.method==='PUT'){
   const {birthday}=await readJson(req,1000),value=typeof birthday==='string'?birthday:'';
   if(value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value+'T12:00:00'))||value>dateKey()||value<'1900-01-01'))return json(res,400,{error:'Pick a real date up to today.'});
   db.prepare('UPDATE users SET birthday=? WHERE username=?').run(value||null,user.username);
   return json(res,200,{user:publicUser({...user,birthday:value||undefined})});
  }
  if(url.pathname==='/api/users'&&req.method==='GET')return json(res,200,{users:spaces.circleOf(user.username).map(publicUser)});
  // Daily couple prompt. Writes are only accepted for the server's today; a partner's answer stays hidden
  // until you have answered yourself (or the day is over).
  // Export everything you can see as one zip: your tracker, the shared journal, your moods and daily answers
  // (data.json) plus every photo you can open (shared ones and your own; never hidden-vault photos).
  if(url.pathname==='/api/export'&&req.method==='GET'){
   const locked=lockedSpace(req,user.username),docOf=sp=>sp===locked?{locked:'Unlock your journal in the app to include it.'}:sharedDoc(sp);
   const data={exported:new Date().toISOString(),user:publicUser(user),tracker:trackerOf(user.username),shared:docOf(spaces.spaceOf(user.username)),mine:spaces.coupleOf(user.username)?docOf(spaces.personalOf(user.username)):undefined,
    moods:db.prepare('SELECT mood,note,shared,at FROM moods WHERE username=? ORDER BY at').all(user.username),
    daily:db.prepare("SELECT date,answer,task_done AS taskDone FROM daily WHERE username=? AND answer<>'' ORDER BY date").all(user.username)};
   const photos=db.prepare(`SELECT f.id,f.name,f.space_id FROM files f WHERE f.vault=0 AND ${VISIBLE_FILE} ORDER BY f.rowid`).all(...visibleArgs(user.username)).filter(f=>(!locked||f.space_id!==locked)&&existsSync(join(base,'files',f.id)));
   const stamp=localAt(new Date(),tzOf(user.username)).date;
   res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="max-export-${user.username}-${stamp}.zip"`,'Cache-Control':'no-store'});
   // A plain (stored) zip, written as it goes: photos are already compressed.
   const central=[];let offset=0;const now=new Date(),dosTime=(now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1),dosDate=((now.getFullYear()-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate();
   const add=(name,bytes)=>{const n=Buffer.from(name,'utf8'),crc=crc32(bytes),h=Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(0x0800,6);h.writeUInt16LE(0,8);h.writeUInt16LE(dosTime,10);h.writeUInt16LE(dosDate,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(bytes.length,18);h.writeUInt32LE(bytes.length,22);h.writeUInt16LE(n.length,26);h.writeUInt16LE(0,28);
    res.write(h);res.write(n);res.write(bytes);central.push({n,crc,size:bytes.length,offset});offset+=30+n.length+bytes.length};
   add('data.json',Buffer.from(JSON.stringify(data,null,2)));
   const used=new Set();
   for(const f of photos){const ext=(/\.[a-z0-9]{2,5}$/i.exec(f.name)?.[0]??'.jpg').toLowerCase();let name=`photos/${f.id}${ext}`;if(used.has(name))continue;used.add(name);try{add(name,readFileSync(join(base,'files',f.id)))}catch{}}
   let size=0;for(const c of central){const h=Buffer.alloc(46);h.writeUInt32LE(0x02014b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(20,6);h.writeUInt16LE(0x0800,8);h.writeUInt16LE(0,10);h.writeUInt16LE(dosTime,12);h.writeUInt16LE(dosDate,14);h.writeUInt32LE(c.crc,16);h.writeUInt32LE(c.size,20);h.writeUInt32LE(c.size,24);h.writeUInt16LE(c.n.length,28);h.writeUInt32LE(c.offset,42);res.write(h);res.write(c.n);size+=46+c.n.length}
   const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(central.length,8);end.writeUInt16LE(central.length,10);end.writeUInt32LE(size,12);end.writeUInt32LE(offset,16);
   return res.end(end);
  }
  if(url.pathname==='/api/moods'){
   if(req.method==='GET'){
    const mine=db.prepare('SELECT * FROM moods WHERE username=? ORDER BY at DESC LIMIT 60').all(user.username).map(moodRow);
    const partners=spaces.circleOf(user.username).filter(u=>u.username!==user.username).map(u=>({...publicUser(u),latest:moodRow(db.prepare('SELECT * FROM moods WHERE username=? AND shared=1 ORDER BY at DESC LIMIT 1').get(u.username))??null}));
    return json(res,200,{mine,partners});
   }
   if(req.method==='POST'){
    const p=await readJson(req,5000),note=typeof p.note==='string'?p.note.trim().slice(0,500):'';
    if(!MOODS.some(m=>m.key===p.mood))return json(res,400,{error:'Pick a mood.'});
    const row={id:randomUUID(),username:user.username,mood:p.mood,note,shared:p.shared===false?0:1,at:Date.now()};
    db.prepare('INSERT INTO moods(id,username,mood,note,shared,at) VALUES(?,?,?,?,?,?)').run(row.id,row.username,row.mood,row.note,row.shared,row.at);
    db.prepare('DELETE FROM moods WHERE username=? AND id NOT IN (SELECT id FROM moods WHERE username=? ORDER BY at DESC LIMIT 1000)').run(user.username,user.username);
    if(row.shared){const m=moodOf(row.mood);notifyPartners(user,{view:'Today',title:`${user.displayName} is feeling ${m.label.toLowerCase()} ${m.emoji}`,body:note||'Tap to see how they’re doing.',tag:`mood-${user.username}`,url:'/'})}
    return json(res,200,{mood:moodRow(row)});
   }
   if(req.method==='DELETE'){
    const id=url.searchParams.get('id')||'';
    return json(res,200,{deleted:db.prepare('DELETE FROM moods WHERE id=? AND username=?').run(id,user.username).changes});
   }
  }
  // Couple stats for the Journal: how many daily questions you've answered (and both of you), out of the question pool.
  if(url.pathname==='/api/daily/stats'&&req.method==='GET'){
   const mine=db.prepare("SELECT date FROM daily WHERE username=? AND answer<>''").all(user.username).map(r=>r.date);
   const archived=db.prepare("SELECT DISTINCT date FROM daily_archive WHERE username=? AND kind='answer'").all(user.username).map(r=>r.date);
   const dates=[...new Set([...mine,...archived])],questions=new Set(dates.map(d=>promptFor(d).question));
   const partner=spaces.partnerOf(user.username),both=partner?db.prepare("SELECT COUNT(*) n FROM (SELECT date FROM daily WHERE answer<>'' AND username IN (?,?) GROUP BY date HAVING COUNT(DISTINCT username)>1)").get(user.username,partner).n:0;
   return json(res,200,{answered:dates.length,both,questions:questions.size,total:dailyQuestions.length});
  }
  if(url.pathname==='/api/daily'){
   // The question's day is the tracking day (5:30 am to 5:30 am), the same day the app shows: after midnight you're still
   // answering tonight's question, not locked out of it.
   const today=trackingDay(user.username);
   if(req.method==='GET'){
    const date=url.searchParams.get('date')||today;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>today)return json(res,400,{error:'Choose today or an earlier day.'});
    const rows=db.prepare('SELECT username,answer,task_done FROM daily WHERE date=?').all(date).filter(r=>r.username===user.username||r.username===spaces.partnerOf(user.username)),mine=rows.find(r=>r.username===user.username),reveal=!!mine?.answer||date<today;
    const partners=spaces.circleOf(user.username).filter(u=>u.username!==user.username).map(u=>{const r=rows.find(x=>x.username===u.username);return {...publicUser(u),answered:!!r?.answer,answer:reveal?(r?.answer??''):null,taskDone:!!r?.task_done}});
    // Read-only answers imported from an earlier app, shown on the day they were written.
    const circle=spaces.circleOf(user.username).map(u=>u.username),archive=db.prepare(`SELECT a.username,u.display_name AS displayName,u.avatar,a.kind,a.text,a.source FROM daily_archive a LEFT JOIN users u ON u.username=a.username WHERE a.date=? AND a.username IN (${circle.map(()=>'?').join(',')}) ORDER BY a.created`).all(date,...circle).map(r=>({username:r.username,displayName:r.displayName??r.username,avatar:r.avatar??null,kind:r.kind,text:r.text,source:r.source}));
    return json(res,200,{date,today,...promptFor(date),me:{answer:mine?.answer??'',taskDone:!!mine?.task_done},partners,archive});
   }
   if(req.method==='PUT'){
    const payload=await readJson(req,20000);
    if(payload.date!==today)return json(res,403,{error:'Daily answers can only be changed on the day itself.'});
    if(payload.answer!==undefined&&(typeof payload.answer!=='string'||payload.answer.length>2000))return json(res,400,{error:'Keep your answer under 2000 characters.'});
    if(payload.taskDone!==undefined&&typeof payload.taskDone!=='boolean')return json(res,400,{error:'Invalid task status.'});
    const current=db.prepare('SELECT answer,task_done FROM daily WHERE date=? AND username=?').get(today,user.username);
    const answer=payload.answer!==undefined?payload.answer.trim():current?.answer??'',taskDone=payload.taskDone!==undefined?payload.taskDone:!!current?.task_done;
    db.prepare('INSERT INTO daily(date,username,answer,task_done,updated) VALUES(?,?,?,?,?) ON CONFLICT(date,username) DO UPDATE SET answer=excluded.answer,task_done=excluded.task_done,updated=excluded.updated').run(today,user.username,answer,taskDone?1:0,Date.now());
    if(answer&&!current?.answer)notifyPartners(user,{view:'Journal',title:`${user.displayName} answered today’s question`,body:'Answer yours to see what they said.',tag:`daily-${today}`,url:'/'});
    return json(res,200,{ok:true});
   }
  }
  if(url.pathname==='/api/profile/avatar'&&req.method==='POST'){
   const file=await readUpload(req,5000000);if(!file)return json(res,400,{error:'Choose a photo smaller than 5 MB.'});
   const bytes=Buffer.from(await file.arrayBuffer());if(!imageType(bytes))return json(res,400,{error:'Choose a JPEG, PNG, WebP, GIF or AVIF photo.'});
   const id=storeFile(user.username,file.name||'avatar',bytes,true),old=user.avatar;
   db.prepare('UPDATE users SET avatar=? WHERE username=?').run(id,user.username);
   if(old&&/^[-a-f0-9]{36}$/.test(old)){db.prepare('DELETE FROM files WHERE id=? AND user_id=?').run(old,user.username);try{unlinkSync(join(base,'files',old))}catch{}}
   return json(res,200,{user:publicUser({...user,avatar:id})});
  }
  if(url.pathname==='/api/state'){
   if(req.method==='GET'){const row=db.prepare('SELECT data,revision FROM trackers WHERE user_id=?').get(user.username);return json(res,200,row?{state:JSON.parse(row.data),revision:row.revision}:{state:initialState(user.displayName),revision:0})}
   if(['PUT','POST'].includes(req.method)){
    const payload=await readJson(req,3000000),result=stateSchema.safeParse(req.method==='POST'?payload:payload.state);
    // Logged (field paths only, no content) so a device stuck on "unsaved changes" can be diagnosed.
    if(!result.success){console.error(`state rejected for ${user.username}:`,result.error.issues.slice(0,4).map(i=>`${i.path.join('.')} ${i.message}`).join('; '));return json(res,400,{error:'Please check your goal settings or backup data.'})}
    if(req.method==='POST')return json(res,200,result.data);
    if(!Number.isSafeInteger(payload.revision)||payload.revision<0)return json(res,400,{error:'Invalid revision.'});
    const current=db.prepare('SELECT revision FROM trackers WHERE user_id=?').get(user.username);
    if((current?.revision??0)!==payload.revision)return json(res,409,{error:'This tracker changed on another device. Export your edits, then reload to get the latest version.'});
    // Safety net: a past day with anything logged is never replaced by a blank or missing copy (a device that slept
    // through those days fills them in empty). The device is told, so it reloads the real days.
    const kept=[];
    {const cur=db.prepare('SELECT data FROM trackers WHERE user_id=?').get(user.username);
     if(cur)try{const old=JSON.parse(cur.data),today=trackingDay(user.username);result.data.days??={};
      for(const [k,d] of Object.entries(old.days??{})){if(k>=today||blankDay(d))continue;const n=result.data.days[k];if(!n||blankDay(n)){result.data.days[k]=d;kept.push(k)}}}catch(e){console.error('state guard:',e.message)}
     if(kept.length)console.error(`kept logged days for ${user.username} (a device sent them blank): ${kept.join(', ')}`)}
    const next=payload.revision+1;db.prepare('INSERT INTO trackers(user_id,data,revision) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,revision=excluded.revision').run(user.username,JSON.stringify(result.data),next);
    return json(res,200,{revision:next,...(kept.length?{adjusted:kept}:{})});
   }
  }
  // The journal and moments: your own (?space=mine) or the one you share with your partner (the default when paired).
  if(url.pathname==='/api/shared'){
   const space=spaces.spaceFor(user.username,url.searchParams.get('space'));if(!space)return json(res,404,{error:'You don’t have a shared journal right now.'});
   if(space===lockedSpace(req,user.username))return json(res,403,{error:'Your journal is locked.',locked:true});
   if(req.method==='GET'){const row=db.prepare('SELECT data,revision FROM shared WHERE id=?').get(space);return json(res,200,row?{shared:JSON.parse(row.data),revision:row.revision}:{shared:initialShared(),revision:0})}
   if(req.method==='PUT'){
    const payload=await readJson(req,5000000),result=sharedSchema.safeParse(payload.shared);
    if(!result.success)return json(res,400,{error:'Please check the journal entry and try again.'});
    if(!Number.isSafeInteger(payload.revision)||payload.revision<0)return json(res,400,{error:'Invalid revision.'});
    const current=db.prepare('SELECT revision FROM shared WHERE id=?').get(space);
    if((current?.revision??0)!==payload.revision)return json(res,409,{error:'The journal changed. Getting the latest version…'});
    const before=(()=>{try{return JSON.parse(db.prepare('SELECT data FROM shared WHERE id=?').get(space)?.data??'null')}catch{return null}})();
    // Only photo admins (Max) can put photos in Recently deleted, stamped with their own name and a recent time
    // (up to a week old, for deletes made offline; never in the future).
    const oldTrash=new Set((before?.photoTrash??[]).map(p=>p.id));
    for(const p of result.data.photoTrash??[])if(!oldTrash.has(p.id)&&(p.deletedBy!==user.username||!(Date.parse(p.deletedAt)<=Date.now()+3600000&&Date.parse(p.deletedAt)>=Date.now()-7*86400000)))return json(res,403,{error:'Please try deleting that again.'});
    // Journal deletes are stamped with the deleter's own name.
    const oldBin=new Set((before?.journalTrash??[]).map(t=>t.id));
    for(const t of result.data.journalTrash??[])if(!oldBin.has(t.id)&&t.deletedBy!==user.username)return json(res,403,{error:'Please try deleting that again.'});
    const next=payload.revision+1;db.prepare('INSERT INTO shared(id,data,revision) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,revision=excluded.revision').run(space,JSON.stringify(result.data),next);
    if(before&&spaces.isCouple(space)){const binned=(before.journalTrash??[]).flatMap(t=>t.memory?[t.memory]:[]),oldIds=new Set([...before.journal,...binned].map(e=>e.id)),oldComments=new Set([...before.journal,...binned].flatMap(e=>(e.comments??[]).map(c=>c.id)).concat((before.journalTrash??[]).filter(t=>t.kind==='comment').map(t=>t.id)));
     for(const e of result.data.journal){
      if(!oldIds.has(e.id)&&e.author===user.username)notifyPartners(user,{view:'Journal',title:`${user.displayName} added a memory`,body:e.sensitive?'A sensitive memory 🔒':(e.title||'Open the journal to see it.'),tag:`memory-${e.id}`,url:'/'});
      for(const c of e.comments??[])if(!oldComments.has(c.id)&&c.author===user.username)notifyPartners(user,{view:'Journal',title:`${user.displayName} commented`,body:e.sensitive?'On a sensitive memory':`On “${e.title||'a memory'}”: ${c.text.slice(0,80)}`,tag:`comment-${c.id}`,url:'/'});
     }}
    return json(res,200,{revision:next});
   }
  }
  // ----- push subscriptions -----
  if(url.pathname==='/api/push/key'&&req.method==='GET')return json(res,200,{publicKey:VAPID_PUBLIC});
  if(url.pathname==='/api/push/subscribe'&&req.method==='POST'){
   const {subscription}=await readJson(req,5000),endpoint=subscription?.endpoint,p256dh=subscription?.keys?.p256dh,auth=subscription?.keys?.auth;
   let ok=false;try{ok=new URL(endpoint).protocol==='https:'}catch{}
   if(!ok||typeof p256dh!=='string'||typeof auth!=='string'||p256dh.length>200||auth.length>100||endpoint.length>1000)return json(res,400,{error:'Invalid subscription.'});
   db.prepare('INSERT INTO push_subs(endpoint,username,p256dh,auth,created) VALUES(?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET username=excluded.username,p256dh=excluded.p256dh,auth=excluded.auth').run(endpoint,user.username,p256dh,auth,new Date().toISOString());
   return json(res,200,{ok:true});
  }
  if(url.pathname==='/api/push/unsubscribe'&&req.method==='POST'){const {endpoint}=await readJson(req,5000);db.prepare('DELETE FROM push_subs WHERE endpoint=? AND username=?').run(String(endpoint||''),user.username);return json(res,200,{ok:true})}
  if(url.pathname==='/api/push/test'&&req.method==='POST'){const r=await pushTo(user.username,{title:'Notifications are on 💜',body:'This is how MAX will nudge you.',tag:'test',url:'/'});return json(res,r.sent?200:502,r.sent?r:{...r,error:r.total?'Could not reach this device. Try enabling again.':'No device is set up yet.'})}
  // ----- hidden photos vault -----
  if(url.pathname.startsWith('/api/vault')){
   if(!vaultOn())return json(res,404,{error:'Not found.'});
   const unlocked=vaultUnlocked(req,user.username),hash=vaultPinHash(user.username),lockKey='vault:'+user.username;
   if(url.pathname==='/api/vault/status'&&req.method==='GET')return json(res,200,{hasPin:!!hash,unlocked,journalLock:mineLockOn(user.username)});
   // Lock my journal: on or off, always with the PIN (or choosing one, if there isn't one yet).
   if(url.pathname==='/api/vault/journal-lock'&&req.method==='PUT'){
    const {enabled,pin}=await readJson(req,2000);if(typeof enabled!=='boolean'||!validPin(pin))return json(res,400,{error:'Enter your PIN (4 to 12 digits).'});
    if(hash){if(isLocked(lockKey))return json(res,429,{error:'Too many attempts. Wait five minutes.'});if(!await verifyPassword(pin,hash)){recordFailure(lockKey);return json(res,401,{error:'Wrong PIN.'})}failures.delete(lockKey)}
    else if(enabled)db.prepare('INSERT INTO app_kv(key,value) VALUES(?,?)').run('vault_pin:'+user.username,hashPassword(pin));
    else return json(res,409,{error:'There’s no PIN yet.'});
    if(enabled)db.prepare("INSERT INTO app_kv(key,value) VALUES(?,'1') ON CONFLICT(key) DO UPDATE SET value='1'").run('mine_lock:'+user.username);else db.prepare('DELETE FROM app_kv WHERE key=?').run('mine_lock:'+user.username);
    return json(res,200,{journalLock:enabled});
   }
   if(url.pathname==='/api/vault/pin'&&req.method==='POST'){
    const {pin,currentPin}=await readJson(req,2000);
    if(!validPin(pin))return json(res,400,{error:'Use a PIN of 4 to 12 digits.'});
    if(hash){if(isLocked(lockKey))return json(res,429,{error:'Too many attempts. Wait five minutes.'});if(!validPin(currentPin)||!await verifyPassword(currentPin,hash)){recordFailure(lockKey);return json(res,401,{error:'Current PIN is wrong.'})}}
    db.prepare('INSERT INTO app_kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('vault_pin:'+user.username,hashPassword(pin));
    for(const [k,v] of vaultSessions)if(v.username===user.username)vaultSessions.delete(k);
    return json(res,200,{ok:true});
   }
   if(url.pathname==='/api/vault/unlock'&&req.method==='POST'){
    if(!hash)return json(res,409,{error:'Create a PIN first.'});
    if(isLocked(lockKey))return json(res,429,{error:'Too many attempts. Wait five minutes.'});
    const {pin}=await readJson(req,2000);
    if(!validPin(pin)||!await verifyPassword(pin,hash)){recordFailure(lockKey);return json(res,401,{error:'Wrong PIN.'})}
    failures.delete(lockKey);
    const token=randomBytes(32).toString('hex');vaultSessions.set(tokenHash(token),{username:user.username,expires:Date.now()+VAULT_SECONDS*1000});
    res.setHeader('Set-Cookie',vaultCookie(token,VAULT_SECONDS));return json(res,200,{ok:true});
   }
   if(url.pathname==='/api/vault/lock'&&req.method==='POST'){const token=readCookie(req,VAULT_COOKIE);if(token)vaultSessions.delete(tokenHash(token));res.setHeader('Set-Cookie',vaultCookie('',0));return json(res,200,{ok:true})}
   // Move a shared (or your own) photo into your hidden photos. Hiding needs no PIN; viewing it later does.
   if(url.pathname==='/api/vault/move'&&req.method==='POST'){
    const {id}=await readJson(req,2000);if(typeof id!=='string'||!/^[-a-f0-9]{36}$/.test(id))return json(res,400,{error:'Invalid photo.'});
    if(!db.prepare(`SELECT 1 FROM files f WHERE f.id=? AND f.vault=0 AND ${VISIBLE_FILE}`).get(id,...visibleArgs(user.username)))return json(res,404,{error:'Photo not found.'});
    if(db.prepare('SELECT 1 FROM users WHERE avatar=?').get(id))return json(res,409,{error:'That photo is a profile picture.'});
    db.prepare('UPDATE files SET vault=1,shared=0,user_id=? WHERE id=?').run(user.username,id);
    db.prepare('INSERT OR REPLACE INTO vault_items(id,added_by,created) VALUES(?,?,?)').run(id,user.username,new Date().toISOString());
    db.prepare('DELETE FROM file_geo WHERE id=?').run(id);
    return json(res,200,{ok:true});
   }
   if(!unlocked)return json(res,403,{error:'Hidden photos are locked.'});
   if(url.pathname==='/api/vault'&&req.method==='GET')return json(res,200,{items:db.prepare('SELECT v.id,f.name,f.size,v.added_by AS addedBy,v.created FROM vault_items v JOIN files f ON f.id=v.id WHERE f.user_id=? AND f.vault=1 ORDER BY v.created DESC').all(user.username)});
   if(url.pathname==='/api/vault/files'&&req.method==='POST'){
    const file=await readUpload(req,10000000);if(!file)return json(res,400,{error:'Choose a photo smaller than 10 MB.'});
    const bytes=Buffer.from(await file.arrayBuffer());if(!imageType(bytes))return json(res,400,{error:'Choose a JPEG, PNG, WebP, GIF or AVIF photo.'});
    const id=storeFile(user.username,file.name||'hidden',bytes,false,true),created=new Date().toISOString();
    db.prepare('INSERT INTO vault_items(id,added_by,created) VALUES(?,?,?)').run(id,user.username,created);
    return json(res,200,{id,name:file.name.slice(0,150),size:bytes.length,addedBy:user.username,created});
   }
   if(url.pathname==='/api/vault/files'&&req.method==='DELETE'){
    const id=url.searchParams.get('id');if(!id||!/^[-a-f0-9]{36}$/.test(id))return json(res,400,{error:'Invalid file.'});
    const row=db.prepare('SELECT 1 FROM files WHERE id=? AND vault=1 AND user_id=?').get(id,user.username);if(!row)return json(res,404,{error:'File not found.'});
    db.prepare('DELETE FROM vault_items WHERE id=?').run(id);db.prepare('DELETE FROM files WHERE id=?').run(id);try{unlinkSync(join(base,'files',id))}catch{}
    return json(res,200,{ok:true});
   }
   if(url.pathname==='/api/vault/file'&&req.method==='GET'){
    const id=url.searchParams.get('id');if(!id||!/^[-a-f0-9]{36}$/.test(id))return json(res,400,{error:'Invalid file.'});
    if(!db.prepare('SELECT 1 FROM files WHERE id=? AND vault=1 AND user_id=?').get(id,user.username)||!existsSync(join(base,'files',id)))return json(res,404,{error:'File not found.'});
    const bytes=readFileSync(join(base,'files',id)),image=imageType(bytes);
    res.writeHead(200,{'Content-Type':image??'application/octet-stream','Content-Disposition':image?'inline':'attachment','Cache-Control':'private, no-store'});return res.end(bytes);
   }
  }
  // Delete forever: only photos already in Recently deleted, in a journal you're part of.
  // M.A.X. coach: a mentor that knows today’s progress.
  // A quick insight for right now (Today, under the cards), asked for once each time the app is opened.
  if(url.pathname==='/api/insight'&&req.method==='POST'){
   // Shared across your devices: the same insight for 30 minutes, then a fresh one.
   // An insight is reused only while their progress is the same (anything logged since makes a fresh one), and "new
   // insight" can be asked for once every 2 minutes.
   const ask=await readJson(req,1000).catch(()=>({}));
   const saved=trackerOf(user.username),s=saved?.settings?saved:initialState(user.displayName),tz=s.settings.timeZone;
   const today=trackingDay(user.username),{time}=localAt(new Date(),tz),hour=Number(time.slice(0,2)),d=s.days?.[today]??dayFor(s,today);
   const sig=JSON.stringify([d.energy??'',d.entries.filter(e=>e.goal.essential).map(e=>[e.goal.id,complete(e),e.value,e.checks.filter(Boolean).length])]);
   {const hit=insightCache.get(user.username),next=hit?Math.max(0,hit.at+2*60000-Date.now()):0;
    if(hit&&hit.day===today&&(ask?.fresh?next>0:hit.sig===sig&&Date.now()-hit.at<30*60000))return json(res,200,{text:hit.text,source:hit.source,next})}
   const ess=d.entries.filter(e=>e.goal.essential&&!e.rest&&!isFlexible(e.goal)&&!isSleep(e)),open=ess.filter(e=>!complete(e)).map(e=>e.goal.private?'a private goal':e.goal.category);
   // Meals (or other timed items) whose window has closed unticked come first: it's the most useful thing to hear now.
   const missed=d.entries.flatMap(e=>{const def=s.goals.find(g=>g.id===e.goal.id)??e.goal;if(e.rest||def.private)return [];return itemsOf(def).filter((item,i)=>{const w=windowFor(def,item);return w&&itemTiming(w,!!e.checks[i],e.times?.[i],time)==='missed'}).map(x=>x.toLowerCase())});
   const rules=missed.length&&hour<23?`You missed ${missed.length>1?`${missed.slice(0,-1).join(', ')} and ${missed.at(-1)}`:missed[0]}. Have something small now and log it, and aim for the window next time.`
    :!ess.length?'Nothing planned today. Rest counts too.':!open.length?'Every main goal is done today. Anything more is a bonus, so enjoy it.'
    :hour>=23||hour<5?`It’s late. Log anything you did and head to bed; ${open.length} left can wait for tomorrow.`
    :hour<11?`Morning: ${ess.length-open.length}/${ess.length} done. Start with ${open[0]} while you’re fresh.`
    :hour<17?`${ess.length-open.length}/${ess.length} done so far. ${open.slice(0,2).join(' and ')} ${open.length>1?'are':'is'} still open; pick one for the next hour.`
    :`Evening check: ${open.join(', ')} left. A small step on ${open[0]} still counts.`;
   if(coachFor(user.username)&&coachAvailable()){
    try{const text=(await coachReply([{role:'system',content:coachPrompt(user)},{role:'user',content:'I just opened the app. In one or two short sentences, give me a quick insight about this moment of my day (the time, what’s done and what’s left) and the single next thing to do. No greeting.'}],()=>{},AbortSignal.timeout(90000))).replace(/M\.A\.X\.?/g,user.displayName).trim();
     if(text){insightCache.set(user.username,{text,source:'coach',at:Date.now(),day:today,sig});return json(res,200,{text,source:'coach',next:2*60000})}}catch{}
   }
   insightCache.set(user.username,{text:rules,source:'rules',at:Date.now(),day:today,sig});return json(res,200,{text:rules,source:'rules',next:2*60000});
  }
  // Today's advice for the Progress tab. If Coach MAX hasn't written it yet (it's written at 6 am), start now and
  // answer "pending"; the page checks back until it's ready.
  if(url.pathname==='/api/advice'&&req.method==='GET'){
   const day=trackingDay(user.username),have=db.prepare('SELECT text,source,at FROM coach_advice WHERE username=? AND day=?').get(user.username,day);
   if(have)return json(res,200,{day,...have});
   if(coachFor(user.username)&&coachAvailable()){if(!adviceBusy.has(user.username))void makeAdvice(user.username).catch(()=>{});return json(res,200,{day,pending:true})}
   const a=await makeAdvice(user.username);return json(res,200,a??{day,pending:false,text:''});
  }
  if(url.pathname.startsWith('/api/coach/')){
   if(!coachFor(user.username))return json(res,404,{error:'Not found.'});
   if(url.pathname==='/api/coach/health'&&req.method==='GET'){
    // Opening the coach reads today's logging instructions ahead of time, so the first message is quick.
    if(url.searchParams.get('prime')==='1'&&coachLoaded()){const t=coachToday(user);if(t){const plan=logPlan(t.day);if(plan.picks.length||plan.amounts.length)primeExtract(plan.system,plan.schema)}}
    return json(res,200,{ok:true,available:coachAvailable(),loaded:coachLoaded()});
   }
   // Weekly recap: Coach MAX writes a short reflection from the week's numbers.
   if(url.pathname==='/api/coach/recap'&&req.method==='POST'){
    if(!coachLimiter(user.username))return json(res,429,{error:'Easy there. Give M.A.X. a minute.'});
    const p=await readJson(req,2000),s=trackerOf(user.username);
    if(!s?.settings||typeof p.start!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p.start))return json(res,400,{error:'Choose a week.'});
    const today=localAt(new Date(Date.now()-DAY_START_MINUTES*60000),s.settings.timeZone).date,r=weeklyRecap(s,p.start,today);
    if(!r.days)return json(res,400,{error:'Nothing tracked that week.'});
    const name=user.displayName||user.username;
    const facts=[`Days: ${r.perfect} perfect, ${r.logged} showed up but not perfect, ${r.missed} missed, out of ${r.days}${r.low?` (${r.low} low-energy)`:''}.`,
     `Goals: ${r.goals.map(g=>`${g.label} ${g.done}/${g.planned}${g.prevPlanned?` (week before ${g.prevDone}/${g.prevPlanned})`:''}`).join('; ')}.`,
     r.improved.length?`Improved: ${r.improved.join(', ')}.`:'',r.slipped.length?`Slipped: ${r.slipped.join(', ')}.`:''].filter(Boolean);
    // The reply is finished and saved even if the phone leaves mid-answer (tab switch, screen lock), so it's in the chat when they come back.
    const controller=new AbortController();
    try{
     const text=(await coachReply([{role:'system',content:`You are ${name}'s coach inside their habits app (the app calls you "M.A.X."); call them ${name}. Write their weekly reflection in 3 short sentences: one specific win, one honest pattern, one small focus for next week. Warm, direct, like a caring older brother. Use only these numbers, no lists, at most one emoji.\n\nWEEK:\n- ${facts.join('\n- ')}`},{role:'user',content:'Write my weekly reflection.'}],()=>{},controller.signal)).replace(/M\.A\.X\.?/g,name).trim();
     return json(res,200,{text:text||recapNote(r)});
    }catch(e){return json(res,503,{error:e?.message||'Coach MAX couldn’t answer right now.'})}
   }
   // Start over: marks the log so every device starts today's chat fresh from here.
   if(url.pathname==='/api/coach/reset'&&req.method==='POST'){logCoach(user.username,trackingDay(user.username),'reset','Started over');return json(res,200,{ok:true})}
   // History: the days you talked to M.A.X. (newest first, with the first thing you said), or one day's whole chat.
   if(url.pathname==='/api/coach/history'&&req.method==='GET'){
    const day=url.searchParams.get('day');
    if(day){if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return json(res,400,{error:'Choose a day.'});return json(res,200,{day,entries:db.prepare('SELECT role,content,at FROM coach_log WHERE username=? AND day=? ORDER BY id').all(user.username,day)})}
    const days=db.prepare("SELECT day,COUNT(*) AS count,MAX(at) AS last,(SELECT content FROM coach_log c2 WHERE c2.username=c.username AND c2.day=c.day AND c2.role='user' ORDER BY id LIMIT 1) AS preview FROM coach_log c WHERE username=? GROUP BY day ORDER BY day DESC LIMIT 120").all(user.username);
    return json(res,200,{days});
   }
   if(url.pathname==='/api/coach/chat'&&req.method==='POST'){
    if(!coachLimiter(user.username))return json(res,429,{error:'Easy there. Give M.A.X. a minute.'});
    const payload=await readJson(req,20000);
    const history=(Array.isArray(payload.messages)?payload.messages:[]).filter(m=>m&&(m.role==='user'||m.role==='assistant')&&typeof m.content==='string'&&m.content.trim()).slice(-10).map(m=>({role:m.role,content:m.content.slice(0,600)}));
    if(payload.kickoff)history.push({role:'user',content:'Check in on me: greet me by name and look at my day so far (morning: help me plan; afternoon: nudge what is left; night: help me wrap up and reflect).'});
    else if(history.at(-1)?.role!=='user')return json(res,400,{error:'Say something first.'});
    // The reply is finished and saved even if the phone leaves mid-answer (tab switch, screen lock), so it's in the chat when they come back.
    const controller=new AbortController();let gone=false;res.on('close',()=>{gone=true});
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no'});
    const send=e=>{if(gone)return;try{res.write(`data: ${JSON.stringify(e)}\n\n`)}catch{}};
    // "Max" talks to "M.A.X.": the model sometimes calls them M.A.X., so that is swapped for their name as it streams.
    const name=user.displayName||user.username,clean=t=>t.replace(/M\.A\.X\.?/g,name);let raw='',sent='';
    const onToken=piece=>{raw+=piece;let out=clean(raw);const tail=['M.A.X','M.A.','M.A','M.','M'].find(x=>out.endsWith(x));if(tail)out=out.slice(0,-tail.length);if(out.length>sent.length&&out.startsWith(sent)){send({type:'token',text:out.slice(sent.length)});sent=out}};
    try{
     // Fill in the tracker from what they said: the model picks from today's items, lib/coach-log checks it, the app applies it (with Undo).
     const t=coachToday(user);let logged=[];
     const last=history.at(-1)?.content??'';
     // Their message is saved straight away, so it's never lost if the reply fails.
     const day=t?.today??localAt(new Date(Date.now()-DAY_START_MINUTES*60000),tzOf(user.username)).date;
     if(!payload.kickoff)try{logCoach(user.username,day,'user',last)}catch(e){console.error('coach log:',e.message)}
     if(t&&!payload.kickoff&&looksLoggable(last)){
      const plan=logPlan(t.day);
      if(plan.picks.length||plan.amounts.length){
       send({type:'status',text:'Checking what to log…'});
       const out=await coachExtract(plan.system,plan.schema,last,controller.signal).catch(()=>null);
       const actions=actionsFrom(plan,out,last);
       if(actions.length){logged=describeActions(t.day,actions);applyActions(t.day,actions);send({type:'actions',day:t.today,actions,summary:logged})}
      }
     }
     const answer=clean(await coachReply([{role:'system',content:coachPrompt(user,t,logged)},...history],onToken,controller.signal));send({type:'done',answer});
     // Saved for History: your message, what was filled in on the tracker, and the reply.
     try{if(logged.length)logCoach(user.username,day,'logged',logged.join(' · '));logCoach(user.username,day,'assistant',answer)}catch(e){console.error('coach log:',e.message)}
    }
    catch(e){send({type:'error',error:e?.message||'M.A.X. couldn’t answer right now.'})}
    return res.end();
   }
   return json(res,404,{error:'Not found.'});
  }
  if(url.pathname==='/api/files/purge'&&req.method==='POST'){
   const {ids}=await readJson(req,100000);
   if(!Array.isArray(ids)||ids.length>500||!ids.every(id=>typeof id==='string'&&/^[-a-f0-9]{36}$/.test(id)))return json(res,400,{error:'Invalid photos.'});
   const trash=new Set(spaces.spacesOf(user.username).flatMap(sp=>sharedDoc(sp).photoTrash?.map(p=>p.id)??[]));
   return json(res,200,{deleted:ids.filter(id=>trash.has(id)&&purgeFile(id,user.username)).length});
  }
  if(url.pathname==='/api/files/geo'&&req.method==='GET')return json(res,200,{photos:visibleGeo(user.username,lockedSpace(req,user.username))});
  if(url.pathname==='/api/files'){
   if(req.method==='POST'){const file=await readUpload(req,10000000);if(!file)return json(res,400,{error:'Choose a file smaller than 10 MB.'});const bytes=Buffer.from(await file.arrayBuffer()),id=storeFile(user.username,file.name,bytes,url.searchParams.get('shared')==='1',false,url.searchParams.get('space')==='mine'?spaces.personalOf(user.username):spaces.spaceOf(user.username)),g=db.prepare('SELECT lat,lng FROM file_geo WHERE id=? AND lat IS NOT NULL').get(id),taken=jpegTaken(bytes);return json(res,200,{id,name:file.name.slice(0,150),size:bytes.length,...(g?{geo:{lat:g.lat,lng:g.lng}}:{}),...(taken?{taken}:{})})}
   if(req.method==='GET'){
    const id=url.searchParams.get('id');if(!id||!/^[-a-f0-9]{36}$/.test(id))return json(res,400,{error:'Invalid file.'});
    const circle=spaces.circleOf(user.username).map(u=>u.avatar).filter(Boolean);
    const locked=lockedSpace(req,user.username),found=db.prepare(`SELECT f.name,f.space_id FROM files f WHERE f.id=? AND f.vault=0 AND ${VISIBLE_FILE}`).get(id,...visibleArgs(user.username)),file=(found&&(!locked||found.space_id!==locked)?found:null)??(circle.includes(id)?db.prepare('SELECT name FROM files WHERE id=? AND vault=0').get(id):null);
    if(!file||!existsSync(join(base,'files',id)))return json(res,404,{error:'File not found.'});
    // Browsers re-check each time (cheap: 304 via the id tag), so a photo moved to Hidden photos stops loading at once.
    const tag=`"${id}"`;if(url.searchParams.get('inline')==='1'&&req.headers['if-none-match']===tag){res.writeHead(304,{ETag:tag,'Cache-Control':'private, no-cache'});return res.end()}
    const bytes=readFileSync(join(base,'files',id)),image=url.searchParams.get('inline')==='1'?imageType(bytes):null;
    res.writeHead(200,image?{'Content-Type':image,'Content-Disposition':'inline','Cache-Control':'private, no-cache',ETag:tag}:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,'Cache-Control':'private, no-store'});
    return res.end(bytes);
   }
  }
  if(url.pathname.startsWith('/api/'))return json(res,405,{error:'Method not allowed.'});
  if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Method not allowed.'});
  // Static app. Unknown paths fall back to index.html; the app shows the login screen when signed out.
  let path=resolve(publicDir,'.'+decodeURIComponent(url.pathname));
  if(!path.startsWith(resolve(publicDir)+'/')&&!path.startsWith(resolve(publicDir)+'\\')&&path!==resolve(publicDir))return json(res,404,{error:'Not found.'});
  if(!existsSync(path)||!statSync(path).isFile())path=join(publicDir,'index.html');
  res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':path.includes('/assets/')||path.includes('\\assets\\')?'private, max-age=31536000, immutable':'no-store'});
  // Funnel can strip /max before proxying, so /max and /max/ may both arrive as /.
  // Anchor relative assets and API requests to the configured mount in either case.
  const contents=path===join(publicDir,'index.html')?readFileSync(path,'utf8').replace('<head>',`<head><base href="${basePath}/">`):readFileSync(path);
  res.end(req.method==='HEAD'?undefined:contents);
 }catch(e){console.error(e.message);
  // Part of the response already went out (a file stream that failed midway): end it rather than crash the server.
  if(res.headersSent){res.destroy();return}
  return json(res,e.status||500,{error:e.status===413?'The upload is too large.':e.status===400?'Invalid request.':'Could not complete this request. Please retry.'})}
});
// MAX_HOST: the address to listen on. Loopback by default (behind a reverse proxy or Tailscale on the same machine);
// 0.0.0.0 in Docker, where the container's port is published instead.
const host=process.env.MAX_HOST||'127.0.0.1';
server.listen(port,host,()=>{
 warmCoach();
 console.log(`MAX listening at http://${host==='0.0.0.0'?'localhost':host}:${port} (${dev?'local preview':tailnetLogins.length?'Tailscale + account login':'account login'})`);
 if(!db.prepare('SELECT 1 FROM users LIMIT 1').get())console.log('No accounts yet. Open the app to create the first (admin) account, or run: node server.mjs set-password <username> [Display Name]');
});
process.on('SIGTERM',()=>server.close(()=>{db.close();process.exit(0)}));
