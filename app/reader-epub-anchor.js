/* A temporary column break preserves the first visible character across reflow.
 * It is ignored by CFI addressing and never written into the source book. */
const readerAnchorClass='um-reader-layout-anchor';
function readerVisibleCfi(rendition,host){
 const bounds=host.getBoundingClientRect();
 for(const view of rendition?.manager?.visible?.()||[]){const doc=view.contents.document,frame=view.iframe.getBoundingClientRect(),walker=doc.createTreeWalker(doc.body,NodeFilter.SHOW_TEXT);let node;
 const visible=range=>[...range.getClientRects()].some(r=>r.width>0&&r.height>0&&r.left+frame.left>=bounds.left-1&&r.left+frame.left<bounds.right-1&&r.top+frame.top>=bounds.top-1&&r.bottom+frame.top<=bounds.bottom+1);
 while(node=walker.nextNode()){if(!node.textContent.trim()||node.parentElement.closest('script,style'))continue;const range=doc.createRange();range.selectNodeContents(node);if(!visible(range))continue;
 let low=1,high=node.length;while(low<high){const middle=Math.floor((low+high)/2);range.setStart(node,0);range.setEnd(node,middle);if(visible(range))high=middle;else low=middle+1;}
 for(let at=Math.max(0,low-1);at<Math.min(node.length,low+100);at++){if(!node.textContent[at].trim())continue;range.setStart(node,at);range.setEnd(node,at+1);if(visible(range)){range.collapse(true);return view.contents.cfiFromRange(range,readerAnchorClass);}}
 }}return null;
}
function readerCanonicalCfi(rendition,raw){
 try{const cfi=new ePub.CFI(raw),view=rendition.manager.views.find(rendition.book.spine.get(cfi.spinePos));if(!view)return raw;const range=cfi.toRange(view.contents.document);return view.contents.cfiFromRange(range,readerAnchorClass);}catch{return raw;}
}
function readerClearAnchor(rendition){for(const view of rendition?.manager?.views?.displayed?.()||[]){for(const marker of view.contents.document.querySelectorAll('.'+readerAnchorClass)){const parent=marker.parentNode;marker.remove();parent.normalize();}}}
async function readerPinAnchor(rendition,cfi,scrolling,valid){
 if(!cfi||!valid())return;await rendition.display(cfi);if(!valid())return;
 const parsed=new ePub.CFI(cfi),view=rendition.manager.views.find(rendition.book.spine.get(parsed.spinePos));if(!view)return;
 readerClearAnchor(rendition);const doc=view.contents.document,range=parsed.toRange(doc,readerAnchorClass);range.collapse(true);
 if(scrolling){const rect=range.getBoundingClientRect();rendition.manager.scrollBy(0,rect.top,true);}
 else{const marker=doc.createElement('span');marker.className=readerAnchorClass;marker.setAttribute('aria-hidden','true');marker.style.cssText='display:block!important;break-before:column!important;column-break-before:always!important;height:0!important;margin:0!important;padding:0!important;border:0!important;';if(range.startContainer.nodeType===3&&range.startOffset===0)range.startContainer.before(marker);else range.insertNode(marker);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));if(!valid())return;view.expand();await new Promise(resolve=>setTimeout(resolve,60));if(!valid())return;const target=doc.createRange();const next=marker.nextSibling;if(next?.nodeType===3){target.setStart(next,0);target.setEnd(next,Math.min(1,next.length));}else{target.selectNodeContents(next||marker.parentElement);target.collapse(true);}const rect=target.getBoundingClientRect(),step=rendition._layout.pageWidth||rendition._layout.width;rendition.manager.scrollTo(Math.floor((rect.left+.5)/step)*step,0,true);}
 await rendition.reportLocation();
}
