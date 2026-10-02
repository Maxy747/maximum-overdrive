// Accounts: sign-up with email verification, log in by email or username, forgotten passwords, and adding an
// email to an account that was made on the command line. The server passes in what it already has (the database,
// password hashing, sessions, request helpers) so this file owns only the account rules.
//
// MAX_SIGNUP: open (anyone with the link) | invite (a partner invite code is needed) | closed (command line only).
// The very first account can always be created from the app, and becomes the admin.
// Codes are 6 digits, stored only as an HMAC, valid 15 minutes, 5 tries each, at most one mail a minute per address.
import {createHmac,randomBytes,randomInt,timingSafeEqual} from 'node:crypto';
import {mailEnabled,sendMail} from './mail.mjs';

const CODE_MINUTES=15,CODE_TRIES=5,RESEND_MS=60000,HOURLY_SENDS=5,UNVERIFIED_HOURS=48;
const validEmail=e=>typeof e==='string'&&e.length<=254&&/^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/.test(e);
const cleanEmail=e=>String(e??'').trim().toLowerCase();

export function createAccounts({db,dev,json,readJson,hashPassword,verifyPassword,dummyHash,validUsername,isLocked,recordFailure,clearFailures,startSession,publicUser,picker=false,appName='MAX',checkInvite=()=>false,rememberInvite=()=>{},onReady=()=>{}}){
 // ----- schema -----
 const cols=new Set(db.prepare('PRAGMA table_info(users)').all().map(c=>c.name));
 if(!cols.has('email'))db.exec('ALTER TABLE users ADD COLUMN email TEXT');
 if(!cols.has('email_verified'))db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
 if(!cols.has('role'))db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'");
 if(!cols.has('created'))db.exec('ALTER TABLE users ADD COLUMN created INTEGER');
 db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(email) WHERE email IS NOT NULL;
 CREATE TABLE IF NOT EXISTS email_codes (purpose TEXT NOT NULL, email TEXT NOT NULL, username TEXT NOT NULL, code_hash TEXT NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL, PRIMARY KEY(purpose,email));`);
 // An instance always has an admin: the oldest account, if none was chosen yet.
 if(!db.prepare("SELECT 1 FROM users WHERE role='admin'").get())db.prepare("UPDATE users SET role='admin' WHERE rowid=(SELECT MIN(rowid) FROM users)").run();
 const secret=(()=>{const row=db.prepare("SELECT value FROM app_kv WHERE key='code_secret'").get();if(row)return row.value;const v=randomBytes(32).toString('hex');db.prepare("INSERT INTO app_kv(key,value) VALUES('code_secret',?)").run(v);return v})();

 const signupMode=()=>{const m=(process.env.MAX_SIGNUP||'invite').toLowerCase();return ['open','invite','closed'].includes(m)?m:'invite'};
 const needsSetup=()=>!db.prepare('SELECT 1 FROM users LIMIT 1').get();
 const email=()=>mailEnabled(dev);

 // ----- codes -----
 const codeHash=(purpose,address,code)=>createHmac('sha256',secret).update(`${purpose}\n${address}\n${code}`).digest('hex');
 const sends=new Map();// address -> timestamps of mails sent in the last hour
 function canSend(address){const now=Date.now(),list=(sends.get(address)??[]).filter(t=>now-t<3600000);sends.set(address,list);return list.length<HOURLY_SENDS&&!(list.length&&now-list.at(-1)<RESEND_MS)}
 async function mail(address,subject,text){if(!canSend(address))return false;sends.get(address).push(Date.now());try{await sendMail({to:address,subject,text},dev);return true}catch(e){console.error('mail:',e.message);return false}}
 async function sendCode(purpose,address,username){
  if(!canSend(address))return false;
  const code=String(randomInt(0,1000000)).padStart(6,'0');
  db.prepare('INSERT INTO email_codes(purpose,email,username,code_hash,expires,attempts,sent) VALUES(?,?,?,?,?,0,?) ON CONFLICT(purpose,email) DO UPDATE SET username=excluded.username,code_hash=excluded.code_hash,expires=excluded.expires,attempts=0,sent=excluded.sent')
   .run(purpose,address,username,codeHash(purpose,address,code),Date.now()+CODE_MINUTES*60000,Date.now());
  const what={verify:`Your ${appName} sign-up code is ${code}.`,reset:`Your ${appName} password reset code is ${code}.`,email:`Your ${appName} code to confirm this email is ${code}.`}[purpose];
  const ok=await mail(address,`${code} is your ${appName} code`,`${what}\n\nIt expires in ${CODE_MINUTES} minutes. If you didn't ask for it, you can ignore this email.`);
  if(!ok)db.prepare('DELETE FROM email_codes WHERE purpose=? AND email=?').run(purpose,address);
  return ok;
 }
 /** Checks a code. Returns the username it was sent for, or an error message. Wrong tries count; five end the code. */
 function takeCode(purpose,address,code){
  const row=db.prepare('SELECT username,code_hash,expires,attempts FROM email_codes WHERE purpose=? AND email=?').get(purpose,address);
  if(!row||row.expires<Date.now())return {error:'That code has expired. Ask for a new one.'};
  const given=Buffer.from(codeHash(purpose,address,String(code??'').replace(/\D/g,'').slice(0,6))),want=Buffer.from(row.code_hash);
  if(!timingSafeEqual(given,want)){
   if(row.attempts+1>=CODE_TRIES){db.prepare('DELETE FROM email_codes WHERE purpose=? AND email=?').run(purpose,address);return {error:'Too many wrong codes. Ask for a new one.'}}
   db.prepare('UPDATE email_codes SET attempts=attempts+1 WHERE purpose=? AND email=?').run(purpose,address);return {error:'That code isn’t right. Check the email and try again.'};
  }
  db.prepare('DELETE FROM email_codes WHERE purpose=? AND email=?').run(purpose,address);
  return {username:row.username};
 }

 // ----- housekeeping: sign-ups never verified are removed after two days, freeing the email and username -----
 const prune=()=>{const cutoff=Date.now()-UNVERIFIED_HOURS*3600000;
  db.prepare("DELETE FROM users WHERE email IS NOT NULL AND email_verified=0 AND created IS NOT NULL AND created<? AND role<>'admin' AND username NOT IN (SELECT user_id FROM trackers)").run(cutoff);
  db.prepare('DELETE FROM email_codes WHERE expires<?').run(Date.now())};
 prune();setInterval(prune,3600000).unref();

 // A readable, unique username from the name or email ("Alex Kim" -> alex-kim, then alex-kim-2, ...).
 function newUsername(displayName,address){
  const slug=s=>String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,28);
  let stem=slug(displayName)||slug(address.split('@')[0]);if(stem.length<2)stem='user';
  for(let i=1;i<1000;i++){const name=i===1?stem:`${stem}-${i}`;if(validUsername(name)&&!db.prepare('SELECT 1 FROM users WHERE username=?').get(name))return name}
  return `user-${randomBytes(4).toString('hex')}`;
 }
 const passwordError=p=>typeof p!=='string'||p.length<8||p.length>200?'Use a password between 8 and 200 characters.':null;
 const nameError=n=>!n||n.length>30?'Choose a name up to 30 characters.':null;
 const userRow=where=>db.prepare(`SELECT username,display_name AS displayName,full_name AS name,avatar,birthday,password_hash,email,email_verified AS verified,role FROM users WHERE ${where}`);

 /** Handles the public account routes. Returns true when it answered the request. */
 async function handle(req,res,url){
  const route=`${req.method} ${url.pathname}`;
  if(route==='GET /api/config')return json(res,200,{signup:needsSetup()?'setup':signupMode(),email:email(),picker,appName}),true;

  if(route==='POST /api/login'){
   const {username,password,remember}=await readJson(req,10000),id=String(username||'').trim().toLowerCase(),secret=String(password||'').slice(0,200);
   const user=id.includes('@')?(validEmail(id)?userRow('email=?').get(id):null):(validUsername(id)?userRow('username=?').get(id):null);
   const key=user?.username??id;// lock the account, however it was named
   if(isLocked(key))return json(res,429,{error:'Too many attempts. Wait five minutes and try again.'}),true;
   const ok=await verifyPassword(secret,user?.password_hash??dummyHash);
   if(!user||!ok){recordFailure(key);return json(res,401,{error:id.includes('@')||!id?'That email and password didn’t match. Try again.':'That password did not match. Try again.'}),true}
   clearFailures(key);
   if(user.email&&!user.verified&&email()){await sendCode('verify',user.email,user.username);return json(res,403,{error:'Confirm your email first. We sent you a new code.',verify:true,email:user.email}),true}
   startSession(res,user.username,!!remember);
   return json(res,200,{user:publicUser(user)}),true;
  }

  if(route==='POST /api/signup'){
   const p=await readJson(req,10000),address=cleanEmail(p.email),displayName=String(p.name??'').trim().replace(/\s+/g,' '),password=p.password,first=needsSetup();
   const mode=signupMode(),invited=!first&&typeof p.invite==='string'&&checkInvite(p.invite);
   if(!first&&mode==='closed')return json(res,403,{error:'New accounts can’t be created here. Ask the admin to add you.'}),true;
   if(!first&&mode==='invite'&&!invited)return json(res,403,{error:'You need an invite code to join.'}),true;
   const bad=nameError(displayName)||passwordError(password)||(address||email()?(validEmail(address)?null:'Enter a valid email address.'):null);
   if(bad)return json(res,400,{error:bad}),true;
   // Without email the first account (or an invited one) is active right away; with email, everyone confirms it.
   const verify=email();
   if(address){const existing=userRow('email=?').get(address);
    if(existing?.verified){
     // Don't reveal who has an account: answer as usual, and tell the owner by email instead.
     if(verify)await mail(address,`Someone tried to sign up with your email`,`Someone (maybe you) tried to create a ${appName} account with this email, but you already have one. If you forgot your password, use "Forgot password" on the login screen.`);
     return json(res,verify?200:409,verify?{verify:true,email:address}:{error:'An account with this email already exists.'}),true;
    }
    if(existing){// unverified: whoever proves the email owns it, with the details they just gave
     db.prepare('UPDATE users SET display_name=?,password_hash=?,created=? WHERE username=?').run(displayName,hashPassword(password),Date.now(),existing.username);
     if(invited)rememberInvite(existing.username,p.invite);
     await sendCode('verify',address,existing.username);return json(res,200,{verify:true,email:address}),true;
    }
   }
   const username=newUsername(displayName,address);
   db.prepare('INSERT INTO users(username,display_name,password_hash,email,email_verified,role,created) VALUES(?,?,?,?,?,?,?)')
    .run(username,displayName,hashPassword(password),address||null,0,first?'admin':'member',Date.now());
   if(invited)rememberInvite(username,p.invite);
   if(verify){await sendCode('verify',address,username);return json(res,200,{verify:true,email:address,...(invited?{invite:true}:{})}),true}
   onReady(username);startSession(res,username,true);
   return json(res,200,{user:publicUser(userRow('username=?').get(username))}),true;
  }

  if(route==='POST /api/signup/verify'){
   const p=await readJson(req,5000),address=cleanEmail(p.email);
   if(!validEmail(address))return json(res,400,{error:'Enter a valid email address.'}),true;
   const r=takeCode('verify',address,p.code);if(r.error)return json(res,400,{error:r.error}),true;
   db.prepare('UPDATE users SET email_verified=1 WHERE username=? AND email=?').run(r.username,address);
   const user=userRow('username=?').get(r.username);if(!user)return json(res,400,{error:'That sign-up has expired. Please sign up again.'}),true;
   onReady(user.username);startSession(res,user.username,p.remember!==false);
   return json(res,200,{user:publicUser(user)}),true;
  }

  if(route==='POST /api/signup/resend'){
   const address=cleanEmail((await readJson(req,5000)).email),user=validEmail(address)?userRow('email=?').get(address):null;
   if(user&&!user.verified)await sendCode('verify',address,user.username);
   return json(res,200,{ok:true}),true;
  }

  if(route==='POST /api/password/forgot'){
   if(!email())return json(res,400,{error:'Email isn’t set up on this server. Ask the admin to reset your password.'}),true;
   const address=cleanEmail((await readJson(req,5000)).email),user=validEmail(address)?userRow('email=?').get(address):null;
   if(user?.verified)await sendCode('reset',address,user.username);
   return json(res,200,{ok:true}),true;// the same answer whether or not there's an account
  }

  if(route==='POST /api/password/reset'){
   const p=await readJson(req,5000),address=cleanEmail(p.email),bad=passwordError(p.password);
   if(!validEmail(address))return json(res,400,{error:'Enter a valid email address.'}),true;
   if(bad)return json(res,400,{error:bad}),true;
   const r=takeCode('reset',address,p.code);if(r.error)return json(res,400,{error:r.error}),true;
   db.prepare('UPDATE users SET password_hash=? WHERE username=?').run(hashPassword(p.password),r.username);
   db.prepare('DELETE FROM sessions WHERE username=?').run(r.username);clearFailures(r.username);
   const user=userRow('username=?').get(r.username);startSession(res,user.username,true);
   return json(res,200,{user:publicUser(user)}),true;
  }
  return false;
 }

 /** Routes for a signed-in person: see and change the email on their account. */
 async function handleSignedIn(req,res,url,user){
  const route=`${req.method} ${url.pathname}`;
  if(route==='GET /api/account'){const u=userRow('username=?').get(user.username);return json(res,200,{email:u?.email??null,verified:!!u?.verified,role:u?.role??'member',emailEnabled:email()}),true}
  if(route==='POST /api/account/email'){
   if(!email())return json(res,400,{error:'Email isn’t set up on this server.'}),true;
   const address=cleanEmail((await readJson(req,5000)).email);if(!validEmail(address))return json(res,400,{error:'Enter a valid email address.'}),true;
   const taken=db.prepare('SELECT username FROM users WHERE email=?').get(address);if(taken&&taken.username!==user.username)return json(res,409,{error:'That email is already used by another account.'}),true;
   if(!await sendCode('email',address,user.username))return json(res,429,{error:'Wait a minute before asking for another code.'}),true;
   return json(res,200,{ok:true,email:address}),true;
  }
  if(route==='POST /api/account/email/verify'){
   const p=await readJson(req,5000),address=cleanEmail(p.email);if(!validEmail(address))return json(res,400,{error:'Enter a valid email address.'}),true;
   const r=takeCode('email',address,p.code);if(r.error)return json(res,400,{error:r.error}),true;
   if(r.username!==user.username)return json(res,400,{error:'That code isn’t right. Check the email and try again.'}),true;
   if(db.prepare('SELECT 1 FROM users WHERE email=? AND username<>?').get(address,user.username))return json(res,409,{error:'That email is already used by another account.'}),true;
   db.prepare('UPDATE users SET email=?,email_verified=1 WHERE username=?').run(address,user.username);
   return json(res,200,{email:address,verified:true}),true;
  }
  return false;
 }

 return {handle,handleSignedIn,needsSetup,signupMode};
}
