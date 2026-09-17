/* Read ZIP entries in memory, never extract paths onto disk. Bound sizes and reject encryption. */
const fs=require('node:fs/promises'),zlib=require('node:zlib');
async function directory(file,{maxCentralBytes=16*1024*1024,maxEntries=12000,charge=()=>{}}={}){
 const handle=await fs.open(file,'r');try{const stat=await handle.stat(),length=Math.min(stat.size,65557),tail=(charge(length),Buffer.alloc(length));await handle.read(tail,0,length,stat.size-length);
  let end=-1;for(let i=tail.length-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50&&i+22+tail.readUInt16LE(i+20)===tail.length){end=i;break;}if(end<0)throw Error('不是有效的 ZIP / CBZ 文件');
  const count=tail.readUInt16LE(end+10),size=tail.readUInt32LE(end+12),offset=tail.readUInt32LE(end+16);if(count>maxEntries||size>maxCentralBytes||offset+size>stat.size)throw Error('压缩包过大或使用了暂不支持的 ZIP64 / 分卷格式');
  charge(size);const central=Buffer.alloc(size);await handle.read(central,0,size,offset);const entries=[];let at=0,total=0;
  for(let i=0;i<count;i++){if(at+46>size||central.readUInt32LE(at)!==0x02014b50)throw Error('压缩包目录损坏');const flags=central.readUInt16LE(at+8),method=central.readUInt16LE(at+10),packed=central.readUInt32LE(at+20),bytes=central.readUInt32LE(at+24),n=central.readUInt16LE(at+28),extra=central.readUInt16LE(at+30),comment=central.readUInt16LE(at+32),position=central.readUInt32LE(at+42),raw=central.subarray(at+46,at+46+n);
   const name=new TextDecoder(flags&0x800?'utf-8':'gb18030').decode(raw).replace(/\\/g,'/');at+=46+n+extra+comment;
   if(name.endsWith('/'))continue;if(flags&1)throw Error('暂不支持加密压缩包，请解密后阅读');if(/(^\/|^[A-Za-z]:|(?:^|\/)\.\.(?:\/|$)|\0)/.test(name))throw Error('压缩包包含不安全的路径');
   total+=bytes;if(bytes>64*1024*1024||total>2*1024*1024*1024)throw Error('压缩包展开体积超过安全限制');entries.push({name,method,packed,bytes,position});
  }return entries;
 }finally{await handle.close();}
}
async function readEntry(file,entry,{maxEntryBytes=64*1024*1024,charge=()=>{}}={}){const handle=await fs.open(file,'r');try{if(entry.bytes>maxEntryBytes||entry.packed>Math.max(maxEntryBytes,80*1024*1024))throw Error('单项内容超过读取预算');charge(30);const header=Buffer.alloc(30);await handle.read(header,0,30,entry.position);if(header.readUInt32LE(0)!==0x04034b50)throw Error('压缩数据损坏');const offset=entry.position+30+header.readUInt16LE(26)+header.readUInt16LE(28);if(entry.packed>80*1024*1024||entry.packed>maxEntryBytes+65536)throw Error('单页压缩数据过大');charge(entry.packed);const data=Buffer.alloc(entry.packed);await handle.read(data,0,data.length,offset);
 const out=entry.method===0?data:entry.method===8?await new Promise((resolve,reject)=>zlib.inflateRaw(data,{maxOutputLength:maxEntryBytes},(e,v)=>e?reject(e):resolve(v))):null;if(!out||out.length!==entry.bytes)throw Error('不支持的压缩方式或文件损坏');return out;
 }finally{await handle.close();}}
module.exports={directory,readEntry};
