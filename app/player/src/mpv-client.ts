import { Socket, createConnection } from 'node:net';

interface Pending { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>; }
/** One connection, bounded JSON lines, correlated replies and bounded waits. */
export class MpvClient {
  private nextId = 0;
  private pending = new Map<number, Pending>();
  private buffer = '';
  private closed = false;
  private events = new Set<(event: Record<string, unknown>) => void>();
  constructor(private socket: Socket, private timeout = 5000) {
    socket.setEncoding('utf8');
    socket.on('data', chunk => this.receive(String(chunk)));
    socket.on('error', error => this.fail(error));
    socket.on('close', () => this.fail(Error('播放后端连接已关闭')));
  }
  static async connect(pipe: string, timeout = 5000): Promise<MpvClient> {
    const deadline = Date.now() + timeout;
    while (true) {
      try {
        const socket = await new Promise<Socket>((resolve, reject) => {
          const s = createConnection(pipe);
          const timer = setTimeout(() => { s.destroy(); reject(Error('命名管道连接超时')); }, Math.max(1, deadline - Date.now()));
          s.once('connect', () => { clearTimeout(timer); resolve(s); });
          s.once('error', error => { clearTimeout(timer); s.destroy(); reject(error); });
        });
        return new MpvClient(socket);
      } catch (error) {
        if (Date.now() >= deadline) throw error;
        await new Promise(resolve => setTimeout(resolve, Math.min(50, deadline - Date.now())));
      }
    }
  }
  request(command: readonly unknown[]): Promise<unknown> {
    if (this.closed) return Promise.reject(Error('播放后端未连接'));
    if (this.pending.size >= 128) return Promise.reject(Error('播放后端请求过多'));
    const request_id = ++this.nextId;
    let line: string;
    try { line = JSON.stringify({ command, request_id }) + '\n'; } catch { return Promise.reject(Error('播放命令无法编码')); }
    if (Buffer.byteLength(line) > 65536) return Promise.reject(Error('播放命令过长'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(request_id); reject(Error('播放后端响应超时')); }, this.timeout);
      this.pending.set(request_id, { resolve, reject, timer });
      this.socket.write(line, error => { if (error) this.fail(error); });
    });
  }
  private receive(chunk: string): void {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > 2 * 1024 * 1024) { this.fail(Error('播放后端响应过大')); return; }
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1);
      let message: { request_id?: number; error?: string; data?: unknown };
      try { message = JSON.parse(line); } catch { this.fail(Error('播放后端 JSON 损坏')); return; }
      if (!message || typeof message !== 'object') { this.fail(Error('播放后端响应结构无效')); return; }
      if (typeof message.request_id !== 'number') {
        for (const listener of this.events) listener(message as Record<string, unknown>);
        continue;
      }
      const pending = this.pending.get(message.request_id); if (!pending) continue;
      clearTimeout(pending.timer); this.pending.delete(message.request_id);
      if (message.error === 'success') pending.resolve(message.data);
      else pending.reject(Error('播放后端：' + String(message.error || '未知错误').slice(0,200)));
    }
  }
  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const value of this.pending.values()) { clearTimeout(value.timer); value.reject(error); }
    this.pending.clear(); this.buffer = ''; this.socket.destroy();
  }
  close(): void { this.fail(Error('播放会话已关闭')); }
  onEvent(listener: (event: Record<string, unknown>) => void): () => void {
    this.events.add(listener); return () => this.events.delete(listener);
  }
}
