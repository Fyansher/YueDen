/* Book markup is data, never instructions or executable code. */
function prepareEpubNotes(doc){
 // Respect author-sized inline art; never enlarge all images to page width.
 for(const img of doc.querySelectorAll('img,svg')){const style=img.getAttribute('style')||'',width=img.getAttribute('width')||'',height=img.getAttribute('height')||'',inline=img.closest('sup,sub,[role=doc-noteref]')||/(?:width|height)\s*:\s*[.\d]+(?:em|ex)/i.test(style)||Number(width)>0&&Number(width)<=48&&Number(height)>0&&Number(height)<=48;if(inline){img.setAttribute('data-um-inline','true');img.style.setProperty('max-width','1.5em','important');img.style.setProperty('max-height','1.5em','important');img.style.setProperty('width','auto','important');img.style.setProperty('height','1em','important');img.style.setProperty('display','inline-block','important');img.style.setProperty('vertical-align','middle','important');}}

 for(const a of doc.querySelectorAll('a')){
  const img=a.querySelector('img'),kind=a.getAttribute('epub:type')||a.getAttribute('role')||'',isNote=/noteref/i.test(kind)||img&&/epub-footnote/.test(img.className)||img?.hasAttribute('zy-footnote');if(!isNote)continue;
  let id='';try{id=decodeURIComponent((a.getAttribute('href')||'').split('#')[1]||'');}catch{}
  const target=id&&doc.getElementById(id),note=target?.textContent?.trim()||img?.getAttribute('zy-footnote')||img?.alt||'';
  if(note){a.dataset.umNote=note.slice(0,20000);a.setAttribute('role','button');a.setAttribute('aria-label','查看注释');a.setAttribute('tabindex','0');if(target){target.hidden=true;target.setAttribute('style','display:none !important');}}
  if(img)img.setAttribute('style','width:1em !important;height:1em !important;max-width:1em !important;display:inline-block !important;vertical-align:baseline !important');
 }
}
function openEpubNote(text){
 document.getElementById('epubNotePopover')?.remove();const panel=document.createElement('section');panel.id='epubNotePopover';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','注释');
 panel.style.cssText='position:fixed;right:24px;bottom:70px;z-index:9999;width:min(420px,calc(100vw - 48px));max-height:55vh;overflow:auto;background:var(--panel);color:var(--text);border:1px solid var(--accent);border-radius:12px;padding:18px;box-shadow:0 8px 35px #0006;line-height:1.8';
 const close=document.createElement('button');close.textContent='关闭注释 ×';close.style.cssText='float:right;color:var(--accent);background:transparent;border:0;cursor:pointer';close.onclick=()=>panel.remove();const body=document.createElement('p');body.textContent=text;panel.append(close,body);(document.fullscreenElement||document.getElementById('readerBackdrop')||document.body).append(panel);close.focus();panel.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();panel.remove();}};
}
if(typeof module!=='undefined')module.exports={prepareEpubNotes};
