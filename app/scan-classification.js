const nonComic=/小说|小說|文学|文學|历史|歷史|传记|傳記|\bfiction\b|\bnovels?\b|\bhistory\b|\bbiography\b|\bpoetry\b/i;
const comic=/漫画|漫畫|コミック|マンガ|\bcomics?\b|graphic novels?/i;
function classify({kind,file='',metadata={},evidence=[],rules=[]}){
 const conflict=rules.length>1&&new Set(rules.map(r=>r.type).filter(Boolean)).size>1;
 const hit=rules[0];if(hit?.type&&!conflict)return {type:hit.type,confidence:1,candidates:[{type:hit.type,score:1}],reason:'已核对且符合路径 / 产品条件的规则',conflicts:[]};
 let type='unknown_file',confidence=.3,candidates=[],reason='证据不足，保留未知状态';
 if(kind==='application'){
  if(!metadata.validPe){type='unknown_file';confidence=.2;reason='文件名带 EXE 扩展名，但未验证为有效 PE 程序；不凭扩展名确认应用';candidates=[{type:'unknown_application',score:.2}];}
  else if(require('./scan-software-evidence').purpose(metadata,file)){type='software';confidence=.9;reason=require('./scan-software-evidence').purpose(metadata,file);}
  else if(evidence.some(e=>e.rule==='installed-product-category')){type=evidence.find(e=>e.rule==='installed-product-category').type;confidence=.98;reason='有效程序、安装位置及平台产品类别相互验证';}
  else if(evidence.some(e=>e.rule==='steam-appid')&&evidence.some(e=>e.rule==='paired-engine-data')){type='game';confidence=.93;reason='有效程序、Steam 产品标识及与启动文件对应的引擎数据共同支持游戏分类';}
  else if(evidence.some(e=>e.rule==='engine-steam-runtime')){type='game';confidence=.9;reason='有效 PE、配套引擎目录与 Steam 运行库共同支持游戏分类';}
  else if(evidence.some(e=>e.rule==='script-runtime-package')){type='game';confidence=.88;reason='脚本游戏格式头、有效程序、运行模块及存档结构共同支持游戏分类';}
  else if(require('./scan-software-evidence').purpose(metadata)){type='software';confidence=.88;reason='有效 PE、具体产品名及厂商与非游戏功能描述相互支持：'+metadata.fileDescription;}
  else{type='unknown_application';confidence=.5;reason='发现应用入口，但产品子类型缺少独立可靠证据；未匹配游戏不等于非游戏软件';candidates=[{type:'game',score:.45},{type:'software',score:.45}];}
 }else if(kind==='publication'){
  if(metadata.container==='epub'){
   if(metadata.comicInfo||comic.test(metadata.subject)){type='comic';confidence=.96;reason='有效 EPUB 容器及嵌入的漫画主题 / ComicInfo 元数据';}
   else if(nonComic.test(metadata.subject)){type='book';confidence=metadata.title&&metadata.hasSpine?.95:.82;reason='有效 EPUB 出版结构及非漫画出版主题；封面与插图属于该出版物';}
   else{type='unknown_collection';confidence=.55;reason='EPUB 只能确认出版容器，缺少区分书籍与漫画的语义；需要人工确认';candidates=[{type:'book',score:.55},{type:'comic',score:.45}];}
  }else if(metadata.container==='pdf'){
   if(comic.test(metadata.subject+' '+metadata.keywords)){type='comic';confidence=.93;reason='有效 PDF 文件头及漫画主题元数据';}
   else if(nonComic.test(metadata.subject+' '+metadata.keywords)){type='book';confidence=.9;reason='有效 PDF 容器与非漫画出版主题共同确认';}
   else{type='document';confidence=metadata.title?.85:.72;reason='有效 PDF 文档；未取得出版物 / 漫画语义，不推断为小说或漫画';candidates=[{type:'document',score:confidence},{type:'book',score:.4}];}
  }else if(metadata.container==='mobi'){type='unknown_collection';confidence=.55;reason='MOBI 出版容器已确认，但缺少书籍 / 漫画语义，需确认';candidates=[{type:'book',score:.55},{type:'comic',score:.4}];}
  else if(metadata.container==='image-archive'&&metadata.comicInfo&&metadata.pages>0){type='comic';confidence=.98;reason='ComicInfo 语义元数据与实际图片页共同确认漫画';}
  else if(metadata.container==='image-archive'&&metadata.pages>0){type='unknown_collection';confidence=.5;reason='归档包含图片，但不足以区分漫画、扫描教材或画册';candidates=[{type:'comic',score:.5},{type:'document',score:.5}];}
  else if(metadata.container==='text'&&metadata.textual){type='document';confidence=.7;reason='可读文本内容，仅能确认文档，不凭 TXT 扩展名判定小说';candidates=[{type:'document',score:.7},{type:'book',score:.35}];}
 }else if(kind==='images'){
  type=metadata.comicInfo?'comic':'unknown_collection';confidence=metadata.comicInfo?.98:.5;reason=metadata.comicInfo?'图片页与 ComicInfo 语义共同确认漫画':'图片序列不能区分漫画与扫描教材，需确认';candidates=metadata.comicInfo?[]:[{type:'comic',score:.5},{type:'document',score:.5}];
 }else if(kind==='video'&&metadata.validVideo){type='video';confidence=.96;reason='媒体扩展名与容器文件头一致';}
 const density=require('./scan-publication-density').estimate(metadata);if(density&&['unknown_collection','document'].includes(type)&&!nonComic.test(metadata.subject||'')&&!comic.test(metadata.subject||'')){type=density.type;confidence=density.confidence;reason=density.reason;candidates=[{type,score:confidence}];}
 return {type,confidence,candidates:candidates.length?candidates:[{type,score:confidence}],reason,conflicts:conflict?['多个已确认规则给出不同类型']:[]};
}
const canonicalType=type=>({movie:'video',anime:'video',manga:'comic',other:'unknown_file'}[type]||type);
const uiType=type=>({video:'movie',comic:'manga',unknown_file:'other'}[type]||type);
module.exports={classify,canonicalType,uiType};
