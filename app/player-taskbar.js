const path=require('node:path');
function create(win,nativeImage,assets,command,onError){
 const icons=Object.fromEntries(['previous','play','pause','next'].map(name=>[name,nativeImage.createFromPath(path.join(assets,'taskbar-'+name+'.png'))]));let signature='',latest=null;
 const click=action=>()=>{if(!win.isDestroyed())Promise.resolve().then(()=>command(action)).catch(onError)};
 function update(state,force=false){latest=state;if(win.isDestroyed())return;const playing=state.status==='playing',enabled=!!state.currentId&&state.queue.length>0;const key=JSON.stringify([playing,enabled]);if(!force&&key===signature)return;
  const buttons=[['previous','上一项'],[playing?'pause':'play',playing?'暂停':'播放'],['next','下一项']].map(([name,tooltip])=>({tooltip,icon:icons[name],flags:enabled?[]:['disabled'],click:click(name==='pause'?'play':name)}));
  if(win.setThumbarButtons(buttons))signature=key;
 }
 win.on('show',()=>{if(latest)update(latest,true)});win.on('closed',()=>{latest=null});return {update};
}
module.exports={create};
