const TROPHY_MARK = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3h8v6a4 4 0 0 1-8 0V3Zm0 2H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4M12 13v5m-4 3h8m-7-3h6v3H9z"/></svg>';
function cardStatusMarkup(item) { if(item.type==='audio')return '';
  const status = StatusModel.normalize(item.status, item.type);
  if (item.type === 'game' && status === '全成就') return '<span class="status-pill achievement-seal" data-status-phase="mastered" role="img" aria-label="全成就" title="全成就 · 每一份坚持都值得被看见">' + TROPHY_MARK + '</span>';
  return '<span class="status-pill" data-status-phase="' + StatusModel.phase(status) + '">' + esc(status) + '</span>';
}
function editorPlatformRating() {
  return RatingModel.parse({...getEditorMetadata(),externalRating:valueFor('fieldExternalRating'),storeUrl:valueFor('fieldStoreUrl'),steamAppId:valueFor('fieldSteamAppId'),platforms:editorMetadata.platforms},$('fieldType').value);
}
function renderPlatformRating(force = false) {
  const host=$('platformRatingDisplay');if(!host)return;const info=editorPlatformRating();
  $('platformRatingLabel').textContent=info.source?info.source+' 评分':'平台评分';
  host.dataset.mode=info.mode;host.dataset.angle=info.ratio===null?'':String(info.ratio*180);
  const input=$('platformRatingValue');if(force||document.activeElement!==input)input.value=info.mode==='empty'&&!info.raw?'':info.display;
  input.title=editorMetadata.ratingEdited?'手动调整的平台评分':'点击直接编辑评分';
  const tier=info.source==='Steam' ? (editorMetadata.ratingEdited&&info.ratio!==null?RatingModel.tierFor(info.ratio):RatingModel.tier(info.raw)) : '';
  $('platformRatingDetail').textContent=info.mode==='numeric'&&tier?(editorMetadata.ratingEdited?'手动 · ':'')+tier:'';
  $('platformRatingDetail').classList.toggle('hidden',!$('platformRatingDetail').textContent);
  host.dataset.steamTier = String(info.source==='Steam' && info.mode==='numeric' && Boolean(tier));
  const needle=$('platformRatingNeedle'),angle=(info.ratio||0)*Math.PI;
  needle.style.opacity=info.ratio===null?'0':'1';needle.setAttribute('x2',String(76-51*Math.cos(angle)));needle.setAttribute('y2',String(72-51*Math.sin(angle)));
  const maximum=info.max||RatingModel.scale(info.source)||10;
  $('gaugeLow').textContent='0';$('gaugeHigh').textContent=String(maximum);
  const gauge=$('platformRatingGauge');gauge.setAttribute('aria-label',(info.source||'平台')+'评分，可拖动调整');gauge.setAttribute('aria-valuemin','0');gauge.setAttribute('aria-valuemax',String(maximum));gauge.setAttribute('aria-valuenow',String(info.value??0));gauge.setAttribute('aria-valuetext',info.display);
}
function setPlatformValue(value, maximum) {
  const info=editorPlatformRating(),source=info.source;
  const number=Math.max(0,Math.min(maximum,Math.round(value*10)/10));
  editorMetadata.ratingValue=number;editorMetadata.ratingMax=maximum;editorMetadata.ratingSource=source;editorMetadata.ratingEdited=true;
  const numeric=source==='Steam'?number+'%':number+' / '+maximum;
  const tier=source==='Steam'?RatingModel.tierFor(number/maximum):'';
  $('fieldExternalRating').value=tier?tier+' · '+numeric:numeric;
  editorMetadata.fieldSources={...editorMetadata.fieldSources,externalRating:source||'手动'};
  renderPlatformRating(true);$('fieldExternalRating').dispatchEvent(new Event('input',{bubbles:true}));
}
function installEditorPolish() {
  const input=$('platformRatingValue');let initial=null;
  input.addEventListener('focus',()=>{initial={raw:valueFor('fieldExternalRating'),metadata:structuredClone(editorMetadata)};});
  input.addEventListener('input',()=>{
    const previous=editorPlatformRating();$('fieldExternalRating').value=input.value.trim();
    editorMetadata.ratingValue=null;editorMetadata.ratingMax=previous.max||RatingModel.scale(previous.source)||10;
    editorMetadata.ratingSource=RatingModel.source({externalRating:input.value,ratingSource:previous.source});
    editorMetadata.ratingEdited=true;editorMetadata.fieldSources={...editorMetadata.fieldSources,externalRating:editorMetadata.ratingSource||'手动'};
    renderPlatformRating();$('fieldExternalRating').dispatchEvent(new Event('input',{bubbles:true}));
  });
  input.addEventListener('blur',()=>renderPlatformRating(true));
  input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();input.blur();}if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(initial){$('fieldExternalRating').value=initial.raw;editorMetadata=initial.metadata;renderPlatformRating(true);updateEditorSaveCue(false);}input.blur();}});
  $('fieldExternalRating').addEventListener('input',()=>renderPlatformRating());
  const gauge=$('platformRatingGauge');let pointer=null;
  const drag=event=>{
    const matrix=gauge.getScreenCTM?.();let point;
    if(matrix&&window.DOMPoint)point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
    else {const r=gauge.getBoundingClientRect(),scale=Math.min(r.width/152,r.height/97);point={x:(event.clientX-r.left-(r.width-152*scale)/2)/scale,y:(event.clientY-r.top-(r.height-97*scale)/2)/scale};}
    const ratio=Math.atan2(Math.max(0,72-point.y),76-point.x)/Math.PI,info=editorPlatformRating(),max=info.max||RatingModel.scale(info.source)||10;
    setPlatformValue(ratio*max,max);
  };
  gauge.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();pointer=event.pointerId;gauge.focus({preventScroll:true});try{gauge.setPointerCapture(pointer);}catch{}hostDragging(true);drag(event);});
  document.addEventListener('pointermove',event=>{if(pointer!==null&&event.pointerId===pointer){event.preventDefault();drag(event);}},{capture:true});
  const finish=event=>{if(event.pointerId!==pointer)return;pointer=null;hostDragging(false);try{gauge.releasePointerCapture(event.pointerId);}catch{}};
  document.addEventListener('pointerup',finish,true);document.addEventListener('pointercancel',finish,true);window.addEventListener('blur',()=>{pointer=null;hostDragging(false);});
  function hostDragging(enabled){$('platformRatingDisplay').classList.toggle('gauge-dragging',enabled);}
  gauge.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowDown','ArrowRight','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();
    const info=editorPlatformRating(),max=info.max||RatingModel.scale(info.source)||10,delta=max===100?1:.1;
    setPlatformValue(event.key==='Home'?0:event.key==='End'?max:(info.value||0)+(['ArrowRight','ArrowUp'].includes(event.key)?delta:-delta),max);
  });
}
