// Hybrid MOBI files have a version-6 first header but an EXTH-121 KF8 boundary.
export function mobiFormat(bytes){
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),n=bytes.byteLength;
 const magic=(at,s)=>at>=0&&at+s.length<=n&&[...s].every((c,i)=>bytes[at+i]===c.charCodeAt(0));
 if(n<86||!magic(60,'BOOKMOBI'))throw Error('不是有效的 MOBI 容器');
 const records=v.getUint16(76),offset=i=>i<records&&78+i*8+4<=n?v.getUint32(78+i*8):-1;
 const head=offset(0);if(head<0||head+40>n||!magic(head+16,'MOBI'))throw Error('MOBI 头损坏');
 if(v.getUint16(head+12))throw Error('此电子书受DRM保护，无法内置阅读');
 if(v.getUint32(head+36)>=8)return 'kf8';
 const exth=head+16+v.getUint32(head+20);
 if(magic(exth,'EXTH')&&exth+12<=n){const end=Math.min(n,exth+v.getUint32(exth+4)),count=Math.min(4096,v.getUint32(exth+8));let at=exth+12;
  for(let i=0;i<count&&at+8<=end;i++){const kind=v.getUint32(at),size=v.getUint32(at+4);if(size<8||at+size>end)break;
   if(kind===121&&size>=12){const next=offset(v.getUint32(at+8));if(next>=0&&next+40<=n&&magic(next+16,'MOBI')&&v.getUint32(next+36)>=8){if(v.getUint16(next+12))throw Error('此电子书受DRM保护，无法内置阅读');return 'kf8';}}
   at+=size;
  }
 }
 return 'mobi';
}
