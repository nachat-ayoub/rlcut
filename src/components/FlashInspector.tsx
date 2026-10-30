import { Clock3, Play, Sparkles, Trash2 } from 'lucide-react';
import type { FlashEffect } from '../types';
import { Dropdown } from './Dropdown';
import { Section, Slider } from './Controls';
import { time } from '../lib/presets';

const styles = [
  { label: 'Soft', intensity: .55, duration: .58, easing: 'ease' as const },
  { label: 'Impact', intensity: .82, duration: .45, easing: 'easeOut' as const },
  { label: 'Hard', intensity: 1, duration: .28, easing: 'easeOut' as const },
];

export function FlashInspector({ value, onChange, onDelete, onPreview }: {
  value: FlashEffect;
  onChange: (value: FlashEffect) => void;
  onDelete: () => void;
  onPreview: () => void;
}) {
  const name = value.kind === 'flash' ? 'Impact flash' : value.kind === 'raggeo' ? 'Raggeo' : 'Black & white';
  return <div className="flash-inspector">
    <div className="flash-hero">
      <span className="flash-hero-icon"><Sparkles size={18} /></span>
      <div><strong>{name}</strong><small><Clock3 size={11} />{time(value.time)} · {value.timing === 'clip' ? 'whole clip' : `${value.duration.toFixed(2)}s`}</small></div>
      <button onClick={onPreview} title="Preview from the effect" aria-label={`Preview ${name}`}><Play size={14} fill="currentColor" /></button>
    </div>
    <Section title="Effect" icon={<Sparkles size={16} />}>
      <div className="flash-kind effect-types" role="group" aria-label="Effect type">
        <button className={value.kind === 'flash' ? 'active' : ''} onClick={() => onChange({ ...value, kind: 'flash', timing: 'duration', duration: Math.min(1.5, value.duration) })}>Impact flash</button>
        <button className={value.kind === 'darkGray' ? 'active' : ''} onClick={() => onChange({ ...value, kind: 'darkGray' })}>Black & white</button>
        <button className={value.kind === 'raggeo' ? 'active' : ''} onClick={() => onChange({ ...value, kind: 'raggeo' })}>Raggeo</button>
      </div>
      {value.kind === 'flash' && <div className="flash-presets" role="group" aria-label="Effect style">
        {styles.map(style => <button key={style.label} className={Math.abs(value.intensity - style.intensity) < .01 && Math.abs(value.duration - style.duration) < .01 ? 'active' : ''} onClick={() => onChange({ ...value, intensity: style.intensity, duration: style.duration, easing: style.easing })}>{style.label}</button>)}
      </div>}
      <Slider label={value.kind === 'flash' ? 'Intensity' : 'Strength'} value={value.intensity} min={.05} max={1} step={.01} defaultValue={.82} onChange={intensity => onChange({ ...value, intensity })} suffix="×" />
      {value.kind !== 'flash' && <div className="flash-kind" role="group" aria-label={`${name} duration`}>
        <button className={value.timing === 'duration' ? 'active' : ''} onClick={() => onChange({ ...value, timing: 'duration' })}>Timeline range</button>
        <button className={value.timing === 'clip' ? 'active' : ''} onClick={() => onChange({ ...value, timing: 'clip' })}>Whole clip</button>
      </div>}
      {value.kind === 'flash' && value.timing === 'duration' && <Slider label="Duration" value={value.duration} min={.08} max={1.5} step={.01} defaultValue={.45} onChange={duration => onChange({ ...value, duration })} suffix="s" />}
      {value.kind !== 'flash' && value.timing === 'duration' && <p className="help-text">Resize the effect directly on the timeline. It can span the full edit.</p>}
      {value.kind === 'flash' && <label className="field">Fade curve<Dropdown label="Effect fade curve" value={value.easing} onChange={easing => onChange({ ...value, easing: easing as FlashEffect['easing'] })} options={[
        { value: 'easeOut', label: 'Quick hit · recommended' },
        { value: 'ease', label: 'Smooth' },
        { value: 'linear', label: 'Linear' },
        { value: 'easeIn', label: 'Hold then fade' },
        { value: 'easeInOut', label: 'Soft S-curve' },
      ]} /></label>}
      <label className="field">Layer placement<Dropdown label="Effect layer placement" value={value.scope} onChange={scope => onChange({ ...value, scope: scope as FlashEffect['scope'] })} options={[{ value: 'video', label: 'Under text' }, { value: 'all', label: 'Top · include text' }]} /></label>
      {value.kind === 'flash' && <label className="flash-color-control"><span><strong>Flash color</strong><small>White works best for impact edits.</small></span><span className="flash-color-value"><i style={{ background: value.color }} /><code>{value.color.toUpperCase()}</code><input aria-label="Flash color" type="color" value={value.color} onChange={event => onChange({ ...value, color: event.target.value })} /></span></label>}
    </Section>
    <button className="danger-quiet flash-delete" onClick={onDelete}><Trash2 size={14} />Remove effect</button>
  </div>;
}
