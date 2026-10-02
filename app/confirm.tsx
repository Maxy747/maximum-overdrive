'use client';
import {useEffect,useState} from 'react';
import {Trash2} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';

// A styled replacement for window.confirm (which shows the site's address in an iPhone web app).
// Call confirmAction() from anywhere; <ConfirmHost/> is mounted once and resolves the promise.
type Ask={title:string;body?:string;action?:string;danger?:boolean};
type Pending=Ask&{resolve:(ok:boolean)=>void};
let show:((p:Pending)=>void)|null=null;

export function confirmAction(ask:Ask):Promise<boolean>{
 if(!show)return Promise.resolve(window.confirm(ask.body?`${ask.title}\n\n${ask.body}`:ask.title));
 // Opened on the next tick so a dropdown menu that triggered it can finish closing first.
 return new Promise(resolve=>setTimeout(()=>show?.({...ask,resolve}),0));
}

export function ConfirmHost(){
 const [pending,setPending]=useState<Pending|null>(null);
 useEffect(()=>{show=p=>setPending(cur=>{cur?.resolve(false);return p});return()=>{show=null}},[]);
 const done=(ok:boolean)=>{pending?.resolve(ok);setPending(null)};
 if(!pending)return null;
 return <Dialog open onOpenChange={v=>!v&&done(false)}><DialogContent className="confirm-dialog" showCloseButton={false}>
  {pending.danger!==false&&<span className="confirm-icon" aria-hidden><Trash2 size={22}/></span>}
  <DialogTitle>{pending.title}</DialogTitle>
  <DialogDescription>{pending.body??''}</DialogDescription>
  <div className="confirm-actions"><button type="button" className="secondary" autoFocus onClick={()=>done(false)}>Cancel</button><button type="button" className={`secondary ${pending.danger!==false?'confirm-danger':'primary'}`} onClick={()=>done(true)}>{pending.action??'Delete'}</button></div>
 </DialogContent></Dialog>;
}
