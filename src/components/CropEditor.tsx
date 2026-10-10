import { useRef, useState } from 'react';
import { Check, MousePointer2, RotateCcw, X } from 'lucide-react';
import type { Preset, Rect } from '../types';
import { Dropdown } from './Dropdown';
import { Slider } from './Controls';
import { Alignment } from './Alignment';
import { corners, resizeCrop, type Corner } from '../lib/geometry';
import { clamp } from '../lib/presets';
type Gesture = {
  mode: 'draw' | 'move' | 'resize';
  startX: number;
  startY: number;
  original: Rect;
  corner?: Corner;
};
export function CropEditor({ source, preset, aspect, onApply, onCancel }: {
  source: string;
  preset: Preset;
  aspect: number;
  onApply: (boost: Preset['boost']) => void;
  onCancel: () => void;
}) {
  const [boost, setBoost] = useState(structuredClone(preset.boost));
  const crop = boost.crop;
  const setCrop = (crop: Rect) => setBoost(b => ({ ...b, crop }));
  const update = (patch: Partial<Preset['boost']>) => setBoost(b => ({ ...b, ...patch }));
  const [zoom, setZoom] = useState(1);
  const [draw, setDraw] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const cutoutRatio = boost.width * 9 / (boost.height * 16);
  const cutoutWidth = Math.min(200, 200 * cutoutRatio);
  function zoomTo(value: number) {
    setZoom(value);
    requestAnimationFrame(() => {
      if (!viewport.current || !frame.current) return;
      viewport.current.scrollTo({ left: (crop.x + crop.width / 2) * frame.current.offsetWidth - viewport.current.clientWidth / 2, top: (crop.y + crop.height / 2) * frame.current.offsetHeight - viewport.current.clientHeight / 2 });
    });
  }
  const frame = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  function point(e: React.PointerEvent) { const r = frame.current!.getBoundingClientRect(); return { x: clamp((e.clientX - r.left) / r.width, 0, .998), y: clamp((e.clientY - r.top) / r.height, 0, .998) }; }
  function start(e: React.PointerEvent, mode: Gesture['mode'], corner?: Corner) { e.stopPropagation(); e.preventDefault(); const p = point(e); gesture.current = { mode, startX: p.x, startY: p.y, original: { ...crop }, corner }; e.currentTarget.setPointerCapture(e.pointerId); }
  function move(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g)
      return;
    const p = point(e);
    const dx = p.x - g.startX, dy = p.y - g.startY;
    if (g.mode === 'draw')
      setCrop({ x: Math.min(g.startX, p.x), y: Math.min(g.startY, p.y), width: Math.max(.002, Math.abs(dx)), height: Math.max(.002, Math.abs(dy)) });
    if (g.mode === 'move')
      setCrop({ ...g.original, x: clamp(g.original.x + dx, 0, 1 - g.original.width), y: clamp(g.original.y + dy, 0, 1 - g.original.height) });
    if (g.mode === 'resize')
      setCrop(resizeCrop(g.original, g.corner!, dx, dy));
  }
  const finish = () => { gesture.current = null; setDraw(false); };
  const style = { left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` };
  return <div className="modal-backdrop">
    <div className="modal crop-modal" role="dialog" aria-modal="true" aria-labelledby="crop-title">
      <div className="modal-heading">
        <div>
          <span className="eyebrow">SOURCE FRAME</span>
          <h2 id="crop-title">Find your boost meter</h2>
        </div>
        <button aria-label="Cancel crop" onClick={onCancel}>
          <X size={20} />
        </button>
      </div>
      <p>Draw around the HUD, then move or resize the selection. Only the masked area appears in your clip.</p>
      <div className="crop-layout"><div>
        <label className="crop-zoom">Source zoom <Dropdown label="Source zoom" value={zoom} onChange={value => zoomTo(Number(value))} options={[1, 2, 3, 4, 6, 8].map(z => ({ value: z, label: z === 1 ? 'Fit' : `${z * 100}%` }))} /> <span>Scroll to inspect the HUD</span></label>
        <div className="crop-viewport" ref={viewport}><div className="crop-frame" style={{ width: `${zoom * 100}%` }} ref={frame} onPointerDown={e => start(e, 'draw')} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}>
          <img src={source} alt="Original frame for boost crop selection" draggable={false} />
          <div className="crop-selection" style={style} onPointerDown={e => start(e, draw ? 'draw' : 'move')}>
            <div className={`crop-mask ${boost.shape}`} style={boost.shape === 'circle' ? { width: `${Math.min(1, crop.height / (crop.width * aspect)) * 100}%`, height: `${Math.min(1, crop.width * aspect / crop.height) * 100}%` } : undefined} />
            <span>BOOST HUD</span>
            {corners.map(corner => <button key={corner} className={`resize-handle ${corner}`} aria-label={`Resize boost crop ${corner}`} onPointerDown={e => start(e, 'resize', corner)} />)}
          </div>
        </div>
        </div></div><aside className="crop-settings">
          <span className="eyebrow">CUTOUT PREVIEW</span>
          <div className="cutout-preview"><div style={{ width: cutoutWidth, height: cutoutWidth / cutoutRatio, position: 'relative', overflow: 'hidden', maskImage: `radial-gradient(${boost.shape === 'circle' ? 'circle closest-side' : 'ellipse closest-side'}, black ${100 * (1 - boost.feather)}%, transparent 100%)`, WebkitMaskImage: `radial-gradient(${boost.shape === 'circle' ? 'circle closest-side' : 'ellipse closest-side'}, black ${100 * (1 - boost.feather)}%, transparent 100%)` }}><img src={source} alt="Boost cutout result" style={{ position: 'absolute', width: `${100 / crop.width}%`, height: `${100 / crop.height}%`, maxWidth: 'none', left: `${-100 * crop.x / crop.width}%`, top: `${-100 * crop.y / crop.height}%` }} /></div></div>
          <label className="row">Show boost cutout<input type="checkbox" checked={boost.enabled} onChange={e => update({ enabled: e.target.checked })} /></label>
          <div className="segmented">{(['circle', 'ellipse'] as const).map(shape => <button key={shape} className={boost.shape === shape ? 'active' : ''} onClick={() => update({ shape })}>{shape}</button>)}</div>
          <Slider label="Scale" value={boost.scale} min={.25} max={4} suffix="×" onChange={scale => update({ scale })} />
          <div className="two-controls">
            <Slider label="Width" value={boost.width} min={.01} max={1} step={.001} onChange={width => update({ width })} />
            <Slider label="Height" value={boost.height} min={.005} max={1} step={.001} onChange={height => update({ height })} />
            <Slider label="X position" value={boost.x - .5} min={-.5} max={.5} onChange={x => update({ x: x + .5 })} />
            <Slider label="Y position" value={boost.y - .5} min={-.5} max={.5} onChange={y => update({ y: y + .5 })} />
          </div>
          <Alignment width={boost.width * boost.scale} height={boost.height * boost.scale} onChange={(x, y) => update({ x, y })} />
          <Slider label="Edge feather" value={boost.feather} max={.25} step={.005} onChange={feather => update({ feather })} />
          <details><summary>Source crop coordinates</summary><div className="two-controls">
            <Slider label="Crop X" value={crop.x} max={1 - crop.width} step={.001} onChange={x => setCrop({ ...crop, x })} />
            <Slider label="Crop Y" value={crop.y} max={1 - crop.height} step={.001} onChange={y => setCrop({ ...crop, y })} />
            <Slider label="Crop width" value={crop.width} min={.002} max={1 - crop.x} step={.001} onChange={width => setCrop({ ...crop, width })} />
            <Slider label="Crop height" value={crop.height} min={.002} max={1 - crop.y} step={.001} onChange={height => setCrop({ ...crop, height })} />
          </div></details>
        </aside></div>
      <div className="crop-footer">
        <button onClick={() => setDraw(true)} className={draw ? 'active' : ''}>
          <MousePointer2 size={15} />Draw new selection</button>
        <button onClick={() => setBoost(structuredClone(preset.boost))}>
          <RotateCcw size={15} />Reset</button>
        <span>
          {Math.round(crop.width * 100)}% × {Math.round(crop.height * 100)}% of source</span>
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" onClick={() => onApply({ ...boost, crop: { ...crop, width: Math.min(crop.width, 1 - crop.x), height: Math.min(crop.height, 1 - crop.y) } })}>
          <Check size={16} />Apply boost settings</button>
      </div>
    </div>
  </div>;
}
