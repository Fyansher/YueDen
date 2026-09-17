(function(root){
 const pathKey=p=>String(p||'').replace(/^file:\/\//i,'').replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
 const paths=x=>[x.localPath,...(x.localFiles||[]).map(f=>f.path),...(x.audio?.sources||[]).filter(s=>s.kind==='local').map(s=>s.localPath)].filter(Boolean).map(pathKey);
 const name=x=>String(x||'').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
 const key=x=>x.identityKey||x.scanInfo?.identity||paths(x).sort()[0]||x.id;
 function sameInstallation(a,b){
  if(!['game','software','unknown_application'].includes(a.type))return false;
  const AI=typeof module!=='undefined'?require('./application-identity'):root.ApplicationIdentity;if(!AI)return false;
  const info=x=>{const scan=x.scanInfo||{},meta=scan.metadata||x.metadata||{},declared=scan.installation,dir=pathKey(x.localPath).replace(/\/[^/]+$/,'');
   return declared||{root:scan.boundary?.kind==='resource_package'?scan.boundary.root:dir,productKey:AI.product(meta.productName),companyKey:AI.key(meta.companyName),versionKey:AI.key(meta.productVersion),confidence:meta.validPe?.9:0};};
  const ai=info(a),bi=info(b),under=(x,i)=>paths(x).some(p=>p.startsWith(pathKey(i.root)+'/'));
  return Boolean(ai.confidence>=.8&&bi.confidence>=.8&&ai.productKey&&ai.productKey===bi.productKey&&pathKey(ai.root)===pathKey(bi.root)&&under(a,ai)&&under(b,bi)&&!(ai.companyKey&&bi.companyKey&&ai.companyKey!==bi.companyKey)&&!(ai.versionKey&&bi.versionKey&&ai.versionKey!==bi.versionKey));
 }
 function compare(a,b){const result=(status,level,reason)=>({status,level,reasons:[reason]});if(a.type!==b.type)return result('no-match','work','资源类型不同');const ak=key(a),bk=key(b),decision=(a.identityDecisions||[]).find(d=>d.key===bk)||(b.identityDecisions||[]).find(d=>d.key===ak);if(decision)return result(decision.action==='separate'?'no-match':'match','user','已保存的人工决定');if(a.id&&a.id===b.id)return result('match','work','稳定条目 ID 相同');const ap=paths(a),bp=paths(b);if(ap.some(p=>bp.includes(p)))return result('match','source','存在相同本地来源');
 const ids=x=>({steam:x.steamAppId||x.identifiers?.steam,isbn:x.isbn,release:x.audio?.identifiers?.musicbrainzRelease,product:x.identifiers?.verifiedProduct});const ai=ids(a),bi=ids(b);for(const id of Object.keys(ai))if(ai[id]&&bi[id]&&String(ai[id])!==String(bi[id]))return result('no-match','edition',id+' 标识不同');
 const edition=x=>name(x.audio?.edition||x.version||x.edition||x.scanInfo?.name?.versionTags?.join(' '));if(edition(a)&&edition(b)&&edition(a)!==edition(b))return result('review','edition','版本信息不同，请保留版本或确认归属');
 const creator=x=>name(x.developer||(x.audio?.albumArtists?.length?x.audio.albumArtists:x.audio?.artists||[]).join('|'));if(creator(a)&&creator(b)&&creator(a)!==creator(b))return result('no-match','work','作者或艺术家不同');
 for(const id of Object.keys(ai))if(ai[id]&&bi[id]&&String(ai[id])===String(bi[id]))return result('match',id==='steam'||id==='product'?'work':'edition','一致的 '+id+' 标识');
 if(a.scanInfo?.identity&&a.scanInfo.identity===b.scanInfo?.identity)return result('match','source','同一扫描边界');
 if(sameInstallation(a,b))return result('match','installation','同安装范围及本地产品身份一致，补充另一个启动入口');
 const titleName=v=>(typeof module!=='undefined'?require('./local-model'):root.LocalModel)?.canonical(v)||name(v);const an=[a.name,a.originalName,...a.aliases||[]].map(titleName).filter(Boolean);if([b.name,b.originalName,...b.aliases||[]].map(titleName).some(n=>n&&an.includes(n)))return result('review','work','仅名称/别名一致，身份不足，不能自动合并');
 const recordingA=(a.audio?.tracks||[]).map(t=>t.identifiers?.musicbrainz).filter(Boolean);if((b.audio?.tracks||[]).some(t=>recordingA.includes(t.identifiers?.musicbrainz)))return result('review','recording','录音标识相同，尚需确认发行版本及来源归属');return result('no-match','work','没有可靠的共同身份');
 }
 const api={compare,key,pathKey,paths};if(typeof module!=='undefined')module.exports=api;else root.ResourceIdentity=api;
})(typeof window==='undefined'?globalThis:window);
