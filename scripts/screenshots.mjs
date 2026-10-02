// README screenshots: start `npm run demo`, then `npm run screenshots`. Drives headless Chrome (or Edge) over the
// DevTools protocol, logs in as the demo's Alex and saves JPEGs to docs/screenshots/. CHROME=path picks the browser.
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const [,,outDir='docs/screenshots',origin=`http://localhost:${process.env.DEMO_PORT||4340}`]=process.argv;
const CHROME=process.env.CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(outDir,{recursive:true});
const profile=mkdtempSync(join(tmpdir(),'mo-shots-'));
const chrome=spawn(CHROME,['--headless=new','--remote-debugging-port=9333',`--user-data-dir=${profile}`,'--no-first-run','--hide-scrollbars','--force-dark-mode','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let target;for(let i=0;i<50&&!target;i++){try{target=await (await fetch('http://127.0.0.1:9333/json/new?about:blank',{method:'PUT'})).json()}catch{await sleep(200)}}
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let id=0;const waiting=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&waiting.has(m.id)){const {ok,fail}=waiting.get(m.id);waiting.delete(m.id);if(m.error)fail(Error(m.error.message));else ok(m.result)}});
const send=(method,params={})=>new Promise((ok,fail)=>{const n=++id;waiting.set(n,{ok,fail});ws.send(JSON.stringify({id:n,method,params}))});
const evaluate=async expr=>(await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true})).result.value;

await send('Page.enable');await send('Runtime.enable');
await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});
async function view(width,height,mobile){await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile});await send('Emulation.setTouchEmulationEnabled',{enabled:mobile})}
async function go(path,ms=3500){await send('Page.navigate',{url:origin+path});await sleep(ms)}
async function shot(name){const {data}=await send('Page.captureScreenshot',{format:'jpeg',quality:88});writeFileSync(join(outDir,name),Buffer.from(data,'base64'));console.log('saved',name)}

await view(1280,820,false);await go('/',1500);
console.log('login',await evaluate(`fetch('./api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'alex@example.com',password:'demo-alex-1234',remember:true})}).then(r=>r.status)`));
await go('/');await shot('today.jpg');
await go('/?open=Journal');await shot('journal.jpg');
await go('/?open=Journal');{const r=await evaluate("(()=>{const b=[...document.querySelectorAll('button,[role=tab]')].find(b=>b.textContent.trim()==='Map');const x=b.getBoundingClientRect();return [x.x+x.width/2,x.y+x.height/2]})()");for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:r[0],y:r[1],button:'left',clickCount:1});}await sleep(5000);await shot('journal-map.jpg');
await go('/?open=Progress');await shot('progress.jpg');
await go('/?open=Settings');await shot('profile.jpg');
await view(390,844,true);
await go('/');await shot('mobile-today.jpg');
await go('/?open=Journal');await shot('mobile-journal.jpg');
ws.close();chrome.kill();await sleep(500);try{rmSync(profile,{recursive:true,force:true})}catch{}
