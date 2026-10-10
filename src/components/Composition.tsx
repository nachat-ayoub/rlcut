import { useRef, type CSSProperties, type PointerEvent } from 'react';
import { Film, LoaderCircle, Move, Scan } from 'lucide-react';
import type { Layer, Preset, Preview, Video } from '../types';
import { clamp } from '../lib/presets';
type Gesture = {
  layer: Layer;
  resize: boolean;
  x: number;
  y: number;
  preset: Preset;
};
export function Composition({ video, preview, preset, before, guides, layer, setLayer, change, busy, importVideo, quality }: {
  video: Video | null;
  preview: Preview | null;
  preset: Preset;
  before: boolean;
  guides: boolean;
  layer: Layer;
  setLayer: (l: Layer) => void;
  change: (p: Preset) => void;
  busy: boolean;
  importVideo: () => void;
  quality: number;
}) {
  const canvas = useRef<HTMLDivElement>(null), gesture = useRef<Gesture | null>(null);
  const ratio = quality === 480 ? 480 / 854 : 9 / 16;
  function begin(e: PointerEvent, target: Layer, resize = false) { e.preventDefault(); e.stopPropagation(); setLayer(target); gesture.current = { layer: target, resize, x: e.clientX, y: e.clientY, preset: structuredClone(preset) }; e.currentTarget.setPointerCapture(e.pointerId); }
  function move(e: PointerEvent) {
    const g = gesture.current;
    if (!g || !canvas.current)
      return;
    const r = canvas.current.getBoundingClientRect(), dx = (e.clientX - g.x) / r.width, dy = (e.clientY - g.y) / r.height;
    const p = structuredClone(g.preset);
    if (g.layer === 'gameplay') {
      if (g.resize)
        p.gameplay.scale = clamp(p.gameplay.scale + dx * 2, .2, 4);
      else {
        p.gameplay.x = clamp(p.gameplay.x + dx);
        p.gameplay.y = clamp(p.gameplay.y + dy);
      }
    }
    else {
      if (g.resize) {
        p.boost.width = clamp(p.boost.width + dx * 2 / p.boost.scale, .01, 1);
        p.boost.height = clamp(p.boost.height + dy * 2 / p.boost.scale, .005, 1);
      }
      else {
        p.boost.x = clamp(p.boost.x + dx);
        p.boost.y = clamp(p.boost.y + dy);
      }
    }
    change(p);
  }
  const rect = (target: Layer): CSSProperties => {
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
          <Film size={34} />
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
  return <div className="preview-stage">
    <div className={`composition ${before ? 'source-mode' : ''}`} ref={canvas} style={{ aspectRatio: before ? `${video.width}/${video.height}` : `${ratio}`, maxHeight: '100%' }} onPointerMove={move} onPointerUp={() => { gesture.current = null; }} onPointerCancel={() => { gesture.current = null; }}>
      {preview && <img src={before ? preview.source : preview.composed} alt={before ? 'Original source frame' : 'Rendered vertical composition'} draggable={false} />} {!preview && <div className="preview-loading">
        <LoaderCircle className="spin" />Rendering your composition…</div>}{!before && guides && preview && (['gameplay', 'boost'] as Layer[]).filter(l => l !== 'boost' || preset.boost.enabled).map(target => <div key={target} className={`layer-guide ${layer === target ? 'selected' : ''} ${target}`} style={rect(target)} onPointerDown={e => begin(e, target)}>
          <span>
            <Move size={10} />
            {target === 'gameplay' ? 'GAMEPLAY' : 'BOOST'}
          </span>
          <button className="resize-handle" aria-label={`Resize ${target}`} onPointerDown={e => begin(e, target, true)} />
        </div>)}{busy && preview && <span className="render-badge">
          <LoaderCircle size={12} className="spin" />Updating</span>}
    </div>
    <span className="canvas-caption">
      <Scan size={12} />
      {before ? 'Original frame' : `${quality === 480 ? 'Approx. 9:16' : '9:16'} · ${quality === 480 ? '480 × 854' : quality === 720 ? '720 × 1280' : '1080 × 1920'}`} · Zoom to fit</span>
  </div>;
}
