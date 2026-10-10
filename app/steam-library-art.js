const APPID=/^\d{1,12}$/;
const ASSET_FIELDS=['library_capsule_2x','library_600x900_2x','library_capsule','library_600x900'];

function requestUrl(appid, country='HK', language='schinese'){
  const ids=[...new Set((Array.isArray(appid)?appid:[appid]).map(value=>String(value||'')).filter(value=>APPID.test(value)))];if(!ids.length)return '';
  const input={ids:ids.map(id=>({appid:Number(id)})),context:{country_code:country,language},data_request:{include_assets:true}};
  return 'https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json='+encodeURIComponent(JSON.stringify(input));
}

function legacyPortraitAppId(values){
  for(const value of Array.isArray(values)?values:[values])try{
    const url=new URL(String(value||''));
    if(!/^https:$/.test(url.protocol)||!/(?:^|\.)(?:cdn\.(?:akamai|cloudflare)\.steamstatic\.com|steamcdn-[a-z]\.akamaihd\.net)$/i.test(url.hostname))continue;
    const id=url.pathname.match(/^\/steam\/apps\/(\d+)\/library_600x900(?:_2x)?\.jpg$/i)?.[1];if(id)return id;
  }catch{}
  return '';
}

function assetUrl(format,file,id){
  const path=format.replace(/\$\{FILENAME\}|\{FILENAME\}|%\$?s/gi,()=>file).replace(/\$\{APPID\}|\{APPID\}/gi,id);
  try{const url=new URL(path,'https://shared.akamai.steamstatic.com/store_item_assets/').href;return /^https:\/\//i.test(url)&&!/(?:\$\{?FILENAME\}?|%\$?s)/i.test(url)?url:'';}catch{return '';}
}

function portraitCandidatesFromItem(item,id){
  if(!item)return [];
  const assets=item.assets||{},format=String(assets.asset_url_format||'').trim(),result=[],derived=[],seen=new Set();
  for(const field of ASSET_FIELDS){
    const file=String(assets[field]||'').trim();if(!file)continue;
    let url='';
    if(/^https:\/\//i.test(file)){
      // Prefer the current asset template even if a legacy absolute URL was
      // returned in the filename field. Never emit the retired flat URL itself.
      const legacyId=legacyPortraitAppId(file);
      if(legacyId){if(legacyId!==String(id))continue;const filename=new URL(file).pathname.split('/').pop();url=format&&filename?assetUrl(format,filename,id):'';if(url&&!seen.has(url)){derived.push(url);seen.add(url);}continue;}
      else url=file;
    }else if(format){
      url=assetUrl(format,file,id);
    }
    if(url&&/^https:\/\//i.test(url)&&!/(?:\$\{?FILENAME\}?|%\$?s)/i.test(url)&&!seen.has(url)){result.push(url);seen.add(url);}
  }
  return [...result,...derived];
}

function portraitCandidates(payload, appids){
  const ids=[...new Set((Array.isArray(appids)?appids:[appids]).map(value=>String(value||'')).filter(value=>APPID.test(value)))],result=new Map();if(!ids.length)return result;
  const response=payload?.response||payload||{},items=Array.isArray(response.store_items)?response.store_items:Array.isArray(response.items)?response.items:[];
  for(const id of ids){const item=items.find(value=>String(value?.appid||value?.id||'')===id)||(ids.length===1?items[0]:null);result.set(id,portraitCandidatesFromItem(item,id));}
  return result;
}

function portraitUrls(payload, appids){const result=new Map();for(const [id,urls] of portraitCandidates(payload,appids))result.set(id,urls[0]||'');return result;}
function portraitUrl(payload, appid){const id=String(appid||'');return APPID.test(id)?(portraitUrls(payload,id).get(id)||''):'';}

module.exports={requestUrl,portraitUrl,portraitUrls,portraitCandidates,legacyPortraitAppId};
