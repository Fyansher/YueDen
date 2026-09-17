import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import type { Backend, PlayerState, QueueEntry } from './contracts';

const remoteReference=require('../../player-source').parse;
/** Same validation and duplicate policy for active and saved context queues. */
export function prepareAppend(queue:QueueEntry[],entries:Omit<QueueEntry,'queueEntryId'>[],allowDuplicates:boolean):QueueEntry[]{
    if (!Array.isArray(entries) || entries.length > 10000) throw Error('队列过长');
    const identity=require('../../player-queue').identity,seen=new Set(queue.map(identity));
    if(!allowDuplicates)entries=entries.filter(e=>{const id=identity(e);if(seen.has(id))return false;seen.add(id);return true;});
    if(queue.length+entries.length>10000)throw Error('队列过长');
    const rows = entries.map(entry => {
      if (typeof entry.path !== 'string' || (!isAbsolute(entry.path)&&!remoteReference(entry.path)) || entry.path.includes('\0') || typeof entry.title !== 'string') throw Error('只接受已授权文件或资料库音轨引用');
      return { ...structuredClone(entry), queueEntryId: randomUUID() };
    });
  return rows;
}
type Listener = (state: PlayerState) => void;
/** Main-process state only. Callers must authorize file paths before append. */
export class PlayerSession {
  private state: PlayerState = { revision: 0, generation: 0, queue: [], currentId: null, status: 'idle', position: 0, duration: 0, hasVideo: false, volume: 80, muted: false, error: null };
  private listeners = new Set<Listener>();
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private polling = false;
  private adjusting=false;
  private adjustmentRevision=0;
  allowDuplicates = true;
  constructor(private backend: Backend, private progress: (entry: QueueEntry, seconds: number) => Promise<void> = async () => {}, private onEnded?:()=>Promise<void>) {}
  snapshot(): PlayerState { return structuredClone(this.state); }
  restore(queue: QueueEntry[], currentId: string | null = null, volume=this.state.volume, muted=this.state.muted): void {
    if (this.closed || !['idle','stopped','error'].includes(this.state.status)) throw Error('先停止播放再恢复队列');
    if (!Array.isArray(queue) || queue.length > 10000 || new Set(queue.map(e=>e.queueEntryId)).size !== queue.length || queue.some(e=>typeof e.queueEntryId!=='string'||!e.queueEntryId||e.queueEntryId.length>150||typeof e.path!=='string'||(!isAbsolute(e.path)&&!remoteReference(e.path))||e.path.includes('\0')||typeof e.title!=='string')) throw Error('保存的队列无效');
    if(!Number.isFinite(volume)||volume<0||volume>100||typeof muted!=='boolean')throw Error('保存的音量无效');
    this.state.volume=volume;this.state.muted=muted;
    this.state.queue = structuredClone(queue); this.state.currentId = queue.some(e=>e.queueEntryId===currentId)?currentId:null; this.publish();
  }
  // Register first, then supply a revisioned snapshot in the same synchronous turn.
  subscribe(listener: Listener): () => void {
    if (this.closed) throw Error('播放会话已关闭');
    this.listeners.add(listener);
    try { listener(this.snapshot()); } catch (error) { this.listeners.delete(listener); throw error; }
    return () => this.listeners.delete(listener);
  }
  private publish(): void {
    this.state.revision++;
    for (const listener of this.listeners) { try { listener(this.snapshot()); } catch { this.listeners.delete(listener); } }
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(Error('播放会话已关闭'));
    const task = this.tail.then(action); this.tail = task.catch(() => {}); return task;
  }
  append(entries: Omit<QueueEntry, 'queueEntryId'>[]): QueueEntry[] {
    if (this.closed) throw Error('播放会话已关闭');
    const rows=prepareAppend(this.state.queue,entries,this.allowDuplicates);
    this.state.queue.push(...rows); this.publish(); return structuredClone(rows);
  }
  reorder(ids: string[]): void {
    if (this.closed) throw Error('播放会话已关闭');
    const byId = new Map(this.state.queue.map(entry => [entry.queueEntryId, entry]));
    if (ids.length !== byId.size || new Set(ids).size !== ids.length || ids.some(id => !byId.has(id))) throw Error('排序必须恰好包含当前队列');
    this.state.queue = ids.map(id => byId.get(id)!); this.publish();
  }
  play(id: string, start = 0): Promise<void> {
    if (!Number.isFinite(start) || start < 0 || start > 864000) return Promise.reject(Error('续播位置无效'));
    if (this.closed) return Promise.reject(Error('播放会话已关闭'));
    const entry = this.state.queue.find(row => row.queueEntryId === id);
    if (!entry) return Promise.reject(Error('队列项不存在'));
    const saved = this.saveProgress().then(() => null, error => error);
    this.backend.cancelPending?.();
    const generation = ++this.state.generation;
    this.state.currentId = id; this.state.status = 'loading'; this.state.position = 0; this.state.duration = 0; this.state.hasVideo = false; this.state.error = null; this.publish();
    return this.serial(async () => {
      if (generation !== this.state.generation) return;
      try {
        const saveError = await saved;
        if (saveError) throw saveError;
        await this.backend.load(entry.path, generation, start);
        if (generation !== this.state.generation) return;
        await this.backend.volume(this.state.volume, this.state.muted);
        // Actual playing/paused status waits for a real backend sample.
      } catch (error) {
        try { await this.backend.stop(); } catch { /* Preserve the original failure. */ }
        this.reportError(generation, error);
      }
    });
  }
  private reportError(generation: number, error: unknown): void {
    if (this.closed || generation !== this.state.generation) return;
    this.state.status = 'error'; this.state.hasVideo = false; this.state.error = error instanceof Error ? error.message : String(error); this.publish();
  }
  private control(action: () => Promise<void>): Promise<void> {
    const generation = this.state.generation;
    return this.serial(async () => { if (generation !== this.state.generation) return; try { await action(); } catch (error) { this.reportError(generation, error); } });
  }
  pause(paused: boolean): Promise<void> {
    if (typeof paused !== 'boolean') return Promise.reject(Error('暂停参数无效'));
    return this.control(() => this.backend.pause(paused));
  }
  seek(seconds: number): Promise<void> {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 864000) return Promise.reject(Error('播放位置无效'));
    return this.control(() => this.backend.seek(seconds));
  }
  volume(value: number, muted: boolean): Promise<void> {
    if (!Number.isFinite(value) || value < 0 || value > 100 || typeof muted !== 'boolean') return Promise.reject(Error('音量无效'));
    return this.control(async () => { await this.backend.volume(value, muted); this.state.volume = value; this.state.muted = muted; this.publish(); });
  }
  adjust(kind:'seek'|'volume'|'toggle',step:number=0):Promise<void>{
    if(!['seek','volume','toggle'].includes(kind)||![-1,0,1].includes(step)||kind!=='toggle'&&step===0)return Promise.reject(Error('快捷操作无效'));
    return this.control(async()=>{
      if(kind!=='volume'&&!['playing','paused'].includes(this.state.status))return;
      this.adjusting=true;this.adjustmentRevision++;
      try{if(kind==='seek'){if(this.state.duration<=0)return;const target=Math.max(0,Math.min(this.state.duration,this.state.position+step));await this.backend.seek(target);this.state.position=target;}
      else if(kind==='volume'){const value=Math.max(0,Math.min(100,this.state.volume+step));await this.backend.volume(value,this.state.muted);this.state.volume=value;}
      else {const paused=this.state.status==='playing';await this.backend.pause(paused);this.state.status=paused?'paused':'playing';}this.publish();}
      finally{this.adjusting=false;}
    });
  }
  private async saveProgress(): Promise<void> {
    const entry = this.state.queue.find(row => row.queueEntryId === this.state.currentId);
    if (entry && this.state.position > 0) await this.progress(structuredClone(entry), this.state.position);
  }
  stop(): Promise<void> {
    if (this.closed) return Promise.reject(Error('播放会话已关闭'));
    const save = this.saveProgress().then(() => null, error => error); // Capture before reset; observe failures immediately.
    const generation = ++this.state.generation;
    this.state.status = 'stopped'; this.state.position = 0; this.state.duration = 0; this.state.hasVideo = false; this.publish();
    return this.serial(async () => { await this.backend.stop(); const error = await save; if (error) throw error; }).catch(error => this.reportError(generation, error));
  }
  async removeMany(ids:string[]):Promise<void>{
    if(this.closed)throw Error('播放会话已关闭');
    const remove=new Set(ids),stopping=this.state.currentId!==null&&remove.has(this.state.currentId);
    const stopped=stopping?this.stop():Promise.resolve();
    if(stopping)this.state.currentId=null;
    this.state.queue=this.state.queue.filter(e=>!remove.has(e.queueEntryId));this.publish();await stopped;
  }
  async remove(id: string): Promise<void> {
    if (this.closed) throw Error('播放会话已关闭');
    if (this.state.currentId === id) {
      // Clear current synchronously; a subsequent selection must not be erased by this stop.
      const stopped = this.stop(); this.state.currentId = null; this.state.error = null;
      this.state.queue = this.state.queue.filter(row => row.queueEntryId !== id); this.publish(); await stopped;
    } else { this.state.queue = this.state.queue.filter(row => row.queueEntryId !== id); this.publish(); }
  }
  async next(direction: 1 | -1 = 1): Promise<void> {
    const index = this.state.queue.findIndex(row => row.queueEntryId === this.state.currentId);
    const entry = index >= 0 ? this.state.queue[index + direction] : undefined;
    if (entry) await this.play(entry.queueEntryId); else await this.stop();
  }
  async poll(): Promise<void> {
    if (this.closed || this.polling || this.adjusting || !['loading','playing','paused'].includes(this.state.status)) return;
    this.polling = true;
    const generation = this.state.generation,adjustmentRevision=this.adjustmentRevision;
    try {
      const sample = await this.backend.sample(generation);
      if (this.closed || this.adjusting || adjustmentRevision!==this.adjustmentRevision || generation !== this.state.generation || sample?.generation !== generation) return;
      if (![sample.position, sample.duration].every(x => Number.isFinite(x) && x >= 0)) throw Error('后端播放位置无效');
      this.state.position = sample.position; this.state.duration = sample.duration; this.state.hasVideo = sample.hasVideo;
      this.state.status = sample.paused ? 'paused' : 'playing'; this.publish();
      if (sample.ended) { await this.saveProgress(); if (generation === this.state.generation) await (this.onEnded?this.onEnded():this.next()); }
    } catch (error) { this.reportError(generation, error); } finally { this.polling = false; }
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.backend.cancelPending?.();this.closed = true; this.state.generation++; this.listeners.clear();
    try { await this.tail; await this.saveProgress(); } finally { await this.backend.close(); }
  }
}
