import { invoke } from './native';
import type { Segment } from '../types';
let nextSession = Date.now() * 1000;
type Callbacks = {
  frame: (source: NativeFrame, time: number) => void;
  time: (time: number) => void;
  waiting: (waiting: boolean) => void;
  ended: () => void;
  error: (error: unknown) => void;
};
export type NativeFrame = { width: number; height: number; pixels: Uint8Array<ArrayBuffer>; sequence: number };
// A pull transport provides backpressure: at most one binary frame request is
// in flight. The native engine owns decoding/audio/time even if UI rendering
// slows down. Editing the scene does not touch this session.
export class NativePlayback {
  private readonly snapshot = document.createElement('canvas');
  private snapshotSequence = 0;
  frame: NativeFrame | null = null;
  private session = ++nextSession;
  private disposed = false;
  private timer = 0;
  private sequence = 0;
  private commands: Promise<void>;
  private latestTime = 0;
  private waiting = true;
  constructor(path: string, time: number, segments: Segment[], private callbacks: Callbacks) {
    this.latestTime = time;
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
          this.frame = { width, height, sequence, pixels: new Uint8Array(buffer, 32) };
          this.callbacks.frame(this.frame, time);
        }
        if (flags & 4) this.callbacks.ended();
      }
    } catch (error) { this.fail(error); return; }
    // Poll above the source cadence so a request that lands just before a
    // decoded frame does not halve visible 60 FPS playback. Unchanged replies
    // contain only the 32-byte header; image payloads remain frame-bounded.
    if (!this.disposed) this.timer = window.setTimeout(() => void this.poll(), Math.max(0, 1000 / 120 - (performance.now() - started)));
  }
  control(values: { playing?: boolean; time?: number; segments?: Segment[] }) {
    if (this.disposed) return;
    this.commands = this.commands.then(async () => {
      if (!this.disposed) await invoke<void>('playback_control', { session: this.session, ...values });
    });
    void this.commands.catch(error => this.fail(error));
  }
  seek(time: number) {
    if (Math.abs(time - this.latestTime) <= .045) return;
    this.latestTime = time;
    // Keep the local state in lockstep with the callback. Otherwise the next
    // ready packet can look unchanged and leave the React loading overlay up.
    this.waiting = true;
    this.callbacks.waiting(true);
    this.control({ time });
  }
  snapshotCanvas() {
    const frame = this.frame;
    if (!frame) return null;
    if (this.snapshotSequence !== frame.sequence) {
      if (this.snapshot.width !== frame.width || this.snapshot.height !== frame.height) {
        this.snapshot.width = frame.width; this.snapshot.height = frame.height;
      }
      const pixels = new Uint8ClampedArray(frame.pixels.buffer, frame.pixels.byteOffset, frame.pixels.byteLength);
      this.snapshot.getContext('2d', { alpha: false })!.putImageData(new ImageData(pixels, frame.width, frame.height), 0, 0);
      this.snapshotSequence = frame.sequence;
    }
    return this.snapshot;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; clearTimeout(this.timer);
    void this.commands.catch(() => { }).then(() => invoke('playback_close', { session: this.session })).catch(() => { });
  }
}
