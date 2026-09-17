const target='https://www.bilibili.com/video/BV1Kq3s65EzA/?t=397&autoplay=1';
function create({windows,setState,closePlayer,openExternal,now=Date.now,report=()=>{}}){let last=null,pending=null;
 function enter(){if(pending)return pending;const errors=[];const record=e=>{errors.push(e.message);report(e);};for(const win of windows()){if(win.isDestroyed())continue;try{win.webContents.setAudioMuted(true);if(win.isFullScreen()){win.once('leave-full-screen',()=>{if(!win.isDestroyed())win.minimize();});win.setFullScreen(false);}win.minimize();}catch(e){record(e);}}
 pending=(async()=>{try{await setState();}catch(e){record(e);}try{await closePlayer();}catch(e){record(e);}try{await openExternal(target);}catch(e){record(e);}return {ok:errors.length===0,errors};})().finally(()=>{pending=null;});return pending;}
 function escape(){const time=now();if(last!==null&&time-last<=350&&time>=last){last=null;void enter();return true;}last=time;return false;}
 function input(value){if(value.type!=='keyDown')return false;if(value.isAutoRepeat)return false;if(value.key==='Escape'&&!value.control&&!value.shift&&!value.alt&&!value.meta)return escape();last=null;return false;}
 return {enter,input,escape};
}
module.exports={create,target};
