'use client';
import {useState,type ReactNode} from 'react';
import {Popover,PopoverTrigger,PopoverContent} from '@/components/ui/popover';
import {Calendar} from '@/components/ui/calendar';
import {dateKey} from '@/lib/tracker';

const toDate=(key:string)=>new Date(key+'T12:00:00');

// In-app calendar popover used instead of the browser's native date picker.
export function DatePicker({value,onChange,max,label,className,children,jumpYears=false}:{value:string;onChange:(v:string)=>void;max?:string;label:string;className?:string;children:ReactNode;jumpYears?:boolean}){
 const [open,setOpen]=useState(false);
 const selected=value?toDate(value):undefined,maxDate=max?toDate(max):undefined,today=dateKey();
 const pick=(key:string)=>{onChange(key);setOpen(false)};
 return <Popover open={open} onOpenChange={setOpen}>
  <PopoverTrigger asChild><button type="button" className={className} aria-label={label} title={label}>{children}</button></PopoverTrigger>
  <PopoverContent className="date-pop" align="center" sideOffset={8} collisionPadding={12}>
   <Calendar mode="single" required={false} selected={selected} defaultMonth={selected??maxDate} weekStartsOn={1}
    className="[--cell-size:--spacing(10)]"
    captionLayout={jumpYears?'dropdown':'label'} startMonth={new Date(2015,0)} endMonth={maxDate??new Date(new Date().getFullYear()+10,11)}
    disabled={maxDate?{after:maxDate}:undefined}
    onSelect={d=>{if(d)pick(dateKey(d))}}/>
   <div className="date-pop-footer">
    <button type="button" onClick={()=>setOpen(false)}>Cancel</button>
    <button type="button" className="date-pop-today" disabled={!!max&&today>max} onClick={()=>pick(today)}>Today</button>
   </div>
  </PopoverContent>
 </Popover>;
}
