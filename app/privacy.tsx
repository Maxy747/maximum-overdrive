'use client';
import {createContext,useContext,useRef,type MouseEvent} from 'react';

const HOLD_MS=500;

// Private goals and sensitive memories that were pressed and held. They stay visible until
// privacy is switched back on (or MAX is reopened).
export const RevealContext=createContext<{revealed:ReadonlySet<string>;reveal:(id:string)=>void}>({revealed:new Set(),reveal:()=>{}});

// Press and hold a hidden item to show it. Returns props for the hidden element; the click that
// ends the hold is swallowed so revealing doesn't also open the item.
export function useHoldReveal(){
 const {revealed,reveal}=useContext(RevealContext);
 const hold=useRef<{timer:ReturnType<typeof setTimeout>|null;fired:boolean}>({timer:null,fired:false});
 const clear=()=>{if(hold.current.timer){clearTimeout(hold.current.timer);hold.current.timer=null}};
 const props=(id:string,hidden:boolean)=>({
  onClickCapture:(e:MouseEvent)=>{if(hold.current.fired){hold.current.fired=false;e.preventDefault();e.stopPropagation()}},
  ...(hidden?{
   'data-hold-reveal':'',
   onPointerDown:()=>{clear();hold.current.fired=false;hold.current.timer=setTimeout(()=>{hold.current.fired=true;hold.current.timer=null;navigator.vibrate?.(20);reveal(id)},HOLD_MS)},
   onPointerUp:clear,onPointerLeave:clear,onPointerCancel:clear,
   onContextMenu:(e:MouseEvent)=>e.preventDefault(),
  }:{}),
 });
 return {revealed,props};
}
