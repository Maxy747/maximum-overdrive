'use client';
import {useRef,useState} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {photoSrc} from './photos';
import type {FileRecord} from '@/lib/tracker';

// Pick a memory's cover and frame it: the photo sits in a frame the shape of the journal card (2:1)
// and you drag it to choose what shows. The framing is saved as a focal point (object-position %).
export function CoverPicker({photo,initial,onConfirm,onClose}:{photo:FileRecord;initial?:{x:number;y:number};onConfirm:(pos:{x:number;y:number})=>void;onClose:()=>void}){
 const [pos,setPos]=useState(initial??{x:50,y:50}),frame=useRef<HTMLDivElement>(null),img=useRef<HTMLImageElement>(null),drag=useRef<{x:number;y:number;start:{x:number;y:number}}|null>(null);
 // How far the photo overflows the frame, in px, so a drag moves it 1:1 under your finger.
 const overflow=()=>{const f=frame.current?.getBoundingClientRect(),i=img.current;if(!f||!i?.naturalWidth)return {x:0,y:0};const scale=Math.max(f.width/i.naturalWidth,f.height/i.naturalHeight);return {x:i.naturalWidth*scale-f.width,y:i.naturalHeight*scale-f.height}};
 const clamp=(n:number)=>Math.max(0,Math.min(100,n));
 return <Dialog open onOpenChange={v=>!v&&onClose()}><DialogContent className="cover-picker" showCloseButton={false}>
  <DialogTitle className="sr-only">Frame the cover photo</DialogTitle><DialogDescription className="sr-only">Drag the photo to choose what shows on the memory card.</DialogDescription>
  <span className="cover-hint">Drag to adjust</span>
  <div ref={frame} className="cover-frame"
   onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,start:pos}}}
   onPointerMove={e=>{const d=drag.current;if(!d)return;const o=overflow();setPos({x:o.x>0?clamp(d.start.x-(e.clientX-d.x)/o.x*100):50,y:o.y>0?clamp(d.start.y-(e.clientY-d.y)/o.y*100):50})}}
   onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}}>
   <img ref={img} src={photoSrc(photo)} alt="" draggable={false} style={{objectPosition:`${pos.x}% ${pos.y}%`}}/>
   <span className="cover-grid" aria-hidden><i/><i/><i/><i/></span>
  </div>
  <div className="cover-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="button" className="primary cover-confirm" onClick={()=>onConfirm({x:Math.round(pos.x),y:Math.round(pos.y)})}>Set as cover</button></div>
 </DialogContent></Dialog>;
}
