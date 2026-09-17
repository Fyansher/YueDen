/* Shared local product evidence. No game titles, path aliases or network search results. */
(function(root){
 const key=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
 const base=value=>String(value||'').replace(/\\/g,'/').split('/').pop().replace(/\.exe$/i,'');
 const generic=/^(?:application|game|main|client|sample|nw|nwjs|electron|unity(?:player)?|unreal(?:engine)?|godot|rpgmaker|renpy|openbor|sdlapp|windowsapplication\d*|microsoft.*|todo.*)$/i;
 function role(file,metadata={}){
  const stem=base(file).replace(/([a-z])([A-Z])/g,'$1 $2');
  if(/(?:^|[ _.-])(?:unins\w*|uninstall\w*|setup|repair|config\w*|settings?|custom|update\w*|unload|plugin|comserver|createdump|crashpad_handler|replay(?:view|viewer)?)(?:$|[ _.-])/i.test(stem)||/^(?:config|replay(?:view|viewer)|unins)/i.test(stem))return 'tool';
  if(/(?:unins[t\d]*|uninstall(?:er)?|repair|config(?:uration)?|settings|crash(?:handler|sender|reporter)?|reporter|replayview(?:er)?|updater?|plugin|comserver)(?:32|64)?$/i.test(stem.replace(/\s+/g,'')))return 'tool';
  if(/(?:launcher|login|boot|bootstrapper)$/i.test(stem))return 'launcher';
  // Product descriptions are useful for arbitrary executable filenames, never evaluated.
  if(/\b(?:configuration (?:tool|utility)|crash reporter|uninstaller|replay viewer)\b/i.test(metadata.fileDescription||''))return 'tool';
  return 'primary';
 }
 function product(value){
  const text=String(value||'').trim().replace(/(?:\s*[-:·/]\s*|\s+)(?:launcher|login|boot|configuration tool|settings|replay viewer|uninstaller)$/i,'');
  if(/^(?:steam[ _:-]*)?appid[ _:-]*\d+$/i.test(text))return '';
  const k=key(text);return k.length>=2&&!generic.test(k)&&! /^(?:generic)?(?:launcher|login|boot|configuration|settings|replayviewer|uninstaller|repairtool)$/.test(k)?k:'';
 }
 function facts(file,metadata={}){return {path:file,role:role(file,metadata),productKey:product(metadata.productName),companyKey:key(metadata.companyName),versionKey:key(metadata.productVersion),validPe:Boolean(metadata.validPe),metadata};}
 function conflict(a,b){
  if(a.productKey&&b.productKey&&a.productKey!==b.productKey&&a.role==='primary'&&b.role==='primary')return true;
  if(a.companyKey&&b.companyKey&&a.companyKey!==b.companyKey&&a.productKey&&b.productKey)return true;
  return Boolean(a.role==='primary'&&b.role==='primary'&&a.versionKey&&b.versionKey&&a.versionKey!==b.versionKey);
 }
 const variant=file=>Number(/[_ -](?:gl|opengl|dx\d+|d3d\d+|vulkan|x86|x64)$/i.test(base(file)));
 const api={key,product,role,facts,conflict,variant};if(typeof module!=='undefined')module.exports=api;else root.ApplicationIdentity=api;
})(typeof window==='undefined'?globalThis:window);
