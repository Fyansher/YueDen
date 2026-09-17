import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PlayerSession, prepareAppend } from './session';
import { MpvBackend } from './mpv-backend';
import { NativeSurface } from './surface';
import { validateCommand, type PlayerState, type QueueEntry } from './contracts';
import { loadLyrics, fromText, type Lyrics } from './lyrics';
import { filter, type Equalizer } from './equalizer';
import { importLegacy } from './legacy';
import {windowControl} from './window-controls';
import {auxVisible} from './visibility';
import {attach,follow} from './attachments';
import { snap, snapResize, restoreBounds, type SnapState } from './snap';
type Kind='main'|'lyrics'|'queue'|'eq'|'lyricsSearch';
const sizes:Record<Kind,number[]>={main:[1024,640,640,400],lyrics:[440,540,300,240],queue:[420,560,320,260],eq:[640,320,360,240],lyricsSearch:[620,580,360,360]};
const titles={main:'媒体播放器 · 悦森盒 YueDen',lyrics:'歌词 · 悦森盒 YueDen',queue:'播放列表 · 悦森盒 YueDen',eq:'均衡器 · 悦森盒 YueDen',lyricsSearch:'搜索歌词 · 悦森盒 YueDen'};
const emptyLyrics=():Lyrics=>({status:'none',lines:[],message:'没有当前媒体'});
export function createPlayerService({electron,ipcMain,loadLibrary,dataRoot,disguised,localServices,audioLyrics=()=>null,appearance=()=>({}),audioPlayback=()=>null,quickEscape=()=>false,usage,snapshotLibrary=loadLibrary}:any){
  const {BrowserWindow,screen,dialog}=electron;
  const root=path.resolve(__dirname,'..'),appRoot=path.resolve(root,'..');
  const store=require('../../reader-progress-store').createProgressStore(()=>path.join(dataRoot(),'player-state.json'));
  let settings:any={schema:1,queue:[],currentId:null,volume:80,muted:false,context:'video',contexts:{},positions:{},layouts:{},visible:{lyrics:false,queue:false,eq:false},eq:{enabled:false,gains:Array(10).fill(0)},manualLyrics:{},bookmarks:[],repeat:'none',shuffle:false};
  const lyricJob=require('../../player-lyrics-job').create();
  let settingsError='';
  try{const saved=store.read().player;if(saved){if(saved.schema!==1||!saved.positions||!saved.contexts||!saved.layouts||!saved.visible)throw Error('播放器配置版本或结构无效');filter(saved.eq);settings={...settings,...saved}}}catch(error){settingsError=String(error)}
  const windows=new Map<Kind,any>();let session:PlayerSession|null=null,backend:MpvBackend|null=null,surface:NativeSurface|null=null;
  let alt=false,mouseDown=false,drag:any=null,resizing:any=null;const insets=new Map<string,number[]>();
  const suppressed={minimized:false,fullscreen:false};
  let creating:Promise<void>|null=null,closing:Promise<void>|null=null,poll:ReturnType<typeof setInterval>|null=null;
  let lyrics=emptyLyrics(),lyricsGeneration=-1,viewRevision=0,sleepDeadline=0,sleepAtEnd=false,priorStatus='',lastSaved=0,lastError='',tracks:any[]=[];
  const key=(entry:QueueEntry)=>JSON.stringify([entry.resourceId||'',entry.memberId||entry.path]);
  const remember=async()=>{if(settingsError)throw Error(settingsError);if(session){const s=session.snapshot();settings.queue=s.queue;settings.currentId=s.currentId;settings.volume=s.volume;settings.muted=s.muted;}await store.save('player',settings)};
  const lyricView=()=>{const s=session?.snapshot(),entry=s?.queue.find(e=>e.queueEntryId===s.currentId);return {...{zoom:100,align:"center"},...settings.lyricView,offset:entry?settings.lyricOffsets?.[key(entry)]||0:0}};
  let queueNotice='';
  let cleanPlan:any=null;
  const snapshot=()=>({...(session?.snapshot()||{queue:settings.queue,currentId:settings.currentId,status:'idle',position:0,duration:0,volume:settings.volume,muted:settings.muted,generation:0}),queue:require('../../player-library').queueMetadata(snapshotLibrary(),session?.snapshot().queue||settings.queue),context:settings.context,allowDuplicates:settings.allowDuplicates!==false,queueNotice,viewRevision:++viewRevision,appearance:appearance(),windowState:Object.fromEntries([...windows].filter(([,w])=>!w.isDestroyed()).map(([k,w])=>[k,{maximized:w.isMaximized(),fullscreen:w.isFullScreen()}])),lyrics,lyricView:lyricView(),eq:settings.eq,visible:settings.visible,error:lastError||session?.snapshot().error||settingsError,bookmarks:settings.bookmarks,sleepDeadline,sleepAtEnd,repeat:settings.repeat,shuffle:settings.shuffle,tracks,rate:settings.rate||1});
  const usageTimeline=usage?.timeline(()=>{const s=session?.snapshot(),entry=s?.queue.find(e=>e.queueEntryId===s.currentId);if(!entry?.resourceId||!s||!['playing','paused','loading'].includes(s.status))return null;return {id:entry.resourceId,generation:s.generation,position:s.position,playing:s.status==='playing',active:[...windows.values()].some(w=>!w.isDestroyed()&&w.isVisible()&&!w.isMinimized()&&w.isFocused())};});
  const flushUsage=()=>usageTimeline?.flush().catch((error:any)=>{lastError='时长记录未保存：'+error.message;broadcast()});
  const broadcast=()=>{const value=snapshot();windows.get('main')?.umTaskbar?.update(value);for(const win of BrowserWindow.getAllWindows())if(!win.isDestroyed()&& (windows.has(win.umPlayerKind)||win.webContents.getURL().startsWith('file:')&&win.webContents.getURL().endsWith('/index.html')))win.webContents.send('player:state',value)};
  const visible=()=>{const main=windows.get('main');return auxVisible({exists:!!main&&!main.isDestroyed(),shown:!!main&&!main.isDestroyed()&&main.isVisible(),minimized:suppressed.minimized||!!main&&!main.isDestroyed()&&main.isMinimized(),fullscreen:suppressed.fullscreen||!!main&&!main.isDestroyed()&&main.isFullScreen()},true)};
  const applyVisibility=()=>{for(const kind of ['lyrics','queue','eq'] as Kind[]){const win=windows.get(kind);if(win&&!win.isDestroyed()){if(settings.visible[kind]&&visible()){if(!win.isVisible())win.showInactive();}else if(win.isVisible())win.hide()}}broadcast()};
  const fit=(bounds:any,kind:Kind)=>{const s=sizes[kind],area=screen.getPrimaryDisplay().workArea;return restoreBounds(bounds,screen.getAllDisplays().map((d:any)=>d.workArea),{x:area.x+40,y:area.y+40,width:s[0]!,height:s[1]!},{width:s[2]!,height:s[3]!})};
  const frame=(win:any,bounds:any)=>{const handle=win.getNativeWindowHandle().readBigUInt64LE().toString(),scale=screen.getDisplayMatching(bounds).scaleFactor,[l,t,r,b,w,h]=(insets.get(handle)||[0,0,0,0]).map(v=>v/scale);return {x:bounds.x,y:bounds.y,width:(w||bounds.width)-l!-r!,height:(h||bounds.height)-t!-b!,left:l!,top:t!}};
  let following=false,restoring=false;
  const displayKey=(bounds:any)=>{const d=screen.getDisplayMatching(bounds);return JSON.stringify([d.id,d.bounds,d.scaleFactor]);};
  const captureLayout=async(kind:Kind,win:any)=>{if(win.isDestroyed()||restoring)return;const bounds=win.getNormalBounds(),old=settings.layouts[kind],layout={...bounds,maximized:win.isMaximized(),fullscreen:win.isFullScreen(),nativeBounds:old&&(["x","y","width","height"] as const).every(k=>bounds[k]===old[k])?old.nativeBounds:undefined,display:old?.display};
    if(surface&&!win.isMaximized()&&!win.isFullScreen()&&!win.isMinimized()){const nativeBounds=await surface.measure(win.getNativeWindowHandle().readBigUInt64LE().toString());if(win.isDestroyed()||JSON.stringify(win.getNormalBounds())!==JSON.stringify(bounds)||win.isMaximized()||win.isFullScreen())return;layout.nativeBounds=nativeBounds;layout.display=displayKey(bounds);}settings.layouts[kind]=layout;
  };
  const captureLayouts=async()=>{for(const [kind,win]of windows)await captureLayout(kind,win);};
  const placeWindow=async(kind:Kind,win:any,reveal=true)=>{const bounds=fit(settings.layouts[kind],kind),display=screen.getDisplayMatching(bounds),origin=screen.dipToScreenPoint({x:display.bounds.x,y:display.bounds.y}),scale=display.scaleFactor;const stored=settings.layouts[kind],raw=stored?.nativeBounds,same=raw?.length===4&&raw.every(Number.isFinite)&&raw[2]>0&&raw[3]>0&&stored.display===displayKey(bounds)&&(["x","y","width","height"] as const).every(k=>bounds[k]===stored[k]);if(same)await surface!.place(win.getNativeWindowHandle().readBigUInt64LE().toString(),raw[0],raw[1],raw[2],raw[3]);else await surface!.place(win.getNativeWindowHandle().readBigUInt64LE().toString(),origin.x+Math.floor((bounds.x-display.bounds.x)*scale),origin.y+Math.floor((bounds.y-display.bounds.y)*scale),Math.ceil((bounds.x-display.bounds.x+bounds.width)*scale)-Math.floor((bounds.x-display.bounds.x)*scale),Math.ceil((bounds.y-display.bounds.y+bounds.height)*scale)-Math.floor((bounds.y-display.bounds.y)*scale));win.umStableSize=win.getSize();if(reveal){if(settings.layouts[kind]?.maximized)win.maximize();if(settings.layouts[kind]?.fullscreen)win.setFullScreen(true);}else win.umDeferredWindowState=true;};
  const followAttachments=()=>{const main=windows.get('main');if(restoring||following||resizing||!main||main.isDestroyed()||main.isMinimized()||main.isMaximized()||main.isFullScreen())return;following=true;try{const anchor=frame(main,main.getBounds());for(const [kind,win]of windows){const a=settings.attachments?.[kind];if(kind==='main'||kind==='lyricsSearch'||!a||win.isDestroyed()||win.isMaximized()||win.isFullScreen())continue;const child=frame(win,win.getBounds()),next=follow(anchor,child,a);const position=screen.dipToScreenPoint({x:Math.round(next.x-child.left),y:Math.round(next.y-child.top)}),handle=win.getNativeWindowHandle().readBigUInt64LE().toString(),scale=screen.getDisplayMatching(win.getBounds()).scaleFactor,native=insets.get(handle);if(surface)surface.move(handle,position.x,position.y,native?.[4]||Math.round(win.getBounds().width*scale),native?.[5]||Math.round(win.getBounds().height*scale));}}finally{following=false;}};
  const captureAttachment=(kind:Kind,win:any)=>{if(kind==='main'||kind==='lyricsSearch'||win.isFullScreen()||following||drag?.win!==win)return;const main=windows.get('main');if(!main||main.isMaximized()||main.isFullScreen())return;settings.attachments||={};const a=alt?null:attach(frame(main,main.getBounds()),frame(win,win.getBounds()));if(a)settings.attachments[kind]=a;else delete settings.attachments[kind];};
  const moveWithSnap=()=>{if(!drag||drag.win.isDestroyed())return;const nativePointer=surface?.modifiers();if(!nativePointer?.down){drag=null;return;}alt=nativePointer.alt;const cursor=screen.getCursorScreenPoint(),raw={...drag.origin,x:drag.origin.x+cursor.x-drag.cursor.x,y:drag.origin.y+cursor.y-drag.cursor.y},sourceFrame=frame(drag.win,raw),source={...sourceFrame,x:sourceFrame.x+sourceFrame.left,y:sourceFrame.y+sourceFrame.top};const targets=[...windows.values()].filter(w=>w!==drag.win&&w.umPlayerKind!=='lyricsSearch'&&!(drag.win.umPlayerKind==='main'&&settings.attachments?.[w.umPlayerKind])&&!w.isDestroyed()&&w.isVisible()&&!w.isMinimized()&&!w.isFullScreen()).map(w=>({...frame(w,w.getBounds()),id:String(w.id)}));const result=snap(source,targets,drag.state,alt);drag.state=result.state;if(process.env.UM_PLAYER_SNAP_TRACE==='1'){drag.win.umSnapTrace||=[];drag.win.umSnapTrace.push({raw,source,targets,result,alt});if(drag.win.umSnapTrace.length>40)drag.win.umSnapTrace.shift()}const point=screen.dipToScreenPoint({x:Math.round(result.bounds.x-source.left),y:Math.round(result.bounds.y-source.top)});const display=screen.getDisplayMatching(raw),origin=screen.dipToScreenPoint({x:display.bounds.x,y:display.bounds.y}),scale=display.scaleFactor,dipSize=drag.dipSize;const width=Math.floor((Math.floor((point.x-origin.x)/scale)+dipSize[0])*scale)-(point.x-origin.x),height=Math.floor((Math.floor((point.y-origin.y)/scale)+dipSize[1])*scale)-(point.y-origin.y);surface?.dragMove(drag.gesture,drag.win.getNativeWindowHandle().readBigUInt64LE().toString(),point.x,point.y,width,height)};
  const resizeWithSnap=()=>{
    if(!resizing||resizing.win.isDestroyed())return;const {win,origin,cursor,edge,gesture}=resizing,native=surface?.modifiers();if(!native?.down||native.gesture!==gesture){resizing=null;return;}
    const at=screen.getCursorScreenPoint(),dx=at.x-cursor.x,dy=at.y-cursor.y,raw={...origin};
    if(edge.includes('left')){raw.x+=dx;raw.width-=dx;}if(edge.includes('right'))raw.width+=dx;if(edge.includes('top')){raw.y+=dy;raw.height-=dy;}if(edge.includes('bottom'))raw.height+=dy;
    const size=sizes[win.umPlayerKind as Kind];if(raw.width<size[2]!){if(edge.includes('left'))raw.x=origin.x+origin.width-size[2]!;raw.width=size[2]!;}if(raw.height<size[3]!){if(edge.includes('top'))raw.y=origin.y+origin.height-size[3]!;raw.height=size[3]!;}
    const scale=screen.getDisplayMatching(raw).scaleFactor,handle=win.getNativeWindowHandle().readBigUInt64LE().toString(),margins=(insets.get(handle)||[0,0,0,0]).slice(0,4).map(v=>v/scale),[l,t,r,b]=margins;
    const visibleRect={x:raw.x+l!,y:raw.y+t!,width:raw.width-l!-r!,height:raw.height-t!-b!};
    const targets=[...windows.values()].filter(w=>w!==win&&!w.isDestroyed()&&w.isVisible()&&!w.isMinimized()&&!w.isMaximized()&&!w.isFullScreen()).map(w=>{const bounds=w.getBounds(),scale=screen.getDisplayMatching(bounds).scaleFactor,data=insets.get(w.getNativeWindowHandle().readBigUInt64LE().toString());if(data?.length===8){const point=screen.screenToDipPoint({x:data[6]!+data[0]!,y:data[7]!+data[1]!});return {id:String(w.id),...point,width:(data[4]!-data[0]!-data[2]!)/scale,height:(data[5]!-data[1]!-data[3]!)/scale};}return {id:String(w.id),...bounds};});
    const result=snapResize(visibleRect,targets,edge,{width:size[2]!-l!-r!,height:size[3]!-t!-b!},resizing.state,native.alt);resizing.state=result.state;
    const bounds={x:result.bounds.x-l!,y:result.bounds.y-t!,width:result.bounds.width+l!+r!,height:result.bounds.height+t!+b!},start=screen.dipToScreenPoint({x:Math.round(bounds.x),y:Math.round(bounds.y)}),end=screen.dipToScreenPoint({x:Math.round(bounds.x+bounds.width),y:Math.round(bounds.y+bounds.height)});
    surface?.resize(gesture,handle,start.x,start.y,end.x-start.x,end.y-start.y);
    if(process.env.UM_PLAYER_SNAP_TRACE==='1'){win.umResizeTrace||=[];win.umResizeTrace.push({raw,edge,result,alt:native.alt});if(win.umResizeTrace.length>60)win.umResizeTrace.shift();}
  };
  const failedWindow=(reason:string)=>{lastError=reason;surface?.immersive(false);surface?.hide();const main=windows.get('main');if(main&&!main.isDestroyed())main.hide();void close().catch(error=>{lastError=reason+'：'+String(error);broadcast()});};
  const make=async(kind:Kind)=>{
    if(windows.has(kind))return windows.get(kind);
    const s=sizes[kind];const win=new BrowserWindow({...fit(settings.layouts[kind],kind),minWidth:s[2],minHeight:s[3],...(kind==='lyricsSearch'?{parent:windows.get('lyrics'),modal:true}:kind!=='main'?{parent:windows.get('main')}:{}),show:false,frame:false,resizable:true,title:titles[kind],icon:path.join(appRoot,'assets/icon.ico'),backgroundColor:'#15191e',webPreferences:{preload:path.join(root,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
    if(kind==='main')win.umTaskbar=require('../../player-taskbar').create(win,electron.nativeImage,path.join(appRoot,'assets'),async(action:string)=>{if(!session)return;const s=session.snapshot();if(action==='previous'||action==='next')await navigate(action==='next'?1:-1);else if(s.status==='playing'||s.status==='paused')await session.pause(s.status==='playing');else if(s.currentId)await playEntry(s.currentId);await remember();},(error:any)=>{lastError=error.message;broadcast()});
    win.umPlayerKind=kind;for(const event of ['focus','blur','show','hide','minimize','restore'])win.on(event,()=>usageTimeline?.sample());if(kind==='main')win.webContents.on('render-process-gone',()=>failedWindow('播放器渲染进程异常退出'));win.umStableSize=win.getSize();win.on('resize',()=>{if(!drag)win.umStableSize=win.getSize()});windows.set(kind,win);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(e:any)=>e.preventDefault());
    surface?.track(win.getNativeWindowHandle().readBigUInt64LE().toString());
    win.on('will-move',(event:any,bounds:any)=>{if(resizing||kind==='lyricsSearch'||win.isMaximized()||win.isFullScreen())return;const native=surface?.modifiers();if(!native?.down)return;if(!drag||drag.win!==win||drag.gesture!==native?.gesture){const matches=native?.down&&native.handle===win.getNativeWindowHandle().readBigUInt64LE().toString();drag={win,gesture:native?.gesture,dipSize:win.umStableSize||win.getSize(),nativeSize:(win.umStableSize||win.getSize()).map((n:number)=>Math.round(n*screen.getDisplayMatching(bounds).scaleFactor)),origin:matches?{...bounds,...screen.screenToDipPoint(native.origin)}:bounds,cursor:matches?screen.screenToDipPoint(native.cursor):screen.getCursorScreenPoint(),state:{} as SnapState}}event.preventDefault();moveWithSnap()});
    win.on('will-resize',(event:any,_bounds:any,details:any)=>{
      if(win.isMaximized()||win.isFullScreen()||!['left','right','top','bottom','top-left','top-right','bottom-left','bottom-right'].includes(details?.edge))return;
      const native=surface?.modifiers();if(!native?.down||native.handle!==win.getNativeWindowHandle().readBigUInt64LE().toString())return;
      if(!resizing||resizing.win!==win||resizing.gesture!==native.gesture){drag=null;const bounds=win.getBounds(),scale=screen.getDisplayMatching(bounds).scaleFactor,data=insets.get(native.handle);resizing={win,edge:details.edge,origin:{...screen.screenToDipPoint(native.origin),width:data?.[4]?data[4]/scale:bounds.width,height:data?.[5]?data[5]/scale:bounds.height},cursor:screen.screenToDipPoint(native.cursor),gesture:native.gesture,state:{}};}
      event.preventDefault();resizeWithSnap();
    });
    win.on('resized',()=>{if(resizing?.win===win)resizing=null;win.umStableSize=win.getSize();});
    win.on('moved',()=>{if(kind==='main'){if(drag?.win===win&&!alt){settings.attachments||={};for(const [childKind,child]of windows){if(childKind==='main'||childKind==='lyricsSearch'||settings.attachments[childKind]||child.isDestroyed()||!child.isVisible())continue;const a=attach(frame(win,win.getBounds()),frame(child,child.getBounds()));if(a)settings.attachments[childKind]=a;}}followAttachments();}else captureAttachment(kind,win);if(!surface?.modifiers().down)drag=null});
    const rememberBounds=()=>{if(!restoring&&!win.isDestroyed()&&!win.isMinimized()&&!win.isMaximized()&&!win.isFullScreen())void captureLayout(kind,win).then(remember).catch((e:any)=>{lastError=e.message;broadcast()});};
    win.on('moved',rememberBounds);win.on('resized',rememberBounds);if(kind==='main'){win.on('move',followAttachments);win.on('resized',followAttachments);win.on('unmaximize',followAttachments);win.on('leave-full-screen',followAttachments);}
    win.on('closed',()=>{if(kind==='lyricsSearch')windows.delete(kind)});
    win.on('close',(event:any)=>{if(kind==='lyricsSearch'){lyricJob.cancel();return;}if(kind==='lyrics'){windows.get('lyricsSearch')?.close();}if(kind!=='main'){if(kind==='lyrics')lyricJob.cancel();event.preventDefault();settings.visible[kind]=false;win.hide();broadcast();void remember().catch((e:any)=>{lastError=e.message})}else{event.preventDefault();void close().catch((e:any)=>{lastError=e.message;broadcast()})}});
    if(kind==='main'){suppressed.minimized=false;suppressed.fullscreen=false;for(const [event,flag,value]of [['minimize','minimized',true],['restore','minimized',false],['enter-full-screen','fullscreen',true],['leave-full-screen','fullscreen',false]] as const)win.on(event,()=>{suppressed[flag]=value;if(flag==='fullscreen'){surface?.immersive(value);if(!value)surface?.clipBottom(0);}applyVisibility();setImmediate(applyVisibility)})}
    if(kind==='lyrics')win.on('hide',()=>windows.get('lyricsSearch')?.close());
    if(kind!=='main'&&kind!=='lyricsSearch')win.on('show',()=>{if(!settings.visible[kind]||!visible())win.hide()});else if(kind==='main'){win.on('hide',applyVisibility);win.on('show',applyVisibility);}
    for(const event of ['maximize','unmaximize','enter-full-screen','leave-full-screen'])win.on(event,broadcast);
    await win.loadFile(path.join(root,'window.html'),{query:{kind}});if(surface)await placeWindow(kind,win);win.setTitle(titles[kind]);return win;
  };
  async function ensure(reveal=true){
    if(disguised())throw Error('当前不可播放');if(settingsError)throw Error(settingsError);
    if(!settings.legacyImported){Object.assign(settings,importLegacy(dataRoot(),loadLibrary()));await remember()}
    if(closing)await closing;if(session)return;if(creating)return creating;
    creating=(async()=>{
      try{
        restoring=true;const main=await make('main');surface=new NativeSurface();surface.onExit=()=>failedWindow('原生视频窗口异常退出');const hwnd=await surface.open(path.join(root,'native/VideoHost.exe'),main.getNativeWindowHandle().readBigUInt64LE().toString());
        surface.track(main.getNativeWindowHandle().readBigUInt64LE().toString());surface.onNative=line=>{const parts=line.split(' ');if(parts[0]==='audio-brand-error'){lastError='Windows 音频品牌设置失败：'+parts.slice(1).join(' ');broadcast();}else if(parts[0]==='input'&&parts.length===2&&['Focus','Left','Right','Up','Down','Toggle','WheelUp','WheelDown','Space','F','Escape'].includes(parts[1]!)){if(parts[1]==='Escape'&&quickEscape())return;const main=windows.get('main');if(main&&!main.isDestroyed()&&main.isVisible()&&main.isEnabled())main.webContents.send('player:nativeInput',parts[1]);}else if(parts[0]==='cursor'&&parts.length===3){const main=windows.get('main');if(main&&!main.isDestroyed()&&main.isFullScreen()){const scale=screen.getDisplayMatching(main.getBounds()).scaleFactor*main.webContents.getZoomFactor();main.webContents.send('player:pointer',{x:Number(parts[1])/scale,y:Number(parts[2])/scale});}}else if(parts[0]==='pointer'){const nextAlt=parts[1]==='1',nextDown=parts[2]==='1';if(mouseDown&&!nextDown&&!surface?.modifiers().down){drag=null;resizing=null;}mouseDown=nextDown;const changed=alt!==nextAlt;alt=nextAlt;if(changed&&drag)moveWithSnap();if(changed&&resizing)resizeWithSnap()}else if(parts[0]==='frame'&&parts.length===10&&parts.slice(2).every(v=>Number.isFinite(Number(v)))){const changed=JSON.stringify(insets.get(parts[1]!))!==JSON.stringify(parts.slice(2).map(Number));insets.set(parts[1]!,parts.slice(2).map(Number));if(changed&&parts[1]===windows.get('main')?.getNativeWindowHandle().readBigUInt64LE().toString())followAttachments();}};
        await placeWindow('main',main,reveal);
        backend=new MpvBackend(path.join(root,'vendor/mpv.exe'),hwnd,(reference,signal)=>{const resolve=audioPlayback();if(!resolve)throw Error('远程播放服务未就绪');return resolve(reference,signal)},pid=>surface?.brandAudio(pid));
        session=new PlayerSession(backend,async(entry,seconds)=>{settings.positions[key(entry)]=seconds;if(entry.resourceId){settings.lastMembers||={};settings.lastMembers[entry.resourceId]=entry.memberId;if(entry.context==='video'&&localServices){const old=localServices.progress()[entry.resourceId]||{};await localServices.saveProgress(entry.resourceId,{...old,member:entry.memberId,positions:{...old.positions,[entry.memberId!]:{...old.positions?.[entry.memberId!],time:seconds}}})}}await remember()},async()=>{if(sleepAtEnd){sleepAtEnd=false;await session!.stop()}else if(settings.repeat==='one'&&session!.snapshot().currentId)await playEntry(session!.snapshot().currentId!);else await navigate(1)});
        session.allowDuplicates=settings.allowDuplicates!==false;
        session.restore(settings.queue,settings.currentId,settings.volume,settings.muted);
        session.subscribe((state:PlayerState)=>{
          usageTimeline?.sample();
          if(!state.hasVideo)surface?.hide();
          if(state.generation!==lyricsGeneration){lyricJob.cancel();lyricsGeneration=state.generation;lyrics=emptyLyrics();const entry=state.queue.find(e=>e.queueEntryId===state.currentId),generation=state.generation;if(entry)void currentLyrics(entry).then(value=>{if(session?.snapshot().generation===generation){lyrics=value;broadcast()}})}
          if(state.status==='playing'&&priorStatus==='loading'){const generation=state.generation;void backend?.equalizer(settings.eq).catch(error=>{lastError=error.message;broadcast()});void backend?.speed(settings.rate||1).catch(error=>{lastError=error.message});void backend?.tracks().then(value=>{if(session?.snapshot().generation===generation){tracks=value;broadcast()}}).catch(()=>{})}priorStatus=state.status;
          broadcast();
        });
        poll=setInterval(()=>{void session?.poll();if(sleepDeadline&&Date.now()>=sleepDeadline){sleepDeadline=0;void session?.pause(true);broadcast()}if(Date.now()-lastSaved>5000&&session){lastSaved=Date.now();void flushUsage();const s=session.snapshot(),entry=s.queue.find(e=>e.queueEntryId===s.currentId);if(entry&&s.position>0)settings.positions[key(entry)]=s.position;void remember().catch((e:any)=>{lastError=e.message;broadcast()})}},200);
        if(reveal)main.show();for(const kind of ['lyrics','queue','eq'] as Kind[])if(settings.visible[kind])await make(kind);restoring=false;applyVisibility();
      }catch(error){await dispose();throw error}
    })();try{await creating}finally{creating=null}
  }
  async function dispose(){cleanPlan=null;lyricJob.cancel();if(poll)clearInterval(poll);poll=null;try{await session?.close()}finally{session=null;backend=null;surface?.close();surface=null;for(const win of windows.values())if(!win.isDestroyed())win.destroy();windows.clear();insets.clear();drag=null;resizing=null;following=false;restoring=false;lyrics=emptyLyrics();lyricsGeneration=-1;await usageTimeline?.reset();broadcast()}}
  async function close(){if(closing)return closing;closing=(async()=>{try{await captureLayouts();await remember()}finally{await dispose()}})();try{await closing}finally{closing=null}}
  async function show(){await ensure();const main=windows.get('main');if(main.umDeferredWindowState){main.umDeferredWindowState=false;if(settings.layouts.main?.maximized)main.maximize();if(settings.layouts.main?.fullscreen)main.setFullScreen(true);}if(main.isMinimized())main.restore();main.show();main.focus();applyVisibility();return snapshot()}
  async function playEntry(id:string,start=0){lastError='';await session!.play(id,start);if(session!.snapshot().status==='error')throw Error(session!.snapshot().error!);await remember()}
  async function navigate(direction:1|-1){const s=session!.snapshot(),ids=settings.shuffle?require('../../audio-context').sequence({queue:s.queue,index:s.queue.findIndex(e=>e.queueEntryId===s.currentId),shuffle:true,shuffleOrder:settings.shuffleOrder||[]}):s.queue.map(e=>e.queueEntryId),at=ids.indexOf(s.currentId),next=ids[at+direction]||(settings.repeat==='all'?ids[(at+direction+ids.length)%ids.length]:null);if(next)await playEntry(next);else await session!.stop()}
  function libraryEntries(refs:any[]):Omit<QueueEntry,'queueEntryId'>[]{
    const library=loadLibrary();return refs.map(ref=>{
      const item=library.items.find((i:any)=>i.id===ref.itemId);if(!item)throw Error('资源已不存在');
      if(item.type==='audio'){
        const track=item.audio?.tracks.find((t:any)=>t.id===ref.trackId);const source=item.audio?.sources.find((s:any)=>s.id===(track?.preferredSourceId||track?.sourceRefs?.[0]));
        if(!track||!source)throw Error('音轨来源不存在');
        return {path:source.kind==='local'?source.localPath:require('../../player-source').reference(item.id,track.id),title:track.title||item.name,artist:(track.artists||item.audio.artists||[]).join(' / '),album:track.albumTitle||(item.audio.collectionKind==='album'?item.name:''),duration:track.durationSeconds,resourceId:item.id,memberId:track.id,context:require('../../audio-context').kind(item.audio.kind)};
      }
      if(!['movie','anime'].includes(item.type))throw Error('该资源使用原阅读器');
      const files=require('../../player-library').videoFiles(item);
      const file=ref.file?files.find((f:any)=>f.path===ref.file):files[0];if(!file)throw Error('没有本地视频文件');
      return {path:file.path,title:file.name||item.name,resourceId:item.id,memberId:file.path,context:'video'};
    });
  }
  function append(entries:Omit<QueueEntry,'queueEntryId'>[]){const rows=session!.append(entries);queueNotice=entries.length===1&&!rows.length?'已在队列中':rows.length<entries.length?'已跳过 '+(entries.length-rows.length)+' 个重复项':'';broadcast();return rows;}
  async function resource(refs:any[],mode='play',resumeSelection=false,source?:any){
    const request=require('../../player-resource-request').resolve(loadLibrary(),refs,source),entries=libraryEntries(request.refs),context=request.context;await show();
    if(settings.context!==context&&mode!=='play'){
      const saved=settings.contexts[context]||{queue:[],currentId:null},added=prepareAppend(saved.queue,entries,session!.allowDuplicates),queue=[...saved.queue];
      if(mode==='next')queue.splice(Math.max(0,queue.findIndex((e:QueueEntry)=>e.queueEntryId===saved.currentId)+1),0,...added);else queue.push(...added);
      settings.contexts[context]={...saved,queue};queueNotice=added.length?'已加入'+({music:'音乐',asmr:'音声',radio:'电台',other:'其他',video:'视频'} as Record<string,string>)[context]+'队列'+(added.length<entries.length?'，已跳过重复项':''):'已在对应队列中';await remember();broadcast();return snapshot();
    }
    if(settings.context!==context){const old=session!.snapshot();await session!.stop();settings.contexts[settings.context]={queue:old.queue,currentId:old.currentId};settings.context=context;session!.restore(settings.contexts[context!]?.queue||[],settings.contexts[context!]?.currentId||null)}
    const added=append(entries);
    if(mode==='play'){const entry=(resumeSelection?added.find(e=>e.memberId===settings.lastMembers?.[e.resourceId!]):null)||added[0]||session!.snapshot().queue.find(e=>require('../../player-queue').identity(e)===require('../../player-queue').identity(entries[0]))!,item=loadLibrary().items.find((i:any)=>i.id===entry.resourceId),resume=entry.context==='video'||item?.audio?.resumePolicy==='resume';await playEntry(entry.queueEntryId,resume?Number(settings.positions[key(entry)])||0:0)}
    else if(mode==='next'){const s=session!.snapshot(),ids=s.queue.filter(e=>!added.some(a=>a.queueEntryId===e.queueEntryId)).map(e=>e.queueEntryId),index=ids.indexOf(s.currentId!);ids.splice(index+1,0,...added.map(e=>e.queueEntryId));session!.reorder(ids)}
    await remember();return snapshot();
  }
  async function openResource(id:string){const item=loadLibrary().items.find((i:any)=>i.id===id);if(!item)throw Error('资源已不存在');if(item.type==='audio')return resource(require('../../audio-context').order(item.audio.tracks).map((track:any)=>({itemId:id,trackId:track.id})));const files=require('../../player-library').videoFiles(item);return resource(files.map((f:any)=>({itemId:id,file:f.path})))}
  async function currentLyrics(entry:QueueEntry):Promise<Lyrics>{if(settings.manualLyrics[key(entry)])return loadLyrics(entry.path,settings.manualLyrics[key(entry)]);const saved=entry.memberId&&audioLyrics()?.read(entry.memberId);if(saved?.source==='用户选择')return fromText(saved.text||'',saved.offset||0,saved.translation||'');const item=loadLibrary().items.find((i:any)=>i.id===entry.resourceId),track=item?.audio?.tracks.find((t:any)=>t.id===entry.memberId);if(track){const local=await require('../../audio-local-lyrics').read(item,track);if(local.text)return fromText(local.text,local.offset||0);}const local=require('../../player-source').parse(entry.path)?emptyLyrics():await loadLyrics(entry.path);if(local.status!=='none')return local;return saved?fromText(saved.text||'',saved.offset||0,saved.translation||''):local;}
  require('../../library-events').subscribe((revision:number)=>{for(const win of windows.values())if(!win.isDestroyed())win.webContents.send('player:libraryChanged',revision)});
  const authorized=(event:any)=>{if(!event?.senderFrame||event.senderFrame!==event.sender.mainFrame||event.sender.isDestroyed())throw Error('非授权播放请求');let file='';try{file=fileURLToPath(event.senderFrame.url)}catch{}const win=BrowserWindow.fromWebContents(event.sender);if(file!==path.join(appRoot,'index.html')&&!(windows.get(win?.umPlayerKind)===win&&file===path.join(root,'window.html')))throw Error('非授权播放窗口');return win};
  ipcMain.on('player:overlay',(event:any,height:number)=>{const win=authorized(event);if(win!==windows.get('main')||!win.isFullScreen()||!Number.isFinite(height)||height<0||height>200)return;surface?.clipBottom(height*screen.getDisplayMatching(win.getBounds()).scaleFactor*win.webContents.getZoomFactor());});
  ipcMain.handle('player:window',(event:any,action:unknown)=>windowControl(authorized(event),action));
  ipcMain.handle('player:lyrics',async(event:any,operation:string,value:any={})=>{authorized(event);if(operation==='cancel'){lyricJob.cancel();return null;}const s=session?.snapshot(),entry=s?.queue.find(e=>e.queueEntryId===s.currentId);if(!entry)throw Error('请先选择媒体');const shared=audioLyrics();if(!shared)throw Error('歌词服务尚未就绪');const item=loadLibrary().items.find((i:any)=>i.id===entry.resourceId),track=item?.audio?.tracks.find((t:any)=>t.id===entry.memberId);
    if(operation==='info')return {title:track?.title||entry.title,artist:track?.artists?.[0]||item?.audio?.artists?.[0]||'',album:item?.name||'',duration:track?.durationSeconds||s!.duration};
    if(operation==='search'){if(!shared.preferences().online)throw Error('声音联网未启用');const title=String(value.title||track?.title||entry.title).slice(0,300),artist=String(value.artist||track?.artists?.[0]||item?.audio?.artists?.[0]||'').slice(0,300);return lyricJob.search((signal:AbortSignal)=>shared.query(item||{name:'',audio:{kind:'music',collectionKind:'single',artists:[artist]}},{...track,title,artists:[artist],albumTitle:item?.name||'',durationSeconds:track?.durationSeconds||s!.duration},signal,value.source||'auto',value.candidateId));}
    if(operation==='use'||operation==='save'){if(value.automatic&&lyrics.status!=='none')return snapshot();const result=lyricJob.selected();if(!result.text)throw Error('没有可用歌词');if(!value.replace&&(settings.manualLyrics[key(entry)]||shared.read(entry.memberId)?.source==='用户选择'))throw Error('保留已手选歌词，在线结果不会覆盖');if(operation==='save'){if(!entry.memberId||!item)throw Error('请先将媒体加入声音资料库后保存歌词');shared.save(entry.memberId,result,{replace:value.replace===true});if(value.replace){delete settings.manualLyrics[key(entry)];await remember();}}lyrics=fromText(result.text,result.offset||0,result.translation||'');broadcast();return snapshot();}throw Error('歌词操作无效');});
  ipcMain.handle('player:library',(event:any,view:string)=>{authorized(event);return {revision:require('../../library-events').revision(),groups:require('../../player-library').browse(loadLibrary(),view),orders:settings.libraryOrders||{}}});
  ipcMain.handle('player:snapshot',(event:any)=>{authorized(event);return snapshot()});
  ipcMain.handle('player:show',async(event:any)=>{authorized(event);return show()});
  ipcMain.handle('player:resource',async(event:any,refs:any,mode:string,source:any)=>{authorized(event);if(!['play','append','next'].includes(mode))throw Error('播放方式无效');return resource(refs,mode,false,source)});
  ipcMain.handle('player:command',async(event:any,raw:any)=>{
    const owner=authorized(event);await ensure(owner===windows.get('main'));const command=validateCommand(raw);
    switch(command.type){case 'play':await playEntry(command.id);break;case 'pause':await session!.pause(command.paused);break;case 'seek':await session!.seek(command.seconds);break;case 'stop':await session!.stop();break;case 'volume':await session!.volume(command.value,command.muted);break;case 'remove':await session!.remove(command.id);break;case 'reorder':session!.reorder(command.ids);break;}await remember();return snapshot();
  });
  ipcMain.handle('player:action',async(event:any,name:string,value:any)=>{
    const owner=authorized(event);await ensure(owner===windows.get('main'));
    if(name==='input'){if(owner!==windows.get('main')||!['seek','volume','toggle'].includes(value?.kind)||![-1,0,1].includes(value?.step))throw Error('快捷操作无效');await session!.adjust(value.kind,value.step);}
      else if(name==='libraryOrder'){
      const {view,groupId=null,ids}=value||{},order=require('../../player-library-order');
      if(owner!==windows.get('queue'))throw Error('请在播放列表窗口排序');
      const groups=require('../../player-library').browse(loadLibrary(),view),validated=order.validate(groups,view,groupId,ids);
      settings.libraryOrders||={};settings.libraryOrders[order.scope(view,groupId)]=validated;
    }else if(name==='libraryOrderReset'){
      if(owner!==windows.get('queue')||!['albums','songs','playlists','asmr','radio','other','movie','anime'].includes(value))throw Error('排序分类无效');
      for(const key of Object.keys(settings.libraryOrders||{})){if(JSON.parse(key)[0]===value)delete settings.libraryOrders[key];}
    }else if(name==='queueDuplicates'){
      if(typeof value!=='boolean')throw Error('重复项设置无效');settings.allowDuplicates=value;session!.allowDuplicates=value;
    }else if(name==='queueCleanPreview'){
      if(owner!==windows.get('queue')||!['clear','duplicates'].includes(value))throw Error('请在播放列表窗口选择清理方式');
      const before=session!.snapshot(),ids=value==='clear'?before.queue.map(e=>e.queueEntryId):require('../../player-queue').duplicateIds(before.queue,before.currentId);
      cleanPlan={token:require('node:crypto').randomUUID(),owner,before,context:settings.context,ids};return {token:cleanPlan.token,count:ids.length};
    }else if(name==='queueClean'){
      const plan=cleanPlan;if(!plan||owner!==plan.owner||value!==plan.token)throw Error('请重新确认清理数量');cleanPlan=null;
      const current=session!.snapshot();if(settings.context!==plan.context||JSON.stringify(current.queue)!==JSON.stringify(plan.before.queue)||current.currentId!==plan.before.currentId)throw Error('队列已变化，请重新确认清理数量');
      await session!.removeMany(plan.ids);queueNotice='已清理 '+plan.ids.length+' 项资源';
    }else if(name==='lyricsSearch'){

      settings.visible.lyrics=true;await make('lyrics');applyVisibility();const search=await make('lyricsSearch');search.show();search.focus();
    }else if(name==='lyricView'){
      if(!value||typeof value!=='object')throw Error('歌词显示参数无效');
      const current=lyricView();
      if(value.zoom!==undefined){if(!Number.isFinite(value.zoom))throw Error('歌词字号无效');current.zoom=Math.max(20,Math.min(400,Math.round(value.zoom)));}
      if(value.align!==undefined){if(!['left','center','right'].includes(value.align))throw Error('歌词对齐方式无效');current.align=value.align;}
      settings.lyricView={zoom:current.zoom,align:current.align};
      if(value.offset!==undefined){if(!Number.isSafeInteger(value.offset))throw Error('歌词偏移无效');const s=session!.snapshot(),entry=s.queue.find(e=>e.queueEntryId===s.currentId);if(!entry)throw Error('请先选择媒体');settings.lyricOffsets||={};settings.lyricOffsets[key(entry)]=value.offset;}
    }else if(name==='files'){
      const result=await dialog.showOpenDialog(windows.get('main'),{properties:['openFile','multiSelections'],filters:[{name:'媒体',extensions:['mp3','wav','flac','m4a','aac','ogg','opus','mp4','mkv','webm','avi','mov','ts','wmv','rm','rmvb']}]});
      if(!result.canceled){const rows=append(result.filePaths.map((file:string)=>({path:file,title:path.basename(file)})));if(value===true&&rows.length)await playEntry(rows[0]!.queueEntryId)}
    }else if(name==='drop'){
      if(!Array.isArray(value)||value.length>1000||value.some((p:any)=>typeof p!=='string'||!path.isAbsolute(p)||!fs.statSync(p).isFile()))throw Error('拖入文件无效');append(value.map((file:string)=>({path:file,title:path.basename(file)})));
    }else if(name==='aux'){
      if(!['lyrics','queue','eq'].includes(value))throw Error('窗口类型无效');settings.visible[value]=!settings.visible[value];if(settings.visible[value])await make(value);applyVisibility();if(settings.visible[value]&&visible())windows.get(value)?.focus();
    }else if(name==='fullscreen'){windows.get('main').setFullScreen(!windows.get('main').isFullScreen())}
    else if(name==='next'||name==='previous'){await navigate(name==='next'?1:-1)}
    else if(name==='rate'){await backend!.speed(value);settings.rate=value}
    else if(name==='track'){await backend!.track(value?.type,value?.id);tracks=await backend!.tracks()}
    else if(name==='subtitle'){const result=await dialog.showOpenDialog(owner,{properties:['openFile'],filters:[{name:'字幕',extensions:['srt','ass','ssa','vtt']}]});if(!result.canceled){await backend!.subtitle(result.filePaths[0]);tracks=await backend!.tracks()}}
    else if(name==='mode'){if(!['none','all','one','shuffle'].includes(value))throw Error('播放模式无效');settings.repeat=value==='shuffle'?'none':value;settings.shuffle=value==='shuffle';if(settings.shuffle){const s=session!.snapshot();settings.shuffleOrder=require('../../audio-context').shuffled({queue:s.queue,index:s.queue.findIndex(e=>e.queueEntryId===s.currentId)})}}
    else if(name==='eq'){filter(value);if(backend&&session!.snapshot().status!=='idle')await backend.equalizer(value);settings.eq=structuredClone(value)}
    else if(name==='lyrics'){lyricJob.cancel();
      const s=session!.snapshot(),entry=s.queue.find(e=>e.queueEntryId===s.currentId);if(!entry)throw Error('先选择媒体');const lastDirectory=typeof settings.lyricsDirectory==='string'&&fs.statSync(settings.lyricsDirectory,{throwIfNoEntry:false})?.isDirectory()?settings.lyricsDirectory:undefined;const result=await dialog.showOpenDialog(owner,{defaultPath:lastDirectory,properties:['openFile'],filters:[{name:'歌词',extensions:['lrc','txt']}]});if(!result.canceled&&result.filePaths[0])settings.lyricsDirectory=path.dirname(result.filePaths[0]);if(!result.canceled&&session!.snapshot().generation===s.generation){settings.manualLyrics[key(entry)]=result.filePaths[0];const value=await loadLyrics(entry.path,result.filePaths[0]);if(session!.snapshot().generation===s.generation)lyrics=value}
    }else if(name==='sleep'){
      if(value==='end'){sleepAtEnd=true;sleepDeadline=0}else{if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1440)throw Error('睡眠分钟数无效');sleepDeadline=value?Date.now()+value*60000:0;sleepAtEnd=false}
    }else if(name==='reloadLyrics'){
      const s=session!.snapshot(),entry=s.queue.find(e=>e.queueEntryId===s.currentId);if(entry){const value=await currentLyrics(entry);if(session!.snapshot().generation===s.generation)lyrics=value}
    }else if(name==='context'){
      if(!['music','asmr','radio','other'].includes(value))throw Error('播放分区无效');const old=session!.snapshot();await session!.stop();settings.contexts[settings.context]={queue:old.queue,currentId:old.currentId};settings.context=value;const saved=settings.contexts[value];session!.restore(saved?.queue||[],saved?.currentId||null);const entry=session!.snapshot().queue.find(e=>e.queueEntryId===saved?.currentId);if(entry)await playEntry(entry.queueEntryId,settings.positions[key(entry)]||0);
    }else if(name==='bookmarkPlay'){
      const mark=settings.bookmarks.find((b:any)=>b.id===value);const s=session!.snapshot(),entry=s.queue.find(e=>key(e)===mark?.key);if(!entry)throw Error('请先打开该书签所属资源');await playEntry(entry.queueEntryId,mark.position);
    }else if(name==='bookmarkDelete'){settings.bookmarks=settings.bookmarks.filter((b:any)=>b.id!==value)
    }else if(name==='bookmarkNote'){const mark=settings.bookmarks.find((b:any)=>b.id===value?.id);if(!mark||typeof value.note!=='string'||value.note.length>1000)throw Error('书签无效');mark.note=value.note
    }else if(name==='bookmark'){
      const s=session!.snapshot(),entry=s.queue.find(e=>e.queueEntryId===s.currentId);if(entry)settings.bookmarks.push({id:require('node:crypto').randomUUID(),key:key(entry),title:entry.title,position:s.position});
    }else throw Error('未知播放器操作');await remember();broadcast();return snapshot();
  });
  ipcMain.on('player:viewport',(event:any,rect:any)=>{
    try{const win=authorized(event);if(win!==windows.get('main')||!surface||!rect||!['x','y','width','height'].every(k=>Number.isFinite(rect[k])))return;const zoom=win.webContents.getZoomFactor(),scale=screen.getDisplayMatching(win.getBounds()).scaleFactor,[width,height]=win.getContentSize();if(rect.x<0||rect.y<0||rect.width<1||rect.height<1||(rect.x+rect.width)*zoom>width+1||(rect.y+rect.height)*zoom>height+1)return;if(session?.snapshot().hasVideo)surface.bounds(rect.x*zoom*scale,rect.y*zoom*scale,rect.width*zoom*scale,rect.height*zoom*scale);else surface.hide()}catch{}
  });
  const displays=()=>{for(const [kind,win]of windows)if(!win.isDestroyed())win.setBounds(fit(win.getNormalBounds(),kind))};screen.on('display-removed',displays);screen.on('display-metrics-changed',displays);
  async function conceal(){if(creating)await creating;try{if(session)await session.volume(session.snapshot().volume,true);}finally{await close();}}
  return {show,openResource,close,conceal,snapshot,appearance:broadcast};
}
