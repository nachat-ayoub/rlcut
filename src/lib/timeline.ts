import type { Segment } from '../types';
export const editedDuration = (segments: Segment[]) => segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
export function trimBounds(segments: Segment[], index: number, duration: number, minimum = .05) {
  const segment = segments[index];
  return {
    start: { min: segments[index - 1]?.end ?? 0, max: segment.end - minimum },
    end: { min: segment.start + minimum, max: segments[index + 1]?.start ?? duration },
  };
}
export function sourceToEdited(segments: Segment[], source: number) {
  let offset = 0;
  for (const segment of segments) {
    if (source < segment.start) return offset;
    if (source < segment.end) return offset + source - segment.start;
    offset += segment.end - segment.start;
  }
  return offset;
}
export function editedToSource(segments: Segment[], value: number) {
  const edited = Math.max(0, Math.min(editedDuration(segments), value));
  let offset = 0;
  for (const segment of segments) {
    const length = segment.end - segment.start;
    // A cut boundary belongs to the next kept interval, never to a gap.
    if (edited < offset + length) return segment.start + Math.max(0, edited - offset);
    offset += length;
  }
  return segments.at(-1)?.end ?? 0;
}
