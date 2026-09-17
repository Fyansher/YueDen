import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {QueueEntry} from './contracts';
/** Import local references into a new file. Never rewrite a legacy source. */
export function importLegacy(directory:string,library:any){
  const names=['audio-session.json','reader-progress.json'];const data:any={};
  for(const name of names){const file=path.join(directory,name);if(!fs.existsSync(file)){data[name]={};continue}const value=JSON.parse(fs.readFileSync(file,'utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error(name+' 损坏，停止迁移');data[name]=value}
  const audio=data['audio-session.json'];if(audio.version!==undefined&&![1,2].includes(audio.version))throw Error('未知声音会话版本');
  if(audio.queue!==undefined&&!Array.isArray(audio.queue)||audio.progress!==undefined&&!Array.isArray(audio.progress)||audio.bookmarks!==undefined&&!Array.isArray(audio.bookmarks))throw Error('声音会话结构损坏');
  const contexts:any={},positions:any={},bookmarks:any[]=[];let unresolved=0;
  const key=(entry:QueueEntry)=>JSON.stringify([entry.resourceId,entry.memberId]);
  const convert=(ref:any):QueueEntry|null=>{const item=library.items.find((i:any)=>i.id===ref.itemId&&i.type==='audio'),track=item?.audio?.tracks?.find((t:any)=>t.id===ref.trackId),source=item?.audio?.sources?.find((s:any)=>s.id===(track?.preferredSourceId||track?.sourceRefs?.[0]));if(!source||source.kind!=='local'){unresolved++;return null}return {queueEntryId:typeof ref.queueEntryId==='string'&&ref.queueEntryId?ref.queueEntryId:randomUUID(),path:source.localPath,title:track.title||item.name,resourceId:item.id,memberId:track.id,context:item.audio.kind}};
  for(const kind of ['music','asmr','radio','other']){const saved=kind===(audio.activeContext||'music')?audio:audio.contexts?.[kind]||{};if(saved.queue!==undefined&&!Array.isArray(saved.queue))throw Error('声音分区队列损坏');const old=saved.queue||[],pairs=old.map((ref:any)=>({ref,entry:convert(ref)})),queue=pairs.map((p:any)=>p.entry).filter(Boolean);const selected=pairs[saved.index||0]?.entry;contexts[kind]={queue,currentId:selected?.queueEntryId||null,repeat:saved.repeat||'none',shuffle:!!saved.shuffle,shuffleOrder:saved.shuffleOrder||[]};}
  for(const item of library.items.filter((i:any)=>i.type==='audio'))for(const track of item.audio?.tracks||[]){const old=audio.progress?.find((p:any)=>p.trackId===track.id);if(Number.isFinite(old?.position)&&old.position>=0)positions[JSON.stringify([item.id,track.id])]=old.position}
  for(const mark of audio.bookmarks||[]){const entry=convert(mark);if(entry)bookmarks.push({...mark,key:key(entry),title:entry.title,id:mark.id||randomUUID()})}
  const lastMembers:any={};for(const item of library.items.filter((i:any)=>['movie','anime'].includes(i.type))){const old=data['reader-progress.json'][item.id];if(!old)continue;lastMembers[item.id]=old.member;for(const [member,value]of Object.entries(old.positions||{})){const time=(value as any)?.time;if(Number.isFinite(time)&&time>=0)positions[JSON.stringify([item.id,member])]=time}}
  // All input validation precedes backups or destination writes; retries do not overwrite backups.
  for(const name of names){const source=path.join(directory,name);if(fs.existsSync(source)){try{fs.copyFileSync(source,source+'.before-player-v1.bak',fs.constants.COPYFILE_EXCL)}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error}}}
  return {contexts,positions,bookmarks,lastMembers,legacyImported:true,legacyUnresolved:unresolved};
}
