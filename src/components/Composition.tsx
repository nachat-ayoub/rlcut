import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Dropdown } from './Dropdown';
import { LoaderCircle, Move, Scan, Video as VideoIcon } from 'lucide-react';
import type { Layer, Preset, Preview, Video, Segment, MusicTrack } from '../types';
import { clamp } from '../lib/presets';
import { NativePlayback } from '../lib/native-playback';
import { Compositor } from '../lib/compositor';
import { corners, snapAxis, type Corner } from '../lib/geometry';
import { ease } from '../lib/easing';
import { sourceToEdited } from '../lib/timeline';
type Gesture = {
  layer: 'gameplay' | 'boost';
  resize: Corner | null;
  x: number;
  y: number;
  preset: Preset;
};
export function Composition({ video, sourceVersion = 0, playbackPath, proxyPreparing, preparation = null, segments = [], music = null, musicFadeOut = null, preview, preset, before, guides, layer, setLayer, change, importVideo, quality, playing, timestamp, onTimestamp, onPlayingChange, onPlaybackError, onSourceFrame }: {
  video: Video | null;
  sourceVersion?: number;
  playbackPath: string;
  proxyPreparing: boolean;
  preparation?: { percent: number; elapsed: number; remaining: number | null } | null;
  segments?: Segment[];
  music?: MusicTrack | null;
  musicFadeOut?: number | null;
  preview: Preview | null;
  preset: Preset;
  before: boolean;
  guides: boolean;
  layer: Layer | null;
  setLayer: (l: Layer | null) => void;
  change: (p: Preset) => void;
  importVideo: () => void;
  quality: number;
  playing: boolean;
  timestamp: number;
  onTimestamp: (value: number) => number | void;
  onPlayingChange: (value: boolean) => void;
  onPlaybackError?: (error: unknown) => void;
  onSourceFrame?: (source: string) => void;
}) {
  const canvas = useRef<HTMLDivElement>(null), player = useRef<NativePlayback | null>(null), gesture = useRef<Gesture | null>(null);
  const output = useRef<HTMLCanvasElement>(null), renderer = useRef<Compositor | null>(null);
  const playbackTimestamp = useRef(timestamp);
  const [forceCPU, setForceCPU] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [mediaReady, setMediaReady] = useState(false);
  const [snaps, setSnaps] = useState<(number | null)[]>([null, null]);
  const ratio = quality === 480 ? 480 / 854 : 9 / 16;
  const callbacks = useRef({ onTimestamp, onPlayingChange, onPlaybackError, onSourceFrame, timestamp, preset, quality, before, video, playing, segments });
  useEffect(() => { callbacks.current = { onTimestamp, onPlayingChange, onPlaybackError, onSourceFrame, timestamp, preset, quality, before, video, playing, segments }; });
  const [waiting, setWaiting] = useState(false);
  const draw = useRef<() => void>(() => { });
  const snapshot = useRef<() => void>(() => { });
  useEffect(() => {
    const target = output.current;
    if (!target || !playbackPath) return;
    let compositor: Compositor;
    try { compositor = new Compositor(target, forceCPU); }
    catch { setForceCPU(true); return; }
    renderer.current = compositor;
    const lost = (event: Event) => { event.preventDefault(); setForceCPU(true); };
    target.addEventListener('webglcontextlost', lost); target.addEventListener('compositionfallback', lost);
    draw.current = () => {
      const current = callbacks.current, source = player.current?.frame;
      if (!current.video || !source) return;
      try {
        let drawingPreset = current.preset;
        const editedTime = sourceToEdited(current.segments, playbackTimestamp.current);
        if (current.preset.boost.intro.enabled && current.preset.boost.enabled && !current.before && editedTime < current.preset.boost.intro.duration) {
          const boost = current.preset.boost;
          const hidden = -(boost.width * boost.scale) / 2 - 5 / current.quality;
          const progress = ease(editedTime / boost.intro.duration, boost.intro.easing);
          drawingPreset = { ...current.preset, boost: { ...boost, x: hidden + (boost.x - hidden) * progress } };
        }
        compositor.draw(source, source.width, source.height, current.video, drawingPreset, current.quality, current.before, current.playing);
      }
      catch (error) { current.onPlayingChange(false); current.onPlaybackError?.(error); }
    };
    snapshot.current = () => {
      const source = !callbacks.current.playing && player.current?.snapshotCanvas();
      if (source) callbacks.current.onSourceFrame?.(source.toDataURL('image/jpeg', .92));
    };
    const observer = new ResizeObserver(() => draw.current()); observer.observe(target);
    draw.current();
    return () => { observer.disconnect(); target.removeEventListener('webglcontextlost', lost); target.removeEventListener('compositionfallback', lost); compositor.dispose(); renderer.current = null; };
  }, [playbackPath, forceCPU, sourceVersion]);
  useEffect(() => {
    if (!playbackPath || !video) return;
    setMediaReady(false); setWaiting(true);
    let disposed = false;
    const session = new NativePlayback(playbackPath, callbacks.current.timestamp, segments, {
      frame: (_source, time) => { if (disposed) return; playbackTimestamp.current = time; setMediaReady(true); draw.current(); snapshot.current(); },
      time: value => { if (!disposed) { playbackTimestamp.current = value; callbacks.current.onTimestamp(value); } },
      waiting: value => { if (!disposed) setWaiting(value); },
      ended: () => { if (!disposed) callbacks.current.onPlayingChange(false); },
      error: error => { if (!disposed) { setMediaReady(false); callbacks.current.onPlayingChange(false); callbacks.current.onPlaybackError?.(error); } },
    });
    player.current = session;
    return () => { disposed = true; session.dispose(); if (player.current === session) player.current = null; };
    // Native source lifetime is independent of scene and timeline changes.
  }, [playbackPath, sourceVersion]);
  useEffect(() => { player.current?.control({ segments }); }, [segments, playbackPath, sourceVersion]);
  useEffect(() => {
    player.current?.control({ music: music ? { ...music, fadeOut: musicFadeOut } : { path: '', name: '', duration: 1, segments: [], fadeOut: null } });
  }, [music, musicFadeOut, playbackPath, sourceVersion]);
  useEffect(() => { if (playing) player.current?.seek(callbacks.current.timestamp); player.current?.control({ playing }); if (!playing) snapshot.current(); }, [playing, playbackPath, sourceVersion]);
  useEffect(() => { if (!playing) { playbackTimestamp.current = timestamp; player.current?.seek(timestamp); } }, [timestamp, playing]);
  useEffect(() => { const frame = requestAnimationFrame(() => draw.current()); return () => cancelAnimationFrame(frame); }, [preset, before, quality, video, playing]);
  function begin(e: PointerEvent, target: 'gameplay' | 'boost', resize: Corner | null = null) { e.preventDefault(); e.stopPropagation(); setLayer(target); gesture.current = { layer: target, resize, x: e.clientX, y: e.clientY, preset: structuredClone(preset) }; e.currentTarget.setPointerCapture(e.pointerId); }
  function move(e: PointerEvent) {
    const g = gesture.current;
    if (!g || !canvas.current)
      return;
    const r = canvas.current.getBoundingClientRect(), dx = (e.clientX - g.x) / r.width, dy = (e.clientY - g.y) / r.height;
    const p = structuredClone(g.preset);
    const item = p[g.layer];
    const width = g.layer === 'gameplay' ? p.gameplay.scale : p.boost.width * p.boost.scale;
    const height = g.layer === 'gameplay' ? width * (video!.height / video!.width) * ratio : p.boost.height * p.boost.scale;
    if (g.resize) {
      const sx = g.resize.includes('w') ? -1 : 1, sy = g.resize.includes('n') ? -1 : 1;
      let nw: number, nh: number;
      if (g.layer === 'gameplay') {
        const aspect = height / width;
        const delta = Math.abs(dx) >= Math.abs(dy / aspect) ? sx * dx : sy * dy / aspect;
        nw = clamp(width + delta, .2, 4); nh = nw * aspect;
        p.gameplay.scale = nw;
      } else {
        nw = clamp(width + sx * dx, .01 * p.boost.scale, p.boost.scale);
        nh = clamp(height + sy * dy, .005 * p.boost.scale, p.boost.scale);
        p.boost.width = nw / p.boost.scale; p.boost.height = nh / p.boost.scale;
      }
      item.x = clamp(item.x + sx * (nw - width) / 2);
      item.y = clamp(item.y + sy * (nh - height) / 2);
      setSnaps([null, null]);
    } else {
      const x = snapAxis(item.x + dx, width, e.altKey ? 0 : 8 / r.width);
      const y = snapAxis(item.y + dy, height, e.altKey ? 0 : 8 / r.height);
      item.x = x.position; item.y = y.position; setSnaps([x.guide, y.guide]);
    }
    change(p);
  }
  const rect = (target: 'gameplay' | 'boost'): CSSProperties => {
    let width: number, height: number, x: number, y: number; if (target === 'gameplay') {
      width = preset.gameplay.scale;
      height = width * (video!.height / video!.width) * ratio;
      x = preset.gameplay.x;
      y = preset.gameplay.y;
    }
    else {
      width = preset.boost.width * preset.boost.scale;
      height = preset.boost.height * preset.boost.scale;
      x = preset.boost.x;
      y = preset.boost.y;
    } return { width: `${width * 100}%`, height: `${height * 100}%`, left: `${x * 100}%`, top: `${y * 100}%`, transform: 'translate(-50%, -50%)' };
  };
  if (!video)
    return <div className="preview-stage">
      <div className="empty-preview">
        <div className="empty-icon">
          <VideoIcon size={34} strokeWidth={1.7} />
        </div>
        <h2>{proxyPreparing ? preparation ? `Preparing recording · ${Math.floor(preparation.percent)}%` : 'Reading your recording…' : 'Your next great clip starts here.'}</h2>
        <p>Drop a Rocket League recording anywhere,<br />or choose a video to get started.</p>
        <button className="primary" disabled={proxyPreparing} onClick={importVideo}>{proxyPreparing ? 'Preparing…' : 'Import gameplay'}</button>
        <small>MP4 · MOV · MKV · WEBM</small>
        <div className="layer-pills">
          <span>Blurred background</span>
          <span>Sharp gameplay</span>
          <span>Live boost HUD</span>
        </div>
      </div>
    </div>;
  return <div className="preview-stage" onPointerDown={() => setLayer(null)}>
    <div className="preview-viewport">
      <div className={`composition ${before ? 'source-mode' : ''} ${layer === 'background' ? 'background-selected' : ''}`} ref={canvas} style={{ aspectRatio: before ? `${video.width}/${video.height}` : `${ratio}`, maxHeight: 'none', maxWidth: 'none', width: before ? `${zoom * 100}%` : 'auto', height: `${zoom * 100}%`, flexShrink: 0 }} onPointerDown={e => { if (e.target !== e.currentTarget && !(e.target as HTMLElement).matches('canvas')) return; e.stopPropagation(); if (!before) setLayer('background'); }} onPointerMove={move} onPointerUp={() => { gesture.current = null; setSnaps([null, null]); }} onPointerCancel={() => { gesture.current = null; setSnaps([null, null]); }}>
        <canvas key={forceCPU ? 'cpu' : 'gpu'} className="composition-output" ref={output} aria-label={before ? 'Original recording' : 'Live edited composition'} />
        {!mediaReady && !proxyPreparing && <div className="preview-loading"><LoaderCircle className="spin" />Opening native decoder…</div>}
        {!before && guides && (mediaReady || preview) && (['gameplay', 'boost'] as const).filter(l => l !== 'boost' || preset.boost.enabled).map(target => <div key={target} className={`layer-guide ${layer === target ? 'selected' : 'unselected'} ${target}`} style={rect(target)} onPointerDown={e => begin(e, target)}>
          {layer === target && <span>
            <Move size={10} />
            {target === 'gameplay' ? 'GAMEPLAY' : 'BOOST'}
          </span>}
          {layer === target && corners.map(corner => <button key={corner} className={`resize-handle ${corner}`} aria-label={`Resize ${target} ${corner}`} onPointerDown={e => begin(e, target, corner)} />)}
        </div>)}
        {snaps[0] !== null && <i className="snap-line vertical" style={{ left: `${snaps[0]! * 100}%` }} />}
        {snaps[1] !== null && <i className="snap-line horizontal" style={{ top: `${snaps[1]! * 100}%` }} />}
        {proxyPreparing && <div className="proxy-loading"><LoaderCircle className="spin" size={17} /><span>{preparation ? `Preparing video · ${Math.floor(preparation.percent)}%` : 'Reading recording…'}{preparation?.remaining != null && <small>About {Math.ceil(preparation.remaining)}s remaining</small>}<progress max="100" value={preparation?.percent} /></span></div>}
        {waiting && mediaReady && !proxyPreparing && <div className="proxy-loading"><LoaderCircle className="spin" size={17} /><span>Seeking frame…</span></div>}
      </div></div>
    <span className="canvas-caption">
      <Scan size={12} />
      {before ? 'Original frame' : `${quality === 480 ? 'Approx. 9:16' : '9:16'} · ${quality === 480 ? '480 × 854' : quality === 720 ? '720 × 1280' : '1080 × 1920'}`} · <label>Zoom <Dropdown label="Preview zoom" value={zoom} onChange={value => setZoom(Number(value))} options={[1, 1.5, 2, 3, 4].map(z => ({ value: z, label: z === 1 ? 'Fit' : `${z * 100}%` }))} /></label></span>
  </div>;
}
