export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type Preset = {
  version: number;
  id: string;
  name: string;
  background: {
    blur: number;
    scale: number;
    x: number;
    y: number;
    brightness: number;
  };
  gameplay: {
    scale: number;
    x: number;
    y: number;
  };
  boost: {
    enabled: boolean;
    crop: Rect;
    x: number;
    y: number;
    width: number;
    height: number;
    scale: number;
    shape: 'circle' | 'ellipse';
    feather: number;
  };
};
export type Video = {
  path: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  hasAudio: boolean;
};
export type Settings = {
  quality: number;
  fps: number;
  outputFolder: string;
  defaultPreset: string;
};
export type Store = {
  version: number;
  setupComplete: boolean;
  activePreset: string;
  presets: Preset[];
  settings: Settings;
  recentFiles: string[];
};
export type Preview = {
  source: string;
  composed: string;
  timestamp: number;
};
export type Progress = {
  id: string;
  phase: 'running' | 'complete' | 'failed' | 'canceled';
  percent: number;
  elapsed: number;
  remaining: number | null;
  output: string;
  error: string | null;
};
export type Init = {
  store: Store;
  binaries: {
    ffmpeg: string | null;
    ffprobe: string | null;
  };
  storageError: string | null;
};
export type Layer = 'gameplay' | 'boost';
