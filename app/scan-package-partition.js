/* A foreign application does not invalidate an already evidenced installation.
 * Select the anchored product; leave independent entries for their own discovery.
 */
const path=require('node:path'),AI=require('./application-identity'),Names=require('./scan-naming');
function partition(dir,rows,programs,{installation,structural,payload,rules=[]}){
 const verified=p=>Names.scopedRules(rules,path.dirname(p.file),p.file,p.metadata);
 const names=new Set(rows.filter(r=>r.kind==='file').map(r=>r.name.toLowerCase()));
 const paired=p=>{const stem=path.basename(p.file,'.exe').toLowerCase();return names.has(stem+'.dat')&&names.has(stem+'.cfg');};
 const anchors=programs.filter(p=>p.metadata.validPe&&(p.file===installation?.launch||installation?.identifiers?.steam&&AI.role(p.file,p.metadata)!=='tool'||p.file===structural.launch&&structural.cohesive||paired(p)||rows.some(r=>r.kind==='directory'&&r.name.toLowerCase()===path.basename(p.file,'.exe').toLowerCase()+'_data')||payload&&path.basename(payload.source).toLowerCase()===path.basename(p.file,'.exe').toLowerCase()+'.pck'));
 if(!anchors.length)return null;
 const first=anchors[0],fact=AI.facts(first.file,first.metadata);
 if(anchors.some(p=>p!==first&&(!fact.productKey||AI.product(p.metadata.productName)!==fact.productKey||AI.conflict(fact,AI.facts(p.file,p.metadata)))))return null;
 const ownerType=installation?.type||verified(first).find(r=>r.type)?.type||(rows.some(r=>r.name.toLowerCase()==='steam_appid.txt')?'game':null);
 const independent=p=>p.file!==first.file&&(verified(p).some(r=>r.type&&r.type!==ownerType)||ownerType!=='software'&&Boolean(require('./scan-software-evidence').purpose(p.metadata,p.file)));
 const owned=[],separate=[];
 for(const p of programs){
  const f=AI.facts(p.file,p.metadata),same=p===first||fact.productKey&&f.productKey===fact.productKey&&!AI.conflict(fact,f);
  const helper=f.role!=='primary'&&!independent(p);
  // An explicit script+payload boundary can also establish an unlabelled renderer
  // alternative. A shared binary directory alone is not sufficient evidence.
  const stem=file=>path.basename(file,'.exe').toLowerCase().replace(/[_ -](?:gl|opengl|dx\d+|d3d\d+|vulkan|x86|x64)$/i,'');
  const renderer=structural.cohesive&&structural.launch===first.file&&path.dirname(p.file)===path.dirname(first.file)&&AI.variant(p.file)&&stem(p.file)===stem(first.file)&&!AI.conflict(fact,f);
  (p.metadata.validPe&&(same||helper||renderer)&&!independent(p)?owned:separate).push(p);
 }
 if(!owned.includes(first))return null;
 return {anchor:first,owned,separate,independent,ownerType,pairedData:paired(first)};
}
module.exports={partition};
