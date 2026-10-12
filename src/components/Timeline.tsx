import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Film, Music2, Pause, Play, Redo2, Scissors, SkipBack, SkipForward, Trash2, Undo2, Volume2, VolumeX, ZoomIn, ZoomOut } from 'lucide-react';
import type { MusicTrack, Segment } from '../types';
import { time } from '../lib/presets';
import { editedDuration as durationOf, sourceToEdited, editedToSource, trimBounds } from '../lib/timeline';

type Track = 'video' | 'music';
type Trim = { track: Track; id: string; edge: 'start' | 'end'; pointer: number; x: number; value: number; min: number; max: number; snap: number };
const MIN_CLIP = .05;
const offsetsOf = (clips: Segment[]) => { let cursor = 0; return clips.map(clip => { const offset = cursor; cursor += clip.end - clip.start; return offset; }); };

export function Timeline({ duration, timestamp, segments, music, playing, playbackReady, canUndo, canRedo, onSeek, onPlay, onEdit, onUndo, onRedo, onImportMusic }: {
  duration: number;
  timestamp: number;
  segments: Segment[];
  music: MusicTrack | null;
  playing: boolean;
  playbackReady: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onSeek: (value: number) => void;
  onPlay: () => void;
  onEdit: (track: Track, segments: Segment[]) => void;
  onUndo: () => void;
  onRedo: () => void;
  onImportMusic: () => void;
}) {
  const [pixelsPerSecond, setPixelsPerSecond] = useState(64);
  const [selection, setSelection] = useState<{ track: Track; id: string }>({ track: 'video', id: segments[0]?.id ?? '' });
  const [trimPreview, setTrimPreview] = useState<{ id: string; edge: 'start' | 'end'; value: number; snapped: boolean } | null>(null);
  const [volume, setVolume] = useState(1);
  const trim = useRef<Trim | null>(null), scroll = useRef<HTMLDivElement>(null), volumeDirty = useRef(false);
  const editedDuration = durationOf(segments), editedTimestamp = sourceToEdited(segments, timestamp);
  const clips = selection.track === 'video' ? segments : music?.segments ?? [];
  const selected = clips.find(clip => clip.id === selection.id);
  const selectedIndex = clips.findIndex(clip => clip.id === selection.id);
  const selectedOffset = offsetsOf(clips)[selectedIndex] ?? 0;
  const selectedTime = selected ? selected.start + editedTimestamp - selectedOffset : 0;
  const canCut = Boolean(selected && selectedTime > selected.start + MIN_CLIP && selectedTime < selected.end - MIN_CLIP);
  const tickEvery = pixelsPerSecond >= 160 ? .5 : pixelsPerSecond >= 80 ? 1 : pixelsPerSecond >= 40 ? 2 : pixelsPerSecond >= 20 ? 5 : 10;
  const timelineDuration = Math.max(editedDuration, durationOf(music?.segments ?? []));
  const ticks = Array.from({ length: Math.floor(timelineDuration / tickEvery) + 1 }, (_, index) => index * tickEvery);
  useEffect(() => {
    if (!segments.some(s => s.id === selection.id) && !music?.segments.some(s => s.id === selection.id)) {
      setSelection({ track: 'video', id: segments[0]?.id ?? '' });
    }
  }, [segments, music, selection.id]);
  useEffect(() => { volumeDirty.current = false; setVolume(selected?.volume ?? 1); }, [selected?.id, selected?.volume]);
  useEffect(() => {
    if (!playing || !scroll.current) return;
    const x = editedTimestamp * pixelsPerSecond, viewport = scroll.current;
    if (x < viewport.scrollLeft + 28) viewport.scrollLeft = Math.max(0, x - 80);
    else if (x > viewport.scrollLeft + viewport.clientWidth - 28) viewport.scrollLeft = x - viewport.clientWidth + 80;
  }, [playing, editedTimestamp, pixelsPerSecond]);
  const seekEdited = (value: number) => onSeek(editedToSource(segments, value));
  const seek = (element: HTMLElement, clientX: number) => seekEdited(Math.max(0, Math.min(editedDuration, (clientX - element.getBoundingClientRect().left) / pixelsPerSecond)));
  const select = (track: Track, clip: Segment) => { volumeDirty.current = false; setVolume(clip.volume); setSelection({ track, id: clip.id }); };
  const choose = (event: PointerEvent<HTMLDivElement>, track: Track, clip: Segment, offset: number) => {
    event.stopPropagation(); select(track, clip);
    const rect = event.currentTarget.getBoundingClientRect();
    seekEdited(offset + Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * (clip.end - clip.start));
  };
  const beginTrim = (event: PointerEvent<HTMLButtonElement>, track: Track, clip: Segment, edge: 'start' | 'end', index: number, offset: number) => {
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); select(track, clip);
    const lane = track === 'video' ? segments : music?.segments ?? [];
    const bounds = trimBounds(lane, index, track === 'video' ? duration : music?.duration ?? 0, MIN_CLIP)[edge];
    trim.current = { track, id: clip.id, edge, pointer: event.pointerId, x: event.clientX, value: clip[edge], min: bounds.min, max: bounds.max, snap: clip.start + editedTimestamp - offset };
  };
  const trimValue = (event: PointerEvent<HTMLButtonElement>, state: Trim) => {
    let value = Math.max(state.min, Math.min(state.max, state.value + (event.clientX - state.x) / pixelsPerSecond));
    const snapped = !event.altKey && state.snap >= state.min && state.snap <= state.max && Math.abs(value - state.snap) * pixelsPerSecond <= 8;
    if (snapped) value = state.snap;
    return { value, snapped };
  };
  const moveTrim = (event: PointerEvent<HTMLButtonElement>) => {
    const state = trim.current; if (!state || state.pointer !== event.pointerId) return;
    setTrimPreview({ id: state.id, edge: state.edge, ...trimValue(event, state) });
  };
  const finishTrim = (event: PointerEvent<HTMLButtonElement>) => {
    const state = trim.current; if (!state || state.pointer !== event.pointerId) return;
    const { value } = trimValue(event, state);
    trim.current = null; setTrimPreview(null);
    const lane = state.track === 'video' ? segments : music?.segments ?? [];
    if (Math.abs(value - state.value) > .001) onEdit(state.track, lane.map(clip => clip.id === state.id ? { ...clip, [state.edge]: value } : clip));
  };
  const cancelTrim = () => { trim.current = null; setTrimPreview(null); };
  const nudgeTrim = (event: KeyboardEvent<HTMLButtonElement>, track: Track, clip: Segment, edge: 'start' | 'end', index: number) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault(); event.stopPropagation(); select(track, clip);
    const lane = track === 'video' ? segments : music?.segments ?? [];
    const bounds = trimBounds(lane, index, track === 'video' ? duration : music?.duration ?? 0, MIN_CLIP)[edge];
    const value = Math.max(bounds.min, Math.min(bounds.max, clip[edge] + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1 : .1)));
    if (Math.abs(value - clip[edge]) > .001) onEdit(track, lane.map(s => s.id === clip.id ? { ...s, [edge]: value } : s));
  };
  const setGain = (gain: number) => { if (selected) onEdit(selection.track, clips.map(s => s.id === selected.id ? { ...s, volume: gain } : s)); };
  const commitVolume = () => { if (selected && volumeDirty.current) { volumeDirty.current = false; setGain(volume); } };
  const cut = (operation: 'start' | 'end' | 'split') => {
    if (!selected || !canCut) return;
    onEdit(selection.track, clips.flatMap(s => s.id !== selected.id ? [s] : operation === 'split'
      ? [{ ...s, end: selectedTime }, { ...s, id: crypto.randomUUID(), start: selectedTime }]
      : [{ ...s, [operation]: selectedTime }]));
  };
  const zoom = (next: number) => setPixelsPerSecond(Math.max(12, Math.min(240, next)));
  const renderClips = (track: Track, lane: Segment[]) => {
    const offsets = offsetsOf(lane);
    return lane.map((clip, index) => {
      const preview = trimPreview?.id === clip.id ? { ...clip, [trimPreview.edge]: trimPreview.value } : clip;
      const inset = trimPreview?.id === clip.id && trimPreview.edge === 'start' ? trimPreview.value - clip.start : 0;
      const Icon = track === 'video' ? Film : Music2;
      return <div key={clip.id} className={`timeline-segment ${track === 'music' ? 'music-segment' : ''} ${selection.id === clip.id ? 'selected' : ''} ${trimPreview?.id === clip.id ? 'trimming' : ''}`} style={{ left: `${(offsets[index] + inset) * pixelsPerSecond}px`, width: `${(preview.end - preview.start) * pixelsPerSecond}px` }} onPointerDown={event => choose(event, track, clip, offsets[index])}>
        <button className="trim-handle start" aria-label={`Trim or extend ${track} clip from left`} title="Snap to playhead; hold Alt to trim freely" onKeyDown={event => nudgeTrim(event, track, clip, 'start', index)} onPointerDown={event => beginTrim(event, track, clip, 'start', index, offsets[index])} onPointerMove={moveTrim} onPointerUp={finishTrim} onPointerCancel={cancelTrim} />
        <span className="clip-fill"><Icon size={12} /><b>{track === 'music' ? music?.name : `Clip ${index + 1}`}</b><small>{time(preview.start)} – {time(preview.end)}</small>{clip.volume === 0 && <VolumeX size={11} />}</span>
        <button className="trim-handle end" aria-label={`Trim or extend ${track} clip from right`} title="Snap to playhead; hold Alt to trim freely" onKeyDown={event => nudgeTrim(event, track, clip, 'end', index)} onPointerDown={event => beginTrim(event, track, clip, 'end', index, offsets[index])} onPointerMove={moveTrim} onPointerUp={finishTrim} onPointerCancel={cancelTrim} />
      </div>;
    });
  };
  return <section className="timeline" aria-label="Editor timeline">
    <div className="transport">
      <button onClick={onPlay} disabled={!duration || !playbackReady} title={playbackReady ? undefined : 'Preparing optimized preview…'} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
      <button onClick={() => seekEdited(Math.max(0, editedTimestamp - 5))} disabled={!duration} aria-label="Back 5 seconds"><SkipBack size={15} /><small>5s</small></button>
      <button onClick={() => seekEdited(Math.min(editedDuration, editedTimestamp + 5))} disabled={!duration} aria-label="Forward 5 seconds"><small>5s</small><SkipForward size={15} /></button>
      <span className="timecode">{time(editedTimestamp)} <i>/</i> {time(editedDuration)}</span>
      <span className="transport-spacer" />
      <button onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)"><Undo2 size={15} /></button>
      <button onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)"><Redo2 size={15} /></button>
      <span className="timeline-divider" />
      <button onClick={() => zoom(pixelsPerSecond / 1.35)} disabled={pixelsPerSecond <= 12} aria-label="Zoom timeline out"><ZoomOut size={15} /></button>
      <input className="timeline-zoom" aria-label="Timeline zoom" type="range" min="12" max="240" step="4" value={pixelsPerSecond} onChange={event => zoom(Number(event.target.value))} />
      <button onClick={() => zoom(pixelsPerSecond * 1.35)} disabled={pixelsPerSecond >= 240} aria-label="Zoom timeline in"><ZoomIn size={15} /></button>
    </div>
    <div className="timeline-mixer">
      <span>{selected ? `Selected ${selection.track} clip · ${time(selected.end - selected.start)}` : 'Select a clip'}</span>
      <button disabled={!selected} onClick={() => { const next = volume > 0 ? 0 : 1; volumeDirty.current = false; setVolume(next); setGain(next); }} aria-label={volume > 0 ? 'Mute selected clip' : 'Unmute selected clip'}>{volume > 0 ? <Volume2 size={14} /> : <VolumeX size={14} />}</button>
      <input aria-label="Selected clip volume" disabled={!selected} type="range" min="0" max="2" step=".01" value={volume} onChange={event => { volumeDirty.current = true; setVolume(Number(event.target.value)); }} onPointerUp={commitVolume} onKeyUp={commitVolume} onBlur={commitVolume} />
      <strong>{Math.round(volume * 100)}%</strong>
      <button onClick={onImportMusic}><Music2 size={14} />{music?.segments.length ? 'Replace music' : 'Choose music'}</button>
    </div>
    <div className="timeline-editor">
      <div className="track-labels" aria-hidden="true"><div className="ruler-corner">TRACKS</div><div className="track-label"><Film size={14} /><span>Video</span></div><div className="track-label music"><Music2 size={14} /><span>Music</span></div></div>
      <div className="timeline-scroll" ref={scroll}>
        <div className="timeline-content" style={{ width: `${Math.max(1, timelineDuration * pixelsPerSecond)}px` }}>
          <div className="time-ruler" onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); seek(event.currentTarget, event.clientX); }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) seek(event.currentTarget, event.clientX); }}>
            {ticks.map(value => <span key={value} className={Number.isInteger(value) ? '' : 'minor'} style={{ left: `${value * pixelsPerSecond}px` }}><i />{Number.isInteger(value) && <small>{time(value)}</small>}</span>)}
          </div>
          <div className="video-track" onPointerDown={event => seek(event.currentTarget, event.clientX)}>{renderClips('video', segments)}</div>
          <div className="music-track" onPointerDown={event => seek(event.currentTarget, event.clientX)}>
            {music?.segments.length ? renderClips('music', music.segments) : <button className="music-import" onPointerDown={event => event.stopPropagation()} onClick={onImportMusic}><Music2 size={12} />Choose music</button>}
          </div>
          <i className={`playhead ${trimPreview?.snapped ? 'snapped' : ''}`} style={{ left: `${editedTimestamp * pixelsPerSecond}px` }}><span /></i>
        </div>
      </div>
    </div>
    <div className="edit-actions">
      <button onClick={() => cut('start')} disabled={!canCut}><span className="trim-icon">[</span>Trim to playhead</button>
      <button onClick={() => cut('split')} disabled={!canCut}><Scissors size={14} />Split</button>
      <button onClick={() => cut('end')} disabled={!canCut}>Trim to playhead<span className="trim-icon">]</span></button>
      <button className="danger" onClick={() => selected && onEdit(selection.track, clips.filter(s => s.id !== selected.id))} disabled={!selected || (selection.track === 'video' && clips.length === 1)}><Trash2 size={14} />Ripple delete</button>
      <small>Edges snap to playhead. Hold Alt to trim freely.</small>
    </div>
  </section>;
}
