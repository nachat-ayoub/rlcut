import { clamp } from './presets';
import type { Rect } from '../types';
export const corners = ['nw', 'ne', 'sw', 'se'] as const;
export type Corner = typeof corners[number];
export function resizeCrop(r: Rect, corner: Corner, dx: number, dy: number): Rect {
  const left = corner.includes('w') ? clamp(r.x + dx, 0, r.x + r.width - .002) : r.x;
  const top = corner.includes('n') ? clamp(r.y + dy, 0, r.y + r.height - .002) : r.y;
  const right = corner.includes('e') ? clamp(r.x + r.width + dx, r.x + .002, 1) : r.x + r.width;
  const bottom = corner.includes('s') ? clamp(r.y + r.height + dy, r.y + .002, 1) : r.y + r.height;
  return { x: left, y: top, width: right - left, height: bottom - top };
}
export function snapAxis(position: number, size: number, threshold: number) {
  const targets = [.5, size / 2, 1 - size / 2].filter(v => v >= 0 && v <= 1);
  const closest = targets.reduce((a, b) => Math.abs(position - a) < Math.abs(position - b) ? a : b);
  return Math.abs(position - closest) <= threshold ? { position: closest, guide: closest === .5 ? .5 : closest === size / 2 ? 0 : 1 } : { position: clamp(position), guide: null };
}
export function anchor(size: number, alignment: number) { return clamp(alignment === .5 ? .5 : alignment === 0 ? size / 2 : 1 - size / 2); }
