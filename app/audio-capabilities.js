(function(root){
const capabilities={musicbrainz:{label:'MusicBrainz',album:true,track:true,albumDetail:true,trackDetail:true,cover:true},deezer:{label:'Deezer',album:true,track:true,albumDetail:true,trackDetail:true,cover:true},qq:{label:'QQ 音乐',album:true,albumDetail:true,track:true,cover:true},netease:{label:'网易云音乐',album:true,track:true,cover:true},kugou:{label:'酷狗音乐',album:true,track:true,cover:true}};
function entity(item){return item.audio?.kind==='asmr'?'work':item.audio?.collectionKind==='single'?'track':'album';}
function mapTracks(local,remote){return local.map(track=>{const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}]/gu,''),matches=remote.filter(candidate=>(track.identifiers?.musicbrainz&&track.identifiers.musicbrainz===candidate.id||norm(track.title)===norm(candidate.title))&&(!track.durationSeconds||!candidate.duration||Math.abs(track.durationSeconds-candidate.duration)<=2)&&(!track.artists?.length||!candidate.artists?.length||track.artists.some(a=>candidate.artists.some(b=>norm(a)===norm(b)))));return {trackId:track.id,title:track.title,candidate:matches.length===1?matches[0]:null,status:matches.length===1?'match':'review'};});}
const api={capabilities,entity,mapTracks};if(typeof module!=='undefined')module.exports=api;else root.AudioCapabilities=api;

})(typeof window==='undefined'?globalThis:window);
