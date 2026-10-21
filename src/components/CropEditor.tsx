import { useRef, useState } from 'react';
import { Check, Crop as CropIcon, RotateCcw, X } from 'lucide-react';
import type { Preset, Rect } from '../types';
import { Dropdown } from './Dropdown';
import { Slider } from './Controls';
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
  const cutoutWidth = cutoutRatio >= 1 ? 178 : 178 * cutoutRatio;
  const cutoutHeight = cutoutRatio >= 1 ? 178 / cutoutRatio : 178;
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
        <div className="crop-title"><span><CropIcon size={17} /></span><div><h2 id="crop-title">Boost cutout</h2><small>Select the boost meter in the source frame</small></div></div>
        <button aria-label="Cancel crop" onClick={onCancel}>
          <X size={18} />
        </button>
      </div>
      <div className="crop-layout"><div className="crop-canvas">
        <div className="crop-canvas-toolbar"><span>Source frame</span><div><Dropdown label="Source zoom" value={zoom} onChange={value => zoomTo(Number(value))} options={[1, 2, 3, 4, 6, 8].map(z => ({ value: z, label: z === 1 ? 'Fit' : `${z * 100}%` }))} /><button onClick={() => setDraw(true)} className={draw ? 'active' : ''} title="Draw a new selection"><CropIcon size={14} /><span>New selection</span></button><button onClick={() => setBoost(structuredClone(preset.boost))} title="Reset boost selection" aria-label="Reset boost selection"><RotateCcw size={14} /></button></div></div>
        <div className="crop-viewport" ref={viewport}><div className="crop-frame" style={{ width: `${zoom * 100}%` }} ref={frame} onPointerDown={e => start(e, 'draw')} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}>
          <img src={source} alt="Original frame for boost crop selection" draggable={false} />
          <div className="crop-selection" style={style} onPointerDown={e => start(e, draw ? 'draw' : 'move')}>
            <div className={`crop-mask ${boost.shape}`} style={boost.shape === 'circle' ? { width: `${Math.min(1, crop.height / (crop.width * aspect)) * 100}%`, height: `${Math.min(1, crop.width * aspect / crop.height) * 100}%` } : undefined} />
            <span>BOOST HUD</span>
            {corners.map(corner => <button key={corner} className={`resize-handle ${corner}`} aria-label={`Resize boost crop ${corner}`} onPointerDown={e => start(e, 'resize', corner)} />)}
          </div>
        </div>
        </div></div><aside className="crop-settings">
          <div className="crop-preview-card"><span>Preview</span><div className="cutout-preview"><div style={{ width: cutoutWidth, height: cutoutHeight, position: 'relative', overflow: 'hidden', maskImage: `radial-gradient(${boost.shape === 'circle' ? 'circle closest-side' : 'ellipse closest-side'}, black ${100 * (1 - boost.feather)}%, transparent 100%)`, WebkitMaskImage: `radial-gradient(${boost.shape === 'circle' ? 'circle closest-side' : 'ellipse closest-side'}, black ${100 * (1 - boost.feather)}%, transparent 100%)` }}><img src={source} alt="Boost cutout result" style={{ position: 'absolute', width: `${100 / crop.width}%`, height: `${100 / crop.height}%`, maxWidth: 'none', left: `${-100 * crop.x / crop.width}%`, top: `${-100 * crop.y / crop.height}%` }} /></div></div></div>
          <div className="crop-options">
            <label className="crop-visible"><span><strong>Visible</strong><small>Show this cutout in the edit</small></span><input className="switch" type="checkbox" checked={boost.enabled} onChange={e => update({ enabled: e.target.checked })} /></label>
            <div className="crop-shape"><span>Shape</span><div className="segmented">{(['circle', 'ellipse'] as const).map(shape => <button key={shape} className={boost.shape === shape ? 'active' : ''} onClick={() => update({ shape })}>{shape}</button>)}</div></div>
            <Slider label="Soft edge" value={boost.feather} max={.25} step={.005} defaultValue={preset.boost.feather} onChange={feather => update({ feather })} />
          </div>
        </aside></div>
      <div className="crop-footer">
        <span>{Math.round(crop.width * 100)}% × {Math.round(crop.height * 100)}% selection</span>
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" onClick={() => onApply({ ...boost, crop: { ...crop, width: Math.min(crop.width, 1 - crop.x), height: Math.min(crop.height, 1 - crop.y) } })}>
          <Check size={15} />Apply cutout</button>
      </div>
    </div>
  </div>;
}
