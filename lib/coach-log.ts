// The coach fills in the tracker from what you tell it. The model only picks from today's items (its
// output is held to a JSON schema), and everything it picks is double-checked here against the message
// itself, so a 3B model can't tick things you never mentioned. Shared by the server (which asks the
// model) and the app (which applies the result, with Undo).
import type {Day,Entry} from './tracker';

export type CoachAction={goal:string;check?:number[];logs?:Record<string,{reps:number;sets:number}>;value?:number};
type Pick_={label:string;goal:string;index:number;keys:string[];body:boolean};
type Amount={key:string;goal:string;unit:string;max:number;keys:string[]};
export type LogPlan={picks:Pick_[];amounts:Amount[];system:string;schema:Record<string,unknown>};

const STOP=new Set('a an and the or of on to in at for with one two my me i im it its did do does done had have has was were is am are be been just some few lot bit made make get got went go more less than then this that today day really very like about also out up minutes minute mins hours hour times time another other member meaningful progress connect'.split(' '));
// A few everyday words the item names don't contain.
const ALSO:Record<string,string[]>={breakfast:['morning','brekkie'],lunch:['noon'],dinner:['supper'],friends:['friend','mates','buddies','homies'],sleep:['slept','nap'],cleanup:['clean','cleaned','cleared','deleted','declutter','organised','organized'],siblings:['brother','sister','bro','sis'],stranger:['strangers']};
const words=(t:string)=>t.toLowerCase().replace(/[‐-―-]/g,'').split(/[^a-z0-9]+/).filter(Boolean);
const keysOf=(...texts:string[])=>{const k=new Set<string>();for(const t of texts)for(const w of words(t))if(w.length>=3&&!STOP.has(w)){k.add(w);for(const a of ALSO[w]??[])k.add(a)}return [...k]};
const mentions=(msg:string[],keys:string[])=>keys.some(k=>msg.some(w=>w.length>=3&&!STOP.has(w)&&(w.startsWith(k)||k.startsWith(w))));
const slug=(t:string)=>t.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')||'amount';
const itemName=(item:string)=>item.split('·')[0].trim();
const isBody=(e:Entry)=>e.goal.category.toLowerCase()==='body';

// Only today's goals that are on (not rest days), in a fixed order so the prompt stays cacheable.
export function logPlan(day:Day):LogPlan{
 const picks:Pick_[]=[],amounts:Amount[]=[],seen=new Set<string>();
 const add=(label:string,e:Entry,index:number,keys:string[])=>{let l=label.slice(0,60);if(seen.has(l.toLowerCase()))l=`${e.goal.category}: ${l}`.slice(0,60);if(seen.has(l.toLowerCase()))return;seen.add(l.toLowerCase());picks.push({label:l,goal:e.goal.id,index,keys,body:isBody(e)})};
 for(const e of day.entries){
  if(e.rest)continue;const g=e.goal;
  if(g.kind==='count'||g.kind==='duration'){let key=`${slug(g.category)}_${slug(g.unit)}`;while(amounts.some(a=>a.key===key))key+='_2';amounts.push({key,goal:g.id,unit:g.unit,max:Math.max(g.target*4,g.unit.toLowerCase().startsWith('hour')?16:g.target*4),keys:keysOf(g.category,g.unit)});continue}
  if(g.kind==='checkbox'){add(g.category,e,0,keysOf(g.category,g.items[0]??''));continue}
  g.items.forEach((item,i)=>add(g.kind==='choice'?`${g.category}: ${itemName(item)}`:itemName(item),e,i,keysOf(itemName(item))));
 }
 const labels=picks.map(p=>p.label),bodyLabels=picks.filter(p=>p.body).map(p=>p.label);
 const props:Record<string,unknown>={did:{type:'array',maxItems:8,uniqueItems:true,items:{type:'string',enum:labels.length?labels:['none']}}},required=['did'];
 if(bodyLabels.length){props.exercise={type:'array',maxItems:bodyLabels.length,items:{type:'object',properties:{name:{type:'string',enum:bodyLabels},reps:{type:'integer',minimum:1,maximum:1000},sets:{type:'integer',minimum:1,maximum:100}},required:['name','reps','sets']}};required.push('exercise')}
 for(const a of amounts){props[a.key]={type:'number',minimum:0,maximum:a.max};required.push(a.key)}
 const empty=()=>{const o:Record<string,unknown>={did:[]};if(bodyLabels.length)o.exercise=[];for(const a of amounts)o[a.key]=0;return o};
 const b=bodyLabels[Math.min(2,bodyLabels.length-1)],other=picks.find(p=>!p.body)?.label;
 const example=b?{...empty(),did:[b,...(other?[other]:[])],exercise:[{name:b,reps:10,sets:3}]}:other?{...empty(),did:[other]}:null;
 const system=`You fill in a habit tracker from one chat message. Add an item only if the message says it was already done today. Questions, plans, wishes and feelings add nothing. Never add items the message doesn't mention.`+
  (bodyLabels.length?' exercise lists reps and sets only when both are said.':'')+(amounts.length?` ${amounts.map(a=>a.key).join(', ')} stay 0 unless the message gives that number.`:'')+
  `\nItems: ${labels.join(', ')}.\nExamples:\n`+
  (example?`"${b?`did 10 ${b.toLowerCase()} x3`:'did it'}${other?` and ${other.toLowerCase()}`:''}" -> ${JSON.stringify(example)}\n`:'')+
  `"is it logged?" -> ${JSON.stringify(empty())}\n"gonna do it later" -> ${JSON.stringify(empty())}`;
 return {picks,amounts,system,schema:{type:'object',properties:props,required}};
}

const PLAN=/\b(gonna|going to|will|later|tomorrow|plan|planning|want to|wanna|need to|have to|should|about to|might)\b/i;
const PAST=/\b(did|done|had|ate|finished|completed|slept|went|called|texted|talked|met|made|cleaned|already|just|worked|ran|walked|trained|logged)\b/i;
const NUMBER:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,once:1,twice:2};
const saysNumber=(msg:string,n:number)=>{const text=msg.toLowerCase();if(new RegExp(`(^|[^0-9.])${String(n).replace('.','\\.')}([^0-9]|$)`).test(text))return true;return Object.entries(NUMBER).some(([w,v])=>v===n&&new RegExp(`\\b${w}\\b`).test(text))};

// Worth asking the model? Skips questions and plans so most chat stays fast.
export function looksLoggable(message:string){const m=message.trim();if(m.length<3)return false;if(PLAN.test(m)&&!PAST.test(m))return false;if(/\?\s*$/.test(m)&&!PAST.test(m))return false;return true}

// Turns the model's JSON into actions, keeping only what the message actually mentions.
export function actionsFrom(plan:LogPlan,out:unknown,message:string):CoachAction[]{
 if(!out||typeof out!=='object'||!looksLoggable(message))return [];
 const o=out as {did?:unknown;exercise?:unknown}&Record<string,unknown>,msg=words(message),byGoal=new Map<string,CoachAction>();
 const act=(goal:string)=>{let a=byGoal.get(goal);if(!a){a={goal};byGoal.set(goal,a)}return a};
 const tick=(p:Pick_)=>{const a=act(p.goal);a.check=[...new Set([...(a.check??[]),p.index])]};
 const did=Array.isArray(o.did)?o.did.filter((x):x is string=>typeof x==='string'):[];
 for(const label of did){const p=plan.picks.find(x=>x.label===label);if(p&&mentions(msg,p.keys))tick(p)}
 for(const x of Array.isArray(o.exercise)?o.exercise:[]){
  const {name,reps,sets}=(x??{}) as {name?:unknown;reps?:unknown;sets?:unknown};const p=plan.picks.find(y=>y.body&&y.label===name);
  if(!p||!mentions(msg,p.keys))continue;tick(p);
  if(Number.isInteger(reps)&&Number.isInteger(sets)&&(reps as number)>=1&&(reps as number)<=1000&&(sets as number)>=1&&(sets as number)<=100&&saysNumber(message,reps as number)&&saysNumber(message,sets as number)){const a=act(p.goal);a.logs={...a.logs,[String(p.index)]:{reps:reps as number,sets:sets as number}}}
 }
 for(const a of plan.amounts){const v=o[a.key];if(typeof v==='number'&&v>0&&v<=a.max&&saysNumber(message,v)&&mentions(msg,a.keys))act(a.goal).value=Math.round(v*100)/100}
 return [...byGoal.values()];
}

// Applies actions to a day (in place). Returns the entries as they were, for Undo.
export function applyActions(day:Day,actions:CoachAction[]):Entry[]{
 const before:Entry[]=[];
 for(const a of actions){
  const e=day.entries.find(x=>x.goal.id===a.goal);if(!e||e.rest)continue;before.push(structuredClone(e));const n=e.goal.kind==='checkbox'?1:e.goal.items.length;
  while(e.checks.length<n)e.checks.push(false);
  for(const i of a.check??[]){if(!Number.isInteger(i)||i<0||i>=n)continue;if(e.goal.kind==='choice')e.checks=e.checks.map((_,j)=>j===i);else e.checks[i]=true}
  for(const [k,l] of Object.entries(a.logs??{})){const i=Number(k);if(!Number.isInteger(i)||i<0||i>=n)continue;e.exerciseLogs={...e.exerciseLogs,[k]:{reps:l.reps,sets:l.sets}};e.checks[i]=true}
  if(typeof a.value==='number'&&(e.goal.kind==='count'||e.goal.kind==='duration'))e.value=Math.max(0,Math.min(100000,a.value));
 }
 return before;
}

// "Body: Push-ups 15×2, Sit-ups" — private goals stay unnamed.
export function describeActions(day:Day,actions:CoachAction[]){
 return actions.flatMap(a=>{const e=day.entries.find(x=>x.goal.id===a.goal);if(!e)return [];const g=e.goal;if(g.private)return ['A private goal'];
  if(typeof a.value==='number')return [`${g.category}: ${a.value} ${g.unit}`];
  if(g.kind==='checkbox')return [`${g.category}: done`];
  const parts=(a.check??[]).map(i=>{const l=a.logs?.[String(i)];return itemName(g.items[i]??'')+(l?` ${l.reps}×${l.sets}`:'')}).filter(Boolean);
  return parts.length?[`${g.category}: ${parts.join(', ')}`]:[];
 });
}
