import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { Diamond, Film, Music2, Pause, Play, Plus, Redo2, SkipBack, SkipForward, Undo2, Volume2, VolumeX, ZoomIn, ZoomOut } from 'lucide-react';
import type { MusicTrack, Segment, TrackMarkers } from '../types';
import { time } from '../lib/presets';
import { editedDuration as durationOf, sourceToEdited, editedToSource, trimBounds } from '../lib/timeline';

type Track = 'video' | 'music';
type ClipGesture = {
  mode: 'edge' | 'body' | 'reorder'; track: Track; id: string; edge: 'start' | 'end'; pointer: number;
  x: number; value: number; min: number; max: number; offset: number; clipStart: number;
  index: number; moved: boolean;
};
type MarkerGesture = { track: Track; index: number; pointer: number; x: number; value: number };
type TrimPreview = { mode: 'edge' | 'body'; track: Track; id: string; edge: 'start' | 'end'; value: number; snapped: boolean };
type ReorderPreview = { track: Track; id: string; target: number; offset: number; width: number };
const MIN_CLIP = .05;
const SNAP_PIXELS = 9;
const offsetsOf = (clips: Segment[]) => { let cursor = 0; return clips.map(clip => { const offset = cursor; cursor += clip.end - clip.start; return offset; }); };
const unique = (values: number[]) => values.filter((value, index) => values.findIndex(other => Math.abs(other - value) < .0001) === index);
const TrimStartIcon = () => <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M5 2.5v13M8 4.5v9M8 9h6" /></svg>;
const TrimEndIcon = () => <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M13 2.5v13M10 4.5v9M10 9H4" /></svg>;
const SplitIcon = () => <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 2v3M9 7v4M9 13v3M3.5 4.5h3v9h-3M14.5 4.5h-3v9h3" /></svg>;
const RippleDeleteIcon = () => <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M4 5h10M6 5l.6 10h4.8L12 5M7 5V3h4v2M8 7.5v5M10 7.5v5" /></svg>;
const MarkerIcon = () => <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 2.5 14.5 5v4c0 3.2-2.2 5.4-5.5 6.5C5.7 14.4 3.5 12.2 3.5 9V5z" /><path d="M9 5.5v5M6.5 8h5" /></svg>;

export function Timeline({ duration, sourceDurations, timestamp, segments, music, markers, playing, playbackReady, canUndo, canRedo, onSeek, onPlay, onEdit, onMarker, onSelectionChange, onUndo, onRedo, onImportVideo, onImportMusic }: {
  duration: number;
  sourceDurations: number[];
  timestamp: number;
  segments: Segment[];
  music: MusicTrack | null;
  markers: TrackMarkers;
  playing: boolean;
  playbackReady: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onSeek: (value: number) => void;
  onPlay: () => void;
  onEdit: (track: Track, segments: Segment[]) => void;
  onMarker: (track: Track, values: number[]) => void;
  onSelectionChange: (track: Track, id: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onImportVideo: () => void;
  onImportMusic: () => void;
}) {
  const [pixelsPerSecond, setPixelsPerSecond] = useState(64);
  const [selection, setSelection] = useState<{ track: Track; id: string }>({ track: 'video', id: segments[0]?.id ?? '' });
  const [trimPreview, setTrimPreview] = useState<TrimPreview | null>(null);
  const [reorderPreview, setReorderPreview] = useState<ReorderPreview | null>(null);
  const [markerPreview, setMarkerPreview] = useState<{ track: Track; index: number; edited: number; snapped: boolean } | null>(null);
  const [volume, setVolume] = useState(1);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const gesture = useRef<ClipGesture | null>(null), markerGesture = useRef<MarkerGesture | null>(null), scroll = useRef<HTMLDivElement>(null), volumePopover = useRef<HTMLDivElement>(null), volumeDirty = useRef(false), rulerDragging = useRef(false), lastRulerSeek = useRef<number | null>(null);
  const musicSegments = music?.segments ?? [], videoOffsets = offsetsOf(segments), musicOffsets = offsetsOf(musicSegments);
  let sourceCursor = 0;
  const sourceRanges = sourceDurations.map(length => { const start = sourceCursor; sourceCursor += length; return { start, end: sourceCursor }; });
  const editedDuration = durationOf(segments), musicDuration = durationOf(musicSegments);
  const mappedTimestamp = sourceToEdited(segments, timestamp), editedTimestamp = mappedTimestamp < .025 ? 0 : mappedTimestamp;
  const lanes = { video: segments, music: musicSegments }, offsets = { video: videoOffsets, music: musicOffsets };
  const displayLanes = {
    video: trimPreview?.mode === 'body' && trimPreview.track === 'video' ? segments.map(clip => clip.id === trimPreview.id ? { ...clip, [trimPreview.edge]: trimPreview.value } : clip) : segments,
    music: trimPreview?.mode === 'body' && trimPreview.track === 'music' ? musicSegments.map(clip => clip.id === trimPreview.id ? { ...clip, [trimPreview.edge]: trimPreview.value } : clip) : musicSegments,
  };
  const displayOffsets = { video: offsetsOf(displayLanes.video), music: offsetsOf(displayLanes.music) };
  const storedMarkersEdited = (track: Track) => markers[track].map(marker => sourceToEdited(lanes[track], marker));
  const visibleMarkersEdited = (track: Track) => markers[track].map((marker, index) => markerPreview?.track === track && markerPreview.index === index ? markerPreview.edited : sourceToEdited(displayLanes[track], marker));
  const videoMarkersEdited = storedMarkersEdited('video'), musicMarkersEdited = storedMarkersEdited('music');
  const clipEdges = (track: Track) => offsets[track].flatMap((offset, index) => [offset, offset + lanes[track][index].end - lanes[track][index].start]);
  const snapPoints = (excludeMarker?: Track) => unique([
    editedTimestamp,
    ...clipEdges('video'),
    ...clipEdges('music'),
    ...(excludeMarker === 'video' ? [] : videoMarkersEdited),
    ...(excludeMarker === 'music' ? [] : musicMarkersEdited),
  ]);
  const clips = lanes[selection.track], selected = clips.find(clip => clip.id === selection.id);
  const selectedIndex = clips.findIndex(clip => clip.id === selection.id), selectedOffset = offsets[selection.track][selectedIndex] ?? 0;
  const selectedTime = selected ? selected.start + editedTimestamp - selectedOffset : 0;
  const canCut = Boolean(selected && selectedTime > selected.start + MIN_CLIP && selectedTime < selected.end - MIN_CLIP);
  const tickEvery = pixelsPerSecond >= 160 ? .5 : pixelsPerSecond >= 80 ? 1 : pixelsPerSecond >= 40 ? 2 : pixelsPerSecond >= 20 ? 5 : 10;
  const timelineDuration = Math.max(durationOf(displayLanes.video), durationOf(displayLanes.music));
  const ticks = Array.from({ length: Math.floor(timelineDuration / tickEvery) + 1 }, (_, index) => index * tickEvery);
  useEffect(() => {
    if (!segments.some(s => selection.track === 'video' && s.id === selection.id) && !musicSegments.some(s => selection.track === 'music' && s.id === selection.id)) setSelection({ track: 'video', id: segments[0]?.id ?? '' });
  }, [segments, musicSegments, selection]);
  const selectedVolume = selection.track === 'video' ? segments[0]?.volume ?? 1 : selected?.volume ?? 1;
  useEffect(() => { volumeDirty.current = false; setVolume(selectedVolume); }, [selection, selectedVolume]);
  useEffect(() => {
    if (!volumeOpen) return;
    const close = (event: globalThis.PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!volumePopover.current?.contains(target) && !target.closest('.volume-action')) setVolumeOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [volumeOpen]);
  useEffect(() => {
    if (!playing || !scroll.current) return;
    const x = editedTimestamp * pixelsPerSecond, viewport = scroll.current;
    if (x < viewport.scrollLeft + 28) viewport.scrollLeft = Math.max(0, x - 80);
    else if (x > viewport.scrollLeft + viewport.clientWidth - 28) viewport.scrollLeft = x - viewport.clientWidth + 80;
  }, [playing, editedTimestamp, pixelsPerSecond]);
  const seekEdited = (value: number) => onSeek(editedToSource(segments, Math.max(0, Math.min(editedDuration, value))));
  const dragSeek = (element: HTMLElement, clientX: number) => {
    const viewport = scroll.current;
    let value: number;
    if (viewport && clientX <= viewport.getBoundingClientRect().left + 3) {
      viewport.scrollLeft = 0;
      value = 0;
    } else {
      value = Math.max(0, Math.min(editedDuration, (clientX - element.getBoundingClientRect().left) / pixelsPerSecond));
      const snapped = nearest(value, unique([...clipEdges('video'), ...clipEdges('music'), ...videoMarkersEdited, ...musicMarkersEdited]));
      if (snapped != null) value = snapped;
    }
    if (lastRulerSeek.current != null && Math.abs(lastRulerSeek.current - value) < .001) return;
    lastRulerSeek.current = value;
    seekEdited(value);
  };
  const select = (track: Track, clip: Segment) => { volumeDirty.current = false; setVolume(track === 'video' ? segments[0]?.volume ?? 1 : clip.volume); setSelection({ track, id: clip.id }); onSelectionChange(track, clip.id); };
  const nearest = (raw: number, candidates: number[]) => {
    const candidate = candidates.filter(Number.isFinite).sort((a, b) => Math.abs(a - raw) - Math.abs(b - raw))[0];
    return candidate != null && Math.abs(candidate - raw) * pixelsPerSecond <= SNAP_PIXELS ? candidate : null;
  };
  const beginClip = (event: PointerEvent<HTMLElement>, requestedMode: 'edge' | 'body', track: Track, clip: Segment, edge: 'start' | 'end', index: number, offset: number) => {
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); select(track, clip);
    const mode = requestedMode === 'body' ? (event.shiftKey ? 'body' : 'reorder') : 'edge';
    const range = track === 'video' ? sourceRanges.find(source => clip.start >= source.start - .001 && clip.end <= source.end + .001) : null;
    const base = trimBounds(lanes[track], index, track === 'video' ? duration : music?.duration ?? 0, MIN_CLIP)[edge];
    const bounds = range ? { min: Math.max(base.min, range.start), max: Math.min(base.max, range.end) } : base;
    gesture.current = { mode, track, id: clip.id, edge, pointer: event.pointerId, x: event.clientX, value: clip[edge], min: bounds.min, max: bounds.max, offset, clipStart: clip.start, index, moved: false };
  };
  const gestureValue = (event: PointerEvent<HTMLElement>, state: ClipGesture) => {
    const delta = (event.clientX - state.x) / pixelsPerSecond;
    let value = Math.max(state.min, Math.min(state.max, state.value + (state.mode === 'body' ? -delta : delta)));
    if (event.altKey) return { value, snapped: false };
    const candidates = snapPoints().map(target => state.clipStart + target - state.offset);
    if (state.mode === 'body') {
      const ownMarkers = markers[state.track].filter(marker => marker >= state.clipStart && marker <= (lanes[state.track].find(clip => clip.id === state.id)?.end ?? state.clipStart));
      for (const ownMarker of ownMarkers) {
        for (const target of snapPoints(state.track)) candidates.push(state.offset + ownMarker - target);
      }
    }
    const snapped = nearest(value, candidates.filter(candidate => candidate >= state.min && candidate <= state.max && Math.abs(candidate - state.value) > .0001));
    if (snapped != null) value = snapped;
    return { value, snapped: snapped != null };
  };
  const moveClip = (event: PointerEvent<HTMLElement>) => {
    const state = gesture.current; if (!state || state.pointer !== event.pointerId) return;
    if (Math.abs(event.clientX - state.x) < 2 && !state.moved) return;
    state.moved = true;
    if (state.mode === 'reorder') {
      const lane = lanes[state.track], clip = lane[state.index], remaining = lane.filter(segment => segment.id !== state.id);
      const center = state.offset + (clip.end - clip.start) / 2 + (event.clientX - state.x) / pixelsPerSecond;
      let cursor = 0, target = 0;
      for (const segment of remaining) {
        const length = segment.end - segment.start;
        if (center >= cursor + length / 2) target++;
        cursor += length;
      }
      const ghostOffset = remaining.slice(0, target).reduce((sum, segment) => sum + segment.end - segment.start, 0);
      setReorderPreview({ track: state.track, id: state.id, target, offset: ghostOffset, width: clip.end - clip.start });
      return;
    }
    setTrimPreview({ mode: state.mode, track: state.track, id: state.id, edge: state.edge, ...gestureValue(event, state) });
  };
  const finishClip = (event: PointerEvent<HTMLElement>) => {
    const state = gesture.current; if (!state || state.pointer !== event.pointerId) return;
    if (state.mode === 'reorder') {
      const preview = reorderPreview; gesture.current = null; setReorderPreview(null);
      if (!state.moved || !preview) return;
      const reordered = lanes[state.track].filter(segment => segment.id !== state.id);
      reordered.splice(preview.target, 0, lanes[state.track][state.index]);
      if (reordered.some((segment, index) => segment.id !== lanes[state.track][index]?.id)) onEdit(state.track, reordered);
      return;
    }
    const result = gestureValue(event, state); gesture.current = null; setTrimPreview(null);
    if (Math.abs(result.value - state.value) > .001) onEdit(state.track, lanes[state.track].map(clip => clip.id === state.id ? { ...clip, [state.edge]: result.value } : clip));
  };
  const cancelClip = () => { gesture.current = null; setTrimPreview(null); setReorderPreview(null); };
  const nudgeTrim = (event: KeyboardEvent<HTMLButtonElement>, track: Track, clip: Segment, edge: 'start' | 'end', index: number) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault(); event.stopPropagation(); select(track, clip);
    const range = track === 'video' ? sourceRanges.find(source => clip.start >= source.start - .001 && clip.end <= source.end + .001) : null;
    const base = trimBounds(lanes[track], index, track === 'video' ? duration : music?.duration ?? 0, MIN_CLIP)[edge];
    const bounds = range ? { min: Math.max(base.min, range.start), max: Math.min(base.max, range.end) } : base;
    const value = Math.max(bounds.min, Math.min(bounds.max, clip[edge] + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1 : .1)));
    if (Math.abs(value - clip[edge]) > .001) onEdit(track, lanes[track].map(segment => segment.id === clip.id ? { ...segment, [edge]: value } : segment));
  };
  const markerValue = (event: PointerEvent<HTMLButtonElement>, state: MarkerGesture) => {
    let value = Math.max(0, Math.min(durationOf(lanes[state.track]), state.value + (event.clientX - state.x) / pixelsPerSecond));
    if (event.altKey) return { value, snapped: false };
    const snapped = nearest(value, snapPoints(state.track).filter(target => Math.abs(target - state.value) > .0001));
    if (snapped != null) value = snapped;
    return { value, snapped: snapped != null };
  };
  const beginMarker = (event: PointerEvent<HTMLButtonElement>, track: Track, index: number, value: number) => {
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    markerGesture.current = { track, index, pointer: event.pointerId, x: event.clientX, value };
  };
  const moveMarker = (event: PointerEvent<HTMLButtonElement>) => {
    const state = markerGesture.current; if (!state || state.pointer !== event.pointerId) return;
    const result = markerValue(event, state);
    setMarkerPreview({ track: state.track, index: state.index, edited: result.value, snapped: result.snapped });
  };
  const finishMarker = (event: PointerEvent<HTMLButtonElement>) => {
    const state = markerGesture.current; if (!state || state.pointer !== event.pointerId) return;
    const { value } = markerValue(event, state); markerGesture.current = null; setMarkerPreview(null);
    const next = [...markers[state.track]];
    next[state.index] = editedToSource(lanes[state.track], value);
    onMarker(state.track, next);
  };
  const setMarkerAtCursor = (track: Track) => {
    if (!lanes[track].length) return;
    const edited = Math.min(durationOf(lanes[track]), editedTimestamp);
    const existing = storedMarkersEdited(track).findIndex(value => Math.abs(value - edited) * pixelsPerSecond <= SNAP_PIXELS);
    if (existing >= 0) onMarker(track, markers[track].filter((_, index) => index !== existing));
    else onMarker(track, [...markers[track], editedToSource(lanes[track], edited)].sort((a, b) => a - b));
  };
  const setGain = (gain: number) => { if (selected) onEdit(selection.track, clips.map(segment => selection.track === 'video' || segment.id === selected.id ? { ...segment, volume: gain } : segment)); };
  const commitVolume = () => { if (selected && volumeDirty.current) { volumeDirty.current = false; setGain(volume); } };
  const cut = (operation: 'start' | 'end' | 'split') => {
    if (!selected || !canCut) return;
    onEdit(selection.track, clips.flatMap(segment => segment.id !== selected.id ? [segment] : operation === 'split'
      ? [{ ...segment, end: selectedTime }, { ...segment, id: crypto.randomUUID(), start: selectedTime }]
      : [{ ...segment, [operation]: selectedTime }]));
  };
  const zoom = (next: number) => {
    const bounded = Math.max(12, Math.min(240, next));
    setPixelsPerSecond(Math.abs(bounded - 64) <= 4 ? 64 : bounded);
  };
  const wheelZoom = (event: WheelEvent<HTMLElement>) => {
    if (!event.ctrlKey || !scroll.current) return;
    event.preventDefault();
    const viewport = scroll.current, rect = viewport.getBoundingClientRect();
    const anchor = (viewport.scrollLeft + event.clientX - rect.left) / pixelsPerSecond;
    const next = Math.max(12, Math.min(240, pixelsPerSecond * (event.deltaY < 0 ? 1.14 : 1 / 1.14)));
    const snapped = Math.abs(next - 64) <= 5 ? 64 : next;
    setPixelsPerSecond(snapped);
    requestAnimationFrame(() => { viewport.scrollLeft = Math.max(0, anchor * snapped - (event.clientX - rect.left)); });
  };
  useEffect(() => {
    const keyboard = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input,textarea,select,[contenteditable]')) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'k') { event.preventDefault(); cut('split'); }
      else if (key === 'q') { event.preventDefault(); cut('start'); }
      else if (key === 'w') { event.preventDefault(); cut('end'); }
      else if ((event.key === 'Delete' || event.key === 'Backspace') && selected) { event.preventDefault(); onEdit(selection.track, clips.filter(segment => segment.id !== selected.id)); }
      else if (key === 'm' && selected) { event.preventDefault(); setMarkerAtCursor(selection.track); }
      else if (event.key === '-' || event.key === '_') { event.preventDefault(); zoom(pixelsPerSecond / 1.2); }
      else if (event.key === '=' || event.key === '+') { event.preventDefault(); zoom(pixelsPerSecond * 1.2); }
      else if (event.key === 'Home') { event.preventDefault(); seekEdited(0); }
      else if (event.key === 'End') { event.preventDefault(); seekEdited(editedDuration); }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  });
  const renderClips = (track: Track) => lanes[track].map((clip, index) => {
    const preview = trimPreview?.track === track && trimPreview.id === clip.id ? { ...clip, [trimPreview.edge]: trimPreview.value } : clip;
    const inset = trimPreview?.mode === 'edge' && trimPreview.track === track && trimPreview.id === clip.id && trimPreview.edge === 'start' ? trimPreview.value - clip.start : 0;
    const Icon = track === 'video' ? Film : Music2;
    const offset = trimPreview?.mode === 'body' ? displayOffsets[track][index] : offsets[track][index];
    return <div key={clip.id} className={`timeline-segment ${track === 'music' ? 'music-segment' : ''} ${selection.track === track && selection.id === clip.id ? 'selected' : ''} ${trimPreview?.track === track && trimPreview.id === clip.id ? 'trimming' : ''} ${reorderPreview?.id === clip.id ? 'reordering' : ''}`} style={{ left: `${(offset + inset) * pixelsPerSecond}px`, width: `${(preview.end - preview.start) * pixelsPerSecond}px` }} title="Drag to reorder · Shift-drag to trim the start · use edge handles to trim" onPointerDown={event => beginClip(event, 'body', track, clip, 'start', index, offset)} onPointerMove={moveClip} onPointerUp={finishClip} onPointerCancel={cancelClip}>
      <button className="trim-handle start" aria-label={`Trim or extend ${track} clip from left`} title="Snaps to cursor, markers, and clip edges; hold Alt for free trim" onKeyDown={event => nudgeTrim(event, track, clip, 'start', index)} onPointerDown={event => beginClip(event, 'edge', track, clip, 'start', index, offset)} onPointerMove={moveClip} onPointerUp={finishClip} onPointerCancel={cancelClip} />
      <span className="clip-fill"><Icon size={12} /><b>{track === 'music' ? music?.name : `Clip ${index + 1}`}</b><small>{time(preview.start)} – {time(preview.end)}</small>{clip.volume === 0 && <VolumeX size={11} />}</span>
      <button className="trim-handle end" aria-label={`Trim or extend ${track} clip from right`} title="Snaps to cursor, markers, and clip edges; hold Alt for free trim" onKeyDown={event => nudgeTrim(event, track, clip, 'end', index)} onPointerDown={event => beginClip(event, 'edge', track, clip, 'end', index, offset)} onPointerMove={moveClip} onPointerUp={finishClip} onPointerCancel={cancelClip} />
    </div>;
  });
  const renderMarkers = (track: Track) => visibleMarkersEdited(track).map((value, index) => <button key={`${track}-${index}`} className={`track-marker ${track} ${markerPreview?.track === track && markerPreview.index === index && markerPreview.snapped ? 'snapped' : ''}`} style={{ left: `${value * pixelsPerSecond}px` }} aria-label={`Drag ${track} marker`} title={`${track === 'video' ? 'Video' : 'Music'} marker · drag to move, Alt for no snapping`} onPointerDown={event => beginMarker(event, track, index, value)} onPointerMove={moveMarker} onPointerUp={finishMarker} onPointerCancel={() => { markerGesture.current = null; setMarkerPreview(null); }}><Diamond size={9} fill="currentColor" /></button>);
  const renderReorderGhost = (track: Track) => reorderPreview?.track === track ? <div className={`reorder-ghost ${track}`} style={{ left: `${reorderPreview.offset * pixelsPerSecond}px`, width: `${reorderPreview.width * pixelsPerSecond}px` }} /> : null;
  const addPosition = (track: Track) => durationOf(displayLanes[track]) * pixelsPerSecond + 9;
  return <section className="timeline" aria-label="Editor timeline" onWheel={wheelZoom}>
    <div className="transport">
      <button onClick={() => seekEdited(editedTimestamp - 5)} disabled={!duration} title="Back 5 seconds" aria-label="Back 5 seconds"><SkipBack size={15} /></button>
      <button onClick={onPlay} disabled={!duration || !playbackReady} title={playbackReady ? undefined : 'Preparing optimized preview…'} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
      <button onClick={() => seekEdited(editedTimestamp + 5)} disabled={!duration} title="Forward 5 seconds" aria-label="Forward 5 seconds"><SkipForward size={15} /></button>
      <span className="timecode">{time(editedTimestamp)} <i>/</i> {time(editedDuration)}</span><span className="timeline-divider" />
      <button className="editor-tool" onClick={() => cut('start')} disabled={!canCut} title="Trim start to playhead (Q)" aria-label="Trim selected clip start to playhead"><TrimStartIcon /></button>
      <button className="editor-tool" onClick={() => cut('split')} disabled={!canCut} title="Split at playhead (Ctrl+K)" aria-label="Split selected clip at playhead"><SplitIcon /></button>
      <button className="editor-tool" onClick={() => cut('end')} disabled={!canCut} title="Trim end to playhead (W)" aria-label="Trim selected clip end to playhead"><TrimEndIcon /></button>
      <button className="editor-tool" onClick={() => selected && onEdit(selection.track, clips.filter(segment => segment.id !== selected.id))} disabled={!selected} title="Ripple delete selected clip (Delete)" aria-label="Ripple delete selected clip"><RippleDeleteIcon /></button>
      <button className={`editor-tool marker-action ${selected && storedMarkersEdited(selection.track).some(value => Math.abs(value - editedTimestamp) * pixelsPerSecond <= SNAP_PIXELS) ? 'active' : ''}`} disabled={!selected} onClick={() => setMarkerAtCursor(selection.track)} title={selected ? `Add or remove a ${selection.track} marker at the playhead` : 'Select a clip to add a marker'} aria-label={selected ? `Toggle ${selection.track} marker at playhead` : 'Toggle marker'}><MarkerIcon /></button>
      <span className="timeline-divider" /><button onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo2 size={15} /></button><button onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Redo2 size={15} /></button><span className="transport-spacer" />
      <button onClick={() => zoom(pixelsPerSecond / 1.35)} disabled={pixelsPerSecond <= 12} aria-label="Zoom timeline out"><ZoomOut size={15} /></button><span className="timeline-zoom-wrap"><input className="timeline-zoom" aria-label="Timeline zoom" type="range" min="12" max="240" step="4" value={pixelsPerSecond} onChange={event => zoom(Number(event.target.value))} /><i /></span><button onClick={() => zoom(pixelsPerSecond * 1.35)} disabled={pixelsPerSecond >= 240} aria-label="Zoom timeline in"><ZoomIn size={15} /></button>
      <button className={volumeOpen ? 'active volume-action' : 'volume-action'} disabled={!selected} onClick={() => setVolumeOpen(value => !value)} title="Selected clip volume" aria-label="Show selected clip volume">{volume > 0 ? <Volume2 size={14} /> : <VolumeX size={14} />}</button>
    </div>
    {volumeOpen && selected && <div className="volume-popover" ref={volumePopover}>
      <button onClick={() => { const next = volume > 0 ? 0 : 1; volumeDirty.current = false; setVolume(next); setGain(next); }} aria-label={volume > 0 ? 'Mute selected clip' : 'Unmute selected clip'}>{volume > 0 ? <Volume2 size={14} /> : <VolumeX size={14} />}</button>
      <div className="volume-range"><input aria-label="Volume" type="range" min="0" max="2" step=".01" value={volume} style={{ '--range-fill': `${volume / 2 * 100}%` } as React.CSSProperties} onChange={event => { const raw = Number(event.target.value); volumeDirty.current = true; setVolume(Math.abs(raw - 1) <= .06 ? 1 : raw); }} onPointerUp={commitVolume} onKeyUp={commitVolume} onBlur={commitVolume} /><i /></div>
      <label className="volume-value"><input aria-label="Volume percent" type="number" min="0" max="200" step="1" value={Math.round(volume * 100)} onChange={event => { const raw = Math.max(0, Math.min(200, event.target.valueAsNumber || 0)) / 100; volumeDirty.current = true; setVolume(Math.abs(raw - 1) <= .02 ? 1 : raw); }} onKeyDown={event => { if (event.key === 'Enter') { commitVolume(); event.currentTarget.blur(); } }} onBlur={commitVolume} /><span>%</span></label>
    </div>}
    <div className="timeline-editor">
      <div className="track-labels" aria-hidden="true"><div className="ruler-corner" /><div className="track-label"><Film size={14} /></div><div className="track-label music"><Music2 size={14} /></div></div>
      <div className="timeline-scroll" ref={scroll}><div className="timeline-content" style={{ width: `${Math.max(1, timelineDuration * pixelsPerSecond + 64)}px` }}>
        <div className="time-ruler" onPointerDown={event => { rulerDragging.current = true; lastRulerSeek.current = null; event.currentTarget.setPointerCapture(event.pointerId); dragSeek(event.currentTarget, event.clientX); }} onPointerMove={event => { if (rulerDragging.current && event.currentTarget.hasPointerCapture(event.pointerId)) dragSeek(event.currentTarget, event.clientX); }} onPointerUp={event => { dragSeek(event.currentTarget, event.clientX); rulerDragging.current = false; lastRulerSeek.current = null; }} onPointerCancel={() => { rulerDragging.current = false; lastRulerSeek.current = null; }} onLostPointerCapture={() => { rulerDragging.current = false; lastRulerSeek.current = null; }}>{ticks.map(value => <span key={value} className={Number.isInteger(value) ? '' : 'minor'} style={{ left: `${value * pixelsPerSecond}px` }}><i />{Number.isInteger(value) && <small>{time(value)}</small>}</span>)}</div>
        <div className="video-track">{renderClips('video')}{renderReorderGhost('video')}{renderMarkers('video')}<button className="track-add" style={{ left: `${addPosition('video')}px` }} title="Append video" aria-label="Append video" onPointerDown={event => event.stopPropagation()} onClick={onImportVideo}><Plus size={16} /></button></div>
        <div className="music-track">{renderClips('music')}{renderReorderGhost('music')}{renderMarkers('music')}<button className="track-add music" style={{ left: `${addPosition('music')}px` }} title={musicSegments.length ? 'Replace music' : 'Add music'} aria-label={musicSegments.length ? 'Replace music' : 'Add music'} onPointerDown={event => event.stopPropagation()} onClick={onImportMusic}><Plus size={16} /></button></div>
        <i className={`playhead ${trimPreview?.snapped || markerPreview?.snapped ? 'snapped' : ''}`} style={{ left: `${editedTimestamp * pixelsPerSecond}px` }}><span /></i>
      </div></div>
    </div>
  </section>;
}
