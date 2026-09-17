export interface QueueEntry {
  queueEntryId: string;
  path: string;
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
  resourceId?: string;
  memberId?: string;
  context?: 'music' | 'asmr' | 'radio' | 'other' | 'video';
}
export interface PlaybackSample {
  generation: number;
  position: number;
  duration: number;
  paused: boolean;
  ended: boolean;
  hasVideo: boolean;
}
export interface Backend {
  cancelPending?():void;
  load(file: string, generation: number, start: number): Promise<void>;
  pause(paused: boolean): Promise<void>;
  seek(seconds: number): Promise<void>;
  stop(): Promise<void>;
  volume(value: number, muted: boolean): Promise<void>;
  sample(generation: number): Promise<PlaybackSample | null>;
  close(): Promise<void>;
}
export interface PlayerState {
  revision: number;
  generation: number;
  queue: QueueEntry[];
  currentId: string | null;
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'error';
  position: number;
  duration: number;
  hasVideo: boolean;
  volume: number;
  muted: boolean;
  error: string | null;
}
// Requests are data, never renderer-provided mpv commands or shell fragments.
export type PlayerCommand =
  | { type: 'play'; id: string }
  | { type: 'pause'; paused: boolean }
  | { type: 'seek'; seconds: number }
  | { type: 'stop' }
  | { type: 'volume'; value: number; muted: boolean }
  | { type: 'remove'; id: string }
  | { type: 'reorder'; ids: string[] };

export function validateCommand(value: unknown): PlayerCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('播放请求无效');
  const v = value as Record<string, unknown>;
  const id = () => { if (typeof v.id !== 'string' || !v.id || v.id.length > 150) throw Error('队列标识无效'); return v.id; };
  switch (v.type) {
    case 'play': case 'remove': return { type: v.type, id: id() };
    case 'stop': return { type: 'stop' };
    case 'pause': if (typeof v.paused === 'boolean') return { type: 'pause', paused: v.paused }; break;
    case 'volume': if (typeof v.value === 'number' && Number.isFinite(v.value) && v.value >= 0 && v.value <= 100 && typeof v.muted === 'boolean') return { type: 'volume', value: v.value, muted: v.muted }; break;
    case 'seek': if (typeof v.seconds === 'number' && Number.isFinite(v.seconds) && v.seconds >= 0 && v.seconds <= 864000) return { type: 'seek', seconds: v.seconds }; break;
    case 'reorder': if (Array.isArray(v.ids) && v.ids.length <= 10000 && v.ids.every(x => typeof x === 'string' && x.length > 0 && x.length <= 150)) return { type: 'reorder', ids: [...v.ids] }; break;
  }
  throw Error('未知或无效的播放请求');
}
