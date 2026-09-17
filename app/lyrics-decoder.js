/* Strict local lyric decoding. Encoding-less legacy text is inherently ambiguous. */
function decode(bytes){bytes=Buffer.from(bytes);const reasons=[];const bad=text=>/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(text);
 const read=encoding=>{try{const text=new TextDecoder(encoding,{fatal:true}).decode(bytes).replace(/^\uFEFF/,'');if(bad(text))throw Error('binary/control characters');return text}catch(e){reasons.push(encoding+': '+e.message);return null}};
 const bom=bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf?'utf-8':bytes[0]===0xff&&bytes[1]===0xfe?'utf-16le':bytes[0]===0xfe&&bytes[1]===0xff?'utf-16be':null;
 if(bom){const text=read(bom);if(text!==null)return text}else if(!bytes.includes(0)){const utf=read('utf-8');if(utf!==null)return utf;const candidates=['gb18030','shift-jis'].map(encoding=>({encoding,text:read(encoding)})).filter(c=>c.text!==null);const score=t=>(t.match(/[\u3040-\u30ff]/g)||[]).length*3-(t.match(/[\uff61-\uff9f]/g)||[]).length*2; candidates.sort((a,b)=>score(b.text)-score(a.text));if(candidates.length)return candidates[0].text;}
 const error=Error('歌词文件编码无法识别或文件已损坏，请另存为 UTF-8 文本后重试');error.code='LYRICS_ENCODING';error.cause=reasons.join('; ')||'binary/NUL data';console.warn('[lyrics-decoder]',error.code,error.cause);throw error;
}module.exports={decode};
