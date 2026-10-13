// Tauri's global API avoids a second JavaScript bridge implementation.
// Only the desktop runtime can access files or start FFmpeg.
type DragDrop = { payload: { type: string; paths?: string[] } };
declare global {
  interface Window {
    __TAURI__?: {
      core: {
        invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
        convertFileSrc(path: string, protocol?: string): string;
      };
      webview: { getCurrentWebview(): { onDragDropEvent(callback: (event: DragDrop) => void): Promise<() => void> } };
    };
  }
}
export const isDesktop = () => Boolean(window.__TAURI__);
export const fileUrl = (path: string) => window.__TAURI__?.core.convertFileSrc(path) ?? '';
export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!window.__TAURI__) throw new Error('Open rlcut with npm run desktop to use native video processing.');
  // IDs belong to the editor's UI/history. Rust accepts media ranges and gain,
  // consistently for playback open/control and export commands.
  const payload: Record<string, unknown> | undefined = args && Array.isArray(args.segments)
    ? { ...args, segments: args.segments.map(({ start, end, volume = 1 }: { start: number; end: number; volume?: number }) => ({ start, end, volume })) }
    : args;
  if (payload?.music && typeof payload.music === 'object') {
    const music = payload.music as { path: string; duration: number; fadeOut?: number | null; segments: { start: number; end: number; volume: number }[] };
    payload.music = { path: music.path, duration: music.duration, fadeOut: music.fadeOut ?? null, segments: music.segments.map(({ start, end, volume }) => ({ start, end, volume })) };
  }
  return window.__TAURI__.core.invoke<T>(command, payload);
}
export async function onDrop(callback: (paths: string[]) => void): Promise<() => void> {
  if (!window.__TAURI__) return Promise.resolve(() => { });
  return window.__TAURI__.webview.getCurrentWebview().onDragDropEvent(({ payload }) => {
    if (payload.type === 'drop' && payload.paths?.length) callback(payload.paths);
  });
}
export function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
