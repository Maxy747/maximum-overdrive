/** Colours a goal card can have (Profile / goal editor). Without one, the card's name picks it (Body, Food…). */
export const CARD_COLORS=['red','orange','amber','lime','green','teal','cyan','blue','purple','pink'] as const;export type CardColor=typeof CARD_COLORS[number];
/** Colours for the Journal's stat cards. */
export const STAT_TONES=['rose','amber','blue','purple','green','teal','pink','night'] as const;export type StatTone=typeof STAT_TONES[number];
export type Goal = { id:string; title:string; category:string; color?:CardColor; description:string; items:string[]; target:number; kind:'checkbox'|'checklist'|'choice'|'any'|'count'|'duration'; unit:string; essential:boolean; private:boolean; days:number[]; reminder:string; reminders?:GoalReminder[]; need?:number; perWeek?:number; easy?:{need?:number;target?:number}; windows?:{item:string;from:string;to:string}[]; sleepPlan?:{bedBy:string;wakeBy:string}; archived:boolean; created:string };
// perWeek: a flexible goal ("work out 3 times this week") shows every day but only needs doing that many days a week.
// easy: the smaller version used on a low-energy day (defaults: half the checklist, half the target, sleep unchanged).
// Extra reminder times for a goal. `item` ties a time to one checklist item (e.g. Food → Lunch), so it stays quiet once that item is ticked.
export type GoalReminder = {time:string;item?:number};
export type CustomReminder = {id:string;title:string;emoji:string;time:string;days:number[];note:string;enabled:boolean};
export type TimedNudge = {enabled:boolean;time:string};
export type Entry = {goal:Goal; checks:boolean[]; value:number; note:string; rest:boolean; exerciseLogs?:Record<string,{reps:number;sets:number}>;easy?:boolean;stretch?:boolean;media?:FileRecord[];resists?:number[];didAt?:number;times?:(string|null)[];bed?:string;wake?:string;noSleep?:boolean;couldnt?:number[]};
// lowEnergy: the day uses each goal's smaller version (entries get easy:true). It keeps the streak but isn't a perfect day.
// energy: the day's energy meter. full = stretch goals (entries get stretch:true), okay = usual (the default), low = smaller goals.
export type Energy = 'full'|'okay'|'low';
export type Day = {entries:Entry[]; reflection:string; focus:string; lowEnergy?:boolean; energy?:Energy};
export type FileRecord = {id:string;name:string;size:number};
export const momentColors=['night','red','pink','purple','blue','green','teal'] as const;
export type MomentColor = typeof momentColors[number];
export type JournalComment = {id:string;author:string;text:string;created:string};
export type JournalEntry = {id:string;title:string;body:string;date:string;time:string;location:string;lat?:number;lng?:number;photos:FileRecord[];author:string;created:string;sensitive?:boolean;comments?:JournalComment[];coverPos?:{id:string;x:number;y:number}};
// coverPos: how the cover photo is framed on the card (focal point in %), for the photo with that id.
// A milestone, or a countdown when its date is ahead. `repeat:'yearly'` makes it come back every year (birthdays, anniversaries).
export type Moment = {id:string;title:string;icon:string;date:string;time:string;color:MomentColor;repeat?:'yearly'};
// The next time a milestone happens, today or later (yearly ones roll over; 29 Feb falls on 28 Feb in other years).
export function nextOccurrence(m:Pick<Moment,'date'|'repeat'>,today=dateKey()){
 if(m.repeat!=='yearly')return m.date;
 const md=m.date.slice(5),at=(y:number)=>{const k=`${y}-${md}`;return md==='02-29'&&new Date(y,1,29).getMonth()!==1?`${y}-02-28`:k};
 const y=Number(today.slice(0,4));return at(y)>=today?at(y):at(y+1);
}
// Upcoming countdowns (soonest first): one-off dates still ahead, and every yearly one.
export function upcoming(moments:Moment[],today=dateKey()){return moments.map(m=>({m,next:nextOccurrence(m,today)})).filter(x=>x.next>=today).sort((a,b)=>a.next.localeCompare(b.next)||a.m.title.localeCompare(b.m.title))}
// Moods: saved with a timestamp and an optional note; shared ones are shown to your partner.
export const MOODS=[{key:'great',emoji:'😄',label:'Great'},{key:'loved',emoji:'🥰',label:'Loved'},{key:'good',emoji:'🙂',label:'Good'},{key:'okay',emoji:'😐',label:'Okay'},{key:'tired',emoji:'😴',label:'Tired'},{key:'low',emoji:'😔',label:'Low'},{key:'anxious',emoji:'😰',label:'Anxious'},{key:'sad',emoji:'😢',label:'Sad'},{key:'angry',emoji:'😤',label:'Frustrated'}] as const;
export type MoodKey = typeof MOODS[number]['key'];
export type Mood = {id:string;username:string;mood:MoodKey;note:string;shared:boolean;at:number};
export const moodOf=(key:string)=>MOODS.find(m=>m.key===key)??MOODS[3];
export type DumpPhoto = FileRecord&{sensitive?:boolean};
// Recently deleted: kept TRASH_DAYS days so it can be restored (back into its memories too), then removed for good.
export type TrashPhoto = DumpPhoto&{deletedAt:string;deletedBy:string;memoryIds?:string[]};
export const TRASH_DAYS=30;
export type DiaryEntry = {id:string;title:string;body:string;date:string;author:string;created:string;updated:string};
// The journal's Recently deleted: a deleted memory, milestone, diary entry or comment, kept TRASH_DAYS days.
// `id` is the deleted item's id; a comment remembers its memory so Restore puts it back there.
export type JournalTrash = {id:string;kind:'memory'|'milestone'|'diary'|'comment';deletedAt:string;deletedBy:string;memoryId?:string;memory?:JournalEntry;milestone?:Moment;diary?:DiaryEntry;comment?:JournalComment};
export type SharedState = {journal:JournalEntry[];moments:Moment[];together?:string;photoDump?:DumpPhoto[];photoTrash?:TrashPhoto[];diary?:DiaryEntry[];journalTrash?:JournalTrash[]};
// displayName is the nickname, used everywhere; name is the real name, shown only in Profile.
export type User = {username:string;displayName:string;name?:string;avatar:string|null;birthday?:string};
// Each person's birthday is a yearly milestone with this id, set from Profile. It shows in Coming up during the 30 days before.
export const birthdayId=(username:string)=>`birthday-${username}`;
export const isBirthday=(m:{id:string})=>m.id.startsWith('birthday-');
/** Birthdays live on each account (Profile) and show as yearly countdowns for you and your partner. */
export const birthdayMoments=(users:Pick<User,'username'|'displayName'|'birthday'>[]):Moment[]=>users.filter(u=>u.birthday).map(u=>({id:birthdayId(u.username),title:`${u.displayName}’s birthday`,icon:'🎂',date:u.birthday!,time:'',color:'pink',repeat:'yearly'}));
/** A journal's own moments (old birthday copies left out) plus the birthdays of the people in it. */
export const withBirthdays=(moments:Moment[],users:Pick<User,'username'|'displayName'|'birthday'>[])=>[...moments.filter(m=>!isBirthday(m)),...birthdayMoments(users)];
export const BIRTHDAY_LEAD_DAYS=30;
export type Freezes = {since:string;earned:{date:string;reason:'month'|'week'}[];used:string[]};
export type State = {goals:Goal[];days:Record<string,Day>;settings:{name:string;quietStart:string;quietEnd:string;reminders:boolean;relationshipStart?:string;allowGoalEdits?:boolean;notifyPartner?:boolean;hideCouple?:boolean;coach?:boolean;statColors?:Partial<Record<string,StatTone>>;customReminders?:CustomReminder[];evening?:TimedNudge;dailyNudge?:TimedNudge;timeZone?:string};freezes?:Freezes;recaps?:Record<string,string>;body?:import('./body').BodyGoal};
export function dateKey(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
// A tracking day runs from 5:30 am to 5:30 am: late nights still count for the day before, and a streak
// only breaks once 5:30 am passes without the day being finished.
export const DAY_START_MINUTES=5*60+30;
export function dayKey(now=new Date()){return dateKey(new Date(now.getTime()-DAY_START_MINUTES*60000))}
export function msUntilDayEnds(now=new Date()){const end=new Date(now);end.setHours(Math.floor(DAY_START_MINUTES/60),DAY_START_MINUTES%60,0,0);if(end<=now)end.setDate(end.getDate()+1);return end.getTime()-now.getTime()}
export function daysSince(start:string,today=dateKey()){return Math.round((new Date(today+'T12:00:00').getTime()-new Date(start+'T12:00:00').getTime())/86400000)}
export function shiftDay(key:string,n:number){const d=new Date(key+'T12:00:00');d.setDate(d.getDate()+n);return dateKey(d)}
export function complete(e:Entry){return !e.rest && (['count','duration'].includes(e.goal.kind)?e.value>=targetFor(e):e.goal.kind==='checkbox'?!!e.checks[0]:['choice','any'].includes(e.goal.kind)?e.checks.some(Boolean):e.checks.filter(Boolean).length>=needFor(e))}
// Checklist items needed to finish: all of them unless the goal says fewer (Body: any 3 of 4 exercises).
export function needOf(g:Goal){return Math.max(1,Math.min(g.items.length,g.need??g.items.length))}
export function fraction(e:Entry){return e.rest?0:['count','duration'].includes(e.goal.kind)?Math.min(1,e.value/targetFor(e)):e.goal.kind==='checkbox'?Number(!!e.checks[0]):['choice','any'].includes(e.goal.kind)?Number(e.checks.some(Boolean)):Math.min(1,e.checks.filter(Boolean).length/needFor(e))}
// Low-energy versions. Your real progress still shows against the full goal; only "done" uses these.
export function easyNeedOf(g:Goal){return Math.max(1,Math.min(needOf(g),g.easy?.need??Math.ceil(needOf(g)/2)))}
export function easyTargetOf(g:Goal){return Math.min(g.target,g.easy?.target??(g.category.toLowerCase()==='sleep'?g.target:Math.round(g.target/2*100)/100))}
// Stretch versions (full energy): every checklist item, +25% on counts and durations (sleep unchanged), +25% reps.
export const STRETCH=1.25;
export function stretchTargetOf(g:Goal){return g.category.toLowerCase()==='sleep'?g.target:Math.ceil(g.target*STRETCH*100)/100}
export function stretchReps(item:string){return item.replace(/(\d+)(\s*[×x]\s*\d+)/,(_,r,rest)=>`${Math.ceil(Number(r)*STRETCH)}${rest}`)}
export const needFor=(e:Entry)=>e.stretch?Math.max(1,e.goal.items.length):e.easy?easyNeedOf(e.goal):needOf(e.goal);
export const targetFor=(e:Entry)=>e.stretch?stretchTargetOf(e.goal):e.easy?easyTargetOf(e.goal):e.goal.target;
// Flexible goals: weeks run Monday to Sunday.
export const isFlexible=(g:Pick<Goal,'perWeek'>)=>!!g.perWeek;
export function weekOf(key:string){const back=(new Date(key+'T12:00:00').getDay()+6)%7;return shiftDay(key,-back)}
export function weekCount(s:State,id:string,key:string){const start=weekOf(key);let n=0;for(let i=0;i<7;i++){const e=s.days[shiftDay(start,i)]?.entries.find(x=>x.goal.id===id);if(e&&complete(e))n++}return n}
// Still needed this week, and days left to do it in (today included).
export function weekLeft(s:State,g:Goal,key:string){const need=Math.max(0,(g.perWeek??0)-weekCount(s,g.id,key)),daysLeft=7-((new Date(key+'T12:00:00').getDay()+6)%7);return {need,daysLeft}}
export function dayFor(s:State,key:string):Day{return s.days[key]??{entries:s.goals.filter(g=>!g.archived&&g.created<=key&&g.days.includes(new Date(key+'T12:00:00').getDay())).map(goal=>({goal:structuredClone(goal),checks:(goal.kind==='checkbox'?['Done']:goal.items).map(()=>false),value:0,note:'',rest:false})),reflection:'',focus:''}}
// Streak (no id): consecutive days you updated anything. Today doesn't break it until 5:30 am, and a day
// covered by a freeze bridges it without counting. streak(s,id): consecutive days that goal was completed.
export function streak(s:State,id?:string){
 if(!id){let n=0,key=dayKey();const first=[...Object.keys(s.days),...s.goals.map(g=>g.created)].sort()[0]??key;for(let i=0;i<3660&&key>=first;i++,key=shiftDay(key,-1)){const st=dayStatus(s,key);if(st==='done'||st==='logged')n++;else if(st==='missed'&&i!==0){if(s.freezes?.used.includes(key))continue;break}}return n}
 const g=s.goals.find(x=>x.id===id);
 if(g?.perWeek){let n=0,week=weekOf(dayKey());const first=weekOf(g.created);for(let i=0;i<520&&week>=first;i++,week=shiftDay(week,-7)){if(weekCount(s,id,week)>=g.perWeek)n++;else if(i!==0)break}return n}
 let n=0,key=dayKey();const first=s.goals.filter(g=>g.id===id).map(g=>g.created).sort()[0]??key;for(let i=0;i<3660&&key>=first;i++,key=shiftDay(key,-1)){const d=dayFor(s,key);const active=d.entries.filter(e=>e.goal.id===id&&!e.rest);if(!active.length)continue;if(active.every(complete))n++;else if(i!==0)break}return n;
}
// Perfect streak: consecutive days with every essential goal finished (today counts once it is).
export function perfectStreak(s:State){let n=0,key=dayKey();const first=[...Object.keys(s.days),...s.goals.map(g=>g.created)].sort()[0]??key;for(let i=0;i<3660&&key>=first;i++,key=shiftDay(key,-1)){const st=dayStatus(s,key);if(st==='done')n++;else if(st!=='none'&&i!==0)break}return n}
export function initialShared():SharedState{return {journal:[],moments:[]}}
export function initialState(name='Me'):State{
 const created=dayKey(),days=[0,1,2,3,4,5,6];
 const definitions=[
 ['body','Body','Move with intention','A starter routine. Adjust it to your current level.',['Push-ups · 20 × 2','Pull-ups · 20 × 2','Squats · 20 × 2','Sit-ups · 20 × 2']],
 ['food','Food','Fuel your day','Three meals. One less thing to overthink.',['Breakfast','Lunch','Dinner']],
 ['sleep','Sleep','Recharge for tomorrow','Log your sleep in hours.',['Sleep']],
 ['work','Work','Make something move','Work, a personal project, or job hunting.',['Meaningful progress on one project']],
 ['personal','Personal','Stay connected','Make a little room for your people.',['Connect or hang out with friends','Connect with family','Call or text someone you miss','Connect with someone new']],
 ['control','Self-control','Choose your next step','A check-in. Progress without judgment.',['Chose to do it','Chose not to do it']],
 ['digital','Digital cleanup','A little less clutter','Small efforts add up.',['10 minutes of digital cleanup']],
 ['content','Content','Create something yours','Move one idea a little further.',['Made progress on a post']]
 ] as const;
 return {goals:definitions.map(([id,category,title,description,items])=>({id,category,title,description,items:[...items],kind:id==='sleep'?'duration':id==='control'?'choice':id==='personal'?'any':items.length===1?'checkbox':'checklist',target:id==='sleep'?7:1,unit:id==='sleep'?'hours':'times',essential:!['control','digital','content'].includes(id),private:false,days,reminder:'',archived:false,created,...(id==='body'?{need:3}:{})})),days:{},settings:{name,quietStart:'00:00',quietEnd:'07:00',reminders:false,relationshipStart:''}};
}

export function fillHistory(s:State,today=dayKey()){const latest=Object.keys(s.days).filter(k=>k<=today).sort().at(-1);let key=latest?shiftDay(latest,1):today;for(let i=0;key<=today&&i<3660;i++,key=shiftDay(key,1)){if(!s.days[key])s.days[key]=dayFor(s,key)}}

// ---------- streak freezes ----------
export type DayStatus='done'|'logged'|'missed'|'none';
// A day counts when every scheduled essential goal that isn't on planned rest is complete.
// Did you touch this day at all? Any tick, value, note, photo, exercise log, rest day or reflection counts.
export function logged(d:Day){return !!(d.reflection?.trim()||d.focus?.trim())||d.entries.some(e=>e.rest||e.checks.some(Boolean)||e.value>0||!!e.note?.trim()||!!e.media?.length||!!(e.exerciseLogs&&Object.keys(e.exerciseLogs).length)||!!e.noSleep||!!e.couldnt?.length)}
// done = every essential finished (a perfect day) · logged = updated, not perfect · missed = nothing updated · none = nothing scheduled.
// Flexible goals never make a day missed or imperfect; a low-energy day that's finished keeps the streak as 'logged'.
// Body rest days: at most two in a row. A third one in a row isn't a rest: Body counts as not done that day.
export const MAX_BODY_RESTS=2;
const isBodyGoal=(g:Pick<Goal,'category'>)=>g.category.toLowerCase()==='body';
/** How many days in a row, right before `key`, this goal was on rest. */
export function restsBefore(s:State,goalId:string,key:string){let n=0;for(let k=shiftDay(key,-1);n<30;k=shiftDay(k,-1)){const e=s.days[k]?.entries.find(x=>x.goal.id===goalId);if(!e?.rest)break;n++}return n}
/** Can this entry be on rest today? Body can't rest a third day running. */
export const restAllowed=(s:State,key:string,e:Entry)=>!isBodyGoal(e.goal)||restsBefore(s,e.goal.id,key)<MAX_BODY_RESTS;
export function dayStatus(s:State,key:string):DayStatus{const raw=s.days[key]??dayFor(s,key),d=raw.entries.some(e=>e.rest&&!restAllowed(s,key,e))?{...raw,entries:raw.entries.map(e=>e.rest&&!restAllowed(s,key,e)?{...e,rest:false}:e)}:raw,es=d.entries.filter(e=>e.goal.essential&&!e.rest&&!isFlexible(e.goal));if(es.length&&es.every(complete))return d.lowEnergy?'logged':'done';if(s.days[key]&&logged(d))return 'logged';return es.length?'missed':'none'}
const nextMonth=(m:string)=>{let [y,mo]=m.split('-').map(Number);mo++;if(mo>12){mo=1;y++}return `${y}-${String(mo).padStart(2,'0')}`};
export const freezeBalance=(s:State)=>s.freezes?Math.max(0,s.freezes.earned.length-s.freezes.used.length):0;
// Grants one freeze per calendar month and one per 7 perfect days in a row, and spends a freeze on a
// missed day (before today) that would otherwise end a live streak. Safe to run repeatedly. Returns true if anything changed.
export function applyFreezes(s:State,today=dayKey()):boolean{
 const before=JSON.stringify(s.freezes??null);
 const f=s.freezes??(s.freezes={since:today,earned:[],used:[]});
 for(let m=f.since.slice(0,7);m<=today.slice(0,7);m=nextMonth(m))if(!f.earned.some(e=>e.reason==='month'&&e.date.startsWith(m)))f.earned.push({date:`${m}-01`,reason:'month'});
 let run=0,live=0;
 for(let d=f.since,i=0;d<today&&i<3660;d=shiftDay(d,1),i++){
  const st=dayStatus(s,d);
  if(st==='none')continue;
  if(st==='done'||st==='logged'){
   if(f.used.includes(d))f.used=f.used.filter(u=>u!==d); // updated after all: refund the freeze
   live++;
   if(st==='done'){run++;if(run%7===0&&!f.earned.some(e=>e.reason==='week'&&e.date===d))f.earned.push({date:d,reason:'week'})}else run=0;
   continue;
  }
  run=0;
  if(f.used.includes(d))continue;
  const available=f.earned.filter(e=>e.date<=d).length-f.used.filter(u=>u<d).length;
  if(live>0&&available>0)f.used.push(d);else live=0;
 }
 f.earned.sort((a,b)=>a.date.localeCompare(b.date));f.used.sort();
 return JSON.stringify(f)!==before;
}
// Perfect days in the current run (today counts once it is done), toward the next weekly freeze.
export function perfectRun(s:State,today=dayKey()){
 let run=0;const since=s.freezes?.since??today;
 for(let d=since,i=0;d<=today&&i<3660;d=shiftDay(d,1),i++){const st=dayStatus(s,d);if(st==='done')run++;else if((st==='missed'||st==='logged')&&d<today)run=0}
 return run;
}
export function bestStreak(s:State,today=dayKey()){
 const first=[...Object.keys(s.days),...s.goals.map(g=>g.created)].sort()[0]??today;let best=0,cur=0;
 for(let d=first,i=0;d<=today&&i<3660;d=shiftDay(d,1),i++){const st=dayStatus(s,d);if(st==='done'||st==='logged'){cur++;best=Math.max(best,cur)}else if(st==='missed'&&d<today&&!s.freezes?.used.includes(d))cur=0}
 return Math.max(best,streak(s));
}

// ---------- reminders ----------
// Quiet hours can wrap past midnight (e.g. 23:00 → 08:00). Equal start and end means "no quiet hours".
export function inQuietHours(time:string,start:string,end:string){if(!start||!end||start===end)return false;return start<end?time>=start&&time<end:time>=start||time<end}

// Every reminder time on a goal: the original single time plus any extra ones.
export function goalReminders(g:Goal):GoalReminder[]{return [...(g.reminder?[{time:g.reminder}]:[]),...(g.reminders??[])]}
// Reminders still worth sending for a day's entry. Times come from the goal as it is now (so edits apply
// today); a reminder tied to a checklist item stays quiet once that item is ticked.
export function openReminders(s:State,e:Entry,date?:string):GoalReminder[]{
 if(e.rest||complete(e))return [];
 const def=s.goals.find(g=>g.id===e.goal.id)??e.goal;
 if(def.perWeek&&date&&weekCount(s,def.id,date)>=def.perWeek)return [];
 // Once anything is logged (sleep hours, a ticked item) the goal's general reminders stop, even under target;
 // a reminder tied to one item still comes while that item is open (Lunch after Breakfast).
 // Count goals (glasses of water) keep reminding until the target is reached.
 return goalReminders(def).filter(r=>r.item!==undefined?!e.checks[r.item]:def.kind==='count'||!started(e));
}
// "Didn't sleep" and "couldn't do it" are answers too: the goal is logged, not waiting.
export const started=(e:Entry)=>e.value>0||e.checks.some(Boolean)||!!e.noSleep||!!e.couldnt?.length;

// Goals with a reminder at exactly `time` on `date`, still unfinished, not on planned rest, outside quiet hours.
export function dueReminders(s:State,date:string,time:string){
 if(!s.settings.reminders||inQuietHours(time,s.settings.quietStart,s.settings.quietEnd))return [];
 return dayFor(s,date).entries
  .filter(e=>openReminders(s,e,date).some(r=>r.time===time))
  .map(e=>({id:e.goal.id,title:e.goal.private?'Your private check-in':e.goal.title,private:e.goal.private,category:e.goal.private?'':e.goal.category}));
}

// Evening check-in and daily-question nudge are on by default once notifications are enabled.
export const eveningOf=(s:State):TimedNudge=>s.settings.evening??{enabled:true,time:'21:30'};
export const dailyNudgeOf=(s:State):TimedNudge=>s.settings.dailyNudge??{enabled:true,time:'20:00'};

// target: what tapping the notification opens (goal:<id>, recap), beyond the page in `view`.
export type Nudge={key:string;title:string;body:string;view:string;target?:string};
// Everything to push at `time` on `date`. `key` is unique per day, so each nudge is sent once.
// Custom reminders are times you picked yourself, so they ignore quiet hours (a 6:30 wake-up still rings).
export function dueNudges(s:State,date:string,time:string,ctx:{dailyAnswered?:boolean;question?:string}={}):Nudge[]{
 const out:Nudge[]=[],quiet=inQuietHours(time,s.settings.quietStart,s.settings.quietEnd),day=dayFor(s,date),weekday=new Date(date+'T12:00:00').getDay();
 if(s.settings.reminders&&!quiet)for(const e of day.entries){
  const def=s.goals.find(g=>g.id===e.goal.id)??e.goal;
  for(const r of openReminders(s,e,date)){
   if(r.time!==time)continue;
   const item=r.item!==undefined?def.items[r.item]:undefined,key=`goal-${def.id}-${time}`;
   if(out.some(n=>n.key===key))continue;
   out.push(def.private?{key,title:'Private check-in',body:'A gentle nudge for your private goal.',view:'Today',target:`goal:${def.id}`}:{key,title:item??def.title,body:def.kind==='count'?`${e.value} of ${targetFor(e)} ${def.unit} so far · tap to add one`:`${def.category} · ${item?'tap to log it':'tap to check in'}`,view:'Today',target:`goal:${def.id}`});
  }
 }
 // Timed items (lib/timing): a nudge when the window opens (unless the item has its own reminder) and one when it
 // closes still unticked. Plus bedtime, 30 minutes before Sleep's bed-by time.
 if(s.settings.reminders&&!quiet){
  for(const e of day.entries){
   if(e.rest)continue;const def=s.goals.find(g=>g.id===e.goal.id)??e.goal;if(def.private)continue;
   const meal=def.category.toLowerCase()==='food',own=goalReminders(def);
   itemsOf(def).forEach((item,i)=>{const w=windowFor(def,item);if(!w||e.checks[i])return;const name=item.toLowerCase();
    if(w.from===time&&!own.some(r=>r.item===i))out.push({key:`window-${def.id}-${i}`,title:meal?`${item} time 🍽️`:`Time for: ${item}`,body:`${meal?'Eat':'Get it done'} by ${fmtTime(w.to)}, then tick it.`,view:'Today',target:`goal:${def.id}`});
    if(w.to===time)out.push({key:`missed-${def.id}-${i}`,title:`Missed ${name}?`,body:meal?`Your ${name} window just closed. Have something small now instead of skipping it, and log it.`:`Its window just closed. Do it now if you still can, and log it.`,view:'Today',target:`goal:${def.id}`});
   });
  }
  for(const g of s.goals){if(g.archived||!isSleepGoal(g))continue;const p=sleepPlanOf(g);if(!p?.bedBy)continue;const m=(toMin(p.bedBy)+1410)%1440;
   if(`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`===time)out.push({key:'bedtime',title:'Bedtime in 30 minutes 🌙',body:`Start winding down and be in bed by ${fmtTime(p.bedBy)}. A steady bedtime is what fixes your sleep.`,view:'Today'})}
 }
 for(const c of s.settings.customReminders??[])if(c.enabled&&c.time===time&&c.days.includes(weekday))out.push({key:`custom-${c.id}`,title:`${c.emoji} ${c.title}`.trim(),body:c.note||'A reminder from MAX',view:'Today'});
 const evening=eveningOf(s);
 if(evening.enabled&&evening.time===time&&!quiet){
  const atRisk=(e:Entry)=>{if(!isFlexible(e.goal))return true;const w=weekLeft(s,s.goals.find(g=>g.id===e.goal.id)??e.goal,date);return w.need>0&&w.need>=w.daysLeft};
  const essentials=day.entries.filter(e=>e.goal.essential&&!e.rest&&(!isFlexible(e.goal)||atRisk(e))),left=essentials.filter(e=>!complete(e)&&!started(e)),noWords=!day.reflection.trim();
  if(left.length||noWords){
   const names=left.map(e=>e.goal.private?'a private goal':['count','duration'].includes(e.goal.kind)?`${e.goal.category} (not logged)`:e.goal.category);
   const list=names.length>2?`${names.slice(0,-1).join(', ')} and ${names.at(-1)}`:names.join(' and ');
   out.push({key:'evening',title:left.length?`${left.length} of ${essentials.length} still open today`:'How was today?',body:left.length?`${list} left${noWords?' · and a few words about your day':''}.`:'Write a few words about your day before it ends.',view:'Today',...(left.length===1?{target:`goal:${left[0].goal.id}`}:{})});
  }
 }
 // Sleep fix: logged sleep under the target gets one gentle nudge to wind down earlier tonight (not a "log it" reminder).
 if(s.settings.reminders&&time==='22:30'&&!quiet)for(const e of day.entries){if(e.rest||e.goal.private||e.goal.kind!=='duration'||e.goal.category.toLowerCase()!=='sleep')continue;
  if(e.noSleep){out.push({key:`sleepfix-${e.goal.id}`,title:'😴 Early night tonight',body:'You didn’t get any sleep last night. Screens off soon and get to bed early.',view:'Today'});continue}
  if(!(e.value>0)||e.value>=e.goal.target)continue;
  out.push({key:`sleepfix-${e.goal.id}`,title:'😴 Sleep fix tonight',body:`You got ${e.value} of ${e.goal.target} ${e.goal.unit}. Wind down a little earlier tonight and aim for bed on time.`,view:'Today'})}
 if(weekday===1&&time==='09:00'&&!quiet&&s.settings.reminders!==false)out.push({key:`recap-${date}`,title:'Your week in review 📊',body:'See what you finished, missed and improved, with a note from Coach MAX.',view:'Progress',target:'recap'});
 const daily=dailyNudgeOf(s);
 if(daily.enabled&&daily.time===time&&!quiet&&ctx.dailyAnswered===false&&!s.settings.hideCouple)out.push({key:'daily',title:'Today’s question is waiting ❤️',body:ctx.question||'Answer it to see each other’s answers.',view:'Journal'});
 return out;
}

// Weekly recap (Monday to Sunday): what you finished, missed and improved against the week before.
export type RecapGoal={id:string;label:string;done:number;planned:number;prevDone:number;prevPlanned:number;perWeek?:number};
export type Recap={start:string;end:string;days:number;perfect:number;logged:number;missed:number;low:number;goals:RecapGoal[];improved:string[];slipped:string[];best?:string;focus?:string};
export function weeklyRecap(s:State,start:string,today=dayKey()):Recap{
 const first=[...Object.keys(s.days),...s.goals.map(g=>g.created)].sort()[0]??today;
 const daysOf=(st:string)=>Array.from({length:7},(_,i)=>shiftDay(st,i)).filter(d=>d<=today&&d>=first);
 const tally=(st:string)=>{const out=new Map<string,{label:string;done:number;planned:number;perWeek?:number}>();
  for(const k of daysOf(st))for(const e of (s.days[k]??dayFor(s,k)).entries){if(e.rest)continue;const g=s.goals.find(x=>x.id===e.goal.id)??e.goal,t=out.get(g.id)??{label:g.private?'A private goal':g.category,done:0,planned:0,...(g.perWeek?{perWeek:g.perWeek}:{})};if(!g.perWeek)t.planned++;if(s.days[k]&&complete(e))t.done++;out.set(g.id,t)}
  for(const t of out.values())if(t.perWeek){t.planned=t.perWeek;t.done=Math.min(t.done,t.perWeek)}
  return out};
 const now=tally(start),prev=tally(shiftDay(start,-7)),days=daysOf(start),st=days.map(k=>dayStatus(s,k));
 const goals:RecapGoal[]=[...now].filter(([,t])=>t.planned>0).map(([id,t])=>({id,label:t.label,done:t.done,planned:t.planned,prevDone:prev.get(id)?.done??0,prevPlanned:prev.get(id)?.planned??0,...(t.perWeek?{perWeek:t.perWeek}:{})}));
 const rate=(d:number,p:number)=>p?d/p:0,named=goals.filter(g=>g.label!=='A private goal');
 const improved=named.filter(g=>g.prevPlanned&&rate(g.done,g.planned)-rate(g.prevDone,g.prevPlanned)>=.15).map(g=>g.label);
 const slipped=named.filter(g=>g.prevPlanned&&rate(g.prevDone,g.prevPlanned)-rate(g.done,g.planned)>=.15).map(g=>g.label);
 const sorted=[...named].sort((a,b)=>rate(b.done,b.planned)-rate(a.done,a.planned));
 return {start,end:shiftDay(start,6),days:days.length,perfect:st.filter(x=>x==='done').length,logged:st.filter(x=>x==='logged').length,missed:st.filter(x=>x==='missed').length,low:days.filter(k=>s.days[k]?.lowEnergy).length,goals,improved,slipped,best:sorted.find(g=>g.done>0)?.label,focus:[...sorted].reverse().find(g=>rate(g.done,g.planned)<1)?.label};
}
// A plain-words reflection, used when Coach MAX (the model) isn't available.
export function recapNote(r:Recap){
 if(!r.days)return 'This week hasn’t started yet.';
 const parts=[`${r.perfect} perfect day${r.perfect===1?'':'s'}${r.logged?` and ${r.logged} more where you showed up`:''} out of ${r.days}.`];
 if(r.best)parts.push(`Strongest: ${r.best}.`);if(r.improved.length)parts.push(`Better than last week: ${r.improved.join(', ')}.`);
 if(r.focus)parts.push(`${r.end>dayKey()?'For the rest of the week':'Next week'}, give ${r.focus} one small, easy win a day.`);else parts.push('Every goal hit. Keep the rhythm going.');
 return parts.join(' ');
}

// Self-control's streak: every "I resisted" is a moment (a timestamp in `resists`) and counts up; doing it counts down
// by how many times (the "how many times" count, at `didAt`, or the day itself for older logs). Switching sides starts from 0,
// so the number is how many in a row, positive for resisting, negative for giving in.
export const isSelfControl=(e:Entry)=>e.goal.kind==='choice'&&e.goal.category.toLowerCase()==='self-control';
export function resistStreak(s:State){
 const noon=(k:string)=>new Date(k+'T12:00:00').getTime(),events:[number,number][]=[];
 for(const [k,d] of Object.entries(s.days))for(const e of d.entries){if(!isSelfControl(e)||e.rest)continue;
  for(const t of e.resists??(e.checks[1]?[noon(k)]:[]))events.push([t,1]);
  // A count of 0 isn't giving in; older logs from before the count mean once.
  const times=e.didAt!==undefined?Math.round(e.value)||0:Math.max(1,Math.round(e.value)||1);
  if(e.checks[0]&&times>0)events.push([e.didAt??noon(k),-times])}
 events.sort((a,b)=>a[0]-b[0]);
 let current=0,best=0,worst=0,last:number|null=null;
 for(const [t,n] of events){
  if(n>0){current=current<0?1:current+1;best=Math.max(best,current);last=t}
  else{current=current>0?n:current+n;worst=Math.min(worst,current)}
 }
 return {current,best,worst,last};
}export type ResistStreak=ReturnType<typeof resistStreak>;
const RESIST_LINES=['Nice.','Proud Of You.','Strong Move.','That’s Discipline.','Huge Win.','Locked In.','Unbreakable.','Keep Going.','You’re Winning.','Pure Discipline.','Unstoppable.'];
/** The reward line for the nth moment resisted in a row; after 11 it goes round again. */
export const resistLine=(n:number)=>n<1?'':RESIST_LINES[(n-1)%RESIST_LINES.length];

// ---------- timed goals (the rest is in lib/timing) ----------
// Kept here because reminders (dueNudges) need them and this file loads on its own in tests.
export type TimeWindow={item:string;from:string;to:string};
export type SleepPlan={bedBy:string;wakeBy:string};
const MEALS:Record<string,[string,string]>={breakfast:['07:00','10:00'],lunch:['12:30','15:00'],dinner:['19:00','22:00']};
export const DEFAULT_SLEEP:SleepPlan={bedBy:'23:30',wakeBy:'07:30'};

export const toMin=(t:string)=>{const [h,m]=t.split(':').map(Number);return h*60+m};
export const fmtTime=(t:string)=>{const [h,m]=t.split(':').map(Number);return `${h%12||12}${m?`:${String(m).padStart(2,'0')}`:''}${h<12?' am':' pm'}`};

export const isSleepGoal=(g:Goal)=>g.kind==='duration'&&g.category.toLowerCase()==='sleep';
export const itemsOf=(g:Goal)=>g.kind==='checkbox'?[g.items[0]||g.title]:g.items;

/** The goal's windows: its own list once set (an empty list turns timing off), else meal defaults for Food. */
export function windowsOf(g:Goal):TimeWindow[]{
 if(g.windows)return g.windows;
 if(g.category.toLowerCase()!=='food'||!['checklist','checkbox','any'].includes(g.kind))return [];
 return itemsOf(g).flatMap(item=>{const d=MEALS[item.trim().toLowerCase()];return d?[{item,from:d[0],to:d[1]}]:[]});
}
export const windowFor=(g:Goal,item:string)=>windowsOf(g).find(w=>w.item.trim().toLowerCase()===item.trim().toLowerCase())??null;
/** Sleep's plan: its own once set (blank times turn that half off), else the default. */
export const sleepPlanOf=(g:Goal):SleepPlan|null=>isSleepGoal(g)?g.sleepPlan??DEFAULT_SLEEP:null;
