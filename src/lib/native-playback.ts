import { invoke } from './native';
import type { Segment } from '../types';
let nextSession = Date.now() * 1000;
type Callbacks = {
  frame: (source: HTMLCanvasElement, time: number) => void;
  time: (time: number) => void;
  waiting: (waiting: boolean) => void;
  ended: () => void;
  error: (error: unknown) => void;
};
// A pull transport provides backpressure: at most one binary frame request is
// in flight. The native engine owns decoding/audio/time even if UI rendering
// slows down. Editing the scene does not touch this session.
export class NativePlayback {
  readonly source = document.createElement('canvas');
  private session = ++nextSession;
  private disposed = false;
  private timer = 0;
  private sequence = 0;
  private commands: Promise<void>;
  private latestTime = 0;
  private waiting = true;
  constructor(path: string, time: number, segments: Segment[], private callbacks: Callbacks) {
    this.latestTime = time;
    this.source.width = 0; this.source.height = 0;
    this.commands = invoke<void>('playback_open', { session: this.session, path, time, segments });
    void this.commands.then(() => { if (!this.disposed) void this.poll(); }).catch(error => this.fail(error));
  }
  private fail(error: unknown) {
    if (this.disposed) return;
    this.callbacks.error(error); this.dispose();
  }
  private async poll() {
    if (this.disposed) return;
    const started = performance.now();
    try {
      const response = await invoke<ArrayBuffer | number[]>('playback_frame', { session: this.session, last: this.sequence });
      if (this.disposed) return;
      const buffer = response instanceof ArrayBuffer ? response : Uint8Array.from(response).buffer;
      if (buffer.byteLength >= 32) {
        const header = new DataView(buffer), width = header.getUint32(0, true), height = header.getUint32(4, true), sequence = header.getUint32(8, true), flags = header.getUint32(12, true);
        const time = header.getFloat64(16, true);
        const waiting = !(flags & 2);
        if (waiting !== this.waiting) { this.waiting = waiting; this.callbacks.waiting(waiting); }
        this.latestTime = time;
        if (flags & 2) this.callbacks.time(time);
        if (buffer.byteLength > 32 && sequence !== this.sequence) {
          if (buffer.byteLength !== 32 + width * height * 4) throw new Error('Invalid decoded frame');
          this.sequence = sequence;
          if (this.source.width !== width || this.source.height !== height) { this.source.width = width; this.source.height = height; }
          const ctx = this.source.getContext('2d', { alpha: false })!;
          ctx.putImageData(new ImageData(new Uint8ClampedArray(buffer, 32), width, height), 0, 0);
          this.callbacks.frame(this.source, time);
        }
        if (flags & 4) this.callbacks.ended();
      }
    } catch (error) { this.fail(error); return; }
    if (!this.disposed) this.timer = window.setTimeout(() => void this.poll(), Math.max(0, 1000 / 60 - (performance.now() - started)));
  }
  control(values: { playing?: boolean; time?: number; segments?: Segment[] }) {
    if (this.disposed) return;
    this.commands = this.commands.then(async () => {
      if (!this.disposed) await invoke<void>('playback_control', { session: this.session, ...values });
    });
    void this.commands.catch(error => this.fail(error));
  }
  seek(time: number) { if (Math.abs(time - this.latestTime) > .045) { this.latestTime = time; this.callbacks.waiting(true); this.control({ time }); } }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; clearTimeout(this.timer);
    void this.commands.catch(() => { }).then(() => invoke('playback_close', { session: this.session })).catch(() => { });
  }
}
