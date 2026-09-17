import { spawn, type ChildProcess } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MpvClient } from './mpv-client';
import type { Backend, PlaybackSample } from './contracts';
import { filter, type Equalizer } from './equalizer';

/** Requires an already-created dedicated native child HWND, never the Electron top-level HWND. */
export class MpvBackend implements Backend {
  private static owner: MpvBackend | null = null;
  private process: ChildProcess | null = null;
  private client: MpvClient | null = null;
  private generation = 0;
  private loaded = false;
  private loadController:AbortController|null=null;
  private disposed = false;
  private playlistId: unknown = null;
  private playbackError: string | null = null;
  private initializing: Promise<void> | null = null;
  constructor(private executable: string, private childHandle: string, private resolveRemote?:(reference:string,signal:AbortSignal)=>Promise<string>,private brandAudio?:(pid:number)=>void) {
    if (!isAbsolute(executable) || !/^\d+$/.test(childHandle) || BigInt(childHandle) === 0n) throw Error('后端路径或原生子窗口句柄无效');
  }
  private async ready(): Promise<void> {
    if (this.disposed) throw Error('播放后端已关闭');
    if (this.client) return;
    if (this.initializing) return this.initializing;
    this.initializing = this.start();
    try { await this.initializing; } finally { this.initializing = null; }
  }
  private async start(): Promise<void> {
    if (MpvBackend.owner && MpvBackend.owner !== this) throw Error('已有实际播放会话');
    MpvBackend.owner = this;
    try {
      if (!(await stat(this.executable)).isFile()) throw Error('缺少随包 mpv');
      const pipe = '\\\\.\\pipe\\um-player-' + randomUUID();
      const child = spawn(this.executable, [
        '--no-config', '--audio-client-name=YueDen', '--title=YueDen', '--idle=yes', '--keep-open=yes', '--force-window=no', '--terminal=no',
        '--osc=no', '--input-default-bindings=no', '--input-vo-keyboard=no', '--input-cursor=no',
        '--load-scripts=no', '--ytdl=no', '--access-references=no', '--audio-spdif=', '--keepaspect=yes', '--panscan=0',
        '--wid=' + this.childHandle, '--input-ipc-server=' + pipe
      ], { shell: false, windowsHide: true, stdio: 'ignore' });
      this.process = child;
      child.on('error', error => { this.playbackError = error.message; this.client?.close(); });
      child.on('exit', () => { if (this.process !== child) return; this.playbackError = '播放后端进程已退出'; this.client?.close(); this.client = null; this.process = null; if (MpvBackend.owner === this) MpvBackend.owner = null; });
      this.client = await MpvClient.connect(pipe);
      this.client.onEvent(event => {
        if(['audio-reconfig','playback-restart'].includes(String(event.event))&&child.pid)this.brandAudio?.(child.pid);
        if (event.event === 'start-file') this.playlistId = event.playlist_entry_id;
        if (event.event === 'end-file' && event.playlist_entry_id === this.playlistId && event.reason === 'error') this.playbackError = String(event.file_error || '媒体解码失败');
      });
    } catch (error) {
      this.client?.close(); this.client = null; this.process?.kill(); this.process = null;
      if (MpvBackend.owner === this) MpvBackend.owner = null;
      throw error;
    }
  }
  private request(command: readonly unknown[]): Promise<unknown> {
    if (!this.client) return Promise.reject(Error('播放后端未启动'));
    return this.client.request(command);
  }
  cancelPending():void{this.loadController?.abort();}
  async load(file: string, generation: number, start: number): Promise<void> {
    this.cancelPending();const controller=this.loadController=new AbortController();let target=file;
    if(require('../../player-source').parse(file)){if(!this.resolveRemote)throw Error('远程播放服务不可用');const timer=setTimeout(()=>controller.abort(new DOMException('远程媒体打开超时','TimeoutError')),15000);try{target=await this.resolveRemote(file,controller.signal);}finally{clearTimeout(timer);}const u=new URL(target);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!/^\/[a-f0-9]{48}$/.test(u.pathname))throw Error('远程播放授权无效');}
    else if (!isAbsolute(file) || file.includes('\0') || !(await stat(file)).isFile()) throw Error('媒体文件不存在');
    if (!Number.isFinite(start) || start < 0 || start > 864000) throw Error('续播位置无效');
    controller.signal.throwIfAborted();await this.ready();
    this.generation = generation; this.loaded = false; this.playbackError = null;
    await this.request(['stop']);
    const client = this.client!;
    let remove: () => void = () => {};
    let timer: ReturnType<typeof setTimeout>;
    const loading = new Promise<void>((resolve, reject) => {
      let started = false;
      timer = setTimeout(() => reject(Error('媒体打开超时')), 15000);
      remove = client.onEvent(event => {
        if (event.event === 'start-file') started = true;
        if (started && event.event === 'file-loaded') resolve();
        if (started && event.event === 'end-file' && event.reason === 'error') reject(Error(String(event.file_error || '媒体解码失败')));
      });
    });
    // Attach rejection immediately so a pipe failure cannot leave an unhandled load timeout.
    void loading.catch(() => {});
    try {
      await this.request(['loadfile', target, 'replace', -1, { start: String(start), pause: 'no' }]);
      await loading;
      if (generation === this.generation) this.loaded = true;
    } finally { clearTimeout(timer!); remove(); }
  }
  async pause(paused: boolean): Promise<void> { await this.request(['set_property', 'pause', paused]); }
  async seek(seconds: number): Promise<void> { await this.request(['seek', seconds, 'absolute+exact']); }
  async stop(): Promise<void> { this.cancelPending();this.loaded = false; this.generation++; if (this.client) await this.request(['stop']); }
  async volume(value: number, muted: boolean): Promise<void> {
    await this.ready();
    await this.request(['set_property', 'volume', value]); await this.request(['set_property', 'mute', muted]);
  }
  async equalizer(value: Equalizer): Promise<void> { await this.request(['af', 'set', filter(value)]); }
  async speed(value:number):Promise<void>{if(!Number.isFinite(value)||value<0.25||value>4)throw Error('倍速无效');await this.request(['set_property','speed',value])}
  async subtitle(file:string):Promise<void>{if(!isAbsolute(file)||!(await stat(file)).isFile())throw Error('字幕文件不存在');await this.request(['sub-add',file,'select'])}
  async tracks():Promise<any[]>{return await this.request(['get_property','track-list']) as any[]}
  async track(type:'audio'|'sub',id:number|'no'):Promise<void>{if(!['audio','sub'].includes(type)||id!=='no'&&(!Number.isInteger(id)||id<0))throw Error('轨道无效');await this.request(['set_property',type==='audio'?'aid':'sid',id])}
  async sample(generation: number): Promise<PlaybackSample | null> {
    if (this.playbackError) throw Error(this.playbackError);
    if (!this.loaded || this.generation !== generation) return null;
    const values = await Promise.all(['time-pos','duration','pause','eof-reached','video-params'].map(name => this.request(['get_property', name]).catch(error => {
      if (name === 'video-params' && String(error.message).includes('property unavailable')) return null;
      throw error;
    })));
    if (this.generation !== generation || !this.loaded) return null;
    return { generation, position: Number(values[0]) || 0, duration: Number(values[1]) || 0, paused: Boolean(values[2]), ended: Boolean(values[3]), hasVideo: Boolean(values[4]) };
  }
  async close(): Promise<void> {
    if (this.disposed) return;
    this.cancelPending();this.disposed = true;
    await this.initializing?.catch(() => {});
    this.loaded = false; this.generation++;
    const child = this.process;
    try { if (this.client) await this.client.request(['quit']); } catch { /* Process may close before replying. */ }
    this.client?.close(); this.client = null;
    if (child && child.exitCode === null) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { child.kill(); resolve(); }, 1500);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
    this.process = null; if (MpvBackend.owner === this) MpvBackend.owner = null;
  }
}
