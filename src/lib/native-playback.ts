import { invoke } from './native';
import type { MusicTrack, Segment, SfxTrack } from '../types';
let nextSession = Date.now() * 1000;
type Callbacks = {
  frame: (source: NativeFrame, time: number) => void;
  time: (time: number) => void;
  waiting: (waiting: boolean) => void;
  ended: () => void;
  error: (error: unknown) => void;
  cost?: (milliseconds: number) => void;
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
  private polling = false;
  private timer = 0;
  private sequence = 0;
  private commands: Promise<void>;
  private latestTime = 0;
  private waiting = true;
  private waitingSince = performance.now();
  private desiredPlaying = false;
  private nativePlaying = false;
  constructor(path: string, time: number, segments: Segment[], private callbacks: Callbacks, private fps = 60, maxEdge = 640) {
    this.latestTime = time;
    this.commands = invoke<void>('playback_open', { session: this.session, path, time, segments, maxEdge });
    void this.commands.then(() => { if (!this.disposed) void this.poll(); }).catch(error => this.fail(error));
  }
  private fail(error: unknown) {
    if (this.disposed) return;
    this.callbacks.error(error); this.dispose();
  }
  private async poll() {
    if (this.disposed || this.polling) return;
    this.polling = true;
    const started = performance.now();
    let changed = false;
    try {
      const response = await invoke<ArrayBuffer | number[]>('playback_frame', { session: this.session, last: this.sequence });
      if (this.disposed) return;
      const buffer = response instanceof ArrayBuffer ? response : Uint8Array.from(response).buffer;
      if (buffer.byteLength >= 32) {
        const header = new DataView(buffer), width = header.getUint32(0, true), height = header.getUint32(4, true), sequence = header.getUint32(8, true), flags = header.getUint32(12, true);
        this.nativePlaying = Boolean(flags & 1);
        const time = header.getFloat64(16, true);
        const waiting = !(flags & 2);
        if (!waiting) this.waitingSince = performance.now();
        else if (performance.now() - this.waitingSince > 15000) throw new Error('Preview decoder did not deliver a frame within 15 seconds. Retry playback. In Docker, check audio forwarding or restart with RLCUT_PREVIEW_SILENT=1.');
        if (waiting !== this.waiting) { this.waiting = waiting; this.callbacks.waiting(waiting); }
        this.latestTime = time;
        if (flags & 2) this.callbacks.time(time);
        if (buffer.byteLength > 32 && sequence !== this.sequence) {
          if (buffer.byteLength !== 32 + width * height * 4) throw new Error('Invalid decoded frame');
          this.sequence = sequence;
          this.frame = { width, height, sequence, pixels: new Uint8Array(buffer, 32) };
          this.callbacks.frame(this.frame, time);
          changed = true;
          this.callbacks.cost?.(performance.now() - started);
        }
        if (flags & 4) this.callbacks.ended();
      }
    } catch (error) { this.polling = false; this.fail(error); return; }
    this.polling = false;
    // After a fresh frame, wait almost one source interval. If that request
    // lands just before the next frame, retry quickly instead of halving FPS.
    // Paused, ready previews do not need 120 header-only IPC requests a second.
    const active = this.desiredPlaying || this.nativePlaying;
    const delay = active ? changed ? Math.max(0, 1000 / this.fps - 3 - (performance.now() - started)) : 2 : this.waiting ? 8 : 80;
    if (!this.disposed) this.timer = window.setTimeout(() => void this.poll(), delay);
  }
  control(values: { playing?: boolean; time?: number; segments?: Segment[]; music?: MusicTrack; sfx?: SfxTrack[] }) {
    if (this.disposed) return;
    if (values.playing !== undefined) this.desiredPlaying = values.playing;
    this.commands = this.commands.then(async () => {
      if (!this.disposed) {
        await invoke<void>('playback_control', { session: this.session, ...values });
        // Wake a backed-off paused poll immediately for play/seek/edit commands.
        clearTimeout(this.timer);
        if (!this.disposed && !this.polling) this.timer = window.setTimeout(() => void this.poll(), 0);
      }
    });
    void this.commands.catch(error => this.fail(error));
  }
  seek(time: number) {
    if (Math.abs(time - this.latestTime) <= .045) return;
    this.latestTime = time;
    // Keep the local state in lockstep with the callback. Otherwise the next
    // ready packet can look unchanged and leave the React loading overlay up.
    this.waiting = true;
    this.waitingSince = performance.now();
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
