import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Trash2, Underline } from 'lucide-react';
import type { FontOption, TextOverlay } from '../types';
import { Slider } from './Controls';
import { FontPicker } from './FontPicker';

export function TextInspector({ value, fonts, onChange, onAddGoogleFont, onDelete }: {
  value: TextOverlay;
  fonts: FontOption[];
  onChange: (next: TextOverlay) => void;
  onAddGoogleFont: (family: string) => Promise<void>;
  onDelete: () => void;
}) {
  const set = <K extends keyof TextOverlay>(key: K, next: TextOverlay[K]) => onChange({ ...value, [key]: next });
  return <div className="text-inspector">
    <label className="field text-content-field">Text<textarea value={value.text} rows={3} onChange={event => set('text', event.target.value)} /></label>
    <label className="text-control-title">Font family<FontPicker value={value.fontFamily} fonts={fonts} onSystemFont={font => onChange({ ...value, fontPath: font.path, fontFamily: font.family, fontBoldPath: '', fontBlackPath: '', fontItalicPath: '', fontBoldItalicPath: '', fontBlackItalicPath: '' })} onGoogleFont={onAddGoogleFont} /></label>
    <div className="text-format-row" role="toolbar" aria-label="Text style and alignment">
      <div><button className={`${value.fontWeight > 400 ? 'active' : ''} ${value.fontWeight === 900 ? 'black' : ''}`} onClick={() => { const fontWeight = value.fontWeight === 400 ? 700 : value.fontWeight === 700 ? 900 : 400; onChange({ ...value, fontWeight, bold: fontWeight > 400 }); }} title={`Weight: ${value.fontWeight === 900 ? 'Black' : value.fontWeight === 700 ? 'Bold' : 'Normal'} · click to cycle`}><Bold size={15} /><small>{value.fontWeight === 900 ? 'BLK' : value.fontWeight === 700 ? 'B' : ''}</small></button><button className={value.italic ? 'active' : ''} onClick={() => set('italic', !value.italic)} title="Italic"><Italic size={15} /></button><button className={value.underline ? 'active' : ''} onClick={() => set('underline', !value.underline)} title="Underline"><Underline size={15} /></button></div>
      <span />
      <div><button className={value.align === 'left' ? 'active' : ''} onClick={() => set('align', 'left')} title="Align left"><AlignLeft size={15} /></button><button className={value.align === 'center' ? 'active' : ''} onClick={() => set('align', 'center')} title="Align center"><AlignCenter size={15} /></button><button className={value.align === 'right' ? 'active' : ''} onClick={() => set('align', 'right')} title="Align right"><AlignRight size={15} /></button></div>
    </div>
    <div className="text-color-row">
      <label className="color-field"><span>Fill</span><input type="color" value={value.color} onChange={event => set('color', event.target.value)} /></label>
      <label className="color-field"><span>Stroke</span><input type="color" value={value.strokeColor} onChange={event => set('strokeColor', event.target.value)} /></label>
      <label className="color-field"><span>Background</span><input type="color" value={value.backgroundColor} onChange={event => set('backgroundColor', event.target.value)} /></label>
    </div>
    <div className="text-settings-card"><Slider label="Size" value={value.fontSize} min={12} max={240} step={1} defaultValue={72} onChange={next => set('fontSize', next)} suffix="px" /><Slider label="Opacity" value={value.opacity} min={0} max={1} step={.01} defaultValue={1} onChange={next => set('opacity', next)} suffix="×" /></div>
    <div className="text-settings-card text-settings-grid">
      <Slider label="Scale" value={value.scale} min={.1} max={5} step={.01} defaultValue={1} onChange={next => set('scale', next)} suffix="×" />
      <Slider label="Text box width" value={value.boxWidth} min={.1} max={1} step={.01} defaultValue={.7} onChange={next => set('boxWidth', next)} suffix="×" />
      <Slider label="Rotation" value={value.rotation} min={-180} max={180} step={1} defaultValue={0} onChange={next => set('rotation', next)} suffix="°" />
      <Slider label="Letter spacing" value={value.letterSpacing} min={-5} max={30} step={.5} defaultValue={0} onChange={next => set('letterSpacing', next)} suffix="px" />
      <Slider label="Line height" value={value.lineHeight} min={.7} max={2} step={.05} defaultValue={1.2} onChange={next => set('lineHeight', next)} suffix="×" />
    </div>
    <div className="text-settings-card"><Slider label="Stroke width" value={value.strokeWidth} min={0} max={15} step={.5} defaultValue={0} onChange={next => set('strokeWidth', next)} suffix="px" />{value.strokeWidth > 0 && <div className="stroke-position" role="group" aria-label="Stroke position"><button className={value.strokePosition === 'inside' ? 'active' : ''} onClick={() => set('strokePosition', 'inside')}>Inside</button><button className={value.strokePosition === 'center' ? 'active' : ''} onClick={() => set('strokePosition', 'center')}>Center</button><button className={value.strokePosition === 'outside' ? 'active' : ''} onClick={() => set('strokePosition', 'outside')}>Outside</button></div>}<Slider label="Background opacity" value={value.backgroundOpacity} min={0} max={1} step={.01} defaultValue={0} onChange={next => set('backgroundOpacity', next)} suffix="×" /></div>
    <details className="text-advanced"><summary>Shadow & position</summary>
      <label className="color-field full">Shadow color<input type="color" value={value.shadowColor} onChange={event => set('shadowColor', event.target.value)} /></label>
      <div className="two-controls">
        <Slider label="Shadow blur" value={value.shadowBlur} min={0} max={40} step={1} defaultValue={0} onChange={next => set('shadowBlur', next)} suffix="px" />
        <Slider label="Shadow X" value={value.shadowX} min={-50} max={50} step={1} defaultValue={0} onChange={next => set('shadowX', next)} suffix="px" />
        <Slider label="Shadow Y" value={value.shadowY} min={-50} max={50} step={1} defaultValue={4} onChange={next => set('shadowY', next)} suffix="px" />
        <Slider label="X position" value={value.x} min={0} max={1} step={.001} defaultValue={.5} onChange={next => set('x', next)} />
        <Slider label="Y position" value={value.y} min={0} max={1} step={.001} defaultValue={.5} onChange={next => set('y', next)} />
      </div>
    </details>
    <div className="text-fades">
      <div className="setting-toggle compact"><div><strong>Fade in</strong></div><input className="switch" type="checkbox" checked={value.fadeIn != null} onChange={event => set('fadeIn', event.target.checked ? .5 : null)} /></div>
      {value.fadeIn != null && <Slider label="Fade-in duration" value={value.fadeIn} min={.05} max={10} step={.05} defaultValue={.5} onChange={next => set('fadeIn', next)} suffix="s" />}
      <div className="setting-toggle compact"><div><strong>Fade out</strong></div><input className="switch" type="checkbox" checked={value.fadeOut != null} onChange={event => set('fadeOut', event.target.checked ? .5 : null)} /></div>
      {value.fadeOut != null && <Slider label="Fade-out duration" value={value.fadeOut} min={.05} max={10} step={.05} defaultValue={.5} onChange={next => set('fadeOut', next)} suffix="s" />}
    </div>
    <button className="danger-quiet" onClick={onDelete}><Trash2 size={14} />Delete text</button>
  </div>;
}
