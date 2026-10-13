import type { BoostEasing } from '../types';

export function ease(value: number, easing: BoostEasing) {
  const t = Math.max(0, Math.min(1, value));
  if (easing === 'linear') return t;
  if (easing === 'easeIn') return t ** 3;
  if (easing === 'easeOut') return 1 - (1 - t) ** 3;
  if (easing === 'easeInOut') return t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
  return t * t * (3 - 2 * t);
}
