import { useState, type ReactNode } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, ChevronDown, Italic, Move, Palette, Play, Sparkles, Trash2, Type, Underline } from 'lucide-react';
import type { FontOption, TextOverlay } from '../types';
import { Slider } from './Controls';
import { FontPicker } from './FontPicker';

type Group = 'typography' | 'transform' | 'appearance' | 'shadow' | 'animation';

function PropertyGroup({ title, icon, summary, open, onToggle, children }: {
  title: string;
  icon: ReactNode;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return <section className={`text-property-group ${open ? 'open' : ''}`}>
    <button type="button" className="text-property-heading" aria-expanded={open} onClick={onToggle}>
      <span className="text-property-name">{icon}<strong>{title}</strong></span>
      <span className="text-property-summary">{summary}<ChevronDown size={14} /></span>
    </button>
    {open && <div className="text-property-body">{children}</div>}
  </section>;
}

function ColorControl({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="premium-color-control"><span>{label}</span><span className="premium-color-value"><i style={{ background: value }} /><code>{value.toUpperCase()}</code><input type="color" value={value} onChange={event => onChange(event.target.value)} /></span></label>;
}

export function TextInspector({ value, fonts, favoriteFonts, onChange, onAddGoogleFont, onToggleFavoriteFont, onDelete }: {
  value: TextOverlay;
  fonts: FontOption[];
  favoriteFonts: string[];
  onChange: (next: TextOverlay) => void;
  onAddGoogleFont: (family: string) => Promise<void>;
  onToggleFavoriteFont: (id: string) => void;
  onDelete: () => void;
}) {
  const [groups, setGroups] = useState<Record<Group, boolean>>({ typography: true, transform: false, appearance: true, shadow: value.shadowEnabled, animation: value.fadeIn != null || value.fadeOut != null });
  const set = <K extends keyof TextOverlay>(key: K, next: TextOverlay[K]) => onChange({ ...value, [key]: next });
  const toggle = (group: Group) => setGroups(current => ({ ...current, [group]: !current[group] }));
  const weightName = value.fontWeight === 900 ? 'Black' : value.fontWeight === 700 ? 'Bold' : 'Regular';
  const animationSummary = value.fadeIn != null && value.fadeOut != null ? 'Fade in + out' : value.fadeIn != null ? 'Fade in' : value.fadeOut != null ? 'Fade out' : 'None';

  return <div className="text-inspector premium-text-inspector">
    <div className="text-editor-primary">
      <div className="text-editor-label"><span>Content</span><small>{value.text.length} characters</small></div>
      <textarea aria-label="Text content" value={value.text} rows={3} placeholder="Type your text" onChange={event => set('text', event.target.value)} />
    </div>

    <div className="text-font-surface">
      <div className="text-editor-label"><span>Typeface</span></div>
      <FontPicker value={value.fontFamily} fonts={fonts} favorites={favoriteFonts} onSystemFont={font => onChange({ ...value, fontPath: font.path, fontFamily: font.family, fontBoldPath: font.variants?.bold ?? '', fontBlackPath: font.variants?.black ?? '', fontItalicPath: font.variants?.italic ?? '', fontBoldItalicPath: font.variants?.boldItalic ?? '', fontBlackItalicPath: font.variants?.blackItalic ?? '' })} onGoogleFont={onAddGoogleFont} onToggleFavorite={onToggleFavoriteFont} />
      <div className="premium-format-toolbar" role="toolbar" aria-label="Text formatting">
        <div className="format-cluster"><button type="button" className={`${value.fontWeight > 400 ? 'active' : ''} ${value.fontWeight === 900 ? 'black' : ''}`} onClick={() => { const fontWeight = value.fontWeight === 400 ? 700 : value.fontWeight === 700 ? 900 : 400; onChange({ ...value, fontWeight, bold: fontWeight > 400 }); }} title={`Weight: ${weightName}`}><Bold size={15} /><small>{value.fontWeight === 900 ? '9' : value.fontWeight === 700 ? '7' : '4'}</small></button><button type="button" className={value.italic ? 'active' : ''} onClick={() => set('italic', !value.italic)} title="Italic"><Italic size={15} /></button><button type="button" className={value.underline ? 'active' : ''} onClick={() => set('underline', !value.underline)} title="Underline"><Underline size={15} /></button></div>
        <i />
        <div className="format-cluster"><button type="button" className={value.align === 'left' ? 'active' : ''} onClick={() => set('align', 'left')} title="Align left"><AlignLeft size={15} /></button><button type="button" className={value.align === 'center' ? 'active' : ''} onClick={() => set('align', 'center')} title="Align center"><AlignCenter size={15} /></button><button type="button" className={value.align === 'right' ? 'active' : ''} onClick={() => set('align', 'right')} title="Align right"><AlignRight size={15} /></button></div>
      </div>
    </div>

    <div className="text-property-list">
      <PropertyGroup title="Typography" icon={<Type size={15} />} summary={`${weightName} · ${Math.round(value.fontSize)} px`} open={groups.typography} onToggle={() => toggle('typography')}>
        <Slider label="Font size" value={value.fontSize} min={12} max={240} step={1} defaultValue={72} onChange={next => set('fontSize', next)} suffix="px" />
        <Slider label="Opacity" value={value.opacity} min={0} max={1} step={.01} defaultValue={1} onChange={next => set('opacity', next)} suffix="×" />
        <Slider label="Text box width" value={value.boxWidth} min={.1} max={1} step={.01} defaultValue={.7} onChange={next => set('boxWidth', next)} suffix="×" />
        <Slider label="Letter spacing" value={value.letterSpacing} min={-5} max={30} step={.5} defaultValue={0} onChange={next => set('letterSpacing', next)} suffix="px" />
        <Slider label="Line height" value={value.lineHeight} min={.7} max={2} step={.05} defaultValue={1.2} onChange={next => set('lineHeight', next)} suffix="×" />
      </PropertyGroup>

      <PropertyGroup title="Transform" icon={<Move size={15} />} summary={`${value.scale.toFixed(2)}× · ${Math.round(value.rotation)}°`} open={groups.transform} onToggle={() => toggle('transform')}>
        <Slider label="Scale" value={value.scale} min={.1} max={5} step={.01} defaultValue={1} onChange={next => set('scale', next)} suffix="×" />
        <Slider label="Rotation" value={value.rotation} min={-180} max={180} step={1} defaultValue={0} onChange={next => set('rotation', next)} suffix="°" />
        <Slider label="Horizontal position" value={value.x} min={0} max={1} step={.001} defaultValue={.5} onChange={next => set('x', next)} />
        <Slider label="Vertical position" value={value.y} min={0} max={1} step={.001} defaultValue={.5} onChange={next => set('y', next)} />
      </PropertyGroup>

      <PropertyGroup title="Appearance" icon={<Palette size={15} />} summary={`${value.strokeWidth}px ${value.strokePosition}`} open={groups.appearance} onToggle={() => toggle('appearance')}>
        <div className="premium-color-list"><ColorControl label="Text" value={value.color} onChange={next => set('color', next)} /><ColorControl label="Stroke" value={value.strokeColor} onChange={next => set('strokeColor', next)} /><ColorControl label="Backdrop" value={value.backgroundColor} onChange={next => set('backgroundColor', next)} /></div>
        <Slider label="Stroke width" value={value.strokeWidth} min={0} max={15} step={.5} defaultValue={9} onChange={next => set('strokeWidth', next)} suffix="px" />
        {value.strokeWidth > 0 && <div className="stroke-position premium-segmented" role="group" aria-label="Stroke position"><button type="button" className={value.strokePosition === 'inside' ? 'active' : ''} onClick={() => set('strokePosition', 'inside')}>Inside</button><button type="button" className={value.strokePosition === 'center' ? 'active' : ''} onClick={() => set('strokePosition', 'center')}>Center</button><button type="button" className={value.strokePosition === 'outside' ? 'active' : ''} onClick={() => set('strokePosition', 'outside')}>Outside</button></div>}
        <Slider label="Backdrop opacity" value={value.backgroundOpacity} min={0} max={1} step={.01} defaultValue={0} onChange={next => set('backgroundOpacity', next)} suffix="×" />
      </PropertyGroup>

      <PropertyGroup title="Shadow" icon={<Sparkles size={15} />} summary={value.shadowEnabled ? `${value.shadowBlur}px blur` : 'Off'} open={groups.shadow} onToggle={() => toggle('shadow')}>
        <label className="premium-effect-toggle"><span><strong>Enable shadow</strong><small>Add separation from busy footage.</small></span><input className="switch" type="checkbox" checked={value.shadowEnabled} onChange={event => set('shadowEnabled', event.target.checked)} /></label>
        {value.shadowEnabled && <><div className="premium-color-list"><ColorControl label="Shadow" value={value.shadowColor} onChange={next => set('shadowColor', next)} /></div><Slider label="Blur" value={value.shadowBlur} min={0} max={40} step={1} defaultValue={8} onChange={next => set('shadowBlur', next)} suffix="px" /><Slider label="Horizontal offset" value={value.shadowX} min={-50} max={50} step={1} defaultValue={0} onChange={next => set('shadowX', next)} suffix="px" /><Slider label="Vertical offset" value={value.shadowY} min={-50} max={50} step={1} defaultValue={6} onChange={next => set('shadowY', next)} suffix="px" /></>}
      </PropertyGroup>

      <PropertyGroup title="Animation" icon={<Play size={15} />} summary={animationSummary} open={groups.animation} onToggle={() => toggle('animation')}>
        <label className="premium-effect-toggle"><span><strong>Fade in</strong><small>Bring the text in smoothly.</small></span><input className="switch" type="checkbox" checked={value.fadeIn != null} onChange={event => set('fadeIn', event.target.checked ? .5 : null)} /></label>
        {value.fadeIn != null && <Slider label="Fade-in duration" value={value.fadeIn} min={.05} max={10} step={.05} defaultValue={.5} onChange={next => set('fadeIn', next)} suffix="s" />}
        <label className="premium-effect-toggle"><span><strong>Fade out</strong><small>Let the text leave without a hard cut.</small></span><input className="switch" type="checkbox" checked={value.fadeOut != null} onChange={event => set('fadeOut', event.target.checked ? .5 : null)} /></label>
        {value.fadeOut != null && <Slider label="Fade-out duration" value={value.fadeOut} min={.05} max={10} step={.05} defaultValue={.5} onChange={next => set('fadeOut', next)} suffix="s" />}
      </PropertyGroup>
    </div>

    <button type="button" className="text-delete-action" onClick={onDelete}><Trash2 size={14} />Delete text clip</button>
  </div>;
}
