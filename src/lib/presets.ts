import type { Preset, Store } from '../types';
export const classic: Preset = {
  version: 1, id: 'classic', name: 'Classic RL Short',
  background: { blur: 30, scale: 1, x: 0.5, y: 0.5, brightness: 0 },
  gameplay: { scale: 1, x: 0.5, y: 0.5 },
  boost: { enabled: true, crop: { x: 0.88, y: 0.77, width: 0.115, height: 0.205 }, x: 0.19, y: 0.8, width: 0.12, height: 0.0675, scale: 1, shape: 'circle', feather: 0 },
};
export const initialStore: Store = { version: 1, setupComplete: false, activePreset: 'classic', presets: [], settings: { quality: 1080, fps: 60, outputFolder: '', defaultPreset: 'classic' }, recentFiles: [] };
export const copyPreset = (p: Preset, name = `${p.name} copy`): Preset => ({ ...structuredClone(p), id: crypto.randomUUID(), name: Array.from(name).slice(0, 100).join('') });
export const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v));
export function time(seconds: number): string {
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds / 60) % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
}
export function filename(path: string) { return path.split(/[\\/]/).pop() || path; }
