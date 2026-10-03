function target(value){const text=String(value||'').trim();if(!text)return '';const u=new URL(text);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('伪装视频链接必须是 HTTP(S) 地址');return u.href;}
function create({windows,setState,closePlayer,openExternal,now=Date.now,report=()=>{},videoUrl=()=>''}){let last=null,pending=null;
 function enter(){if(pending)return pending;const errors=[];const record=e=>{errors.push(e.message);report(e);};for(const win of windows()){if(win.isDestroyed())continue;try{win.webContents.setAudioMuted(true);if(win.isFullScreen()){win.once('leave-full-screen',()=>{if(!win.isDestroyed())win.minimize();});win.setFullScreen(false);}win.minimize();}catch(e){record(e);}}
 pending=(async()=>{try{await setState();}catch(e){record(e);}try{await closePlayer();}catch(e){record(e);}try{const url=target(videoUrl());if(url)await openExternal(url);}catch(e){record(e);}return {ok:errors.length===0,errors};})().finally(()=>{pending=null;});return pending;}
 function escape(){const time=now();if(last!==null&&time-last<=350&&time>=last){last=null;void enter();return true;}last=time;return false;}
 function input(value){if(value.type!=='keyDown')return false;if(value.isAutoRepeat)return false;if(value.key==='Escape'&&!value.control&&!value.shift&&!value.alt&&!value.meta)return escape();last=null;return false;}
 return {enter,input,escape};
}
module.exports={create,target};
