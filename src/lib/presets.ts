import type { Preset, Store } from '../types';
export const classic: Preset = {
  version: 1, id: 'classic', name: 'Classic RL Short',
  background: { blur: 30, scale: 1, x: 0.5, y: 0.5, brightness: 0 },
  gameplay: { scale: 1, x: 0.5, y: 0.5 },
  boost: { enabled: true, crop: { x: 0.88, y: 0.77, width: 0.115, height: 0.205 }, x: 0.19, y: 0.8, width: 0.12, height: 0.0675, scale: 1, shape: 'circle', feather: 0 },
};
export const initialStore: Store = { version: 1, setupComplete: false, activePreset: 'classic', presets: [], settings: { quality: 1080, fps: 60, outputFolder: '', defaultPreset: 'classic', waitForPreview: true, boostIntro: false }, recentFiles: [] };
export const copyPreset = (p: Preset, name = `${p.name} copy`): Preset => ({ ...structuredClone(p), id: crypto.randomUUID(), name: Array.from(name).slice(0, 100).join('') });
export const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v));
export function time(seconds: number): string {
  const total = Math.max(0, Math.round((Number.isFinite(seconds) ? seconds : 0) * 100));
  const h = Math.floor(total / 360000), m = Math.floor(total / 6000) % 60;
  const s = (total % 6000 / 100).toFixed(2);
  return [h ? `${h} h` : '', m ? `${m} min` : '', `${s} s`].filter(Boolean).join(' ');
}
export function filename(path: string) { return path.split(/[\\/]/).pop() || path; }

export function duration(seconds: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
  return [h ? `${h} h` : '', m ? `${m} min` : '', `${s} s`].filter(Boolean).join(' ');
}
