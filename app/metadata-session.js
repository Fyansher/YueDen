/* Each editor search owns a token. Closing, changing a title/type or selecting
   another item invalidates the token before late IPC messages can touch the UI. */
let metadataSession=null,metadataSessionCounter=0,metadataSelectionEpoch=0;
let metadataPointerBusy=false,metadataPendingProgress=null;
function cancelMetadataLookup(hide=true) {
  window.audioPanels?.cancelLookup?.();
  if(metadataCandidatePicker){metadataCandidatePicker.job.ignoreAll=true;finishImportCandidate(null);}
  const old=metadataSession;metadataSession=null;metadataRequestId++;metadataSelectionEpoch++;
  metadataPendingProgress=null;
  if(old)native.cancelMetadataSearch?.(old.id);
  const button=$('metadataBtn');if(button){button.disabled=false;button.textContent='⌁ 自动获取信息';button.removeAttribute('aria-busy');}
  if(hide)$('candidateBackdrop')?.classList.add('hidden');
}
function validMetadataSession(session) {
  return metadataSession===session&&editorId===session.editor&&$('fieldType').value===session.type&&valueFor('fieldName')===session.query&&!$('editorBackdrop').classList.contains('hidden');
}
function receiveMetadataProgress(message) {
  const session=metadataSession;if(!session||message.id!==session.id||!validMetadataSession(session))return;
  if(metadataPointerBusy){metadataPendingProgress=message;return;}
  session.payload=message.bundle;
  showCandidates(message.bundle,{preserve:true});
}
async function fetchMetadata() {
  if($('fieldType').value==='audio')return window.audioPanels.metadata(editorId,true);
  if(metadataSession?.running){cancelMetadataLookup();return;}
  cancelMetadataLookup();const type=$('fieldType').value,query=valueFor('fieldName');
  if(!query){showToast('请先输入名称','error');$('fieldName').focus();return;}
  const session={id:'lookup-'+Date.now()+'-'+(++metadataSessionCounter),editor:editorId,type,query,running:true,covers:JSON.stringify(getEditorCovers()),fields:Object.fromEntries([...$('editorForm').querySelectorAll('input[id],textarea[id]')].map(node=>[node.id,node.value]))};
  metadataSession=session;const button=$('metadataBtn');button.disabled=false;button.textContent='× 停止获取';button.setAttribute('aria-busy','true');
  try {
    let payload=native.startMetadataSearch?await native.startMetadataSearch(session.id,type,query):native.searchMetadataSources?await native.searchMetadataSources(type,query):await native.searchMetadata(type,query);
    if(!validMetadataSession(session))return;
    if(payload?.canceled)return;
    if(payload?.error){showToast(payload.error,'error');return;}
    session.payload=payload;session.running=false;
    receiveMetadataProgress({id:session.id,bundle:Array.isArray(payload)?{integrated:payload,sources:[],loading:false}:payload||{integrated:[],sources:[],loading:false}});
  }catch(error){if(validMetadataSession(session)&&error?.name!=='AbortError')showToast('联网搜索失败；已填写的内容已保留。','error');}
  finally {if(metadataSession===session){session.running=false;button.disabled=false;button.textContent='⌁ 自动获取信息';button.removeAttribute('aria-busy');}}
}
function installMetadataSession() {
  const unsubscribe=native.onMetadataProgress?.(receiveMetadataProgress);
  $('candidateBackdrop').addEventListener('pointerdown',()=>{metadataPointerBusy=true;},true);
  $('candidateBackdrop').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dismissCandidateResults();}});
  const release=()=>{metadataPointerBusy=false;setTimeout(()=>{const next=metadataPendingProgress;metadataPendingProgress=null;if(next)receiveMetadataProgress(next);},0);};
  document.addEventListener('pointerup',release,true);document.addEventListener('pointercancel',release,true);window.addEventListener('blur',release);
  for(const id of ['fieldName','fieldType'])$(id).addEventListener(id==='fieldName'?'input':'change',()=>cancelMetadataLookup());
  window.addEventListener('beforeunload',()=>{cancelMetadataLookup();unsubscribe?.();});
}
