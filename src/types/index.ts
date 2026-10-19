export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type BoostEasing = 'linear' | 'ease' | 'easeIn' | 'easeOut' | 'easeInOut';
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
    intro: {
      enabled: boolean;
      duration: number;
      easing: BoostEasing;
    };
  };
};
export type Video = {
  path: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  hasAudio: boolean;
  colorTransfer?: string;
};
export type Settings = {
  quality: number;
  fps: number;
  outputFolder: string;
  defaultPreset: string;
  waitForPreview: boolean;
  boostIntro?: boolean;
  musicFadeOut: boolean;
  musicFadeDuration: number;
};
export type Store = {
  version: number;
  setupComplete: boolean;
  activePreset: string;
  presets: Preset[];
  settings: Settings;
  recentFiles: string[];
  projects: Project[];
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
export type Segment = {
  id: string;
  start: number;
  end: number;
  volume: number;
  colorFix: number;
};
export type MusicFile = {
  path: string;
  name: string;
  duration: number;
};
export type MusicTrack = MusicFile & { segments: Segment[]; fadeOut?: number | null };
export type TrackMarkers = {
  video: number[];
  music: number[];
};
export type TextOverlay = {
  id: string;
  text: string;
  start: number;
  end: number;
  x: number;
  y: number;
  scale: number;
  boxWidth: number;
  rotation: number;
  fontFamily: string;
  fontPath: string;
  fontBoldPath: string;
  fontBlackPath: string;
  fontItalicPath: string;
  fontBoldItalicPath: string;
  fontBlackItalicPath: string;
  fontWeight: 400 | 700 | 900;
  fontSize: number;
  color: string;
  opacity: number;
  align: 'left' | 'center' | 'right';
  bold: boolean;
  italic: boolean;
  underline: boolean;
  letterSpacing: number;
  lineHeight: number;
  strokeColor: string;
  strokeWidth: number;
  strokePosition: 'inside' | 'center' | 'outside';
  backgroundColor: string;
  backgroundOpacity: number;
  shadowColor: string;
  shadowBlur: number;
  shadowX: number;
  shadowY: number;
  fadeIn: number | null;
  fadeOut: number | null;
};
export type FontOption = { family: string; path: string; variants?: Partial<Record<'regular' | 'bold' | 'black' | 'italic' | 'boldItalic' | 'blackItalic', string>> };
export type Project = {
  version: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  videoPaths: string[];
  segments: Segment[];
  music: MusicTrack | null;
  markers: TrackMarkers;
  texts?: TextOverlay[];
  preset: Preset;
  quality: number;
  fps: number;
  outputFolder: string;
  outputName: string;
};
export type Init = {
  store: Store;
  binaries: {
    ffmpeg: string | null;
    ffprobe: string | null;
  };
  storageError: string | null;
};
export type Layer = 'background' | 'gameplay' | 'boost';
