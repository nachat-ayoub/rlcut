import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Diamond, DiamondPlus, Film, Music2, PanelLeftClose, PanelRightClose, Pause, Play, Redo2, Scissors, SkipBack, SkipForward, Trash2, Undo2, Volume2, VolumeX, ZoomIn, ZoomOut } from 'lucide-react';
import type { MusicTrack, Segment, TrackMarkers } from '../types';
import { time } from '../lib/presets';
import { editedDuration as durationOf, sourceToEdited, editedToSource, trimBounds } from '../lib/timeline';

type Track = 'video' | 'music';
type ClipGesture = {
  mode: 'edge' | 'body'; track: Track; id: string; edge: 'start' | 'end'; pointer: number;
  x: number; value: number; min: number; max: number; offset: number; clipStart: number;
  moved: boolean;
};
type MarkerGesture = { track: Track; pointer: number; x: number; value: number };
type TrimPreview = { mode: 'edge' | 'body'; track: Track; id: string; edge: 'start' | 'end'; value: number; snapped: boolean };
const MIN_CLIP = .05;
const SNAP_PIXELS = 9;
const offsetsOf = (clips: Segment[]) => { let cursor = 0; return clips.map(clip => { const offset = cursor; cursor += clip.end - clip.start; return offset; }); };
const unique = (values: number[]) => values.filter((value, index) => values.findIndex(other => Math.abs(other - value) < .0001) === index);

export function Timeline({ duration, sourceDurations, timestamp, segments, music, markers, playing, playbackReady, canUndo, canRedo, onSeek, onPlay, onEdit, onMarker, onUndo, onRedo, onImportMusic }: {
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
  onMarker: (track: Track, value: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onImportMusic: () => void;
}) {
  const [pixelsPerSecond, setPixelsPerSecond] = useState(64);
  const [selection, setSelection] = useState<{ track: Track; id: string }>({ track: 'video', id: segments[0]?.id ?? '' });
  const [trimPreview, setTrimPreview] = useState<TrimPreview | null>(null);
  const [markerPreview, setMarkerPreview] = useState<{ track: Track; edited: number; snapped: boolean } | null>(null);
  const [volume, setVolume] = useState(1);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const gesture = useRef<ClipGesture | null>(null), markerGesture = useRef<MarkerGesture | null>(null), scroll = useRef<HTMLDivElement>(null), volumeDirty = useRef(false), rulerDragging = useRef(false), lastRulerSeek = useRef<number | null>(null);
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
  const storedMarkerEdited = (track: Track) => {
    const marker = markers[track];
    return marker == null ? null : sourceToEdited(lanes[track], marker);
  };
  const visibleMarkerEdited = (track: Track) => {
    if (markerPreview?.track === track) return markerPreview.edited;
    const marker = markers[track];
    return marker == null ? null : sourceToEdited(displayLanes[track], marker);
  };
  const videoMarkerEdited = storedMarkerEdited('video'), musicMarkerEdited = storedMarkerEdited('music');
  const clipEdges = (track: Track) => offsets[track].flatMap((offset, index) => [offset, offset + lanes[track][index].end - lanes[track][index].start]);
  const snapPoints = (excludeMarker?: Track) => unique([
    editedTimestamp,
    ...clipEdges('video'),
    ...clipEdges('music'),
    ...(excludeMarker === 'video' || videoMarkerEdited == null ? [] : [videoMarkerEdited]),
    ...(excludeMarker === 'music' || musicMarkerEdited == null ? [] : [musicMarkerEdited]),
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
  useEffect(() => { volumeDirty.current = false; setVolume(selected?.volume ?? 1); }, [selection, selected?.volume]);
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
    }
    if (lastRulerSeek.current != null && Math.abs(lastRulerSeek.current - value) < .001) return;
    lastRulerSeek.current = value;
    seekEdited(value);
  };
  const select = (track: Track, clip: Segment) => { volumeDirty.current = false; setVolume(clip.volume); setSelection({ track, id: clip.id }); };
  const nearest = (raw: number, candidates: number[]) => {
    const candidate = candidates.filter(Number.isFinite).sort((a, b) => Math.abs(a - raw) - Math.abs(b - raw))[0];
    return candidate != null && Math.abs(candidate - raw) * pixelsPerSecond <= SNAP_PIXELS ? candidate : null;
  };
  const beginClip = (event: PointerEvent<HTMLElement>, mode: 'edge' | 'body', track: Track, clip: Segment, edge: 'start' | 'end', index: number, offset: number) => {
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); select(track, clip);
    const range = track === 'video' ? sourceRanges.find(source => clip.start >= source.start - .001 && clip.end <= source.end + .001) : null;
    const base = trimBounds(lanes[track], index, track === 'video' ? duration : music?.duration ?? 0, MIN_CLIP)[edge];
    const bounds = range ? { min: Math.max(base.min, range.start), max: Math.min(base.max, range.end) } : base;
    gesture.current = { mode, track, id: clip.id, edge, pointer: event.pointerId, x: event.clientX, value: clip[edge], min: bounds.min, max: bounds.max, offset, clipStart: clip.start, moved: false };
  };
  const gestureValue = (event: PointerEvent<HTMLElement>, state: ClipGesture) => {
    const delta = (event.clientX - state.x) / pixelsPerSecond;
    let value = Math.max(state.min, Math.min(state.max, state.value + (state.mode === 'body' ? -delta : delta)));
    if (event.altKey) return { value, snapped: false };
    const candidates = snapPoints().map(target => state.clipStart + target - state.offset);
    if (state.mode === 'body') {
      const ownMarker = markers[state.track];
      if (ownMarker != null && ownMarker >= state.clipStart && ownMarker <= (lanes[state.track].find(clip => clip.id === state.id)?.end ?? state.clipStart)) {
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
    setTrimPreview({ mode: state.mode, track: state.track, id: state.id, edge: state.edge, ...gestureValue(event, state) });
  };
  const finishClip = (event: PointerEvent<HTMLElement>) => {
    const state = gesture.current; if (!state || state.pointer !== event.pointerId) return;
    const result = gestureValue(event, state); gesture.current = null; setTrimPreview(null);
    if (state.mode === 'body' && !state.moved) return;
    if (Math.abs(result.value - state.value) > .001) onEdit(state.track, lanes[state.track].map(clip => clip.id === state.id ? { ...clip, [state.edge]: result.value } : clip));
  };
  const cancelClip = () => { gesture.current = null; setTrimPreview(null); };
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
  const beginMarker = (event: PointerEvent<HTMLButtonElement>, track: Track, value: number) => {
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    markerGesture.current = { track, pointer: event.pointerId, x: event.clientX, value };
  };
  const moveMarker = (event: PointerEvent<HTMLButtonElement>) => {
    const state = markerGesture.current; if (!state || state.pointer !== event.pointerId) return;
    const result = markerValue(event, state);
    setMarkerPreview({ track: state.track, edited: result.value, snapped: result.snapped });
  };
  const finishMarker = (event: PointerEvent<HTMLButtonElement>) => {
    const state = markerGesture.current; if (!state || state.pointer !== event.pointerId) return;
    const { value } = markerValue(event, state); markerGesture.current = null; setMarkerPreview(null);
    onMarker(state.track, editedToSource(lanes[state.track], value));
  };
  const setMarkerAtCursor = (track: Track) => {
    if (!lanes[track].length) return;
    onMarker(track, track === 'video' ? timestamp : editedToSource(musicSegments, Math.min(musicDuration, editedTimestamp)));
  };
  const setGain = (gain: number) => { if (selected) onEdit(selection.track, clips.map(segment => segment.id === selected.id ? { ...segment, volume: gain } : segment)); };
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
  const renderClips = (track: Track) => lanes[track].map((clip, index) => {
    const preview = trimPreview?.track === track && trimPreview.id === clip.id ? { ...clip, [trimPreview.edge]: trimPreview.value } : clip;
    const inset = trimPreview?.mode === 'edge' && trimPreview.track === track && trimPreview.id === clip.id && trimPreview.edge === 'start' ? trimPreview.value - clip.start : 0;
    const Icon = track === 'video' ? Film : Music2;
    const offset = trimPreview?.mode === 'body' ? displayOffsets[track][index] : offsets[track][index];
    return <div key={clip.id} className={`timeline-segment ${track === 'music' ? 'music-segment' : ''} ${selection.track === track && selection.id === clip.id ? 'selected' : ''} ${trimPreview?.track === track && trimPreview.id === clip.id ? 'trimming' : ''}`} style={{ left: `${(offset + inset) * pixelsPerSecond}px`, width: `${(preview.end - preview.start) * pixelsPerSecond}px` }} title="Drag clip body left to shorten from its start; drag right to restore" onPointerDown={event => beginClip(event, 'body', track, clip, 'start', index, offset)} onPointerMove={moveClip} onPointerUp={finishClip} onPointerCancel={cancelClip}>
      <button className="trim-handle start" aria-label={`Trim or extend ${track} clip from left`} title="Snaps to cursor, markers, and clip edges; hold Alt for free trim" onKeyDown={event => nudgeTrim(event, track, clip, 'start', index)} onPointerDown={event => beginClip(event, 'edge', track, clip, 'start', index, offset)} onPointerMove={moveClip} onPointerUp={finishClip} onPointerCancel={cancelClip} />
      <span className="clip-fill"><Icon size={12} /><b>{track === 'music' ? music?.name : `Clip ${index + 1}`}</b><small>{time(preview.start)} – {time(preview.end)}</small>{clip.volume === 0 && <VolumeX size={11} />}</span>
      <button className="trim-handle end" aria-label={`Trim or extend ${track} clip from right`} title="Snaps to cursor, markers, and clip edges; hold Alt for free trim" onKeyDown={event => nudgeTrim(event, track, clip, 'end', index)} onPointerDown={event => beginClip(event, 'edge', track, clip, 'end', index, offset)} onPointerMove={moveClip} onPointerUp={finishClip} onPointerCancel={cancelClip} />
    </div>;
  });
  const renderMarker = (track: Track) => {
    const value = visibleMarkerEdited(track); if (value == null) return null;
    return <button className={`track-marker ${track} ${markerPreview?.track === track && markerPreview.snapped ? 'snapped' : ''}`} style={{ left: `${value * pixelsPerSecond}px` }} aria-label={`Drag ${track} peak marker`} title={`${track === 'video' ? 'Video' : 'Music'} peak · drag to move, Alt for no snapping`} onPointerDown={event => beginMarker(event, track, value)} onPointerMove={moveMarker} onPointerUp={finishMarker} onPointerCancel={() => { markerGesture.current = null; setMarkerPreview(null); }}><Diamond size={9} fill="currentColor" /></button>;
  };
  return <section className="timeline" aria-label="Editor timeline">
    <div className="transport">
      <button onClick={onPlay} disabled={!duration || !playbackReady} title={playbackReady ? undefined : 'Preparing optimized preview…'} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
      <button onClick={() => seekEdited(editedTimestamp - 5)} disabled={!duration} title="Back 5 seconds" aria-label="Back 5 seconds"><SkipBack size={15} /></button><button onClick={() => seekEdited(editedTimestamp + 5)} disabled={!duration} title="Forward 5 seconds" aria-label="Forward 5 seconds"><SkipForward size={15} /></button>
      <span className="timecode">{time(editedTimestamp)} <i>/</i> {time(editedDuration)}</span><span className="timeline-divider" />
      <button onClick={() => cut('start')} disabled={!canCut} title="Trim selected clip start to playhead" aria-label="Trim selected clip start to playhead"><PanelLeftClose size={15} /></button>
      <button onClick={() => cut('split')} disabled={!canCut} title="Split selected clip at playhead" aria-label="Split selected clip at playhead"><Scissors size={15} /></button>
      <button onClick={() => cut('end')} disabled={!canCut} title="Trim selected clip end to playhead" aria-label="Trim selected clip end to playhead"><PanelRightClose size={15} /></button>
      <button className="danger" onClick={() => selected && onEdit(selection.track, clips.filter(segment => segment.id !== selected.id))} disabled={!selected || (selection.track === 'video' && clips.length === 1)} title="Ripple delete selected clip" aria-label="Ripple delete selected clip"><Trash2 size={15} /></button>
      <button className={selected && markers[selection.track] != null ? 'active marker-action' : 'marker-action'} disabled={!selected} onClick={() => setMarkerAtCursor(selection.track)} title={selected ? `Set ${selection.track} peak at the playhead` : 'Select a clip to set its peak'} aria-label={selected ? `Set ${selection.track} peak marker at playhead` : 'Set peak marker'}><DiamondPlus size={15} /></button>
      <span className="timeline-divider" /><button onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo2 size={15} /></button><button onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Redo2 size={15} /></button><span className="transport-spacer" />
      <button onClick={() => zoom(pixelsPerSecond / 1.35)} disabled={pixelsPerSecond <= 12} aria-label="Zoom timeline out"><ZoomOut size={15} /></button><input className="timeline-zoom" aria-label="Timeline zoom" type="range" min="12" max="240" step="4" value={pixelsPerSecond} onChange={event => zoom(Number(event.target.value))} /><button onClick={() => zoom(pixelsPerSecond * 1.35)} disabled={pixelsPerSecond >= 240} aria-label="Zoom timeline in"><ZoomIn size={15} /></button>
      <button onClick={onImportMusic} title={musicSegments.length ? 'Replace music' : 'Choose music'} aria-label={musicSegments.length ? 'Replace music' : 'Choose music'}><Music2 size={14} /></button>
      <button className={volumeOpen ? 'active volume-action' : 'volume-action'} disabled={!selected} onClick={() => setVolumeOpen(value => !value)} title="Selected clip volume" aria-label="Show selected clip volume">{volume > 0 ? <Volume2 size={14} /> : <VolumeX size={14} />}</button>
    </div>
    {volumeOpen && selected && <div className="volume-popover">
      <button onClick={() => { const next = volume > 0 ? 0 : 1; volumeDirty.current = false; setVolume(next); setGain(next); }} aria-label={volume > 0 ? 'Mute selected clip' : 'Unmute selected clip'}>{volume > 0 ? <Volume2 size={14} /> : <VolumeX size={14} />}</button>
      <input aria-label="Selected clip volume" type="range" min="0" max="2" step=".01" value={volume} onChange={event => { const raw = Number(event.target.value); volumeDirty.current = true; setVolume(Math.abs(raw - 1) <= .04 ? 1 : raw); }} onPointerUp={commitVolume} onKeyUp={commitVolume} onBlur={commitVolume} /><strong>{Math.round(volume * 100)}%</strong>
    </div>}
    <div className="timeline-editor">
      <div className="track-labels" aria-hidden="true"><div className="ruler-corner" /><div className="track-label"><Film size={14} /></div><div className="track-label music"><Music2 size={14} /></div></div>
      <div className="timeline-scroll" ref={scroll}><div className="timeline-content" style={{ width: `${Math.max(1, timelineDuration * pixelsPerSecond)}px` }}>
        <div className="time-ruler" onPointerDown={event => { rulerDragging.current = true; lastRulerSeek.current = null; event.currentTarget.setPointerCapture(event.pointerId); dragSeek(event.currentTarget, event.clientX); }} onPointerMove={event => { if (rulerDragging.current && event.currentTarget.hasPointerCapture(event.pointerId)) dragSeek(event.currentTarget, event.clientX); }} onPointerUp={event => { dragSeek(event.currentTarget, event.clientX); rulerDragging.current = false; lastRulerSeek.current = null; }} onPointerCancel={() => { rulerDragging.current = false; lastRulerSeek.current = null; }} onLostPointerCapture={() => { rulerDragging.current = false; lastRulerSeek.current = null; }}>{ticks.map(value => <span key={value} className={Number.isInteger(value) ? '' : 'minor'} style={{ left: `${value * pixelsPerSecond}px` }}><i />{Number.isInteger(value) && <small>{time(value)}</small>}</span>)}</div>
        <div className="video-track">{renderClips('video')}{renderMarker('video')}</div>
        <div className="music-track">{musicSegments.length ? <>{renderClips('music')}{renderMarker('music')}</> : <button className="music-import" title="Choose music" aria-label="Choose music" onPointerDown={event => event.stopPropagation()} onClick={onImportMusic}><Music2 size={13} /></button>}</div>
        <i className={`playhead ${trimPreview?.snapped || markerPreview?.snapped ? 'snapped' : ''}`} style={{ left: `${editedTimestamp * pixelsPerSecond}px` }}><span /></i>
      </div></div>
    </div>
  </section>;
}
