/* Explicit selected-text queries only. Fixed origins, no credentials or redirects. */
function installReaderLookup(ipcMain,owned,{fetcher=fetch}={}){
 const jobs=new Map(),last=new Map(),cache=new Map(),languages=new Set(['en','zh-CN','ja','ko','fr','de','es']);
 ipcMain.handle('reader:lookupCancel',event=>{owned(event);jobs.get(event.sender.id)?.abort();return true;});
 ipcMain.handle('reader:lookup',async(event,request)=>{
  const win=owned(event),owner=event.sender.id;if(!request||typeof request.text!=='string'||!request.text.trim()||Buffer.byteLength(request.text,'utf8')>500)throw Error('请输入不超过500字节的选中文字（中文约160字）');
  const detected=request.from==='auto';if(detected){const t=request.text;request={...request,from:/[\u3040-\u30ff]/.test(t)?'ja':/[\uac00-\ud7af]/.test(t)?'ko':/[\u3400-\u9fff]/.test(t)?'zh-CN':/[äöüß]/i.test(t)?'de':/[¿¡ñ]/i.test(t)?'es':/[àâçéèêëîïôùûÿœ]/i.test(t)?'fr':/\b(?:the|and|is|this|hello|world|of|to|a|you|in)\b/i.test(t)?'en':''};if(!request.from)throw Error('无法可靠自动检测短文本语言，请选择原文语言');}if(request.kind==='translate'&&request.from===request.to)return {source:'本机语言检查',text:request.text,from:request.from,to:request.to,detected};let url;if(request.kind==='dictionary'){if(!/^[a-zA-Z '-]{1,80}$/.test(request.text))throw Error('内置词典只查询英文单词');url='https://api.dictionaryapi.dev/api/v2/entries/en/'+encodeURIComponent(request.text.trim());}
  else if(request.kind==='translate'&&languages.has(request.from)&&languages.has(request.to)&&request.from!==request.to){url=new URL('https://api.mymemory.translated.net/get');url.searchParams.set('q',request.text);url.searchParams.set('langpair',request.from+'|'+request.to);url=url.href;}else throw Error('查询参数无效');
  if(cache.has(url))return cache.get(url);if(Date.now()-(last.get(owner)||0)<1000)throw Error('请稍后再查询');last.set(owner,Date.now());jobs.get(owner)?.abort();const abort=new AbortController();jobs.set(owner,abort);const timer=setTimeout(()=>abort.abort(),12000),close=()=>abort.abort();win.once('closed',close);
  try{const response=await fetcher(url,{signal:abort.signal,redirect:'error',headers:{Accept:'application/json'}});if(!response.ok)throw Error(response.status===404?'未找到释义':response.status===429?'资料源额度已用完，请稍后再试':'资料源暂不可用（'+response.status+'）');const reader=response.body.getReader();let text='';const decoder=new TextDecoder();for(;;){const {done,value}=await reader.read();if(done)break;text+=decoder.decode(value,{stream:true});if(text.length>512000){await reader.cancel();throw Error('查询结果过大');}}const data=JSON.parse(text+decoder.decode());let result;
   if(request.kind==='dictionary'){const entries=Array.isArray(data)?data:[];result={source:'Free Dictionary API',text:entries.flatMap(e=>(e.meanings||[]).flatMap(m=>(m.definitions||[]).slice(0,4).map(d=>m.partOfSpeech+' · '+d.definition+(d.example?'\n例句：'+d.example:'')))).slice(0,16).join('\n\n')};}
   else{if(Number(data.responseStatus)!==200)throw Error(String(data.responseDetails||'翻译服务额度不足或无法处理'));result={source:'MyMemory',text:String(data.responseData?.translatedText||''),from:request.from,to:request.to,detected};}
   if(!result.text)throw Error('没有匹配资料');cache.set(url,result);while(cache.size>100)cache.delete(cache.keys().next().value);return result;
  }finally{clearTimeout(timer);win.removeListener('closed',close);if(jobs.get(owner)===abort)jobs.delete(owner);}
 });
}
module.exports={installReaderLookup};
