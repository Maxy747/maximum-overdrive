'use client';
import {useEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,X,Lock,EyeOff,Eye,Plus,Trash2,RotateCcw,Download} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {toast} from 'sonner';
import {TRASH_DAYS,type DumpPhoto,type FileRecord,type TrashPhoto} from '@/lib/tracker';
import {photoSrc,uploadPhotos,sharedUploadUrl} from './photos';
import {Vault} from './vault';
import {confirmAction} from './confirm';

const HOLD_MS=550;

// Grid of every imported photo. Tap to zoom, press and hold to mark a photo sensitive.
export type TrashActions={items:TrashPhoto[];remove:(p:DumpPhoto)=>void;restore:(ids:string[])=>void;purge:(ids:string[])=>Promise<boolean>};
export function PhotoDump({photos,privacy,canVault,onClose,onSetSensitive,onAdd,onHide,trash}:{photos:DumpPhoto[];privacy:boolean;canVault:boolean;onClose:()=>void;onSetSensitive:(id:string,value:boolean)=>void;onAdd:(p:FileRecord)=>void;onHide?:(p:DumpPhoto)=>Promise<boolean>;trash?:TrashActions}){
 const [revealed,setRevealed]=useState<Set<string>>(()=>new Set()),[zoomAt,setZoomAt]=useState<number|null>(null),[showSensitive,setShowSensitive]=useState(false),[vaultOpen,setVaultOpen]=useState(false),[adding,setAdding]=useState(false);
 const add=async(files:FileList|null)=>{setAdding(true);await uploadPhotos(files,5000,onAdd,sharedUploadUrl());setAdding(false)};
 const hold=useRef<{timer:ReturnType<typeof setTimeout>|null;fired:boolean}>({timer:null,fired:false});
 // Sensitive photos always start hidden; turning privacy mode on hides them again.
 useEffect(()=>{if(privacy){setShowSensitive(false);setRevealed(new Set())}},[privacy]);
 const hidden=(p:DumpPhoto)=>!showSensitive&&!!p.sensitive&&!revealed.has(p.id);
 const toggleSensitive=()=>{setShowSensitive(v=>!v);setRevealed(new Set())};
 const reveal=(id:string)=>setRevealed(r=>new Set(r).add(id));
 const setSensitive=(p:DumpPhoto,value:boolean)=>{onSetSensitive(p.id,value);setRevealed(r=>{const n=new Set(r);if(value)n.delete(p.id);else n.add(p.id);return n});toast.success(value?'Marked as sensitive':'No longer sensitive')};
 const clearHold=()=>{if(hold.current.timer){clearTimeout(hold.current.timer);hold.current.timer=null}};
 const startHold=(p:DumpPhoto)=>{clearHold();hold.current.fired=false;hold.current.timer=setTimeout(()=>{hold.current.fired=true;hold.current.timer=null;navigator.vibrate?.(25);setSensitive(p,!p.sensitive)},HOLD_MS)};
 const tap=(p:DumpPhoto,i:number)=>{if(hold.current.fired){hold.current.fired=false;return}if(hidden(p))return reveal(p.id);setZoomAt(i)};
 const sensitiveCount=photos.filter(p=>p.sensitive).length;
 // Photo admins only: move a photo into Hidden photos. It leaves the shared dump (and any memory) for both of you.
 const [hiding,setHiding]=useState(false),[trashOpen,setTrashOpen]=useState(false);
 // Photo admins only: delete goes to Recently deleted (restorable for 30 days), with an Undo right away.
 const remove=async(p:DumpPhoto,i:number)=>{if(!trash||!await confirmAction({title:'Delete this photo?',body:`It leaves the Photo Dump and its memories, and moves to Recently deleted for ${TRASH_DAYS} days.`}))return;trash.remove(p);setZoomAt(photos.length<=1?null:Math.min(i,photos.length-2));toast('Photo deleted',{description:'Moved to Recently deleted',duration:6000,action:{label:'Undo',onClick:()=>trash.restore([p.id])}})};
 const hide=async(p:DumpPhoto,i:number)=>{if(!onHide||hiding||!await confirmAction({title:'Move to Hidden photos?',body:'It disappears from the Photo Dump and memories for both of you, and only you can open it with your PIN.',action:'Move',danger:false}))return;setHiding(true);const ok=await onHide(p);setHiding(false);if(ok)setZoomAt(photos.length<=1?null:Math.min(i,photos.length-2))};
 return <Dialog open onOpenChange={v=>!v&&onClose()}><DialogContent className="journal-editor photo-dump" showCloseButton={false} onEscapeKeyDown={ev=>{if(zoomAt!==null){ev.preventDefault();setZoomAt(null)}}}>
  <div className="dump-top">
   <button className="round-btn" aria-label="Back" onClick={onClose}><ChevronLeft size={22}/></button>
   <div className="dump-heading"><DialogTitle>Photo Dump</DialogTitle><DialogDescription>{photos.length} photos{sensitiveCount?` · ${sensitiveCount} sensitive`:''} · tap to zoom · hold to mark sensitive</DialogDescription></div>
   <button className={`round-btn ${showSensitive?'':'eye-hidden'}`} aria-pressed={showSensitive} aria-label={showSensitive?'Hide sensitive photos':'Show sensitive photos'} title={showSensitive?'Hide sensitive photos':'Show sensitive photos'} onClick={toggleSensitive}>{showSensitive?<Eye size={20}/>:<EyeOff size={20}/>}</button>
  </div>
  <div className="dump-scroll">
   <div className="dump-grid">
    {photos.map((p,i)=><button key={p.id} className={`dump-tile ${hidden(p)?'locked':''}`}
     aria-label={hidden(p)?`Sensitive photo ${i+1}. Tap to reveal.`:`Photo ${i+1}${p.sensitive?', sensitive':''}. Tap to zoom, hold to ${p.sensitive?'unmark':'mark'} sensitive.`}
     onPointerDown={()=>startHold(p)} onPointerUp={clearHold} onPointerLeave={clearHold} onPointerCancel={clearHold} onContextMenu={e=>e.preventDefault()} onClick={()=>tap(p,i)}>
     {hidden(p)?<Lock size={20} aria-hidden/>:<><img src={photoSrc(p)} alt="" loading="lazy" draggable={false}/>{p.sensitive&&<span className="dump-badge"><EyeOff size={12} aria-hidden/></span>}</>}
    </button>)}
   </div>
   {!photos.length&&<p className="muted vault-empty">No photos here yet.</p>}
   {trash&&<button className="dump-entry vault-entry trash-entry" onClick={()=>setTrashOpen(true)}>
    <span className="vault-icon" aria-hidden><Trash2 size={21}/></span>
    <span className="dump-entry-text"><strong>Recently deleted</strong><span>{trash.items.length?`${trash.items.length} photo${trash.items.length===1?'':'s'} · kept ${TRASH_DAYS} days`:'Empty'}</span></span>
    <ChevronRight size={20} aria-hidden/>
   </button>}
   {canVault&&<button className="dump-entry vault-entry dump-vault-btn" onClick={()=>setVaultOpen(true)}>
    <span className="vault-icon" aria-hidden><Lock size={22}/></span>
    <span className="dump-entry-text"><strong>Hidden photos</strong><span>PIN protected</span></span>
    <ChevronRight size={20} aria-hidden/>
   </button>}
  </div>
  <label className={`dump-fab ${adding?'busy':''}`} title="Add photos"><Plus size={26} aria-hidden/><input type="file" accept="image/*" multiple aria-label="Add photos to the photo dump" disabled={adding} onChange={e=>{void add(e.target.files);e.target.value=''}}/></label>
  {canVault&&vaultOpen&&<Vault onClose={()=>setVaultOpen(false)}/>}
  {trash&&trashOpen&&<RecentlyDeleted trash={trash} onClose={()=>setTrashOpen(false)}/>}
  {zoomAt!==null&&photos[zoomAt]&&<Lightbox photos={photos} index={zoomAt} hidden={hidden} onReveal={reveal} onIndex={setZoomAt} onClose={()=>setZoomAt(null)} onToggleSensitive={p=>setSensitive(p,!p.sensitive)} action={canVault&&onHide||trash?p=><>{trash&&<button className="round-btn glass" aria-label="Delete photo" title="Delete" onClick={()=>void remove(p,zoomAt)}><Trash2 size={19}/></button>}{canVault&&onHide&&<button className="round-btn glass" aria-label="Move to hidden photos" title="Move to hidden photos" disabled={hiding} onClick={()=>void hide(p,zoomAt)}><Lock size={19}/></button>}</>:undefined}/>}
 </DialogContent></Dialog>;
}

// One photo viewer everywhere (memories, Photo Dump, hidden photos, the map, check-in photos): framed, pinch to zoom that
// springs back, swipe between photos, and Save.
export function Lightbox({photos,index,hidden,onReveal,onIndex,onClose,onToggleSensitive,src=photoSrc,action,framed=true}:{photos:DumpPhoto[];index:number;hidden:(p:DumpPhoto)=>boolean;onReveal:(id:string)=>void;onIndex:(i:number)=>void;onClose:()=>void;onToggleSensitive?:(p:DumpPhoto)=>void;src?:(p:{id:string})=>string;action?:(p:DumpPhoto)=>React.ReactNode;framed?:boolean}){
 const [zoom,setZoom]=useState(false),[drag,setDrag]=useState<number|null>(null),stage=useRef<HTMLDivElement>(null),touchX=useRef<number|null>(null);
 const p=photos[index];
 // Memory photos (framed): pinch to zoom while your fingers are down, clipped by the frame so the photo never leaves its
 // border (offsets are clamped so it always fills the frame). Letting go springs it back. Tapping does nothing.
 const curImg=useRef<HTMLImageElement>(null),view=useRef({s:1,x:0,y:0}),gesture=useRef<{kind:'pinch'|'pan';d0:number;s0:number;mx:number;my:number;x0:number;y0:number}|null>(null);
 const paint=(animate=false)=>{const img=curImg.current;if(!img)return;const {s,x,y}=view.current;img.style.transition=animate?'transform .3s cubic-bezier(.22,1,.36,1)':'none';img.style.transform=s===1&&!x&&!y?'':`translate(${x}px,${y}px) scale(${s})`};
 const clampView=()=>{const img=curImg.current,v=view.current;if(!img)return;const mx=img.clientWidth*(v.s-1)/2,my=img.clientHeight*(v.s-1)/2;v.x=Math.max(-mx,Math.min(mx,v.x));v.y=Math.max(-my,Math.min(my,v.y))};
 const resetZoom=(animate=false)=>{view.current={s:1,x:0,y:0};gesture.current=null;paint(animate)};
 const pinchStart=(t:React.TouchList)=>{const [a,b]=[t[0],t[1]];gesture.current={kind:'pinch',d0:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY)||1,s0:view.current.s,mx:(a.clientX+b.clientX)/2,my:(a.clientY+b.clientY)/2,x0:view.current.x,y0:view.current.y}};
 const panStart=(t:React.Touch)=>{gesture.current={kind:'pan',d0:1,s0:view.current.s,mx:t.clientX,my:t.clientY,x0:view.current.x,y0:view.current.y}};
 const onTouchStart=(e:React.TouchEvent)=>{
  if(framed&&e.touches.length>=2){touchX.current=null;setDrag(null);pinchStart(e.touches);return}
  if(framed&&view.current.s>1){touchX.current=null;panStart(e.touches[0]);return}
  touchX.current=zoom?null:e.touches[0].clientX};
 const gestureMove=(e:React.TouchEvent)=>{const g=gesture.current;if(!g)return false;const v=view.current;
  if(g.kind==='pinch'&&e.touches.length>=2){const [a,b]=[e.touches[0],e.touches[1]],d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);v.s=Math.max(1,Math.min(4,g.s0*d/g.d0));v.x=g.x0+((a.clientX+b.clientX)/2-g.mx);v.y=g.y0+((a.clientY+b.clientY)/2-g.my)}
  else if(g.kind==='pan'&&e.touches.length===1){v.x=g.x0+(e.touches[0].clientX-g.mx);v.y=g.y0+(e.touches[0].clientY-g.my)}
  clampView();paint();return true};
 // Letting go (all fingers up) glides the photo back into place; one finger left after a pinch keeps following until it lifts.
 const gestureEnd=(e:React.TouchEvent)=>{if(!gesture.current)return false;if(e.touches.length===1&&view.current.s>1)panStart(e.touches[0]);else if(!e.touches.length)resetZoom(true);return true};
 // Swiping: the strip follows your finger (with a little resistance past the ends), then glides to the next photo.
 const onTouchMove=(e:React.TouchEvent)=>{if(gestureMove(e))return;if(touchX.current===null)return;const dx=e.touches[0].clientX-touchX.current,edge=(index===0&&dx>0)||(index===photos.length-1&&dx<0);setDrag(edge?dx*.3:dx)};
 const onTouchEnd=(e:React.TouchEvent)=>{if(gestureEnd(e))return;if(touchX.current===null)return;const dx=e.changedTouches[0].clientX-touchX.current,w=stage.current?.clientWidth??400;touchX.current=null;setDrag(null);if(Math.abs(dx)>Math.min(60,w*.15))go(dx<0?1:-1)};
 const go=(d:number)=>{const n=index+d;if(n>=0&&n<photos.length){setZoom(false);resetZoom();onIndex(n)}};
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='ArrowRight')go(1);if(e.key==='ArrowLeft')go(-1)};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)});
 const toggleZoom=(e:React.MouseEvent<HTMLImageElement>)=>{
  const r=e.currentTarget.getBoundingClientRect(),fx=(e.clientX-r.left)/r.width,fy=(e.clientY-r.top)/r.height,next=!zoom;setZoom(next);
  if(next)requestAnimationFrame(()=>{const s=stage.current;if(s){s.scrollLeft=fx*s.scrollWidth-s.clientWidth/2;s.scrollTop=fy*s.scrollHeight-s.clientHeight/2}});
 };
 return <div className={`lightbox ${framed?'framed':''}`} role="group" aria-label={`Photo ${index+1} of ${photos.length}`}>
  <div ref={stage} className={`lightbox-stage ${zoom?'zoomed':''}`}
   onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={()=>{touchX.current=null;setDrag(null);gesture.current=null}}>
   {zoom?<img key={p.id} src={src(p)} alt={`Photo ${index+1}`} onClick={toggleZoom} draggable={false}/>
    // A strip of every photo; only the current one and its neighbours are loaded.
    :<div className="lightbox-track" style={{transform:`translateX(calc(${-index*100}% + ${drag??0}px))`,transition:drag===null?'transform .42s cubic-bezier(.22,1,.36,1)':'none'}}>
     {photos.map((q,i)=><div key={q.id} className="lightbox-slide" style={{left:`${i*100}%`}} aria-hidden={i!==index}>
      {Math.abs(i-index)>1?null:hidden(q)?<button className="lightbox-locked" tabIndex={i===index?0:-1} onClick={()=>onReveal(q.id)}><Lock size={28} aria-hidden/><strong>Sensitive photo</strong><span>Tap to reveal</span></button>
       :framed?<div className="lightbox-frame"><img ref={i===index?curImg:undefined} src={src(q)} alt={`Photo ${i+1}`} draggable={false}/></div>
       :<img src={src(q)} alt={`Photo ${i+1}`} onClick={i===index?toggleZoom:undefined} draggable={false}/>}
     </div>)}
    </div>}
  </div>
  <div className="lightbox-bar">
   <button className="round-btn glass" aria-label="Close photo" onClick={onClose}><X size={22}/></button>
   <span className="lightbox-count">{index+1} / {photos.length}</span>
   {<span className="lightbox-actions">{action?.(p)}<button className="round-btn glass" aria-label="Save photo" title="Save" onClick={()=>void savePhoto(p,src)}><Download size={19}/></button>{onToggleSensitive&&<button className={`round-btn glass ${p.sensitive?'is-sensitive':''}`} aria-pressed={!!p.sensitive} aria-label={p.sensitive?'Unmark sensitive':'Mark as sensitive'} title={p.sensitive?'Unmark sensitive':'Mark as sensitive'} onClick={()=>onToggleSensitive(p)}>{p.sensitive?<Eye size={20}/>:<EyeOff size={20}/>}</button>}</span>}
  </div>
  {index>0&&<button className="lightbox-nav prev" aria-label="Previous photo" onClick={()=>go(-1)}><ChevronLeft size={26}/></button>}
  {index<photos.length-1&&<button className="lightbox-nav next" aria-label="Next photo" onClick={()=>go(1)}><ChevronRight size={26}/></button>}
 </div>;
}

// Recently deleted: restore (back into Photo Dump and its memories) or delete for good. Empties itself after 30 days.
function RecentlyDeleted({trash,onClose}:{trash:TrashActions;onClose:()=>void}){
 const items=[...trash.items].sort((a,b)=>b.deletedAt.localeCompare(a.deletedAt)),[zoomAt,setZoomAt]=useState<number|null>(null),[busy,setBusy]=useState(false);
 const daysLeft=(p:TrashPhoto)=>Math.max(0,TRASH_DAYS-Math.floor((Date.now()-Date.parse(p.deletedAt))/86400000));
 const restore=(ids:string[])=>{trash.restore(ids);toast.success(ids.length>1?`${ids.length} photos restored`:'Photo restored')};
 const purge=async(ids:string[])=>{if(!ids.length||busy)return false;if(!await confirmAction({title:ids.length>1?`Delete ${ids.length} photos forever?`:'Delete this photo forever?',body:'This can’t be undone.',action:'Delete forever'}))return false;setBusy(true);const ok=await trash.purge(ids);setBusy(false);if(ok)toast.success(ids.length>1?'Photos deleted':'Photo deleted');return ok};
 const after=(i:number)=>setZoomAt(items.length<=1?null:Math.min(i,items.length-2));
 return <Dialog open onOpenChange={v=>!v&&onClose()}><DialogContent className="journal-editor photo-dump trash-view" showCloseButton={false} onEscapeKeyDown={ev=>{if(zoomAt!==null){ev.preventDefault();setZoomAt(null)}}}>
  <div className="dump-top">
   <button className="round-btn" aria-label="Back" onClick={onClose}><ChevronLeft size={22}/></button>
   <div className="dump-heading"><DialogTitle>Recently deleted</DialogTitle><DialogDescription>{items.length} photo{items.length===1?'':'s'} · deleted for good after {TRASH_DAYS} days</DialogDescription></div>
   <span/>
  </div>
  <div className="dump-scroll">
   {items.length>0&&<div className="trash-actions"><button type="button" className="chip-btn" onClick={()=>restore(items.map(p=>p.id))}><RotateCcw size={15} aria-hidden/>Restore all</button><button type="button" className="chip-btn danger-text" disabled={busy} onClick={()=>void purge(items.map(p=>p.id))}><Trash2 size={15} aria-hidden/>Delete all</button></div>}
   <div className="dump-grid">
    {items.map((p,i)=><button key={p.id} className="dump-tile trash-tile" aria-label={`Deleted photo, ${daysLeft(p)} days left. Tap to open.`} onClick={()=>setZoomAt(i)}><img src={photoSrc(p)} alt="" loading="lazy" draggable={false}/><span className="trash-days">{daysLeft(p)}d</span></button>)}
   </div>
   {!items.length&&<p className="muted vault-empty">Nothing here. Deleted photos stay here for {TRASH_DAYS} days.</p>}
  </div>
  {zoomAt!==null&&items[zoomAt]&&<Lightbox photos={items} index={zoomAt} hidden={()=>false} onReveal={()=>{}} onIndex={setZoomAt} onClose={()=>setZoomAt(null)} action={p=><><button className="round-btn glass" aria-label="Restore photo" title="Restore" onClick={()=>{restore([p.id]);after(zoomAt)}}><RotateCcw size={19}/></button><button className="round-btn glass" aria-label="Delete forever" title="Delete forever" disabled={busy} onClick={()=>void purge([p.id]).then(ok=>{if(ok)after(zoomAt)})}><Trash2 size={19}/></button></>}/>}
 </DialogContent></Dialog>;
}

// Saves a photo: the share sheet where it's supported (on iPhone: "Save Image"), a download otherwise.
export async function savePhoto(p:{id:string;name?:string},src:(p:{id:string})=>string=photoSrc){
 try{const blob=await (await fetch(src(p))).blob(),name=p.name||`photo-${p.id.slice(0,8)}.jpg`,file=new File([blob],name,{type:blob.type||'image/jpeg'});
  if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file]});return}
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000)}
 catch(err){if(!(err instanceof DOMException&&err.name==='AbortError'))toast.error('Couldn’t save the photo.')}
}

// The viewer on its own full-screen layer, for places that aren't already full-screen (the map, check-in photos).
export function PhotoViewer({photos,index,onClose,src=photoSrc}:{photos:DumpPhoto[];index:number;onClose:()=>void;src?:(p:{id:string})=>string}){
 const [at,setAt]=useState(index);
 return <Dialog open onOpenChange={v=>!v&&onClose()}><DialogContent className="photo-viewer-dialog" showCloseButton={false}>
  <DialogTitle className="sr-only">Photo</DialogTitle><DialogDescription className="sr-only">Photo {at+1} of {photos.length}</DialogDescription>
  <Lightbox photos={photos} index={Math.min(at,photos.length-1)} hidden={()=>false} onReveal={()=>{}} onIndex={setAt} onClose={onClose} src={src}/>
 </DialogContent></Dialog>;
}