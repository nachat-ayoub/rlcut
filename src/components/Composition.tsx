import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Dropdown } from './Dropdown';
import { Film, LoaderCircle, Move, Scan } from 'lucide-react';
import type { Layer, Preset, Preview, Video } from '../types';
import { clamp } from '../lib/presets';
import { corners, snapAxis, type Corner } from '../lib/geometry';
type Gesture = {
  layer: Layer;
  resize: Corner | null;
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
  layer: Layer | null;
  setLayer: (l: Layer | null) => void;
  change: (p: Preset) => void;
  busy: boolean;
  importVideo: () => void;
  quality: number;
}) {
  const canvas = useRef<HTMLDivElement>(null), gesture = useRef<Gesture | null>(null);
  const [zoom, setZoom] = useState(1);
  const [snaps, setSnaps] = useState<(number | null)[]>([null, null]);
  const ratio = quality === 480 ? 480 / 854 : 9 / 16;
  function begin(e: PointerEvent, target: Layer, resize: Corner | null = null) { e.preventDefault(); e.stopPropagation(); setLayer(target); gesture.current = { layer: target, resize, x: e.clientX, y: e.clientY, preset: structuredClone(preset) }; e.currentTarget.setPointerCapture(e.pointerId); }
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
  return <div className="preview-stage" onPointerDown={() => setLayer(null)}>
    <div className="preview-viewport">
      <div className={`composition ${before ? 'source-mode' : ''}`} ref={canvas} style={{ aspectRatio: before ? `${video.width}/${video.height}` : `${ratio}`, maxHeight: 'none', maxWidth: 'none', width: before ? `${zoom * 100}%` : 'auto', height: `${zoom * 100}%`, flexShrink: 0 }} onPointerMove={move} onPointerUp={() => { gesture.current = null; setSnaps([null, null]); }} onPointerCancel={() => { gesture.current = null; setSnaps([null, null]); }}>
        {preview && <img src={before ? preview.source : preview.composed} alt={before ? 'Original source frame' : 'Rendered vertical composition'} draggable={false} />} {!preview && <div className="preview-loading">
          <LoaderCircle className="spin" />Rendering your composition…</div>}{!before && guides && preview && (['gameplay', 'boost'] as Layer[]).filter(l => l !== 'boost' || preset.boost.enabled).map(target => <div key={target} className={`layer-guide ${layer === target ? 'selected' : 'unselected'} ${target}`} style={rect(target)} onPointerDown={e => begin(e, target)}>
            {layer === target && <span>
              <Move size={10} />
              {target === 'gameplay' ? 'GAMEPLAY' : 'BOOST'}
            </span>}
            {layer === target && corners.map(corner => <button key={corner} className={`resize-handle ${corner}`} aria-label={`Resize ${target} ${corner}`} onPointerDown={e => begin(e, target, corner)} />)}
          </div>)}{busy && preview && <span className="render-badge">
            <LoaderCircle size={12} className="spin" />Updating</span>}
        {snaps[0] !== null && <i className="snap-line vertical" style={{ left: `${snaps[0]! * 100}%` }} />}
        {snaps[1] !== null && <i className="snap-line horizontal" style={{ top: `${snaps[1]! * 100}%` }} />}
      </div></div>
    <span className="canvas-caption">
      <Scan size={12} />
      {before ? 'Original frame' : `${quality === 480 ? 'Approx. 9:16' : '9:16'} · ${quality === 480 ? '480 × 854' : quality === 720 ? '720 × 1280' : '1080 × 1920'}`} · <label>Zoom <Dropdown label="Preview zoom" value={zoom} onChange={value => setZoom(Number(value))} options={[1, 1.5, 2, 3, 4].map(z => ({ value: z, label: z === 1 ? 'Fit' : `${z * 100}%` }))} /></label></span>
  </div>;
}
