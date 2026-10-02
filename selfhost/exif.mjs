// Reads the GPS position from a JPEG's EXIF block, if the camera recorded one.
// Returns {lat,lng} or null. Only the file header is needed; malformed data returns null.
export function jpegGps(buf){const t=exifTiff(buf);try{return t?tiffGps(t):null}catch{return null}}

// When the photo was taken (EXIF DateTimeOriginal, the camera's local time): {date:'YYYY-MM-DD',time:'HH:MM'} or null.
export function jpegTaken(buf){
 try{
  const t=exifTiff(buf);if(!t)return null;
  const {u16,u32,entries}=reader(t),ptr=entries(u32(4)).get(0x8769);if(ptr===undefined)return null;
  const e=entries(u32(ptr+8)).get(0x9003)??entries(u32(ptr+8)).get(0x9004);if(e===undefined||u16(e+2)!==2)return null;
  const n=u32(e+4),text=t.toString('latin1',n<=4?e+8:u32(e+8),(n<=4?e+8:u32(e+8))+Math.min(n,20));
  const m=/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/.exec(text);if(!m||m[1]<'1990'||+m[2]<1||+m[2]>12||+m[3]<1||+m[3]>31||+m[4]>23||+m[5]>59)return null;
  return {date:`${m[1]}-${m[2]}-${m[3]}`,time:`${m[4]}:${m[5]}`};
 }catch{return null}
}

// The EXIF (TIFF) block of a JPEG, or null.
function exifTiff(buf){
 try{
  if(buf.length<4||buf[0]!==0xff||buf[1]!==0xd8)return null;
  let p=2;
  while(p+4<=buf.length&&buf[p]===0xff){
   const marker=buf[p+1],size=buf.readUInt16BE(p+2);
   if(marker===0xda||marker===0xd9)break;// image data starts: no EXIF before it
   if(marker===0xe1&&buf.toString('latin1',p+4,p+10)==='Exif\0\0')return buf.subarray(p+10,p+2+size);
   p+=2+size;
  }
 }catch{}
 return null;
}

function reader(t){
 const le=t.toString('latin1',0,2)==='II';
 const u16=o=>le?t.readUInt16LE(o):t.readUInt16BE(o),u32=o=>le?t.readUInt32LE(o):t.readUInt32BE(o);
 const entries=ifd=>{const n=u16(ifd),out=new Map();for(let i=0;i<n;i++){const e=ifd+2+i*12;out.set(u16(e),e)}return out};
 return {u16,u32,entries};
}

function tiffGps(t){
 const {u16,u32,entries}=reader(t);
 const gpsPtr=entries(u32(4)).get(0x8825);if(gpsPtr===undefined)return null;
 const gps=entries(u32(gpsPtr+8));
 const ref=tag=>{const e=gps.get(tag);return e===undefined?'':String.fromCharCode(t[e+8])};
 const dms=tag=>{const e=gps.get(tag);if(e===undefined||u16(e+2)!==5||u32(e+4)!==3)return null;const o=u32(e+8),r=i=>{const d=u32(o+i*8+4);return d?u32(o+i*8)/d:0};return r(0)+r(1)/60+r(2)/3600};
 let lat=dms(2),lng=dms(4);if(lat===null||lng===null)return null;
 if(ref(1)==='S')lat=-lat;if(ref(3)==='W')lng=-lng;
 if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180||(lat===0&&lng===0))return null;
 return {lat:Math.round(lat*1e6)/1e6,lng:Math.round(lng*1e6)/1e6};
}
