import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
export interface Lyrics { status:'none'|'empty'|'error'|'synced'|'plain'; lines:{time:number;text:string;translation?:string}[]; message:string; }
// Reuse the application's timestamp/multiple-tag/offset parser.
const parse=require('../../audio-lyrics').parse;
export function fromText(text:string,offset=0,translation=''):Lyrics{
 if(!text.trim())return {status:'empty',lines:[],message:'歌词为空'};
 const value=parse(text),groups=new Map<number,{time:number;text:string;translation?:string}>();
 const appendTranslation=(line:{text:string;translation?:string},text:string)=>{if(text&&text!==line.text&&!(line.translation||'').split('\n').includes(text))line.translation=[line.translation,text].filter(Boolean).join('\n');};
 for(const line of value.lines){const timestamp=Math.round(line.time*1000),group=groups.get(timestamp);if(group)appendTranslation(group,line.text);else groups.set(timestamp,{time:(timestamp+offset)/1000,text:line.text});}
 // Separate translated LRC is aligned by its own timestamps (including its embedded offset).
 // Untimed translation is never guessed onto unrelated timed original lines.
 if(typeof translation==='string')for(const line of parse(translation).lines){const group=groups.get(Math.round(line.time*1000));if(group)appendTranslation(group,line.text);}
 return groups.size?{status:'synced',lines:[...groups.values()],message:''}:{status:'plain',lines:[],message:[text,translation].filter(Boolean).join('\n\n')};
}
export async function loadLyrics(media:string,manual?:string):Promise<Lyrics>{
  const file=manual||media.slice(0,-extname(media).length)+'.lrc';
  try{
    const info=await stat(file);if(!info.isFile()||info.size>2*1024*1024)throw Error('歌词文件超过 2 MB 或不是文件');
    const bytes=await readFile(file);const text=require('../../lyrics-decoder').decode(bytes);if(!text.trim())return {status:'empty',lines:[],message:'歌词文件为空'};
    return fromText(text);
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {status:'none',lines:[],message:'没有同名本地歌词'};return {status:'error',lines:[],message:error instanceof Error?error.message:String(error)}}
}
