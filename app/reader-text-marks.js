/* Restore plain-text/PDF quote marks in the current rendered member; never modify source files. */
function applyReaderTextMarks(session){
 if(!CSS.highlights||!window.Highlight||!$('readerViewport'))return;
 const host=$('readerViewport'),walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT),nodes=[];let text='',node;
 while(node=walker.nextNode()){if(node.parentElement.closest('script,style,button,figcaption'))continue;nodes.push({node,start:text.length});text+=node.textContent;}
 const highlights={highlight:new Highlight(),underline:new Highlight()};
 const position=session.positions[readerFileKey(session.file)]||{};
 for(const mark of session.bookmarks){if(mark.member!==readerFileKey(session.file)||!highlights[mark.annotation]||!mark.quote||mark.position?.cfi)continue;if(mark.position?.page!=null&&mark.position.page!==position.page)continue;const start=text.indexOf(mark.quote);if(start<0)continue;const end=start+mark.quote.length,first=nodes.find(n=>n.start+n.node.length>start),last=[...nodes].reverse().find(n=>n.start<end);if(!first||!last)continue;const range=document.createRange();range.setStart(first.node,start-first.start);range.setEnd(last.node,end-last.start);highlights[mark.annotation].add(range);}
 for(const [name,ranges]of Object.entries(highlights))CSS.highlights.set('reader-'+name,ranges);
}
