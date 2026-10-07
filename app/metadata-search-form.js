const Html=require('./metadata-html');

const QUERY_NAME=/^(?:q|query|keyword|search|title|term)$/i;

function safeFormAction(value,base){
  try{
    const target=new URL(value||base,base),origin=new URL(base);
    return target.protocol==='https:'&&target.origin===origin.origin&&!target.username&&!target.password&&!target.port?target:null;
  }catch{return null;}
}

/* Build a same-origin GET search URL from the source's own form. Hidden values
   (including CSRF tokens) stay in memory and are never passed to diagnostics. */
function buildGetSearchUrl(page,query,base,stats={}){
  const forms=[...String(page||'').matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)];
  stats.formCount=forms.length;stats.searchFormCandidateCount=0;
  for(const match of forms){
    const form=Html.attributes('<form '+match[1]+'>');
    if(String(form.method||'get').toLowerCase()!=='get')continue;
    const inputs=[...match[2].matchAll(/<input\b[^>]*>/gi)].map(input=>({tag:input[0],...Html.attributes(input[0])}));
    const queryInput=inputs.find(input=>input.name&&/^(?:text|search)$/i.test(input.type||'text')&&QUERY_NAME.test(input.name))
      ||inputs.find(input=>input.name&&/^(?:text|search)$/i.test(input.type||''));
    if(!queryInput)continue;
    const target=safeFormAction(form.action||base,base);if(!target)continue;
    stats.searchFormCandidateCount++;
    for(const input of inputs){
      const name=String(input.name||'').trim(),type=String(input.type||'text').toLowerCase();
      if(!name||/^(?:button|submit|reset|image|file|password)$/i.test(type))continue;
      if(input===queryInput){target.searchParams.set(name,String(query||'').trim().slice(0,240));continue;}
      if(type==='hidden')target.searchParams.set(name,String(input.value||''));
      else if((type==='checkbox'||type==='radio')&&/(?:^|\s)checked(?=\s|=|\/?>|$)/i.test(input.tag))target.searchParams.append(name,String(input.value||'on'));
    }
    for(const selectMatch of match[2].matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)){
      const select=Html.attributes('<select '+selectMatch[1]+'>'),name=String(select.name||'').trim();if(!name)continue;
      const options=[...selectMatch[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map(option=>({attrs:Html.attributes('<option '+option[1]+'>'),text:Html.text(option[2])}));
      const selected=options.filter(option=>Object.prototype.hasOwnProperty.call(option.attrs,'selected'));
      const values=selected.length?selected:options.slice(0,1);for(const option of values)target.searchParams.append(name,String(option.attrs.value??option.text));
    }
    target.hash='';return target.href;
  }
  return '';
}

module.exports={buildGetSearchUrl,safeFormAction};
