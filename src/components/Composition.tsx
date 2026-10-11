import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Dropdown } from './Dropdown';
import { LoaderCircle, Move, Scan, Video as VideoIcon } from 'lucide-react';
import type { Layer, Preset, Preview, Video } from '../types';
import { clamp } from '../lib/presets';
import { fileUrl } from '../lib/native';
import { corners, snapAxis, type Corner } from '../lib/geometry';
type Gesture = {
  layer: 'gameplay' | 'boost';
  resize: Corner | null;
  x: number;
  y: number;
  preset: Preset;
};
export function Composition({ video, playbackPath, proxyPreparing, preview, preset, before, guides, layer, setLayer, change, busy, importVideo, quality, playing, timestamp, onTimestamp, onPlayingChange }: {
  video: Video | null;
  playbackPath: string;
  proxyPreparing: boolean;
  preview: Preview | null;
  preset: Preset;
  before: boolean;
  guides: boolean;
  layer: Layer | null;
  setLayer: (l: Layer | null) => void;
  change: (p: Preset) => void;
  busy: boolean;
  importVideo: () => void;
  quality: number;
  playing: boolean;
  timestamp: number;
  onTimestamp: (value: number) => number | void;
  onPlayingChange: (value: boolean) => void;
}) {
  const canvas = useRef<HTMLDivElement>(null), player = useRef<HTMLVideoElement>(null), gesture = useRef<Gesture | null>(null);
  const [zoom, setZoom] = useState(1);
  const [mediaReady, setMediaReady] = useState(false);
  const [snaps, setSnaps] = useState<(number | null)[]>([null, null]);
  const ratio = quality === 480 ? 480 / 854 : 9 / 16;
  useEffect(() => {
    if (!player.current || !video) return;
    if (!playing || Math.abs(player.current.currentTime - timestamp) > .5)
      if (Math.abs(player.current.currentTime - timestamp) > .04) player.current.currentTime = timestamp;
  }, [timestamp, video, playing]);
  useEffect(() => {
    const videoElement = player.current;
    if (!videoElement) return;
    let frame = 0, lastReport = -1;
    if (playing) {
      void videoElement.play().then(() => {
        const update = () => {
          const current = videoElement.currentTime;
          if (Math.abs(current - lastReport) >= .04) {
            lastReport = current;
            const corrected = onTimestamp(current);
            if (typeof corrected === 'number' && Math.abs(corrected - current) > .01) videoElement.currentTime = corrected;
          }
          if (!videoElement.paused && !videoElement.ended) frame = requestAnimationFrame(update);
        };
        frame = requestAnimationFrame(update);
      }).catch(() => onPlayingChange(false));
    } else videoElement.pause();
    return () => cancelAnimationFrame(frame);
  }, [playing, playbackPath, onTimestamp, onPlayingChange]);
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
        <h2>Your next great clip starts here.</h2>
        <p>Drop a Rocket League recording anywhere,<br />or choose a video to get started.</p>
        <button className="primary" onClick={importVideo}>Import gameplay</button>
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
      <div className={`composition ${before ? 'source-mode' : ''} ${layer === 'background' ? 'background-selected' : ''}`} ref={canvas} style={{ aspectRatio: before ? `${video.width}/${video.height}` : `${ratio}`, maxHeight: 'none', maxWidth: 'none', width: before ? `${zoom * 100}%` : 'auto', height: `${zoom * 100}%`, flexShrink: 0 }} onPointerDown={e => { if (e.target !== e.currentTarget && !(e.target as HTMLElement).matches('img,video')) return; e.stopPropagation(); if (!before) setLayer('background'); }} onPointerMove={move} onPointerUp={() => { gesture.current = null; setSnaps([null, null]); }} onPointerCancel={() => { gesture.current = null; setSnaps([null, null]); }}>
        {playbackPath && <video ref={player} className={`playback-video ${playing ? 'active' : ''}`} src={fileUrl(playbackPath)} preload="auto" playsInline onLoadedData={() => setMediaReady(true)} onCanPlay={() => setMediaReady(true)} onEnded={() => onPlayingChange(false)} />}
        {preview && <img className={playing ? 'playback-hidden' : ''} src={before ? preview.source : preview.composed} alt={before ? 'Original source frame' : 'Rendered vertical composition'} draggable={false} />} {!preview && !playing && <div className="preview-loading">
          <LoaderCircle className="spin" />Rendering your composition…</div>}{!playing && !before && guides && preview && (['gameplay', 'boost'] as const).filter(l => l !== 'boost' || preset.boost.enabled).map(target => <div key={target} className={`layer-guide ${layer === target ? 'selected' : 'unselected'} ${target}`} style={rect(target)} onPointerDown={e => begin(e, target)}>
            {layer === target && <span>
              <Move size={10} />
              {target === 'gameplay' ? 'GAMEPLAY' : 'BOOST'}
            </span>}
            {layer === target && corners.map(corner => <button key={corner} className={`resize-handle ${corner}`} aria-label={`Resize ${target} ${corner}`} onPointerDown={e => begin(e, target, corner)} />)}
          </div>)}{busy && preview && <span className="render-badge">
            <LoaderCircle size={12} className="spin" />Updating</span>}
        {snaps[0] !== null && <i className="snap-line vertical" style={{ left: `${snaps[0]! * 100}%` }} />}
        {snaps[1] !== null && <i className="snap-line horizontal" style={{ top: `${snaps[1]! * 100}%` }} />}
        {proxyPreparing && <div className="proxy-loading"><LoaderCircle className="spin" size={17} /><span>Preparing smooth preview…</span></div>}
        {playing && !mediaReady && <div className="proxy-loading"><LoaderCircle className="spin" size={17} /><span>Buffering preview…</span></div>}
      </div></div>
    <span className="canvas-caption">
      <Scan size={12} />
      {before ? 'Original frame' : `${quality === 480 ? 'Approx. 9:16' : '9:16'} · ${quality === 480 ? '480 × 854' : quality === 720 ? '720 × 1280' : '1080 × 1920'}`} · <label>Zoom <Dropdown label="Preview zoom" value={zoom} onChange={value => setZoom(Number(value))} options={[1, 1.5, 2, 3, 4].map(z => ({ value: z, label: z === 1 ? 'Fit' : `${z * 100}%` }))} /></label></span>
  </div>;
}
