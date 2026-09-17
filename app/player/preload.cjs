const {contextBridge,ipcRenderer,webUtils}=require('electron');
contextBridge.exposeInMainWorld('player',{
  library:view=>ipcRenderer.invoke('player:library',view),
  resource:(refs,mode,source)=>ipcRenderer.invoke('player:resource',refs,mode,source),
  libraryChanged:callback=>{const listener=(_,revision)=>callback(revision);ipcRenderer.on('player:libraryChanged',listener);return()=>ipcRenderer.removeListener('player:libraryChanged',listener)},
  lyrics:(operation,value)=>ipcRenderer.invoke('player:lyrics',operation,value),
  overlay:height=>ipcRenderer.send('player:overlay',height),
  nativeInput:callback=>{const listener=(_,value)=>callback(value);ipcRenderer.on('player:nativeInput',listener);return()=>ipcRenderer.removeListener('player:nativeInput',listener)},
  pointer:callback=>{const listener=(_,point)=>callback(point);ipcRenderer.on('player:pointer',listener);return()=>ipcRenderer.removeListener('player:pointer',listener)},
  window:action=>ipcRenderer.invoke('player:window',action),
  snapshot:()=>ipcRenderer.invoke('player:snapshot'),
  command:value=>ipcRenderer.invoke('player:command',value),
  action:(name,value)=>ipcRenderer.invoke('player:action',name,value),
  viewport:rect=>ipcRenderer.send('player:viewport',rect),
  filePath:file=>webUtils.getPathForFile(file),
  subscribe:callback=>{const listener=(_,value)=>callback(value);ipcRenderer.on('player:state',listener);return()=>ipcRenderer.removeListener('player:state',listener)}
});
