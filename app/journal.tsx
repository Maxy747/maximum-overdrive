'use client';
import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {Plus,ChevronLeft,ChevronRight,Trash2,Hourglass,Repeat,ImagePlus,CalendarDays,Clock,MapPin,Images,X,PenLine,Milestone,Lock,EyeOff,Eye,Pencil,MoreHorizontal,ArrowUp,NotebookPen} from 'lucide-react';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from '@/components/ui/dropdown-menu';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {toast} from 'sonner';
import {dateKey,daysSince,shiftDay,nextOccurrence,upcoming,isBirthday,BIRTHDAY_LEAD_DAYS,momentColors,type SharedState,type JournalEntry,type JournalComment,type Moment,type User,type DumpPhoto,withBirthdays,type StatTone} from '@/lib/tracker';
import {photoSrc,uploadPhotos,sharedUploadUrl} from './photos';
import {Avatar} from './avatar';
import {DatePicker} from './date-picker';
import {CoverPicker} from './cover-picker';
import {PhotoDump,Lightbox,type TrashActions} from './photo-dump';

import {Diary} from './diary';
import {JournalBin,deleteToBin} from './journal-trash';
import {CoupleStats,type StatTarget} from './couple-stats';
import {useHoldReveal} from './privacy';
import {placeName} from './geo';
import {LiveCountdown} from './live-countdown';
// The map and picker load Leaflet only when opened.
const MemoryMap=lazy(()=>import('./memory-map'));
const LocationPicker=lazy(()=>import('./location-picker'));
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {Switch} from '@/components/ui/switch';
import type {MutateShared} from './shared';

const MAX_PHOTOS=30;
const emojis=['❤️','💍','💋','🌹','🎂','🎉','✈️','🏠','🎓','⭐','🌙','📸'];
const nowTime=()=>new Date().toTimeString().slice(0,5);
const newEntry=(author:string):JournalEntry=>({id:crypto.randomUUID(),title:'',body:'',date:dateKey(),time:nowTime(),location:'',photos:[],author,created:new Date().toISOString(),sensitive:false});
const newMoment=():Moment=>({id:crypto.randomUUID(),title:'',icon:'❤️',date:dateKey(),time:'',color:'pink'});
// A countdown is a milestone dated ahead (birthdays and anniversaries repeat every year).
const newCountdown=():Moment=>({id:crypto.randomUUID(),title:'',icon:'🎉',date:shiftDay(dateKey(),7),time:'',color:'purple'});
const ordinal=(n:number)=>`${n}${n%100>=11&&n%100<=13?'th':['th','st','nd','rd'][n%10]??'th'}`;
const longDate=(key:string)=>new Date(key+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
const clock12=(t:string)=>{const [h,m]=t.split(':').map(Number);return `${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}`};
function openPicker(input:HTMLInputElement|null){if(!input)return;try{input.showPicker()}catch{input.focus()}}
function timeAgo(iso:string){const s=(Date.now()-new Date(iso).getTime())/1000;if(s<60)return 'just now';if(s<3600)return `${Math.floor(s/60)}m`;if(s<86400)return `${Math.floor(s/3600)}h`;if(s<604800)return `${Math.floor(s/86400)}d`;return new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric'})}

function MomentCount({moment:m}:{moment:Moment}){
 const next=nextOccurrence(m),d=daysSince(next),years=Number(next.slice(0,4))-Number(m.date.slice(0,4));
 if(m.repeat==='yearly')return <span className="moment-count">{d===0?<strong>Today</strong>:<><strong>{-d}</strong>{d===-1?'day to go':'days to go'}</>}{years>0&&<span className="moment-nth"> · {ordinal(years)}</span>}</span>;
 return <span className="moment-count">{d===0?<strong>Today</strong>:<><strong>{Math.abs(d)}</strong>{d>0?(d===1?'day ago':'days ago'):(d===-1?'day to go':'days to go')}</>}</span>;
}

// Every photo added to a memory also lands in the Photo Dump. Photos of sensitive memories are marked sensitive there too.
function syncMemoryPhotos(s:SharedState){const dump=s.photoDump??(s.photoDump=[]),have=new Map(dump.map(p=>[p.id,p])),added:DumpPhoto[]=[];for(const e of [...s.journal].sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time)))for(const p of e.photos){const known=have.get(p.id);if(known){if(e.sensitive&&!known.sensitive)known.sensitive=true;continue}const item:DumpPhoto={id:p.id,name:p.name,size:p.size,...(e.sensitive?{sensitive:true}:{})};have.set(p.id,item);added.push(item)}if(added.length)s.photoDump=[...added,...dump]}
const memoryPhotosSynced=(s:SharedState)=>{const dump=new Map((s.photoDump??[]).map(p=>[p.id,p]));return s.journal.every(e=>e.photos.every(p=>{const d=dump.get(p.id);return d&&(!e.sensitive||d.sensitive)}))};
export function Journal({statColors,setStatColor,canVault=false,solo=false,shared,mutate,me,users,privacy,onPrivacy,onOpenView,together,compose,composeDiary,onComposed}:{statColors?:Partial<Record<string,StatTone>>;setStatColor?:(key:string,tone:StatTone)=>void;canVault?:boolean;solo?:boolean;shared:SharedState;mutate:MutateShared;me:User;users:User[];privacy:boolean;onPrivacy:(value:boolean)=>void;onOpenView:(view:string)=>void;together:string;compose:number;composeDiary:number;onComposed:()=>void}){
 const [open,setOpen]=useState<{mode:'view'|'edit';id:string;draft?:JournalEntry}|null>(null),[moment,setMoment]=useState<Moment|null>(null);
 const {revealed,props:hold}=useHoldReveal();
 const compose_=()=>{const n=newEntry(me.username);setOpen({mode:'edit',id:n.id,draft:n})};
 const [tab,setTab]=useState('memories'),[diaryCompose,setDiaryCompose]=useState(0);
 useEffect(()=>{if(compose){const n=newEntry(me.username);setTab('memories');setOpen({mode:'edit',id:n.id,draft:n});onComposed()}},[compose,onComposed,me.username]);
 const writeDiary=()=>{setTab('diary');setDiaryCompose(c=>c+1)};
 useEffect(()=>{if(composeDiary){setTab('diary');setDiaryCompose(c=>c+1);onComposed()}},[composeDiary,onComposed]);
 // Memories saved before this existed (or on the other phone) are added to the Photo Dump once.
 useEffect(()=>{if(!memoryPhotosSynced(shared))mutate(syncMemoryPhotos)},[shared,mutate]);
 const author=(name:string)=>users.find(u=>u.username===name)??(name===me.username?me:undefined);
 const entries=[...shared.journal].sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time)||b.created.localeCompare(a.created));
 type TimelineItem={kind:'memory';e:JournalEntry;at:string}|{kind:'milestone';m:Moment;at:string};
 const timeline:TimelineItem[]=[...entries.map(e=>({kind:'memory' as const,e,at:e.date+(e.time||'00:00')})),...shared.moments.filter(m=>!isBirthday(m)).map(m=>({kind:'milestone' as const,m,at:m.date+(m.time||'00:00')}))].sort((a,b)=>b.at.localeCompare(a.at));
 const saveEntry=(e:JournalEntry)=>mutate(s=>{const i=s.journal.findIndex(x=>x.id===e.id);if(i>=0)s.journal[i]={...e,comments:s.journal[i].comments};else s.journal.push(e);syncMemoryPhotos(s)});
 const updateEntry=(id:string,fn:(e:JournalEntry)=>void)=>mutate(s=>{const e=s.journal.find(x=>x.id===id);if(e)fn(e);syncMemoryPhotos(s)});
 const current=open?shared.journal.find(x=>x.id===open.id):undefined;
 const [binOpen,setBinOpen]=useState(false),bin=shared.journalTrash??[];
 // Deleting asks first, then moves the item to Recently deleted with an Undo.
 const deleteMemory=async(id:string)=>{if(await deleteToBin(mutate,'memory',id,me.username,{title:'Delete this memory?',body:'It moves to Recently deleted for 30 days. Its photos stay in the Photo Dump.'}))setOpen(null)};
 const deleteMoment=async(id:string)=>{if(await deleteToBin(mutate,'milestone',id,me.username,{title:'Delete this milestone?'}))setMoment(null)};
 const [dumpOpen,setDumpOpen]=useState(false),dump=shared.photoDump??[],dumpPreview=dump.filter(p=>!p.sensitive).slice(0,10);
 // Server moves the file into Max's hidden photos first; then it leaves the shared dump and every memory.
 const hideToVault=async(p:DumpPhoto)=>{try{const r=await fetch('./api/vault/move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:p.id})});const data=await r.json().catch(()=>({})) as {error?:string};if(!r.ok)throw Error(data.error??'Could not move the photo.');
  mutate(s=>{s.photoDump=(s.photoDump??[]).filter(x=>x.id!==p.id);for(const e of [...s.journal,...(s.journalTrash??[]).flatMap(t=>t.memory?[t.memory]:[])])if(e.photos.some(x=>x.id===p.id))e.photos=e.photos.filter(x=>x.id!==p.id)});
  void caches?.open('max-photos').then(c=>c.delete(new URL(photoSrc(p),document.baseURI).href)).catch(()=>{});
  toast.success('Moved to Hidden photos');return true}catch(e){toast.error(e instanceof Error?e.message:'Could not move the photo.');return false}};
 // Delete → Recently deleted (remembers which memories had it, so Restore puts it back there too).
 const trashActions:TrashActions={items:shared.photoTrash??[],
  remove:p=>mutate(s=>{const memoryIds=s.journal.filter(e=>e.photos.some(x=>x.id===p.id)).map(e=>e.id);for(const e of s.journal)if(memoryIds.includes(e.id))e.photos=e.photos.filter(x=>x.id!==p.id);s.photoDump=(s.photoDump??[]).filter(x=>x.id!==p.id);s.photoTrash=[{id:p.id,name:p.name,size:p.size,...(p.sensitive?{sensitive:true}:{}),deletedAt:new Date().toISOString(),deletedBy:me.username,...(memoryIds.length?{memoryIds}:{})},...(s.photoTrash??[]).filter(x=>x.id!==p.id)]}),
  restore:ids=>mutate(s=>{const back=(s.photoTrash??[]).filter(x=>ids.includes(x.id));s.photoTrash=(s.photoTrash??[]).filter(x=>!ids.includes(x.id));
   for(const t of back){const photo={id:t.id,name:t.name,size:t.size,...(t.sensitive?{sensitive:true}:{})};if(!(s.photoDump??[]).some(x=>x.id===t.id))s.photoDump=[photo,...(s.photoDump??[])];for(const e of s.journal)if(t.memoryIds?.includes(e.id)&&!e.photos.some(x=>x.id===t.id)&&e.photos.length<30)e.photos.push({id:t.id,name:t.name,size:t.size})}}),
  purge:async ids=>{try{const r=await fetch('./api/files/purge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})});const data=await r.json().catch(()=>({})) as {error?:string};if(!r.ok)throw Error(data.error??'Could not delete.');mutate(s=>{s.photoTrash=(s.photoTrash??[]).filter(x=>!ids.includes(x.id))});return true}catch(e){toast.error(e instanceof Error?e.message:'Could not delete.');return false}}};
 // Birthdays show up during the 30 days before; the title follows the person's current nickname.
 // Couple Stats cards open their part of the app.
 const openStat=(to:StatTarget)=>{const top=()=>requestAnimationFrame(()=>document.querySelector('.journal')?.scrollIntoView({behavior:'smooth',block:'start'}));
  if(to==='profile')return onOpenView('Settings');
  if(to==='daily')return void window.dispatchEvent(new Event('max:open-daily'));
  if(to==='photos')return setDumpOpen(true);
  if(to==='map'||to==='diary'){setTab(to);return top()}
  setTab('memories');requestAnimationFrame(()=>{const el=to==='milestones'?document.querySelector('.countdowns,.milestone-row'):document.querySelector('.timeline');(el??document.querySelector('.journal'))?.scrollIntoView({behavior:'smooth',block:'start'})})};
 const soon=upcoming(withBirthdays(shared.moments,users.length?users:[me])).filter(x=>!isBirthday(x.m)||-daysSince(x.next)<=BIRTHDAY_LEAD_DAYS).slice(0,10).map(x=>{const u=isBirthday(x.m)?users.find(v=>`birthday-${v.username}`===x.m.id):undefined;return u?{...x,m:{...x.m,title:`${u.displayName}’s ${ordinal(Number(x.next.slice(0,4))-Number(x.m.date.slice(0,4)))} birthday`}}:x});
 const saveMoment=(m:Moment)=>mutate(s=>{const i=s.moments.findIndex(x=>x.id===m.id);if(i>=0)s.moments[i]=m;else s.moments.push(m)});
 return <div className="journal">
  <div className="journal-top"><h1>{solo?'My Journal':'Our Journal'}</h1><div className="journal-top-actions"><button type="button" className={`round-btn ${privacy?'eye-hidden':''}`} aria-pressed={privacy} aria-label={privacy?'Show sensitive memories':'Hide sensitive memories'} title={privacy?'Sensitive memories hidden':'Hide sensitive memories'} onClick={()=>{onPrivacy(!privacy);toast(privacy?'Sensitive memories shown':'Sensitive memories hidden')}}>{privacy?<EyeOff size={20}/>:<Eye size={20}/>}</button><DropdownMenu><DropdownMenuTrigger asChild><button className="round-btn" aria-label="Add to the journal"><Plus size={22}/></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="journal-add-menu"><DropdownMenuItem onSelect={compose_}><PenLine size={18}/>Add a memory</DropdownMenuItem><DropdownMenuItem onSelect={()=>setMoment(newMoment())}><Milestone size={18}/>Add a milestone</DropdownMenuItem><DropdownMenuItem onSelect={()=>setMoment(newCountdown())}><Hourglass size={18}/>Add a countdown</DropdownMenuItem><DropdownMenuItem onSelect={writeDiary}><NotebookPen size={18}/>Add a diary entry</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></div>
  <Tabs value={tab} onValueChange={setTab} className="journal-tabs"><TabsList aria-label="Journal sections"><TabsTrigger value="memories">Timeline</TabsTrigger><TabsTrigger value="map">Map</TabsTrigger><TabsTrigger value="diary">Diary</TabsTrigger></TabsList><TabsContent value="memories">
  {soon.length>0&&<section className="countdowns" aria-label="Coming up"><h2>Coming up</h2><div className="countdown-row">{soon.map(({m,next})=>{const d=-daysSince(next);return <button key={m.id} className="countdown-card" data-color={m.color} onClick={()=>isBirthday(m)?onOpenView('Settings'):setMoment(m)} aria-label={`${m.title}: ${d===0?'today':d===1?'tomorrow':`in ${d} days`}. Tap to edit.`}><span className="countdown-icon" aria-hidden>{m.icon}</span><span className="countdown-num">{d===0?'Today':d===1?'1':d}</span><span className="countdown-unit">{d===0?'🎉':d===1?'day to go':'days to go'}</span>{isBirthday(m)&&d>0&&<LiveCountdown date={next} time={m.time}/>}<span className="countdown-title">{m.title}</span><span className="countdown-date">{new Date(next+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}{m.repeat==='yearly'&&<Repeat size={11} aria-label="Every year"/>}</span></button>})}</div></section>}
  {timeline.length?<ol className="timeline">{timeline.map(item=>{if(item.kind==='milestone'){const m=item.m,md=new Date(m.date+'T12:00:00');return <li className="journal-row milestone-row" key={'m-'+m.id}><div className="date-chip" aria-hidden><span>{md.toLocaleDateString('en-US',{month:'short'})}</span><strong>{String(md.getDate()).padStart(2,'0')}</strong><span>{md.getFullYear()}</span></div><button className="moment-card" data-color={m.color} onClick={()=>setMoment(m)} aria-label={`Milestone: ${m.title}, ${longDate(m.date)}. Tap to edit.`}><span className="moment-icon" aria-hidden>{m.icon}</span><span className="moment-title">{m.title}</span><MomentCount moment={m}/></button></li>}const e=item.e,d=new Date(e.date+'T12:00:00');return <li className="journal-row" key={e.id}>
   <div className="date-chip" aria-hidden><span>{d.toLocaleDateString('en-US',{month:'short'})}</span><strong>{String(d.getDate()).padStart(2,'0')}</strong><span>{d.getFullYear()}</span></div>
   {privacy&&e.sensitive&&!revealed.has(e.id)?<button className="journal-card journal-hidden" {...hold(e.id,true)} onClick={()=>toast('Press and hold to show this memory')} aria-label={`Sensitive memory from ${longDate(e.date)}. Press and hold to show.`}>
    <span className="journal-sensitive"><Lock size={22} aria-hidden/><strong>Sensitive memory</strong><span>Hold to show</span></span>
   </button>:<button className="journal-card" {...hold(e.id,false)} onClick={()=>setOpen({mode:'view',id:e.id})} aria-label={`Open ${e.title||'untitled memory'}, ${longDate(e.date)}`}>
    {e.photos[0]&&<span className="journal-cover"><img src={photoSrc(e.photos[0])} alt="" loading="lazy" {...(e.coverPos?.id===e.photos[0].id?{className:'framed',style:{objectPosition:`${e.coverPos.x}% ${e.coverPos.y}%`}}:{})}/>{e.photos.length>1&&<span className="photo-count"><Images size={14} aria-hidden/>{e.photos.length}</span>}{e.sensitive&&<span className="sensitive-tag"><EyeOff size={13} aria-hidden/>Sensitive</span>}</span>}
    <span className="journal-text"><span className="journal-title-row"><strong>{e.title||'Untitled'}</strong>{author(e.author)&&<Avatar user={author(e.author)} size={22} className="journal-author"/>}</span>{e.body&&<span className="journal-excerpt">{e.body}</span>}</span>
   </button>}
  </li>})}</ol>:<div className="journal-empty"><p>Your story starts here.</p><button className="primary" onClick={compose_}><Plus size={16}/>Add your first memory</button></div>}
  <button className="dump-entry" onClick={()=>setDumpOpen(true)}>
   <span className={`dump-train ${dumpPreview.length>3?'moving':''}`} aria-hidden><span className="train-track">{(dumpPreview.length>3?[...dumpPreview,...dumpPreview]:dumpPreview).map((p,i)=><img key={p.id+'-'+i} src={photoSrc(p)} alt="" loading="lazy"/>)}</span></span>
   <span className="dump-entry-text"><strong>Photo Dump</strong><span>{dump.length} photo{dump.length===1?'':'s'}</span></span>
   <ChevronRight size={20} aria-hidden/>
  </button>
  <CoupleStats colors={statColors} setColor={setStatColor} solo={solo} shared={shared} together={together} onOpen={openStat}/>
  </TabsContent><TabsContent value="map">{tab==='map'&&<Suspense fallback={<p className="muted journal-loading">Opening the map…</p>}><MemoryMap shared={shared} mutate={mutate} privacy={privacy} users={users} onOpenMemory={id=>setOpen({mode:'view',id})}/></Suspense>}</TabsContent><TabsContent value="diary"><Diary entries={shared.diary??[]} mutate={mutate} me={me} users={users} compose={diaryCompose} onDelete={id=>deleteToBin(mutate,'diary',id,me.username,{title:'Delete this diary entry?'})}/></TabsContent></Tabs>
  {bin.length>0&&tab!=='map'&&<button className="dump-entry vault-entry trash-entry journal-bin-entry" onClick={()=>setBinOpen(true)}><span className="vault-icon" aria-hidden><Trash2 size={21}/></span><span className="dump-entry-text"><strong>Recently deleted</strong><span>{bin.length} item{bin.length===1?'':'s'} · kept 30 days</span></span><ChevronRight size={20} aria-hidden/></button>}
  {binOpen&&<JournalBin items={bin} mutate={mutate} users={users} privacy={privacy} onClose={()=>setBinOpen(false)}/>}
  {dumpOpen&&<PhotoDump canVault={canVault} onHide={hideToVault} trash={trashActions} photos={dump} privacy={privacy} onClose={()=>setDumpOpen(false)} onSetSensitive={(id,value)=>mutate(s=>{const p=(s.photoDump??[]).find(x=>x.id===id);if(p)p.sensitive=value})} onAdd={p=>mutate(s=>{if(!(s.photoDump??[]).some(x=>x.id===p.id))s.photoDump=[{id:p.id,name:p.name,size:p.size},...(s.photoDump??[])]})}/>}
  {open?.mode==='view'&&current&&<MemoryPreview key={'view-'+current.id} entry={current} me={me} author={author} onBack={()=>setOpen(null)} onEdit={()=>setOpen({mode:'edit',id:current.id})}
   onToggleSensitive={()=>updateEntry(current.id,e=>{e.sensitive=!e.sensitive})}
   onDelete={()=>void deleteMemory(current.id)}
   onComment={text=>{const c:JournalComment={id:crypto.randomUUID(),author:me.username,text,created:new Date().toISOString()};updateEntry(current.id,e=>{if(!(e.comments??[]).some(x=>x.id===c.id))e.comments=[...(e.comments??[]),c]})}}
   onDeleteComment={id=>{if(current.comments?.some(x=>x.id===id&&x.author===me.username))void deleteToBin(mutate,'comment',id,me.username,{title:'Delete your comment?',memoryId:current.id})}}/>}
  {open?.mode==='edit'&&(open.draft??current)&&<EntryEditor key={'edit-'+open.id} entry={open.draft??current!} isNew={!current} onClose={()=>setOpen(current?{mode:'view',id:current.id}:null)} onSave={e=>{saveEntry(e);setOpen({mode:'view',id:e.id});toast.success('Memory saved')}} onDelete={()=>void deleteMemory(open.id)}/>}
  {moment&&<MomentEditor key={moment.id} moment={moment} isNew={!shared.moments.some(x=>x.id===moment.id)} onClose={()=>setMoment(null)} onSave={m=>{saveMoment(m);setMoment(null)}} onDelete={()=>void deleteMoment(moment.id)}/>}
 </div>;
}

function MemoryPreview({entry:e,me,author,onBack,onEdit,onDelete,onToggleSensitive,onComment,onDeleteComment}:{entry:JournalEntry;me:User;author:(name:string)=>User|undefined;onBack:()=>void;onEdit:()=>void;onDelete:()=>void;onToggleSensitive:()=>void;onComment:(text:string)=>void;onDeleteComment:(id:string)=>void}){
 // The cover is a still picture (framed as chosen in the editor); the cards below open each photo large, with Save.
 const [text,setText]=useState(''),[zoomAt,setZoomAt]=useState<number|null>(null),scrollRef=useRef<HTMLDivElement>(null);
 const cover=e.photos[0],framed=!!cover&&e.coverPos?.id===cover.id,coverImg=useRef<HTMLImageElement>(null),[scrollEl,setScrollEl]=useState<HTMLDivElement|null>(null);
 // Pull the text down at the top to peek at more of the cover: the photo stays anchored and grows taller (up to its
 // full height), pushing the text down; letting go springs it back. The page itself never bounces.
 useEffect(()=>{const el=scrollEl,img=coverImg.current;if(!el||!img)return;let startY:number|null=null,pull=0,frame=0,base=0;
  const full=()=>img.naturalWidth?Math.max(0,img.clientWidth*img.naturalHeight/img.naturalWidth-base):0;
  const apply=(px:number,animate:boolean)=>{pull=px;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{img.style.transition=animate?'height .45s cubic-bezier(.22,1,.36,1)':'none';img.style.height=px>0?`${base+px}px`:''})};
  const down=(ev:TouchEvent)=>{if(el.scrollTop>0){startY=null;return}startY=ev.touches[0].clientY;if(!pull)base=img.clientHeight};
  const move=(ev:TouchEvent)=>{if(startY===null)return;const dy=ev.touches[0].clientY-startY;if(dy<=0||el.scrollTop>0){if(pull)apply(0,false);return}
   ev.preventDefault();const room=full()+40,eased=room*(1-Math.exp(-dy*.9/room));apply(eased,false)};
  const up=()=>{startY=null;if(pull)apply(0,true)};
  el.addEventListener('touchstart',down,{passive:true});el.addEventListener('touchmove',move,{passive:false});el.addEventListener('touchend',up);el.addEventListener('touchcancel',up);
  return()=>{cancelAnimationFrame(frame);el.removeEventListener('touchstart',down);el.removeEventListener('touchmove',move);el.removeEventListener('touchend',up);el.removeEventListener('touchcancel',up)}},[scrollEl,cover?.id]);
 const who=author(e.author),comments=e.comments??[];
 const send=()=>{const t=text.trim();if(!t)return;onComment(t);setText('');requestAnimationFrame(()=>{const el=scrollRef.current;if(el)el.scrollTop=el.scrollHeight})};
 return <Dialog open onOpenChange={v=>!v&&onBack()}><DialogContent className="journal-editor memory-view" showCloseButton={false} onEscapeKeyDown={ev=>{if(zoomAt!==null){ev.preventDefault();setZoomAt(null)}}}>
  <DialogTitle className="sr-only">{e.title||'Memory'}</DialogTitle>
  <DialogDescription className="sr-only">{longDate(e.date)}{e.location?`, ${e.location}`:''}</DialogDescription>
  <div className="memory-hero-bar">
     <button className="round-btn glass" aria-label="Back" onClick={onBack}><ChevronLeft size={24}/></button>
     <DropdownMenu><DropdownMenuTrigger asChild><button className="round-btn glass" aria-label="More options"><MoreHorizontal size={22}/></button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="journal-add-menu">
       <DropdownMenuItem onSelect={onEdit}><Pencil size={17}/>Edit memory</DropdownMenuItem>
       <DropdownMenuItem onSelect={onToggleSensitive}>{e.sensitive?<><Eye size={17}/>Unmark sensitive</>:<><EyeOff size={17}/>Mark as sensitive</>}</DropdownMenuItem>
       <DropdownMenuItem className="menu-danger" onSelect={onDelete}><Trash2 size={17}/>Delete memory</DropdownMenuItem>
      </DropdownMenuContent>
     </DropdownMenu>
    </div>
  <div className="memory-scroll" ref={node=>{scrollRef.current=node;setScrollEl(node)}}>
   <div className={`memory-hero ${e.photos.length?'':'no-photo'}`}>
    {cover&&<div className="memory-gallery memory-cover"><img ref={coverImg} src={photoSrc(cover)} alt="" draggable={false} {...(framed?{className:'framed',style:{objectPosition:`${e.coverPos!.x}% ${e.coverPos!.y}%`}}:{})}/></div>}
   </div>
   <div className="memory-body">
    <h2>{e.title||'Untitled'}</h2>
    <p className="memory-meta">{longDate(e.date)}{e.location&&<><span aria-hidden> • </span>{e.location}</>}{e.sensitive&&<span className="memory-sensitive"><Lock size={12} aria-hidden/> Sensitive</span>}</p>
    {e.body&&<p className="memory-text">{e.body}</p>}
    {who&&<p className="memory-by"><span aria-hidden>❤️</span> Added by <Avatar user={who} size={30}/><span>{who.displayName}</span></p>}
    {e.photos.length>0&&<div className="memory-stack" aria-label="Photos">
     {e.photos.map((p,i)=><button key={p.id} className="stack-card" style={{zIndex:i+1}} aria-label={`Open photo ${i+1} of ${e.photos.length}`} onClick={()=>setZoomAt(i)}><img src={photoSrc(p)} alt="" loading="lazy" draggable={false}/></button>)}
    </div>}
    {comments.length>0&&<section className="memory-comments" aria-label="Comments">
     {comments.map(c=>{const u=author(c.author);return <div className="memory-comment" key={c.id}>
      <Avatar user={u??{displayName:c.author,avatar:null}} size={32}/>
      <div className="grow"><p className="memory-comment-head"><strong>{u?.displayName??c.author}</strong><span> · {timeAgo(c.created)}</span></p><p className="memory-comment-text">{c.text}</p></div>
      {c.author===me.username&&<button className="comment-delete" aria-label="Delete your comment" onClick={()=>onDeleteComment(c.id)}><X size={15}/></button>}
     </div>})}
    </section>}
   </div>
  </div>
  <form className="comment-bar" onSubmit={ev=>{ev.preventDefault();send()}}>
   <input aria-label="Write a comment" placeholder="Write a comment" maxLength={2000} value={text} onChange={ev=>setText(ev.target.value)}/>
   <button className="comment-send" aria-label="Send comment" disabled={!text.trim()}><ArrowUp size={24} strokeWidth={2.6}/></button>
  </form>
  {zoomAt!==null&&e.photos[zoomAt]&&<Lightbox photos={e.photos} index={zoomAt} hidden={()=>false} onReveal={()=>{}} onIndex={setZoomAt} onClose={()=>setZoomAt(null)}/>}
 </DialogContent></Dialog>;
}

function EntryEditor({entry,isNew,onClose,onSave,onDelete}:{entry:JournalEntry;isNew:boolean;onClose:()=>void;onSave:(e:JournalEntry)=>void;onDelete:()=>void}){
 const [draft,setDraft]=useState(entry),[uploading,setUploading]=useState(false),[pickPlace,setPickPlace]=useState(false),[coverPick,setCoverPick]=useState<string|null>(null);
 const timeRef=useRef<HTMLInputElement>(null);
 const set=<K extends keyof JournalEntry>(k:K,v:JournalEntry[K])=>setDraft(d=>({...d,[k]:v}));
 const dirty=JSON.stringify(draft)!==JSON.stringify(entry);
 const close=()=>{if(uploading)return;if(!dirty||window.confirm('Discard your changes to this memory?'))onClose()};
 const save=()=>{const e={...draft,title:draft.title.trim(),location:draft.location.trim()};if(!e.title&&!e.body.trim()&&!e.photos.length)return void toast.error('Add a title, a few words, or a photo.');onSave(e)};
 // A photo taken with location on places the memory on the map, unless you already picked a place.
 const fromPhoto=useRef(false),fromPhotoDate=useRef(false);
 const add=async(files:FileList|null)=>{setUploading(true);await uploadPhotos(files,MAX_PHOTOS-draft.photos.length,(p,geo,taken)=>{setDraft(d=>{const next={...d,photos:[...d.photos,p]};
  // A new memory whose date you haven't changed takes the date and time the first photo was taken.
  if(taken&&isNew&&!fromPhotoDate.current&&d.date===entry.date&&d.time===entry.time&&taken.date<=dateKey()){fromPhotoDate.current=true;next.date=taken.date;next.time=taken.time;toast('📅 Date set from the photo')}if(geo&&d.lat===undefined&&!fromPhoto.current){fromPhoto.current=true;next.lat=geo.lat;next.lng=geo.lng;if(!d.location.trim())void placeName(geo.lat,geo.lng).then(name=>setDraft(x=>x.lat===geo.lat&&!x.location.trim()?{...x,location:name}:x)).catch(()=>{});toast('📍 Location added from the photo')}return next})},sharedUploadUrl());setUploading(false)};
 return <Dialog open onOpenChange={v=>!v&&close()}><DialogContent className="journal-editor" showCloseButton={false}>
  <div className="editor-top"><button className="round-btn" aria-label="Back" onClick={close}><ChevronLeft size={22}/></button>{!isNew&&<button className="round-btn" aria-label="Delete memory" onClick={onDelete}><Trash2 size={19}/></button>}</div>
  <DialogTitle className="sr-only">{isNew?'New memory':'Edit memory'}</DialogTitle>
  <DialogDescription className="sr-only">Write what happened, add photos, then save.</DialogDescription>
  <div className="editor-scroll">
   <input className="editor-title" aria-label="Title" placeholder="Give this day a title" maxLength={150} value={draft.title} onChange={e=>set('title',e.target.value)}/>
   <div className="editor-when">
    <DatePicker value={draft.date} onChange={v=>set('date',v)} max={dateKey()} label="Change date">{longDate(draft.date)}</DatePicker>
    {draft.time?<> at <button type="button" onClick={()=>openPicker(timeRef.current)}>{clock12(draft.time)}</button></>:null}
    <span aria-hidden> · </span>
    <button type="button" className="when-place" onClick={()=>setPickPlace(true)}>{draft.lat!==undefined&&<MapPin size={13} aria-hidden/>}<span>{draft.location.trim()||'Add location'}</span></button>
    {draft.sensitive&&<button type="button" className="when-sensitive" onClick={()=>set('sensitive',false)} title="Tap to unmark"><Lock size={12} aria-hidden/> Sensitive</button>}
    <input ref={timeRef} className="picker-input" type="time" aria-label="Time" tabIndex={-1} value={draft.time} onChange={e=>set('time',e.target.value)}/>
   </div>
   {pickPlace&&<Suspense fallback={null}><LocationPicker initial={{name:draft.location,lat:draft.lat,lng:draft.lng}} onClose={()=>setPickPlace(false)} onPick={p=>{setDraft(d=>{const next={...d};if(p){next.location=p.name;next.lat=p.lat;next.lng=p.lng}else{next.location='';delete next.lat;delete next.lng}return next});setPickPlace(false)}}/></Suspense>}
   <textarea className="editor-body" aria-label="Entry" placeholder="What happened? How did it feel?" maxLength={20000} value={draft.body} onChange={e=>set('body',e.target.value)}/>
  </div>
  {draft.photos.length>0&&<div className="editor-photos">{draft.photos.map((p,i)=><div className={`editor-photo ${i===0?'is-cover':''}`} key={p.id}><button type="button" className="editor-photo-pick" aria-label={i===0?'Adjust the cover photo':`Use ${p.name} as the cover`} onClick={()=>setCoverPick(p.id)}><img src={photoSrc(p)} alt={p.name} loading="lazy"/>{i===0&&<span className="cover-badge">Cover</span>}</button><button type="button" aria-label={`Remove ${p.name}`} onClick={()=>set('photos',draft.photos.filter(x=>x.id!==p.id))}><X size={15}/></button></div>)}</div>}
  {coverPick&&draft.photos.some(p=>p.id===coverPick)&&<CoverPicker photo={draft.photos.find(p=>p.id===coverPick)!} initial={draft.coverPos?.id===coverPick?draft.coverPos:undefined} onClose={()=>setCoverPick(null)} onConfirm={pos=>{setDraft(d=>{const p=d.photos.find(x=>x.id===coverPick)!;return {...d,photos:[p,...d.photos.filter(x=>x.id!==coverPick)],coverPos:{id:coverPick,...pos}}});setCoverPick(null)}}/>}
  <div className="editor-toolbar">
   <label className={`tool-btn ${uploading?'busy':''}`} title="Add photos"><ImagePlus size={22} aria-hidden/><input type="file" accept="image/*" multiple aria-label="Add photos" disabled={uploading} onChange={e=>{void add(e.target.files);e.target.value=''}}/></label>
   <DatePicker value={draft.date} onChange={v=>set('date',v)} max={dateKey()} label="Change date" className="tool-btn"><CalendarDays size={22}/></DatePicker>
   <button className="tool-btn" aria-label="Change time" onClick={()=>openPicker(timeRef.current)}><Clock size={22}/></button>
   <button className={`tool-btn ${draft.sensitive?'active':''}`} aria-pressed={!!draft.sensitive} aria-label="Sensitive memory" title={draft.sensitive?'Sensitive: hidden while privacy mode is on':'Mark as sensitive'} onClick={()=>set('sensitive',!draft.sensitive)}><EyeOff size={22}/></button>
   <button className="tool-btn" aria-label="Add location" onClick={()=>setPickPlace(true)}><MapPin size={22}/></button>
   <button className="save-btn" onClick={save} disabled={uploading}>{uploading?'UPLOADING…':'SAVE'}<ChevronRight size={18}/></button>
  </div>
 </DialogContent></Dialog>;
}

function MomentEditor({moment,isNew,onClose,onSave,onDelete}:{moment:Moment;isNew:boolean;onClose:()=>void;onSave:(m:Moment)=>void;onDelete:()=>void}){
 const [draft,setDraft]=useState(moment);
 const set=<K extends keyof Moment>(k:K,v:Moment[K])=>setDraft(d=>({...d,[k]:v}));
 const save=()=>{const m={...draft,title:draft.title.trim(),icon:draft.icon.trim()||'❤️'};if(!m.title)return void toast.error('Give this milestone a title.');onSave(m)};
 return <Dialog open onOpenChange={v=>!v&&onClose()}><DialogContent className="journal-editor moment-editor" showCloseButton={false}>
  <div className="editor-top"><button className="round-btn" aria-label="Back" onClick={onClose}><ChevronLeft size={22}/></button>{!isNew&&<button className="round-btn" aria-label="Delete milestone" onClick={onDelete}><Trash2 size={19}/></button>}</div>
  <DialogTitle className="sr-only">{isNew?(moment.date>dateKey()?'New countdown':'New milestone'):'Edit milestone'}</DialogTitle>
  <DialogDescription className="sr-only">Choose an icon, title, date and colour for this milestone.</DialogDescription>
  <div className="editor-scroll">
   <div className="moment-card moment-preview" data-color={draft.color} aria-hidden><span className="moment-icon">{draft.icon||'❤️'}</span><span className="moment-title">{draft.title||'Your milestone'}</span><MomentCount moment={draft}/></div>
   <div className="moment-fields">
    <div className="moment-row"><label className="field moment-icon-field">Icon<input value={draft.icon} maxLength={16} aria-label="Icon (emoji)" onChange={e=>set('icon',e.target.value)}/></label><label className="field grow">Title<input value={draft.title} maxLength={150} placeholder="Proposed at the beach" onChange={e=>set('title',e.target.value)}/></label></div>
    <div className="emoji-row" role="group" aria-label="Quick icons">{emojis.map(e=><button key={e} type="button" className={draft.icon===e?'selected':''} aria-label={`Use ${e}`} aria-pressed={draft.icon===e} onClick={()=>set('icon',e)}>{e}</button>)}</div>
    <div className="moment-row"><div className="field grow">Date<DatePicker value={draft.date} onChange={v=>set('date',v)} label="Choose the milestone date" className="date-field" jumpYears><span>{longDate(draft.date)}</span><CalendarDays size={17} aria-hidden/></DatePicker></div><label className="field grow">Time<input type="time" value={draft.time} onChange={e=>set('time',e.target.value)}/></label></div>
    <div className="setting-line compact moment-repeat"><label htmlFor="moment-repeat">Repeats every year<span className="setting-hint">For birthdays and anniversaries: counts down to the next one</span></label><Switch id="moment-repeat" checked={draft.repeat==='yearly'} onCheckedChange={v=>setDraft(d=>{const n={...d};if(v)n.repeat='yearly';else delete n.repeat;return n})}/></div>
    <div className="field">Colour<div className="swatches" role="radiogroup" aria-label="Colour">{momentColors.map(c=><button key={c} type="button" role="radio" aria-checked={draft.color===c} aria-label={c} data-color={c} className={`swatch ${draft.color===c?'selected':''}`} onClick={()=>set('color',c)}/>)}</div></div>
   </div>
  </div>
  <button className="moment-save" onClick={save}>Save</button>
 </DialogContent></Dialog>;
}
