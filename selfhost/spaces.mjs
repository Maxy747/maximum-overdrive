// Journals and partners. A space is one journal document (the `shared` row with the space's id: memories, moments,
// diary, photo dump) plus the photos shared into it.
// - Everyone has their own space ("Mine"): private to them, always, whether or not they have a partner.
// - Partners also share a couple space ("Ours"). Pairing makes one (or brings back the one these two had before);
//   leaving hides it from both until they pair again. Nothing is ever deleted by pairing or leaving.
//
// Pairing: one person makes an invite code (8 characters, single use, 48 hours) and the other enters it.
// Only a code's hash is stored. Entering codes is rate-limited per account.
import {createHash,randomInt,randomUUID} from 'node:crypto';

const INVITE_HOURS=48,ALPHABET='0123456789ABCDEFGHJKMNPQRSTVWXYZ';// Crockford base32: no I, L, O, U
const TRIES=10,TRY_WINDOW=15*60000;
/** "k7qm 3xrd", "K7QM-3XRD", "K7QM3XRO" all mean the same code. */
export const normalizeCode=c=>String(c??'').toUpperCase().replace(/[^0-9A-Z]/g,'').replace(/O/g,'0').replace(/[IL]/g,'1').slice(0,8);
const hashCode=c=>createHash('sha256').update('invite\n'+normalizeCode(c)).digest('hex');
const newCode=()=>Array.from({length:8},()=>ALPHABET[randomInt(ALPHABET.length)]).join('');
export const formatCode=c=>`${c.slice(0,4)}-${c.slice(4)}`;

export function createSpaces({db,json,readJson,publicUser,notify=()=>{}}){
 // ----- schema -----
 db.exec(`CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, owner TEXT NOT NULL, created INTEGER NOT NULL, paired INTEGER, a TEXT, b TEXT);
 CREATE TABLE IF NOT EXISTS invites (code_hash TEXT PRIMARY KEY, from_user TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE, expires INTEGER NOT NULL, used_by TEXT, used_at INTEGER);`);
 const userCols=new Set(db.prepare('PRAGMA table_info(users)').all().map(c=>c.name));
 if(!userCols.has('space_id'))db.exec('ALTER TABLE users ADD COLUMN space_id TEXT');// your own journal
 if(!userCols.has('couple_id'))db.exec('ALTER TABLE users ADD COLUMN couple_id TEXT');// the one you share, while paired
 if(!userCols.has('pending_invite'))db.exec('ALTER TABLE users ADD COLUMN pending_invite TEXT');
 if(!db.prepare('PRAGMA table_info(files)').all().some(c=>c.name==='space_id'))db.exec('ALTER TABLE files ADD COLUMN space_id TEXT');
 // Upgrading from one journal for everyone ('main'): it becomes the shared journal of the two oldest accounts, who are
 // partners from then on, and their shared photos stay in it. Everyone gets their own journal on first use.
 // New servers have no 'main' and skip this.
 if(!db.prepare('SELECT 1 FROM spaces LIMIT 1').get()&&db.prepare("SELECT 1 FROM shared WHERE id='main'").get()){
  const [a,b]=db.prepare('SELECT username FROM users ORDER BY rowid LIMIT 2').all().map(u=>u.username);
  if(a){
   db.prepare("INSERT INTO spaces(id,owner,created,paired,a,b) VALUES('main',?,?,?,?,?)").run(a,Date.now(),b?Date.now():null,a,b??null);
   if(b){db.prepare("UPDATE users SET couple_id='main' WHERE username IN (?,?)").run(a,b);db.prepare("UPDATE files SET space_id='main' WHERE shared=1 AND space_id IS NULL AND user_id IN (?,?)").run(a,b)}
   else{db.prepare("UPDATE users SET space_id='main' WHERE username=?").run(a);db.prepare("UPDATE files SET space_id='main' WHERE shared=1 AND space_id IS NULL AND user_id=?").run(a)}
  }
 }

 // ----- lookups -----
 /** Your own journal's space, made on first use. */
 function personalOf(username){
  const row=db.prepare('SELECT space_id FROM users WHERE username=?').get(username);if(!row)return null;
  if(row.space_id&&db.prepare('SELECT 1 FROM spaces WHERE id=?').get(row.space_id))return row.space_id;
  const id=randomUUID();db.prepare('INSERT INTO spaces(id,owner,created) VALUES(?,?,?)').run(id,username,Date.now());
  db.prepare('UPDATE users SET space_id=? WHERE username=?').run(id,username);return id;
 }
 /** The journal you share with your partner, or null on your own. */
 const coupleOf=username=>db.prepare('SELECT couple_id FROM users WHERE username=?').get(username)?.couple_id??null;
 /** Your partner's username, or null when you're on your own. */
 const partnerOf=username=>{const c=coupleOf(username);return c?db.prepare('SELECT username FROM users WHERE couple_id=? AND username<>?').get(c,username)?.username??null:null};
 /** "mine" is your own journal; "ours" (or nothing, when paired) the shared one. Null: you asked for "ours" on your own. */
 const spaceFor=(username,which)=>which==='mine'?personalOf(username):coupleOf(username)??(which==='ours'?null:personalOf(username));
 /** The journal the app opens by default: the shared one when paired, else your own. */
 const spaceOf=username=>spaceFor(username);
 /** Every space whose shared photos you may open. */
 const spacesOf=username=>[personalOf(username),coupleOf(username)].filter(Boolean);
 const isCouple=space=>!!db.prepare('SELECT 1 FROM users WHERE couple_id=?').get(space);
 const userOf=username=>db.prepare('SELECT username,display_name AS displayName,full_name AS name,avatar,birthday FROM users WHERE username=?').get(username);
 /** You and your partner, for the app's names and faces. */
 const circleOf=username=>[username,partnerOf(username)].filter(Boolean).map(userOf).filter(Boolean);

 // ----- invites -----
 const liveInvite=code=>{const row=db.prepare('SELECT from_user,expires,used_by FROM invites WHERE code_hash=?').get(hashCode(code));return row&&!row.used_by&&row.expires>Date.now()?row:null};
 /** For sign-up with MAX_SIGNUP=invite: is this a code someone can still accept? */
 const checkInvite=code=>{const row=normalizeCode(code).length===8?liveInvite(code):null;return !!row&&!partnerOf(row.from_user)};
 function createInvite(username){
  if(partnerOf(username))return {error:'You already have a partner. Leave first to invite someone else.'};
  db.prepare('DELETE FROM invites WHERE from_user=? AND used_by IS NULL').run(username);
  const code=newCode(),expires=Date.now()+INVITE_HOURS*3600000;
  db.prepare('INSERT INTO invites(code_hash,from_user,expires) VALUES(?,?,?)').run(hashCode(code),username,expires);
  return {code:formatCode(code),expires};
 }
 /** Pairs `username` with the code's owner. One transaction: the code can only be used once. */
 function accept(username,code){
  db.exec('BEGIN IMMEDIATE');
  try{
   const row=normalizeCode(code).length===8?liveInvite(code):null,fail=error=>{db.exec('ROLLBACK');return {error}};
   if(!row)return fail('That code isn’t valid or has expired. Ask for a new one.');
   if(row.from_user===username)return fail('That’s your own code. Send it to your partner.');
   if(partnerOf(row.from_user))return fail('That person already has a partner.');
   if(partnerOf(username))return fail('You already have a partner. Leave first to join someone else.');
   const inviter=row.from_user;
   // These two had a shared journal before: bring it back. Otherwise start a new, empty one.
   let couple=db.prepare('SELECT id FROM spaces WHERE (a=? AND b=?) OR (a=? AND b=?) ORDER BY created DESC').get(inviter,username,username,inviter)?.id;
   if(couple)db.prepare('UPDATE spaces SET paired=? WHERE id=?').run(Date.now(),couple);
   else{couple=randomUUID();db.prepare('INSERT INTO spaces(id,owner,created,paired,a,b) VALUES(?,?,?,?,?,?)').run(couple,inviter,Date.now(),Date.now(),inviter,username)}
   db.prepare('UPDATE users SET couple_id=?,pending_invite=NULL WHERE username IN (?,?)').run(couple,inviter,username);
   db.prepare('UPDATE invites SET used_by=?,used_at=? WHERE code_hash=?').run(username,Date.now(),hashCode(code));
   db.prepare('DELETE FROM invites WHERE from_user IN (?,?) AND used_by IS NULL').run(inviter,username);
   db.exec('COMMIT');
   return {partner:inviter};
  }catch(e){try{db.exec('ROLLBACK')}catch{}throw e}
 }
 /** Stops sharing. The shared journal is kept (hidden from both) and comes back if these two pair again. */
 function leave(username){
  const couple=coupleOf(username),partner=partnerOf(username);if(!couple||!partner)return {error:'You don’t have a partner right now.'};
  db.prepare('UPDATE users SET couple_id=NULL WHERE couple_id=?').run(couple);
  db.prepare('UPDATE spaces SET paired=NULL WHERE id=?').run(couple);
  return {left:true,partner};
 }
 /** After sign-up (and email confirmation): pair with whoever's code was used to sign up. */
 function onAccountReady(username){
  const code=db.prepare('SELECT pending_invite FROM users WHERE username=?').get(username)?.pending_invite;
  if(!code)return;db.prepare('UPDATE users SET pending_invite=NULL WHERE username=?').run(username);
  const r=accept(username,code);if(r.partner)notify(r.partner,username);
 }
 const rememberInvite=(username,code)=>db.prepare('UPDATE users SET pending_invite=? WHERE username=?').run(normalizeCode(code),username);

 /** Account deletion, the journal side. Your own journal goes. A shared journal you're in now moves into your partner's
  *  own journal (memories, countdowns, diary, photos), so they keep it; past shared journals (from before you left a
  *  partner) go, and the other person's photos in them become private to that person. Deleting your files is the
  *  caller's job; this re-homes the files in a current shared journal (yours included) to the partner. */
 function removeUser(username){
  const doc=id=>{try{return JSON.parse(db.prepare('SELECT data FROM shared WHERE id=?').get(id)?.data??'null')}catch{return null}};
  const couple=coupleOf(username),partner=partnerOf(username),own=db.prepare('SELECT space_id FROM users WHERE username=?').get(username)?.space_id;
  let kept=null;
  if(couple&&partner){
   const into=personalOf(partner),from=doc(couple);
   if(from){
    const to=doc(into)??{journal:[],moments:[]},ids=new Set((to.moments??[]).map(m=>m.id));
    const merged={...to,journal:[...(to.journal??[]),...(from.journal??[])],moments:[...(to.moments??[]),...(from.moments??[]).filter(m=>!ids.has(m.id))].slice(0,100),
     diary:[...(to.diary??[]),...(from.diary??[])],photoDump:[...(to.photoDump??[]),...(from.photoDump??[])],...(from.together&&!to.together?{together:from.together}:{})};
    db.prepare('INSERT INTO shared(id,data,revision) VALUES(?,?,1) ON CONFLICT(id) DO UPDATE SET data=excluded.data,revision=shared.revision+1').run(into,JSON.stringify(merged));
   }
   // Everything shared into the couple's journal, including your uploads, now belongs to the partner's own journal.
   db.prepare('UPDATE files SET space_id=?,user_id=? WHERE space_id=?').run(into,partner,couple);
   db.prepare('UPDATE users SET couple_id=NULL WHERE username=?').run(partner);
   kept=partner;
  }
  // Every shared journal you were ever part of, and your own: gone. Others' photos in them stay theirs, privately.
  const ids=db.prepare('SELECT id FROM spaces WHERE a=? OR b=? OR id=?').all(username,username,own??'').map(r=>r.id);
  for(const id of ids){db.prepare('UPDATE files SET space_id=NULL,shared=0 WHERE space_id=? AND user_id<>?').run(id,username);db.prepare('DELETE FROM shared WHERE id=?').run(id);db.prepare('DELETE FROM spaces WHERE id=?').run(id)}
  db.prepare('DELETE FROM invites WHERE from_user=? OR used_by=?').run(username,username);
  return {partner:kept};
 }

 // ----- routes (signed in) -----
 const tries=new Map();
 const tooMany=username=>{const now=Date.now(),list=(tries.get(username)??[]).filter(t=>now-t<TRY_WINDOW);tries.set(username,list);return list.length>=TRIES};
 const failed=username=>tries.get(username)?.push(Date.now());
 async function handle(req,res,url,user){
  if(!url.pathname.startsWith('/api/pair'))return false;
  const route=`${req.method} ${url.pathname}`;
  if(route==='GET /api/pair'){
   const partner=partnerOf(user.username),s=partner?db.prepare('SELECT paired FROM spaces WHERE id=?').get(coupleOf(user.username)):null;
   const invite=db.prepare('SELECT expires FROM invites WHERE from_user=? AND used_by IS NULL AND expires>?').get(user.username,Date.now());
   return json(res,200,{partner:partner?publicUser(userOf(partner)):null,since:s?.paired?new Date(s.paired).toISOString():null,invite:invite?{expires:invite.expires}:null}),true;
  }
  if(route==='POST /api/pair/invite'){const r=createInvite(user.username);return json(res,r.error?409:200,r),true}
  if(route==='DELETE /api/pair/invite'){db.prepare('DELETE FROM invites WHERE from_user=? AND used_by IS NULL').run(user.username);return json(res,200,{ok:true}),true}
  if(route==='POST /api/pair/preview'||route==='POST /api/pair/accept'){
   if(tooMany(user.username))return json(res,429,{error:'Too many tries. Wait a few minutes and try again.'}),true;
   const {code}=await readJson(req,2000),row=normalizeCode(code).length===8?liveInvite(code):null;
   if(!row||row.from_user===user.username){failed(user.username);return json(res,400,{error:row?'That’s your own code. Send it to your partner.':'That code isn’t valid or has expired. Ask for a new one.'}),true}
   if(route==='POST /api/pair/preview'){const from=userOf(row.from_user);return json(res,200,{from:{displayName:from.displayName,avatar:from.avatar??null}}),true}
   const r=accept(user.username,code);if(r.error){failed(user.username);return json(res,409,r),true}
   notify(r.partner,user.username);
   return json(res,200,{partner:publicUser(userOf(r.partner))}),true;
  }
  if(route==='POST /api/pair/leave'){const r=leave(user.username);return json(res,r.error?409:200,r.error?r:{ok:true}),true}
  return false;
 }

 return {spaceOf,spaceFor,spacesOf,personalOf,coupleOf,partnerOf,isCouple,circleOf,checkInvite,rememberInvite,onAccountReady,removeUser,handle};
}
