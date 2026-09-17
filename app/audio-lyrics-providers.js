const norm=v=>String(v||'').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const Status=require('./provider-status');
const labels={lrclib:'LRCLIB',netease:'网易云音乐',qq:'QQ 音乐',ovh:'lyrics.ovh',kugou:'酷狗音乐'};
function decode(value){if(typeof value!=='string'||value.length>2800000||!/^[A-Za-z0-9+/=\r\n]*$/.test(value))throw new SyntaxError('歌词编码无效');const bytes=Buffer.from(value,'base64');if(bytes.toString('base64').replace(/=+$/,'')!==value.replace(/[\r\n=]/g,''))throw new SyntaxError('歌词编码无效');try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes).slice(0,2*1024*1024)}catch{throw new SyntaxError('歌词文本编码无效')}}
function create({json,music}){
 return async function lyrics(item,track,signal,source='auto',candidateId){
  if(['asmr','radio'].includes(item.audio?.kind))return {kind:'not-applicable',text:'',state:'skipped',message:'未执行：音声或电台不使用歌曲歌词搜索'};
  const title=String(track?.title||'').trim(),artist=track?.artists?.[0]||item.audio?.artists?.[0]||'';
  if(!title||!artist)return {kind:'none',text:'',message:'请填写歌曲名称和艺术家'};
  const pick=(rows,id)=>rows.length===1?rows[0]:rows.find(r=>r.id===id);
  const review=choices=>({kind:choices.length?'review':'none',text:'',mismatch:choices.length>1,choices});
  const query=encodeURIComponent(title+' '+artist);
  const providers={
   lrclib:()=>music.lyrics(item,{...track,title},signal),
   netease:async()=>{
    const data=await json('https://music.163.com/api/search/get?type=1&limit=20&s='+query,signal);
    if(!data.result||(!Array.isArray(data.result.songs)&&data.result.songCount!==0))throw new SyntaxError('网易云歌曲响应格式无效');
    const matches=(data.result.songs||[]).filter(s=>norm(s.name)===norm(title)&&(s.artists||[]).some(a=>norm(a.name)===norm(artist))&&(!track.durationSeconds||Math.abs(Number(s.duration)/1000-track.durationSeconds)<=3));
    const choices=matches.map(s=>({id:String(s.id),title:s.name,artist:s.artists.map(a=>a.name).join(' / '),album:s.album?.name||'',duration:Number(s.duration)/1000,provider:'netease'}));
    const selected=pick(choices,candidateId);if(!selected)return review(choices);
    const dataLyrics=await json('https://music.163.com/api/song/lyric?id='+Number(selected.id)+'&lv=1&kv=-1&tv=-1',signal),text=String(dataLyrics.lrc?.lyric||'').slice(0,2*1024*1024);
    if(dataLyrics.tlyric?.lyric!=null&&typeof dataLyrics.tlyric.lyric!=='string')throw new SyntaxError('网易云翻译歌词格式无效');
    return {...selected,kind:dataLyrics.nolyric?'instrumental':text?'synced':'none',text,...(dataLyrics.tlyric?.lyric?{translation:String(dataLyrics.tlyric.lyric).slice(0,2*1024*1024)}:{}),choices,source:labels.netease};
   },
   qq:async()=>{
    const data=await json('https://c.y.qq.com/soso/fcgi-bin/client_search_cp?format=json&p=1&n=20&w='+query,signal);
    if(!Array.isArray(data.data?.song?.list))throw new SyntaxError('QQ 歌曲响应格式无效');
    const choices=data.data.song.list.filter(s=>(s.singer||[]).some(a=>norm(a.name)===norm(artist))&&norm(s.songname).includes(norm(title))).map(s=>({id:String(s.songmid),title:s.songname,artist:s.singer.map(a=>a.name).join(' / '),album:s.albumname||'',duration:Number(s.interval)||0,provider:'qq'}));
    const selected=pick(choices,candidateId);if(!selected)return review(choices);
    const request={comm:{ct:24,cv:0},req_0:{module:'music.musichallSong.PlayLyricInfo',method:'GetPlayLyricInfo',param:{songMID:selected.id,songID:0}}};
    const response=await json('https://u.y.qq.com/cgi-bin/musicu.fcg?data='+encodeURIComponent(JSON.stringify(request)),signal),result=response.req_0;
    if(!result||!Number.isFinite(result.code))throw new SyntaxError('QQ 歌词响应格式无效');
    if(result.code!==0)throw Object.assign(Error('QQ 歌词服务错误 '+result.code),{status:result.code===429?429:502});
    if(result.data?.crypt)return {kind:'not-applicable',text:'',state:'skipped',message:'未执行：QQ 返回受保护歌词格式'};
    if(typeof result.data?.lyric!=='string')throw new SyntaxError('QQ 歌词内容格式无效');const text=decode(result.data.lyric);return {...selected,kind:text?'synced':'none',text,...(result.data.trans?{translation:decode(result.data.trans)}:{}),choices,source:labels.qq,mismatch:norm(selected.title)!==norm(title)};
   },
   kugou:async()=>{
    const data=await json('https://songsearch.kugou.com/song_search_v2?page=1&pagesize=20&keyword='+query,signal);
    if(data.status===0)throw Object.assign(Error(data.error_msg||'酷狗搜索失败'),{status:data.error_code===429?429:502});
    if(!Array.isArray(data.data?.lists))throw new SyntaxError('酷狗歌曲响应格式无效');
    const rows=data.data.lists.filter(s=>(s.Singers||[]).some(a=>norm(a.name)===norm(artist))&&norm(s.SongName).includes(norm(title))&&/^[a-f\d]{32}$/i.test(s.FileHash||''));
    const choices=rows.map(s=>({id:String(s.MixSongID||s.FileHash),title:s.SongName,artist:(s.Singers||[]).map(a=>a.name).join(' / '),album:s.AlbumName||'',duration:Number(s.Duration)||0,provider:'kugou'}));
    const selected=pick(choices,candidateId);if(!selected)return review(choices);const song=rows[choices.indexOf(selected)];
    const response=await json('https://lyrics.kugou.com/search?ver=1&man=yes&client=pc&hash='+encodeURIComponent(song.FileHash)+'&duration='+Math.round(selected.duration*1000)+'&keyword='+encodeURIComponent(selected.title),signal);
    if(response.status!==200)throw Object.assign(Error('酷狗歌词搜索失败 '+response.status),{status:response.status===429?429:502});
    if(!Array.isArray(response.candidates))throw new SyntaxError('酷狗歌词候选格式无效');
    const lyric=response.candidates.find(c=>norm(c.song)===norm(selected.title)&&norm(c.singer)===norm(selected.artist));if(!lyric)return {...review([]),choices};
    if(typeof lyric.accesskey!=='string'||!lyric.id)throw new SyntaxError('酷狗歌词下载信息无效');
    const downloaded=await json('https://lyrics.kugou.com/download?ver=1&client=pc&id='+encodeURIComponent(lyric.id)+'&accesskey='+encodeURIComponent(lyric.accesskey)+'&fmt=lrc&charset=utf8',signal);
    if(downloaded.status!==200)throw Object.assign(Error('酷狗歌词下载失败 '+downloaded.status),{status:downloaded.status===429?429:502});
    if(typeof downloaded.content!=='string')throw new SyntaxError('酷狗歌词内容格式无效');const text=decode(downloaded.content);return {...selected,kind:text?'synced':'none',text,choices,source:labels.kugou,mismatch:norm(selected.title)!==norm(title)};
   },
   ovh:async()=>{const data=await json('https://api.lyrics.ovh/v1/'+encodeURIComponent(artist)+'/'+encodeURIComponent(title),signal);return {kind:data.lyrics?'plain':'none',text:String(data.lyrics||'').slice(0,2*1024*1024),source:labels.ovh,title,artist,mismatch:true};}
  };
  if(source!=='auto'&&!providers[source])throw Error('未知歌词来源');
  // A prefixed candidate routes "all sources" selection back to its actual provider.
  const prefix=String(candidateId||'').match(/^(lrclib|netease|qq|ovh|kugou):/);
  if(prefix){if(source==='auto')source=prefix[1];if(source!==prefix[1])throw Error('歌词版本不属于所选来源');candidateId=String(candidateId).slice(prefix[0].length);}
  const failures=[];let empty=null,choiceResult=null;
  for(const id of source==='auto'?['lrclib','netease','qq','kugou','ovh']:[source]){signal?.throwIfAborted();try{
    const r=await providers[id]();r.provider=id;if(r.kind==='none'&&r.choices?.length&&!r.message)r.message='此版本暂无可用歌词，请选择其他版本';
    r.choices=(r.choices||((r.text||r.kind==='instrumental')?[{id:'result',title:r.title||title,artist:r.artist||artist,album:r.album||track.albumTitle||'',duration:r.duration||track.durationSeconds||0}]:[])).map(c=>({...c,provider:id,id:id+':'+c.id,artist:c.artist||r.artist||artist}));
    if(r.text||r.kind==='instrumental'||source!=='auto'&&r.choices.length)return {...r,failures};
    if(r.choices.length&&!choiceResult)choiceResult=r;empty=r;
   }catch(e){signal?.throwIfAborted();const state=Status.classify(e);failures.push({provider:id,state,message:labels[id]+'：'+Status.labels[state]+(e.status?'（'+e.status+'）':'')});}}
  if(source!=='auto'&&failures.length)throw Error(failures.map(f=>f.message).join('；'));
  return {...(choiceResult||empty||{kind:'none',text:''}),failures,message:failures.length?failures.map(f=>f.message).join('；'):(choiceResult||empty)?.message||''};
 };
}
module.exports={create};
