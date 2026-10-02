// M.A.X. coach: a mentor inside MAX that checks in on your day and keeps you accountable.
// Either an OpenAI-compatible endpoint (MAX_COACH_URL), or a local llama.cpp server started here as its own
// resident process. Two slots keep two prompts cached: slot 0 for the conversation, slot 1 for reading what to
// log, so switching between them doesn't re-read either prompt. The model preloads at server startup and stays
// resident by default. Set MAX_COACH_IDLE_SECONDS above zero to opt into unloading.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

const HOME=homedir();
// Any OpenAI-compatible /v1 endpoint: Ollama, LM Studio, a llama.cpp server elsewhere, Groq, OpenRouter, OpenAI, Gemini's
// OpenAI-compatible endpoint... When set, nothing is started here. MAX_COACH_API_KEY is sent as a Bearer token and
// MAX_COACH_MODEL_NAME picks the model. MAX_COACH_LLAMACPP=1 says the endpoint is llama.cpp (prompt caching per slot).
const EXTERNAL=(process.env.MAX_COACH_URL||'').replace(/\/$/,'');
const API_KEY=process.env.MAX_COACH_API_KEY||'',MODEL_NAME=process.env.MAX_COACH_MODEL_NAME||'coach';
const LLAMACPP=!EXTERNAL||process.env.MAX_COACH_LLAMACPP==='1';
const headers=()=>({'Content-Type':'application/json',...(API_KEY?{Authorization:`Bearer ${API_KEY}`}:{})});
// llama.cpp keeps each prompt cached in its own slot; other APIs reject these extra fields.
const slot=n=>LLAMACPP?{cache_prompt:true,id_slot:n}:{};
// A local llama.cpp model started by this server: both paths must be set (~ means the home folder).
const path=v=>v?(v.startsWith('~/')?join(HOME,v.slice(2)):v):'';
const SERVER=path(process.env.MAX_COACH_LLAMA_SERVER),MODEL=path(process.env.MAX_COACH_MODEL);
const PORT=Number(process.env.MAX_COACH_PORT||8097);
const THREADS=process.env.MAX_COACH_THREADS||'3';// e.g. 3 of a 4-thread CPU
const IDLE_MS=Number(process.env.MAX_COACH_IDLE_SECONDS??0)*1000;
const baseUrl=()=>EXTERNAL||`http://127.0.0.1:${PORT}/v1`;

let proc=null,starting=null,busy=0,lastUsed=0,queue=Promise.resolve(),primed='';

export const coachAvailable=()=>!!EXTERNAL||(!!SERVER&&!!MODEL&&existsSync(SERVER)&&existsSync(MODEL));
export const coachLoaded=()=>!!EXTERNAL||(!!proc&&proc.exitCode===null);

async function healthy(){try{return (await fetch(`http://127.0.0.1:${PORT}/health`,{signal:AbortSignal.timeout(2000)})).ok}catch{return false}}

function stop(){if(proc&&proc.exitCode===null)proc.kill('SIGTERM');proc=null}

async function ensureModel(){
 if(EXTERNAL)return;
 if(coachLoaded()&&await healthy())return;
 if(starting)return starting;
 starting=(async()=>{
  stop();primed='';
  if(!coachAvailable())throw Error('The model isn’t installed on this server.');
  // Lower priority than the app itself; systemd stops it together with MAX (same service cgroup).
  proc=spawn('nice',['-n','10',SERVER,'-m',MODEL,'-t',THREADS,'--poll','0','--poll-batch','0','-c','6144','--parallel','2','--host','127.0.0.1','--port',String(PORT)],{stdio:'ignore'});
  const child=proc;child.on('exit',()=>{if(proc===child)proc=null});child.on('error',()=>{if(proc===child)proc=null});
  for(const deadline=Date.now()+120000;Date.now()<deadline;){
   if(!proc)throw Error('The model could not start.');
   if(await healthy())return;
   await new Promise(r=>setTimeout(r,500));
  }
  stop();throw Error('The model took too long to wake up.');
 })().finally(()=>{starting=null});
 return starting;
}

setInterval(()=>{if(IDLE_MS>0&&proc&&!busy&&!starting&&Date.now()-lastUsed>IDLE_MS)stop()},30000).unref();

export function warmCoach(){
 if(EXTERNAL||IDLE_MS>0||!coachAvailable())return;
 void ensureModel().catch(e=>console.error('Coach preload:',e.message));
 // Recover after a model-process exit without sending synthetic chat requests.
 setInterval(()=>{if(!proc&&!starting&&!busy)void ensureModel().catch(e=>console.error('Coach preload:',e.message))},30000).unref();
}

// One request at a time on this CPU: later ones wait their turn (up to a few) instead of failing.
// A remote API handles its own load, so requests go straight through.
function exclusive(fn){
 if(EXTERNAL)return fn();
 if(busy>=3)return Promise.reject(Object.assign(Error('M.A.X. is still answering. One moment.'),{status:429}));
 busy++;const run=queue.then(async()=>{await ensureModel();lastUsed=Date.now();return fn()}).finally(()=>{busy--;lastUsed=Date.now()});
 queue=run.catch(()=>{});return run;
}

// Streams one reply. `messages` already includes the system prompt. Calls onToken per piece; returns the text.
export function coachReply(messages,onToken,signal){
 return exclusive(async()=>{
  if(signal?.aborted)throw Error('Cancelled.');
  const r=await fetch(`${baseUrl()}/chat/completions`,{method:'POST',headers:headers(),signal,
   body:JSON.stringify({model:MODEL_NAME,messages,stream:true,max_tokens:170,temperature:0.7,...slot(0)})});
  if(!r.ok||!r.body)throw Error('The model didn’t answer.');
  let text='',buffer='';const decoder=new TextDecoder();
  for await(const chunk of r.body){
   buffer+=decoder.decode(chunk,{stream:true});const lines=buffer.split('\n');buffer=lines.pop()??'';
   for(const line of lines){
    if(!line.startsWith('data:'))continue;const data=line.slice(5).trim();if(!data||data==='[DONE]')continue;
    try{const piece=JSON.parse(data).choices?.[0]?.delta?.content;if(piece){text+=piece;onToken(piece)}}catch{}
   }
  }
  return text.trim();
 });
}

// Reads what to log from one message: the output is held to `schema` (llama.cpp grammar). Returns the parsed
// JSON, or null if the model couldn't. Uses its own slot so its long instructions stay cached.
export function coachExtract(system,schema,text,signal){
 return exclusive(async()=>{
  if(signal?.aborted)return null;
  const r=await fetch(`${baseUrl()}/chat/completions`,{method:'POST',headers:headers(),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000),
   body:JSON.stringify({model:MODEL_NAME,messages:[{role:'system',content:system},{role:'user',content:text}],max_tokens:160,temperature:0,...slot(1),response_format:{type:'json_schema',json_schema:{name:'log',schema}}})});
  if(!r.ok)return null;primed=system;
  try{return JSON.parse((await r.json()).choices?.[0]?.message?.content??'null')}catch{return null}
 });
}

// Reads the logging instructions ahead of time (when the coach opens), so the first real message is quick.
export function primeExtract(system,schema){
 if(!LLAMACPP||primed===system||busy)return;primed=system;
 void coachExtract(system,schema,'hi').catch(()=>{primed=''});
}
