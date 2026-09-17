import {initMobiFile,initKf8File} from './vendor/mobi-parser.min.mjs';
import {mobiFormat} from './mobi-format.mjs';
// Convert in memory only. The original book is never changed; DRM is not bypassed.
export async function openMobi(session,valid,epubEngine,comicEngine){
 const buffer=await window.readerResourceBytes(session),bytes=new Uint8Array(buffer),length=bytes.length;if(!valid())return {dispose(){}};
 if(length<90)throw Error('电子书文件不完整');const view=new DataView(bytes.buffer),record=view.getUint32(78);if(record+40>length)throw Error('电子书记录损坏');
 if(view.getUint16(record+12)!==0)throw Error('此电子书受DRM保护，无法内置阅读；不会绕过加密');
 let book;try{
  book=await(mobiFormat(bytes)==='kf8'?initKf8File:initMobiFile)(bytes);if(!valid()){book.destroy();return {dispose(){}};}
  await window.mediaScript('vendor/jszip.min.js');await window.mediaScript('vendor/purify.min.js');
  const zip=new window.JSZip(),spine=book.getSpine();if(!spine.length||spine.length>5000)throw Error('电子书目录为空或章节过多');let textBytes=0;const manifest=[],refs=[],pages=[];
  zip.file('mimetype','application/epub+zip');zip.file('META-INF/container.xml','<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  for(let i=0;i<spine.length;i++){session.loadAbort.signal.throwIfAborted();const chapter=await book.loadChapter(spine[i].id),raw=chapter?.html||'';textBytes+=raw.length;if(textBytes>64*1024*1024)throw Error('电子书解码正文超出安全限制');
   const clean=window.DOMPurify.sanitize(raw,{WHOLE_DOCUMENT:true,ADD_URI_SAFE_ATTR:['src'],FORBID_TAGS:['script','iframe','object','embed','form','style','link','meta','base','audio','video','svg'],FORBID_ATTR:['style','srcset']});const doc=new DOMParser().parseFromString(clean,'text/html');for(const el of doc.querySelectorAll('[src]'))if(!/^(blob:|data:image\/(png|jpeg|gif|webp);base64,)/i.test(el.getAttribute('src')||''))el.removeAttribute('src');
   for(const img of doc.querySelectorAll('img[src]'))pages.push({url:img.getAttribute('src'),chapterIndex:i,name:'第 '+(pages.length+1)+' 页'});
   const html='<html xmlns="http://www.w3.org/1999/xhtml"><head><title>章节 '+(i+1)+'</title></head>'+new XMLSerializer().serializeToString(doc.body)+'</html>';zip.file('chapter'+i+'.xhtml',html);manifest.push('<item id="c'+i+'" href="chapter'+i+'.xhtml" media-type="application/xhtml+xml"/>');refs.push('<itemref idref="c'+i+'"/>');if(i%10===0)await new Promise(r=>setTimeout(r,0));
  }
  const navigation=[],xml=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const walk=(entries,depth=0)=>{for(const entry of entries||[]){let resolved;try{resolved=book.resolveHref(entry.href);}catch{}const index=spine.findIndex(s=>s.id===resolved?.id);if(index>=0)navigation.push({label:String(entry.label||'章节 '+(index+1)),index,depth,selector:resolved.selector});if(depth<20)walk(entry.children,depth+1);}};walk(book.getToc?.());
  if(!navigation.length)for(let index=0;index<spine.length;index++)navigation.push({label:'第 '+(index+1)+' 节',index,depth:0});
  for(const [ordinal,n]of navigation.entries()){n.href='chapter'+n.index+'.xhtml';if(!n.selector)continue;try{const doc=new DOMParser().parseFromString(await zip.file(n.href).async('string'),'application/xhtml+xml'),target=doc.querySelector(n.selector);if(target){const anchor='um-toc-'+ordinal;target.id=anchor;n.href+='#'+anchor;zip.file('chapter'+n.index+'.xhtml',new XMLSerializer().serializeToString(doc));const images=[...doc.querySelectorAll('img[src]')],image=images.find(i=>i===target||target.contains(i)||(target.compareDocumentPosition(i)&4));if(image)n.page=pages.findIndex(p=>p.chapterIndex===n.index)+images.indexOf(image);}}catch{/* Malformed internal anchors fall back to their chapter. */}}
  if(session.data.type==='manga'&&comicEngine){if(!pages.length)throw Error('漫画容器中没有可读取图片');const engine=await comicEngine(session,valid,pages),dispose=engine.dispose;window.renderReaderContents(session,navigation.map(n=>({label:'　'.repeat(n.depth)+n.label,open:()=>engine.goToPage(Math.max(0,n.page??pages.findIndex(p=>p.chapterIndex===n.index)))})));engine.dispose=()=>{dispose?.();book.destroy();};return engine;}
  zip.file('nav.xhtml','<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol>'+navigation.map(n=>'<li><a href="'+xml(n.href)+'">'+xml(n.label)+'</a></li>').join('')+'</ol></nav></body></html>');manifest.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
  zip.file('book.opf','<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">local-mobi</dc:identifier><dc:title>本地电子书</dc:title><dc:language>zh</dc:language></metadata><manifest>'+manifest.join('')+'</manifest><spine>'+refs.join('')+'</spine></package>');
  const bookBytes=await zip.generateAsync({type:'arraybuffer'});if(!valid()){book.destroy();return {dispose(){}};}const engine=await epubEngine(session,valid,bookBytes),dispose=engine.dispose;engine.dispose=()=>{dispose?.();book.destroy();};return engine;
 }catch(e){book?.destroy();throw Error('电子书解码失败：'+e.message);}
}
