import type {User} from '@/lib/tracker';
import {photoSrc} from './photos';

export function Avatar({user,size=36,className='',src}:{user:Pick<User,'displayName'|'avatar'>|undefined;size?:number;className?:string;src?:string}){
 const name=user?.displayName??'?';
 return <span className={`avatar ${className}`} style={{width:size,height:size,fontSize:Math.round(size*0.42)}} aria-hidden>
  {src||user?.avatar?<img src={src??photoSrc({id:user!.avatar!})} alt=""/>:name.slice(0,1).toUpperCase()}
 </span>;
}
