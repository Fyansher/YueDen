const {classify}=require('./cover-classifier');
const KEYS=['coverPortrait','coverLandscape','cover'];
const present=value=>typeof value==='string'&&value.trim().length>0;

function createLabels(primaryId,matches,knownEdition=false){
  const labels=new Map(),priorities=new Map([[primaryId,0]]),records=[];
  for(const [index,match] of matches.entries()){
    if(!match?.sourceId||!match.candidate)continue;
    if(match.ambiguous&&!knownEdition)continue;
    const id=String(match.sourceId);if(!priorities.has(id))priorities.set(id,index+1);
    records.push({id,candidate:match.candidate,priority:priorities.get(id)});
  }
  for(const row of records){
    for(const label of Object.values(row.candidate.fieldSources||{}))if(label)labels.set(String(label),row.id);
    for(const label of String(row.candidate.metadataSource||'').split(/\s+\+\s+/).filter(Boolean))labels.set(label,row.id);
  }
  return {labels,priorities,records};
}

async function complete(entry,matches=[],inspect=async()=>null,primaryExtras=[]){
  if(!entry||typeof entry!=='object')return entry;
  const primaryId=String(entry._sourceId||entry.sourceId||''),{labels,priorities,records}=createLabels(primaryId,matches,Boolean(entry.isbn));
  const result={...entry,fieldSources:{...(entry.fieldSources||{})}};
  const slotPriority={portrait:Infinity,landscape:Infinity},slotFailed={portrait:false,landscape:false};
  const coverSource=labels.get(String(result.fieldSources.cover||''))||primaryId;
  let coverPriority=priorities.get(coverSource)??0,coverFailed=false;
  const sourceFor=(candidate,key,fallback)=>{
    const label=candidate.fieldSources?.[key];return label&&(labels.get(String(label))||String(label)===String(candidate.metadataSource||'')&&fallback)?(labels.get(String(label))||fallback):fallback;
  };
  for(const key of ['coverPortrait','coverLandscape'])if(present(result[key])){
    const label=result.fieldSources[key],source=labels.get(String(label||''))||primaryId;
    slotPriority[key==='coverPortrait'?'portrait':'landscape']=priorities.get(source)??(source===primaryId?0:Infinity);
  }

  const allRecords=[{id:primaryId,candidate:entry,priority:0,merged:true},...primaryExtras.filter(Boolean).map(candidate=>({id:primaryId,candidate,priority:0})),...records];
  const imageRows=[];
  for(const row of allRecords)for(const key of KEYS){
    const url=row.candidate[key];if(!present(url))continue;
    const sourceId=row.merged?sourceFor(row.candidate,key,row.id):row.id;
    const priority=priorities.get(sourceId)??row.priority;
    imageRows.push({url,key,candidate:row.candidate,sourceId,priority});
  }
  imageRows.sort((a,b)=>a.priority-b.priority||KEYS.indexOf(a.key)-KEYS.indexOf(b.key));
  const seen=new Set(),checked=new Map(),orientationByUrl=new Map();let attempts=0;
  for(const row of imageRows){
    if(seen.has(row.url)){
      const orientation=orientationByUrl.get(row.url);
      if(row.key==='cover'&&result.cover===row.url&&['portrait','landscape'].includes(orientation))result.cover='';
      continue;
    }
    seen.add(row.url);
    const hint=row.key==='coverPortrait'?'portrait':row.key==='coverLandscape'?'landscape':'';
    const currentDimension=row.url===row.candidate.cover?row.candidate.coverDimensions:null;
    let detail=currentDimension?.width>0&&currentDimension?.height>0?{dimensions:currentDimension}:checked.get(row.url);
    if(!detail&&attempts<8){attempts++;try{detail=await inspect(row.url); }catch{detail=null;}checked.set(row.url,detail||null);}
    if(!detail){if(hint&&row.url===result[row.key])slotFailed[hint]=true;if(row.key==='cover'&&row.url===result.cover)coverFailed=true;continue;}
    const dimensions=detail.dimensions||null,orientation=classify(dimensions?.width,dimensions?.height)||row.candidate.coverOrientation||hint;
    orientationByUrl.set(row.url,orientation);
    const target=orientation==='portrait'?'portrait':orientation==='landscape'?'landscape':'';
    if(!target){
      if(orientation==='square'&&(!present(result.cover)||coverFailed||row.priority<coverPriority)){
        if(row.key!=='cover'&&result[row.key]===row.url)result[row.key]='';
        result.cover=row.url;result.coverDimensions=dimensions;result.coverOrientation='square';
        result.fieldSources.cover=row.candidate.fieldSources?.[row.key]||row.candidate.metadataSource||row.sourceId||'';
        coverPriority=row.priority;coverFailed=false;
        const labelsToAdd=String(result.fieldSources.cover||'').split(/\s+\+\s+/).filter(Boolean),combined=String(result.metadataSource||'').split(/\s+\+\s+/).filter(Boolean);
        for(const label of labelsToAdd)if(label&&!combined.includes(label))combined.push(label);
        result.metadataSource=combined.join(' + ');
      }
      continue;
    }
    const targetKey=target==='portrait'?'coverPortrait':'coverLandscape',current=result[targetKey];
    const currentPriority=slotPriority[target];
    const canReplace=!present(current)||slotFailed[target]||row.priority<currentPriority;
    if(canReplace){
      if(row.key==='cover'&&result.cover===row.url)result.cover='';
      if(row.key!==targetKey&&result[row.key]===row.url&&row.key!=='cover')result[row.key]='';
      result[targetKey]=row.url;
      result.fieldSources[targetKey]=row.candidate.fieldSources?.[row.key]||row.candidate.metadataSource||row.sourceId||'';
      slotPriority[target]=row.priority;slotFailed[target]=false;
      const labelsToAdd=String(result.fieldSources[targetKey]||'').split(/\s+\+\s+/).filter(Boolean),combined=String(result.metadataSource||'').split(/\s+\+\s+/).filter(Boolean);
      for(const label of labelsToAdd)if(label&&!combined.includes(label))combined.push(label);
      result.metadataSource=combined.join(' + ');
    }
    if(row.key==='cover'&&result.cover===row.url)result.cover='';
  }
  return result;
}

module.exports={complete};
