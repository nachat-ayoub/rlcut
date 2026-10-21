import { useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Move, Sparkles, Trash2, Type, Underline } from 'lucide-react';
import type { FontOption, TextOverlay } from '../types';
import { Slider } from './Controls';
import { FontPicker } from './FontPicker';

type TextPanel = 'basic' | 'layout' | 'effects';

export function TextInspector({ value, fonts, favoriteFonts, onChange, onAddGoogleFont, onToggleFavoriteFont, onDelete }: {
  value: TextOverlay;
  fonts: FontOption[];
  favoriteFonts: string[];
  onChange: (next: TextOverlay) => void;
  onAddGoogleFont: (family: string) => Promise<void>;
  onToggleFavoriteFont: (id: string) => void;
  onDelete: () => void;
}) {
  const [panel, setPanel] = useState<TextPanel>('basic');
  const set = <K extends keyof TextOverlay>(key: K, next: TextOverlay[K]) => onChange({ ...value, [key]: next });
  return <div className="text-inspector">
    <div className="text-inspector-tabs" role="tablist" aria-label="Text controls">
      <button type="button" role="tab" aria-selected={panel === 'basic'} className={panel === 'basic' ? 'active' : ''} onClick={() => setPanel('basic')}><Type size={14} />Basic</button>
      <button type="button" role="tab" aria-selected={panel === 'layout'} className={panel === 'layout' ? 'active' : ''} onClick={() => setPanel('layout')}><Move size={14} />Layout</button>
      <button type="button" role="tab" aria-selected={panel === 'effects'} className={panel === 'effects' ? 'active' : ''} onClick={() => setPanel('effects')}><Sparkles size={14} />Effects</button>
    </div>

    {panel === 'basic' && <div className="text-panel">
      <label className="field text-content-field">Text<textarea value={value.text} rows={3} onChange={event => set('text', event.target.value)} /></label>
      <label className="text-control-title">Font family<FontPicker value={value.fontFamily} fonts={fonts} favorites={favoriteFonts} onSystemFont={font => onChange({ ...value, fontPath: font.path, fontFamily: font.family, fontBoldPath: font.variants?.bold ?? '', fontBlackPath: font.variants?.black ?? '', fontItalicPath: font.variants?.italic ?? '', fontBoldItalicPath: font.variants?.boldItalic ?? '', fontBlackItalicPath: font.variants?.blackItalic ?? '' })} onGoogleFont={onAddGoogleFont} onToggleFavorite={onToggleFavoriteFont} /></label>
      <div className="text-format-row" role="toolbar" aria-label="Text style and alignment">
        <div><button type="button" className={`${value.fontWeight > 400 ? 'active' : ''} ${value.fontWeight === 900 ? 'black' : ''}`} onClick={() => { const fontWeight = value.fontWeight === 400 ? 700 : value.fontWeight === 700 ? 900 : 400; onChange({ ...value, fontWeight, bold: fontWeight > 400 }); }} title={`Weight: ${value.fontWeight === 900 ? 'Black' : value.fontWeight === 700 ? 'Bold' : 'Normal'} · click to cycle`}><Bold size={15} /><small>{value.fontWeight === 900 ? 'BLK' : value.fontWeight === 700 ? 'B' : ''}</small></button><button type="button" className={value.italic ? 'active' : ''} onClick={() => set('italic', !value.italic)} title="Italic"><Italic size={15} /></button><button type="button" className={value.underline ? 'active' : ''} onClick={() => set('underline', !value.underline)} title="Underline"><Underline size={15} /></button></div>
        <span />
        <div><button type="button" className={value.align === 'left' ? 'active' : ''} onClick={() => set('align', 'left')} title="Align left"><AlignLeft size={15} /></button><button type="button" className={value.align === 'center' ? 'active' : ''} onClick={() => set('align', 'center')} title="Align center"><AlignCenter size={15} /></button><button type="button" className={value.align === 'right' ? 'active' : ''} onClick={() => set('align', 'right')} title="Align right"><AlignRight size={15} /></button></div>
      </div>
      <div className="text-color-row">
        <label className="color-field"><span>Fill</span><input type="color" value={value.color} onChange={event => set('color', event.target.value)} /></label>
        <label className="color-field"><span>Stroke</span><input type="color" value={value.strokeColor} onChange={event => set('strokeColor', event.target.value)} /></label>
        <label className="color-field"><span>Backdrop</span><input type="color" value={value.backgroundColor} onChange={event => set('backgroundColor', event.target.value)} /></label>
      </div>
      <div className="text-control-stack">
        <Slider label="Size" value={value.fontSize} min={12} max={240} step={1} defaultValue={72} onChange={next => set('fontSize', next)} suffix="px" />
        <Slider label="Opacity" value={value.opacity} min={0} max={1} step={.01} defaultValue={1} onChange={next => set('opacity', next)} suffix="×" />
      </div>
    </div>}

    {panel === 'layout' && <div className="text-panel">
      <div className="text-control-grid">
        <Slider label="Scale" value={value.scale} min={.1} max={5} step={.01} defaultValue={1} onChange={next => set('scale', next)} suffix="×" />
        <Slider label="Text box width" value={value.boxWidth} min={.1} max={1} step={.01} defaultValue={.7} onChange={next => set('boxWidth', next)} suffix="×" />
        <Slider label="Rotation" value={value.rotation} min={-180} max={180} step={1} defaultValue={0} onChange={next => set('rotation', next)} suffix="°" />
        <Slider label="Letter spacing" value={value.letterSpacing} min={-5} max={30} step={.5} defaultValue={0} onChange={next => set('letterSpacing', next)} suffix="px" />
        <Slider label="Line height" value={value.lineHeight} min={.7} max={2} step={.05} defaultValue={1.2} onChange={next => set('lineHeight', next)} suffix="×" />
      </div>
      <div className="text-subsection"><span>Position</span><div className="text-control-grid"><Slider label="X position" value={value.x} min={0} max={1} step={.001} defaultValue={.5} onChange={next => set('x', next)} /><Slider label="Y position" value={value.y} min={0} max={1} step={.001} defaultValue={.5} onChange={next => set('y', next)} /></div></div>
    </div>}

    {panel === 'effects' && <div className="text-panel">
      <div className="text-subsection first"><span>Stroke & backdrop</span>
        <Slider label="Stroke width" value={value.strokeWidth} min={0} max={15} step={.5} defaultValue={9} onChange={next => set('strokeWidth', next)} suffix="px" />
        {value.strokeWidth > 0 && <div className="stroke-position" role="group" aria-label="Stroke position"><button type="button" className={value.strokePosition === 'inside' ? 'active' : ''} onClick={() => set('strokePosition', 'inside')}>Inside</button><button type="button" className={value.strokePosition === 'center' ? 'active' : ''} onClick={() => set('strokePosition', 'center')}>Center</button><button type="button" className={value.strokePosition === 'outside' ? 'active' : ''} onClick={() => set('strokePosition', 'outside')}>Outside</button></div>}
        <Slider label="Backdrop opacity" value={value.backgroundOpacity} min={0} max={1} step={.01} defaultValue={0} onChange={next => set('backgroundOpacity', next)} suffix="×" />
      </div>
      <div className="text-subsection"><div className="text-subsection-toggle"><span>Shadow</span><input className="switch" type="checkbox" aria-label="Text shadow" checked={value.shadowEnabled} onChange={event => set('shadowEnabled', event.target.checked)} /></div>
        {value.shadowEnabled && <><label className="color-field full">Shadow color<input type="color" value={value.shadowColor} onChange={event => set('shadowColor', event.target.value)} /></label><div className="text-control-grid"><Slider label="Blur" value={value.shadowBlur} min={0} max={40} step={1} defaultValue={8} onChange={next => set('shadowBlur', next)} suffix="px" /><Slider label="X offset" value={value.shadowX} min={-50} max={50} step={1} defaultValue={0} onChange={next => set('shadowX', next)} suffix="px" /><Slider label="Y offset" value={value.shadowY} min={-50} max={50} step={1} defaultValue={6} onChange={next => set('shadowY', next)} suffix="px" /></div></>}
      </div>
      <div className="text-subsection"><span>Animation</span><div className="text-fades-inline"><div><label>Fade in<input className="switch" type="checkbox" checked={value.fadeIn != null} onChange={event => set('fadeIn', event.target.checked ? .5 : null)} /></label>{value.fadeIn != null && <Slider label="Duration" value={value.fadeIn} min={.05} max={10} step={.05} defaultValue={.5} onChange={next => set('fadeIn', next)} suffix="s" />}</div><div><label>Fade out<input className="switch" type="checkbox" checked={value.fadeOut != null} onChange={event => set('fadeOut', event.target.checked ? .5 : null)} /></label>{value.fadeOut != null && <Slider label="Duration" value={value.fadeOut} min={.05} max={10} step={.05} defaultValue={.5} onChange={next => set('fadeOut', next)} suffix="s" />}</div></div></div>
    </div>}

    <button type="button" className="danger-quiet" onClick={onDelete}><Trash2 size={14} />Delete text</button>
  </div>;
}
