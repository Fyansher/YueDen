const path=require('node:path'),{fileURLToPath}=require('node:url');
function authorize(event,channel,directory){
 if(!event?.sender||event.sender.isDestroyed()||!event.senderFrame||event.senderFrame!==event.sender.mainFrame)return false;
 let file;try{const u=new URL(event.senderFrame.url);if(u.protocol!=='file:')return false;file=path.resolve(fileURLToPath(u));}catch{return false;}
 if(file===path.join(directory,'index.html'))return true;
 if(file===path.join(directory,'audio-window.html'))return ['audio:lyrics','audio:onlineLyrics','audio:saveLyrics','audio:pickLyrics','audio:cancelExtras','audio:windowInit','audio:windowCommand','window:close','window:minimize','window:toggleMaximize'].includes(channel);
 if(file===path.join(directory,'reader.html'))return channel.startsWith('reader:')||channel.startsWith('window:')||channel==='external:open'||channel==='cover:pick'||['usage:opened','usage:tick'].includes(channel);
 return false;
}
function create(raw,directory){return {handle(channel,handler){raw.handle(channel,(event,...args)=>{if(!authorize(event,channel,directory))throw Error('拒绝非授权窗口请求');return handler(event,...args);});},on(channel,handler){raw.on(channel,(event,...args)=>{if(authorize(event,channel,directory))handler(event,...args);});}};}
module.exports={create,authorize};
