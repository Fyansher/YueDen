export interface Rect{x:number;y:number;width:number;height:number}
export interface Target extends Rect{id:string}
interface Latch{target:string;value:number}
export interface SnapState{x?:Latch;y?:Latch}
const near=(a:number,size:number,b:number,other:number,tolerance:number)=>a<=b+other+tolerance&&a+size>=b-tolerance;
/** Visible frame rectangles in DIP. Caller supplies uncorrected cursor-derived intent. */
export function snap(raw:Rect,targets:Target[],state:SnapState={},alt=false):{bounds:Rect;state:SnapState}{
 if(alt)return {bounds:{...raw},state:{}};
 const result={...raw},next:SnapState={};
 const choose=(axis:'x'|'y',extra:{target:string;value:number}[]=[])=>{
  const other=axis==='x'?'y':'x',size=axis==='x'?'width':'height',otherSize=axis==='x'?'height':'width';
  const prior=state[axis],target=targets.find(t=>t.id===prior?.target);
  if(prior&&target&&Math.abs(raw[axis]-prior.value)<=20&&near(raw[other],raw[otherSize],target[other],target[otherSize],20)){next[axis]=prior;result[axis]=prior.value;return}
  const choices=targets.filter(t=>near(raw[other],raw[otherSize],t[other],t[otherSize],12)).flatMap(t=>[{target:t.id,value:t[axis]+t[size]},{target:t.id,value:t[axis]-raw[size]}]);
  choices.push(...extra);const best=choices.filter(c=>Math.abs(raw[axis]-c.value)<=12).sort((a,b)=>Math.abs(raw[axis]-a.value)-Math.abs(raw[axis]-b.value)||a.target.localeCompare(b.target)||a.value-b.value)[0];
  if(best){next[axis]=best;result[axis]=best.value}
 };
 choose('x');const xt=targets.find(t=>t.id===next.x?.target);
 choose('y',xt?[{target:xt.id,value:xt.y},{target:xt.id,value:xt.y+xt.height-raw.height}]:[]);
 if(!next.x&&next.y){const yt=targets.find(t=>t.id===next.y?.target);if(yt)choose('x',[{target:yt.id,value:yt.x},{target:yt.id,value:yt.x+yt.width-raw.width}])}
 return {bounds:result,state:next};
}
export function restoreBounds(raw:Partial<Rect>|undefined,areas:Rect[],defaults:Rect,minimum:{width:number;height:number}):Rect{
 const candidate={x:Number.isFinite(raw?.x)?raw!.x!:defaults.x,y:Number.isFinite(raw?.y)?raw!.y!:defaults.y,width:Number.isFinite(raw?.width)?raw!.width!:defaults.width,height:Number.isFinite(raw?.height)?raw!.height!:defaults.height};
 const overlap=(a:Rect)=>Math.max(0,Math.min(a.x+a.width,candidate.x+candidate.width)-Math.max(a.x,candidate.x))*Math.max(0,Math.min(a.y+a.height,candidate.y+candidate.height)-Math.max(a.y,candidate.y));
 const area=[...areas].sort((a,b)=>overlap(b)-overlap(a))[0]||defaults;
 const width=Math.min(area.width,Math.max(minimum.width,candidate.width)),height=Math.min(area.height,Math.max(minimum.height,candidate.height));
 return {x:Math.max(area.x,Math.min(candidate.x,area.x+area.width-width)),y:Math.max(area.y,Math.min(candidate.y,area.y+area.height-height)),width,height};
}

/** Resize only the grabbed edges; the opposite edge remains fixed. */
export function snapResize(raw:Rect,targets:Target[],edge:string,minimum:{width:number;height:number},state:SnapState={},alt=false):{bounds:Rect;state:SnapState}{
 if(alt)return {bounds:{...raw},state:{}};
 const result={...raw},next:SnapState={};
 for(const axis of ['x','y'] as const){const horizontal=axis==='x',low=horizontal?'left':'top',high=horizontal?'right':'bottom',size=horizontal?'width':'height',other=horizontal?'y':'x',otherSize=horizontal?'height':'width';if(!edge.split('-').includes(low)&&!edge.split('-').includes(high))continue;
 const leading=edge.split('-').includes(low),position=raw[axis]+(leading?0:raw[size]),opposite=raw[axis]+(leading?raw[size]:0),prior=state[axis];
 const valid=(v:number)=>leading?opposite-v>=minimum[size]:v-opposite>=minimum[size];
 const candidates=targets.filter(t=>near(raw[other],raw[otherSize],t[other],t[otherSize],20));
 const held=prior&&candidates.find(t=>t.id===prior.target)&&Math.abs(position-prior.value)<=20&&valid(prior.value)?prior:undefined;
 const choices=candidates.filter(t=>near(raw[other],raw[otherSize],t[other],t[otherSize],12)).flatMap(t=>[{target:t.id,value:t[axis]},{target:t.id,value:t[axis]+t[size]}]);
 const best=held||choices.filter(c=>Math.abs(position-c.value)<=12&&valid(c.value)).sort((a,b)=>Math.abs(position-a.value)-Math.abs(position-b.value)||a.target.localeCompare(b.target)||a.value-b.value)[0];
 if(best){next[axis]=best;if(leading){result[axis]=best.value;result[size]=opposite-best.value;}else result[size]=best.value-opposite;}
 }
 return {bounds:result,state:next};
}
