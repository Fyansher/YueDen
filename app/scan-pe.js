// Read only the PE resource directory and RT_VERSION payload, never run the image.
async function versionData(file,ctx,head,pe){
 const count=head.readUInt16LE(pe+6),optional=head.readUInt16LE(pe+20),start=pe+24+optional;
 const table=start+Math.min(count,96)*40<=head.length?head:await ctx.read(file,start+Math.min(count,96)*40);
 const sections=[];for(let i=0;i<Math.min(count,96);i++){const at=start+i*40;if(at+40>table.length)break;sections.push({name:table.toString('ascii',at,at+8).replace(/\0/g,''),rva:table.readUInt32LE(at+12),size:table.readUInt32LE(at+16),offset:table.readUInt32LE(at+20)});}
 const rsrc=sections.find(s=>s.name==='.rsrc');if(!rsrc)return null;
 const dir=async rel=>{if(rel<0||rel+16>rsrc.size)return [];const h=await ctx.read(file,16,rsrc.offset+rel);if(h.length<16)return [];const n=h.readUInt16LE(12)+h.readUInt16LE(14);if(n>256||rel+16+n*8>rsrc.size)return [];const b=await ctx.read(file,n*8,rsrc.offset+rel+16),out=[];for(let i=0;i+8<=b.length;i+=8)out.push({id:b.readUInt32LE(i),target:b.readUInt32LE(i+4)});return out;};
 let entry=(await dir(0)).find(e=>e.id===16);
 for(let depth=0;entry&&entry.target>>>31&&depth<3;depth++)entry=(await dir(entry.target&0x7fffffff))[0];
 if(entry&&!(entry.target>>>31)&&entry.target+16<=rsrc.size){const d=await ctx.read(file,16,rsrc.offset+entry.target);if(d.length===16){const rva=d.readUInt32LE(0),size=d.readUInt32LE(4),section=sections.find(s=>rva>=s.rva&&rva-s.rva+size<=s.size);if(section&&size>0&&size<=65536)return ctx.read(file,size,section.offset+rva-section.rva);}}
 // Bounded fallback for nonstandard resource layouts; never scan an entire icon bank.
 return ctx.read(file,Math.min(rsrc.size,32768),rsrc.offset);
}
module.exports={versionData};
