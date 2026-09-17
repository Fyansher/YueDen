/* Positive product-purpose evidence, not “no game match => software”.
 * Cross-check valid executables with purpose, product/entry identity or verified
 * companion evidence. A directory name or an unmatched game search never suffices.
 */
const AI=require('./application-identity'),path=require('node:path'),catalog=require('./scan-product-kinds.json');
function purpose(metadata={},file='',rows=[]){
 if(!metadata.validPe)return '';
 const product=String(metadata.productName||'').trim(),description=String(metadata.fileDescription||'').trim(),stem=path.basename(file,path.extname(file)),original=String(metadata.originalFilename||'').trim();
 if(/^Microsoft Corporation$/i.test(String(metadata.companyName||'').trim())&&/DirectX|Visual C\+\+|\.NET|WebView/i.test(product+' '+description)&&/setup|installer|redistributable/i.test(description)&&AI.key(original.replace(/\.exe$/i,''))===AI.key(stem))return '微软运行环境安装组件：'+description;
 const semantic=/加速器|翻译器|翻译(?:工具|软件|程序)|MOD\s*(?:管理|盒子)|(?:商店|料理|存档|画面|文本|音频|视频)编辑器|游戏修改器|(?:^|\b)(?:mod manager|mod loader|(?:shop|meal|save|text|audio|video|image)[ -]editor|game trainer)(?:\b|$)/i;
 // Two channels agree: a valid product description and its actual executable.
 if(product&&semantic.test(product+' '+description)&&file&&(AI.key(stem).includes(AI.key(product))||AI.key(product).includes(AI.key(stem))||AI.key(original.replace(/\.(exe|dll)$/i,''))===AI.key(stem)))return '产品功能与实际入口一致：'+(description||product);
 const split=stem.replace(/([a-z])([A-Z])/g,'$1 $2');
 const trainer=split.match(/^(.*?)\s*Trainer(?:$|[ _.-]*(?:v?\d|Plus\b|x(?:86|64)\b))/i);
 if(trainer&&AI.key(trainer[1]).length>=2&&AI.key(product).length>=2&&AI.key(trainer[1]).includes(AI.key(product)))return '实际入口明确是 Trainer，内部游戏产品名不能作为游戏身份：'+stem;
 if(AI.product(product)&&String(metadata.companyName||'').trim()&&/\b(?:translation (?:application|tool|utility)|(?:image|photo|text|audio|video) editor|(?:file|archive|password) manager|web browser|screen reader)\b|翻译(?:工具|软件|程序)|文件管理器|压缩软件|网页浏览器/i.test(description))return description;
 const names=new Set(rows.filter(r=>r.kind==='file').map(r=>r.name.toLowerCase()));
 if(/^maintenancetool$/i.test(stem)&&['components.xml','maintenancetool.dat','maintenancetool.ini'].every(n=>names.has(n)))return '安装维护程序及配套组件清单、维护数据一致；不是游戏本体';
 for(const p of catalog.products){
  const entry=p.entries?.some(e=>e.toLowerCase()===path.basename(file).toLowerCase());
  const identified=p.product?product.toLowerCase()===p.product.toLowerCase():p.productPrefix?product.startsWith(p.productPrefix):false;
  const corroborated=p.company?String(metadata.companyName||'').trim()===p.company:p.originalPrefix?original.startsWith(p.originalPrefix):false;
  if(identified&&corroborated&&(!p.entries||entry)||entry&&p.companions?.filter(n=>names.has(n.toLowerCase())).length>=p.minimumCompanions)return '已核对的软件产品身份与入口 / 配套文件一致：'+p.id+' · '+p.kind;
 }
 return metadata.softwarePurpose||'';
}
module.exports={purpose};
