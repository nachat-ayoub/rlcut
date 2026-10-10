import { useState, type ReactNode } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';
export function Slider({ label, value, min = 0, max = 1, step = 0.01, onChange, suffix = '' }: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return <div className="slider-control">
    <div className="control-label">
      <label>
        {label}
      </label>
      <div className="numeric">
        <input aria-label={`${label} value`} type="number" min={min} max={max} step={step} value={draft ?? Number(value.toFixed(4))} onChange={e => {
          setDraft(e.target.value); const v = e.target.valueAsNumber; if (Number.isFinite(v) && v >= min && v <= max)
            onChange(v);
        }} onBlur={() => setDraft(null)} />
        <span>
          {suffix}
        </span>
      </div>
    </div>
    <input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={e => { setDraft(null); onChange(Number(e.target.value)); }} style={{ '--range-fill': `${(value - min) / (max - min) * 100}%` } as React.CSSProperties} />
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
