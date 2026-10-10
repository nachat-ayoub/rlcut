import { anchor } from '../lib/geometry';
export function Alignment({ width, height, onChange }: { width: number; height: number; onChange: (x: number, y: number) => void }) {
  return <div className="alignment"><span>Align to canvas</span><div>{[0, .5, 1].flatMap((y, row) => [0, .5, 1].map((x, col) => <button key={`${x},${y}`} aria-label={`Align ${['top', 'middle', 'bottom'][row]} ${['left', 'center', 'right'][col]}`} title={`${['Top', 'Middle', 'Bottom'][row]} ${['left', 'center', 'right'][col]}`} onClick={() => onChange(anchor(width, x), anchor(height, y))}>{['↖', '↑', '↗', '←', '•', '→', '↙', '↓', '↘'][row * 3 + col]}</button>))}</div></div>;
}
