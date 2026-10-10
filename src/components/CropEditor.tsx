import { useRef, useState } from 'react';
import { Check, MousePointer2, RotateCcw, X } from 'lucide-react';
import type { Preset, Rect } from '../types';
import { clamp } from '../lib/presets';
type Gesture = {
  mode: 'draw' | 'move' | 'resize';
  startX: number;
  startY: number;
  original: Rect;
};
export function CropEditor({ source, preset, aspect, onApply, onCancel }: {
  source: string;
  preset: Preset;
  aspect: number;
  onApply: (crop: Rect) => void;
  onCancel: () => void;
}) {
  const [crop, setCrop] = useState(preset.boost.crop);
  const [draw, setDraw] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  function point(e: React.PointerEvent) { const r = frame.current!.getBoundingClientRect(); return { x: clamp((e.clientX - r.left) / r.width, 0, .998), y: clamp((e.clientY - r.top) / r.height, 0, .998) }; }
  function start(e: React.PointerEvent, mode: Gesture['mode']) { e.stopPropagation(); e.preventDefault(); const p = point(e); gesture.current = { mode, startX: p.x, startY: p.y, original: { ...crop } }; e.currentTarget.setPointerCapture(e.pointerId); }
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
      setCrop({ ...g.original, width: clamp(g.original.width + dx, .002, 1 - g.original.x), height: clamp(g.original.height + dy, .002, 1 - g.original.y) });
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
      <div className="crop-frame" ref={frame} onPointerDown={e => start(e, 'draw')} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}>
        <img src={source} alt="Original frame for boost crop selection" draggable={false} />
        <div className="crop-selection" style={style} onPointerDown={e => start(e, draw ? 'draw' : 'move')}>
          <div className={`crop-mask ${preset.boost.shape}`} style={preset.boost.shape === 'circle' ? { width: `${Math.min(1, crop.height / (crop.width * aspect)) * 100}%`, height: `${Math.min(1, crop.width * aspect / crop.height) * 100}%` } : undefined} />
          <span>BOOST HUD</span>
          <button className="resize-handle" aria-label="Resize boost crop" onPointerDown={e => start(e, 'resize')} />
        </div>
      </div>
      <div className="crop-footer">
        <button onClick={() => setDraw(true)} className={draw ? 'active' : ''}>
          <MousePointer2 size={15} />Draw new selection</button>
        <button onClick={() => setCrop(preset.boost.crop)}>
          <RotateCcw size={15} />Reset</button>
        <span>
          {Math.round(crop.width * 100)}% × {Math.round(crop.height * 100)}% of source</span>
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" onClick={() => onApply({ ...crop, width: Math.min(crop.width, 1 - crop.x), height: Math.min(crop.height, 1 - crop.y) })}>
          <Check size={16} />Apply crop</button>
      </div>
    </div>
  </div>;
}
