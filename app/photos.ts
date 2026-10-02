import {toast} from 'sonner';
import type {FileRecord} from '@/lib/tracker';

export const photoSrc=(p:{id:string})=>`./api/files?id=${encodeURIComponent(p.id)}&inline=1`;

// Which journal the Journal page is showing (set by it): shared photos are uploaded into that one.
let side:'ours'|'mine'='ours';
export const setJournalSide=(s:'ours'|'mine')=>{side=s};
export const sharedUploadUrl=()=>side==='mine'?'./api/files?shared=1&space=mine':'./api/files?shared=1';

// Uploads photos one at a time so each finished upload is kept even if a later one fails.
export async function uploadPhotos(files:FileList|null,room:number,add:(photo:FileRecord,geo?:{lat:number;lng:number},taken?:{date:string;time:string})=>void,url='./api/files'){
 const list=Array.from(files??[]);if(!list.length)return;
 if(list.length>room)return void toast.error(room>0?`You can add ${room} more photo${room===1?'':'s'}.`:'Photo limit reached.');
 let added=0;
 try{
  for(const file of list){
   if(!file.type.startsWith('image/'))throw Error(`${file.name} is not a photo.`);
   if(file.size>10000000)throw Error(`${file.name} is larger than 10 MB.`);
   const data=new FormData();data.append('file',file);
   const r=await fetch(url,{method:'POST',body:data});
   const body=await r.json().catch(()=>({})) as {id?:string;name?:string;size?:number;geo?:{lat:number;lng:number};taken?:{date:string;time:string};error?:string};
   if(!r.ok||!body.id)throw Error(body.error??'Upload failed. Please retry.');
   add({id:body.id,name:body.name??file.name.slice(0,150),size:body.size??file.size},body.geo,body.taken);added++;
  }
  toast.success(added>1?'Photos added':'Photo added');
 }catch(err){toast.error(err instanceof Error?err.message:'Upload failed. Please retry.')}
}
