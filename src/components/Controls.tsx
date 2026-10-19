import { useState, type ReactNode } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';
export function Slider({ label, value, min = 0, max = 1, step = 0.01, onChange, suffix = '', defaultValue, snapThreshold }: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  suffix?: string;
  defaultValue?: number;
  snapThreshold?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const trackPosition = (point: number) => {
    const ratio = Math.max(0, Math.min(1, (point - min) / (max - min)));
    // Native range thumbs travel inside half a thumb at both ends. Account for
    // that inset so the default tick crosses the thumb's actual center.
    return `calc(${ratio * 100}% + ${4.5 - ratio * 9}px)`;
  };
  const snap = (next: number) => defaultValue != null && defaultValue >= min && defaultValue <= max && Math.abs(next - defaultValue) <= (snapThreshold ?? Math.max(step * 2, (max - min) * .015)) ? defaultValue : next;
  return <div className="slider-control">
    <div className="control-label">
      <label>
        {label}
      </label>
      <div className="numeric">
        <input aria-label={`${label} value`} type="number" min={min} max={max} step={step} value={draft ?? Number(value.toFixed(4))} onChange={e => {
          setDraft(e.target.value); const v = e.target.valueAsNumber; if (Number.isFinite(v) && v >= min && v <= max)
            onChange(snap(v));
        }} onBlur={() => setDraft(null)} />
        <span>
          {suffix}
        </span>
      </div>
    </div>
    <div className="slider-range">
      <input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={e => { setDraft(null); onChange(snap(Number(e.target.value))); }} style={{ '--range-fill': `${(value - min) / (max - min) * 100}%` } as React.CSSProperties} />
      {defaultValue != null && defaultValue >= min && defaultValue <= max && <i className="slider-default" style={{ left: trackPosition(defaultValue) }} />}
    </div>
  </div>;
}
export function Section({ title, icon, children, reset, open = true }: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  reset?: () => void;
  open?: boolean;
}) {
  return <details className="section" open={open}>
    <summary>
      <span>
        {icon}{title}
      </span>
      <span>
        {reset && <button title={`Reset ${title}`} aria-label={`Reset ${title}`} onClick={e => { e.preventDefault(); reset(); }}>
          <RotateCcw size={13} />
        </button>}<ChevronDown size={14} />
      </span>
    </summary>
    <div className="section-body">
      {children}
    </div>
  </details>;
}
