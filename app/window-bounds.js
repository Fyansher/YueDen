/* Persist normal bounds separately from settings; clamp against current work areas. */
function restore(saved,displays){
 const areas=displays.map(d=>d.workArea).filter(r=>r&&r.width>0&&r.height>0);if(!areas.length)areas.push({x:0,y:0,width:1500,height:960});
 const finite=v=>Number.isFinite(Number(v)),raw=saved?.bounds||{},valid=['x','y','width','height'].every(k=>finite(raw[k]));
 const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
 const area=valid?[...areas].sort((a,b)=>overlap(raw,b)-overlap(raw,a))[0]:areas[0],minWidth=Math.min(1120,area.width),minHeight=Math.min(700,area.height),width=Math.round(Math.min(area.width,Math.max(minWidth,valid?raw.width:1500))),height=Math.round(Math.min(area.height,Math.max(minHeight,valid?raw.height:960)));
 const x=Math.round(Math.max(area.x,Math.min(area.x+area.width-width,valid?raw.x:area.x+(area.width-width)/2))),y=Math.round(Math.max(area.y,Math.min(area.y+area.height-height,valid?raw.y:area.y+(area.height-height)/2)));
 return {x,y,width,height,minWidth,minHeight,maximized:Boolean(saved?.maximized)};
}
function install(win,{screen,read,write}){
 let timer;const persist=()=>{clearTimeout(timer);if(win.isDestroyed()||win.isMinimized())return;write({bounds:win.getNormalBounds(),maximized:win.isMaximized()});};
 const schedule=()=>{clearTimeout(timer);timer=setTimeout(persist,350);};
 for(const event of ['move','resize','maximize','unmaximize'])win.on(event,schedule);win.on('close',persist);win.once('closed',()=>clearTimeout(timer));
 const adjust=()=>{if(win.isDestroyed()||win.isMaximized())return;const safe=restore({bounds:win.getBounds()},screen.getAllDisplays());win.setBounds({x:safe.x,y:safe.y,width:safe.width,height:safe.height});};
 screen.on('display-removed',adjust);win.once('closed',()=>screen.removeListener('display-removed',adjust));
}
module.exports={restore,install};
