/* A failed remote request cannot replace a saved cover with generated artwork. */
const libraryCoverMemory=new Map(),libraryCoverRequests=new Map();
function coverUrls(item,orientation='landscape'){
 const preferred=orientation==='portrait'?'coverPortrait':'coverLandscape';
 return [...new Set([item[preferred],item.cover,item.coverPortrait,item.coverLandscape,item.networkCovers?.[preferred],item.networkCovers?.cover,...Object.values(item.networkCovers||{})].filter(Boolean))];
}
function coverSignature(item,orientation='landscape'){return JSON.stringify(coverUrls(item,orientation));}
function stableCoverFor(item,orientation='landscape'){return libraryCoverMemory.get(coverSignature(item,orientation))||coverFor(item,orientation);}
function coverOrientation(image,item){
 if(image.dataset.coverDirection)return image.dataset.coverDirection;
 if(image.closest('.portrait-layout,#portraitCoverSample'))return 'portrait';
 return image.closest('.list-layout,.small-layout')&&['book','manga'].includes(item.type)?'portrait':'landscape';
}
function attachStableCover(image,item,index=0){
 image._coverCleanup?.();
 const orientation=coverOrientation(image,item),urls=coverUrls(item,orientation),signature=JSON.stringify(urls),tried=new Set([image.getAttribute('src')]);let alive=true,attempt=0,recovery=null;
 const remember=src=>{libraryCoverMemory.set(signature,src);while(libraryCoverMemory.size>1800)libraryCoverMemory.delete(libraryCoverMemory.keys().next().value);};
 const valid=()=>alive&&image.isConnected;
 const recover=()=>{
  if(recovery)return recovery;
  if(!native.resolveLibraryCover)return Promise.resolve('');
  if(!libraryCoverRequests.has(signature)){
   const task=Promise.resolve().then(()=>native.resolveLibraryCover(urls)).catch(()=>'');
   libraryCoverRequests.set(signature,task);task.finally(()=>libraryCoverRequests.delete(signature));
  }
  recovery=libraryCoverRequests.get(signature);return recovery;
 };
 const loaded=()=>{
  if(!image.naturalWidth||image.dataset.coverFallback==='true')return;
  ++attempt;image.classList.remove('cover-recovering');const src=image.getAttribute('src');remember(src);
  // Download/cache in the background without touching an already decoded visible image.
  if(/^https:\/\//i.test(src||''))void recover().then(ref=>{if(ref)remember(ref);});
 };
 const failed=async()=>{
  if(!alive||image.dataset.coverFallback==='true')return;
  const token=++attempt;image.classList.add('cover-recovering');
  const cached=libraryCoverMemory.get(signature),alternate=[cached,...urls].find(url=>url&&!tried.has(url));
  if(alternate){tried.add(alternate);image.src=alternate;void recover();return;}
  const ref=await recover();if(!valid()||token!==attempt)return;
  if(ref&&!tried.has(ref)){tried.add(ref);image.src=ref;return;}
  // All sources failed: temporary visual placeholder only; original fields remain intact.
  image.dataset.coverFallback='true';image.classList.remove('cover-recovering');image.src=fallbackCover(item.name,index);
 };
 image.addEventListener('load',loaded);image.addEventListener('error',failed);
 image._coverCleanup=()=>{alive=false;++attempt;image.removeEventListener('load',loaded);image.removeEventListener('error',failed);};
 if(image.complete){if(image.naturalWidth)loaded();else if(image.getAttribute('src'))void failed();}
}
window.addEventListener('online',()=>{
 for(const img of document.querySelectorAll('img[data-cover-fallback=true]')){
  const item=state.items.find(i=>i.id===img.closest('.resource-card')?.dataset.id);if(!item)continue;
  img.dataset.coverFallback='false';img.src=stableCoverFor(item,coverOrientation(img,item));attachStableCover(img,item);
 }
});
