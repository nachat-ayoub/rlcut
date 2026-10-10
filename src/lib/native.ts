// Tauri's global API avoids a second JavaScript bridge implementation.
// Only the desktop runtime can access files or start FFmpeg.
type DragDrop = { payload: { type: string; paths?: string[] } };
declare global {
  interface Window {
    __TAURI__?: {
      core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> };
      webview: { getCurrentWebview(): { onDragDropEvent(callback: (event: DragDrop) => void): Promise<() => void> } };
    };
  }
}
export const isDesktop = () => Boolean(window.__TAURI__);
export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!window.__TAURI__) throw new Error('Open rlcut with npm run desktop to use native video processing.');
  return window.__TAURI__.core.invoke<T>(command, args);
}
export async function onDrop(callback: (paths: string[]) => void): Promise<() => void> {
  if (!window.__TAURI__) return Promise.resolve(() => { });
  return window.__TAURI__.webview.getCurrentWebview().onDragDropEvent(({ payload }) => {
    if (payload.type === 'drop' && payload.paths?.length) callback(payload.paths);
  });
}
export function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
