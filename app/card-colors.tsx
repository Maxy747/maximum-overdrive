'use client';
import {Check} from 'lucide-react';
import {CARD_COLORS,type CardColor} from '@/lib/tracker';

// Swatches for a goal card's colour. "Auto" keeps the colour that comes with its card name (Body, Food, Sleep…).
export function CardColorPicker({value,onChange}:{value?:CardColor;onChange:(c:CardColor|undefined)=>void}){
 return <div className="field"><span>Card colour</span>
  <div className="color-swatches" role="radiogroup" aria-label="Card colour">
   <button type="button" role="radio" aria-checked={!value} className={`color-swatch auto ${!value?'on':''}`} onClick={()=>onChange(undefined)}>Auto</button>
   {CARD_COLORS.map(c=><button key={c} type="button" role="radio" aria-checked={value===c} aria-label={c} title={c} data-color={c} className={`color-swatch ${value===c?'on':''}`} onClick={()=>onChange(c)}>{value===c&&<Check size={14} aria-hidden/>}</button>)}
  </div>
 </div>;
}
