import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Film, Music2, Pause, Play, Redo2, Scissors, SkipBack, SkipForward, Trash2, Undo2, Volume2, VolumeX, ZoomIn, ZoomOut } from 'lucide-react';
import type { MusicFile, Segment } from '../types';
import { time } from '../lib/presets';
import { editedDuration as durationOf, sourceToEdited as sourceTime, editedToSource as sourceOf, trimBounds } from '../lib/timeline';

type Trim = { id: string; edge: 'start' | 'end'; pointer: number; x: number; value: number; min: number; max: number };
const MIN_CLIP = .05;

export function Timeline({ duration, timestamp, segments, music, playing, playbackReady, canUndo, canRedo, onSeek, onPlay, onSplit, onTrimLeft, onTrimRight, onTrim, onVolume, onDelete, onUndo, onRedo, onImportMusic }: {
  duration: number;
  timestamp: number;
  segments: Segment[];
  music: MusicFile | null;
  playing: boolean;
  playbackReady: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onSeek: (value: number) => void;
  onPlay: () => void;
  onSplit: () => void;
  onTrimLeft: () => void;
  onTrimRight: () => void;
  onTrim: (id: string, edge: 'start' | 'end', value: number) => void;
  onVolume: (id: string, volume: number) => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onImportMusic: () => void;
}) {
  const [pixelsPerSecond, setPixelsPerSecond] = useState(64);
  const [selectedId, setSelectedId] = useState(segments[0]?.id ?? '');
  const [trimPreview, setTrimPreview] = useState<{ id: string; edge: 'start' | 'end'; value: number } | null>(null);
  const [volume, setVolume] = useState(segments[0]?.volume ?? 1);
  const trim = useRef<Trim | null>(null), scroll = useRef<HTMLDivElement>(null), volumeDirty = useRef(false);
  const editedDuration = durationOf(segments);
  const sourceToEdited = (source: number) => sourceTime(segments, source);
  const editedToSource = (edited: number) => sourceOf(segments, edited);
  const editedTimestamp = sourceToEdited(timestamp);
  const active = segments.find(segment => timestamp >= segment.start && timestamp <= segment.end);
  const selected = segments.find(segment => segment.id === selectedId) ?? active ?? segments[0];
  const offsets = useMemo(() => {
    let cursor = 0;
    return segments.map(segment => { const value = cursor; cursor += segment.end - segment.start; return value; });
  }, [segments]);
  const tickEvery = pixelsPerSecond >= 160 ? .5 : pixelsPerSecond >= 80 ? 1 : pixelsPerSecond >= 40 ? 2 : pixelsPerSecond >= 20 ? 5 : 10;
  const ticks = Array.from({ length: Math.floor(editedDuration / tickEvery) + 1 }, (_, index) => index * tickEvery);
  useEffect(() => { if (active && !trim.current) setSelectedId(active.id); }, [active?.id]);
  useEffect(() => { if (selected && !volumeDirty.current) setVolume(selected.volume); }, [selected?.id, selected?.volume]);
  useEffect(() => {
    if (!playing || !scroll.current) return;
    const x = editedTimestamp * pixelsPerSecond, viewport = scroll.current;
    if (x < viewport.scrollLeft + 28) viewport.scrollLeft = Math.max(0, x - 80);
    else if (x > viewport.scrollLeft + viewport.clientWidth - 28) viewport.scrollLeft = x - viewport.clientWidth + 80;
  }, [playing, editedTimestamp, pixelsPerSecond]);
  const seek = (element: HTMLElement, clientX: number) => {
    const rect = element.getBoundingClientRect();
    onSeek(editedToSource(Math.max(0, Math.min(editedDuration, (clientX - rect.left) / pixelsPerSecond))));
  };
  const choose = (event: PointerEvent<HTMLDivElement>, segment: Segment) => {
    event.stopPropagation(); setSelectedId(segment.id);
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    onSeek(segment.start + ratio * (segment.end - segment.start));
  };
  const beginTrim = (event: PointerEvent<HTMLButtonElement>, segment: Segment, edge: 'start' | 'end', index: number) => {
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setSelectedId(segment.id);
    const bounds = trimBounds(segments, index, duration, MIN_CLIP)[edge];
    trim.current = {
      id: segment.id, edge, pointer: event.pointerId, x: event.clientX, value: segment[edge],
      min: bounds.min, max: bounds.max,
    };
  };
  const moveTrim = (event: PointerEvent<HTMLButtonElement>) => {
    const state = trim.current; if (!state || state.pointer !== event.pointerId) return;
    const value = Math.max(state.min, Math.min(state.max, state.value + (event.clientX - state.x) / pixelsPerSecond));
    setTrimPreview({ id: state.id, edge: state.edge, value });
  };
  const finishTrim = (event: PointerEvent<HTMLButtonElement>) => {
    const state = trim.current; if (!state || state.pointer !== event.pointerId) return;
    const value = Math.max(state.min, Math.min(state.max, state.value + (event.clientX - state.x) / pixelsPerSecond));
    trim.current = null; setTrimPreview(null);
    if (Math.abs(value - state.value) > .001) onTrim(state.id, state.edge, value);
  };
  const cancelTrim = () => { trim.current = null; setTrimPreview(null); };
  const nudgeTrim = (event: KeyboardEvent<HTMLButtonElement>, segment: Segment, edge: 'start' | 'end', index: number) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault(); event.stopPropagation(); setSelectedId(segment.id);
    const bounds = trimBounds(segments, index, duration, MIN_CLIP)[edge];
    const step = event.shiftKey ? 1 : .1;
    const value = Math.max(bounds.min, Math.min(bounds.max, segment[edge] + (event.key === 'ArrowLeft' ? -step : step)));
    if (Math.abs(value - segment[edge]) > .001) onTrim(segment.id, edge, value);
  };
  const commitVolume = () => {
    if (!selected || !volumeDirty.current) return;
    volumeDirty.current = false; onVolume(selected.id, volume);
  };
  const zoom = (next: number) => setPixelsPerSecond(Math.max(12, Math.min(240, next)));
  const contentWidth = Math.max(1, editedDuration * pixelsPerSecond);
  return <section className="timeline" aria-label="Editor timeline">
    <div className="transport">
      <button onClick={onPlay} disabled={!duration || !playbackReady} title={playbackReady ? undefined : 'Preparing optimized preview…'} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
      <button onClick={() => onSeek(editedToSource(Math.max(0, editedTimestamp - 5)))} disabled={!duration} aria-label="Back 5 seconds"><SkipBack size={15} /><small>5s</small></button>
      <button onClick={() => onSeek(editedToSource(Math.min(editedDuration, editedTimestamp + 5)))} disabled={!duration} aria-label="Forward 5 seconds"><small>5s</small><SkipForward size={15} /></button>
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
      <span>{selected ? `Selected clip · ${time(selected.end - selected.start)}` : 'Select a video clip'}</span>
      <button disabled={!selected} onClick={() => { if (!selected) return; const next = selected.volume > 0 ? 0 : 1; setVolume(next); volumeDirty.current = false; onVolume(selected.id, next); }} aria-label={volume > 0 ? 'Mute selected video clip' : 'Unmute selected video clip'}>{volume > 0 ? <Volume2 size={14} /> : <VolumeX size={14} />}</button>
      <input aria-label="Selected video clip volume" disabled={!selected} type="range" min="0" max="2" step=".01" value={volume} onChange={event => { volumeDirty.current = true; setVolume(Number(event.target.value)); }} onPointerUp={commitVolume} onKeyUp={commitVolume} onBlur={commitVolume} />
      <strong>{Math.round(volume * 100)}%</strong>
    </div>
    <div className="timeline-editor">
      <div className="track-labels" aria-hidden="true">
        <div className="ruler-corner">TRACKS</div>
        <div className="track-label"><Film size={14} /><span>Video</span></div>
        <div className="track-label music"><Music2 size={14} /><span>Music</span></div>
      </div>
      <div className="timeline-scroll" ref={scroll}>
        <div className="timeline-content" style={{ width: `${contentWidth}px` }}>
          <div className="time-ruler" onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); seek(event.currentTarget, event.clientX); }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) seek(event.currentTarget, event.clientX); }}>
            {ticks.map(value => <span key={value} className={Number.isInteger(value) ? '' : 'minor'} style={{ left: `${value * pixelsPerSecond}px` }}><i />{Number.isInteger(value) && <small>{time(value)}</small>}</span>)}
          </div>
          <div className="video-track" onPointerDown={event => seek(event.currentTarget, event.clientX)}>
            {segments.map((segment, index) => {
              const previewSegment = trimPreview?.id === segment.id ? { ...segment, [trimPreview.edge]: trimPreview.value } : segment;
              const previewInset = trimPreview?.id === segment.id && trimPreview.edge === 'start' ? trimPreview.value - segment.start : 0;
              return <div key={segment.id} className={`timeline-segment ${active?.id === segment.id ? 'active' : ''} ${selected?.id === segment.id ? 'selected' : ''} ${trimPreview?.id === segment.id ? 'trimming' : ''}`} style={{ left: `${(offsets[index] + previewInset) * pixelsPerSecond}px`, width: `${(previewSegment.end - previewSegment.start) * pixelsPerSecond}px` }} onPointerDown={event => choose(event, segment)}>
              <button className="trim-handle start" aria-label="Trim or extend clip from left" title="Drag, or use arrow keys (Shift = 1 second)" onKeyDown={event => nudgeTrim(event, segment, 'start', index)} onPointerDown={event => beginTrim(event, segment, 'start', index)} onPointerMove={moveTrim} onPointerUp={finishTrim} onPointerCancel={cancelTrim} />
              <span className="clip-fill"><Film size={12} /><b>Clip {index + 1}</b><small>{time(previewSegment.start)} – {time(previewSegment.end)}</small>{segment.volume === 0 && <VolumeX size={11} />}</span>
              <button className="trim-handle end" aria-label="Trim or extend clip from right" title="Drag, or use arrow keys (Shift = 1 second)" onKeyDown={event => nudgeTrim(event, segment, 'end', index)} onPointerDown={event => beginTrim(event, segment, 'end', index)} onPointerMove={moveTrim} onPointerUp={finishTrim} onPointerCancel={cancelTrim} />
            </div>})}
          </div>
          <div className="music-track">
            {music ? <button className="music-clip" style={{ width: `${Math.max(24, Math.min(music.duration, editedDuration) * pixelsPerSecond)}px` }} onClick={onImportMusic} title={`${music.name} · click to choose another song`}><Music2 size={12} /><b>{music.name}</b><small>{time(Math.min(music.duration, editedDuration))}</small></button>
              : <button className="music-import" onClick={onImportMusic}><Music2 size={12} />Choose music</button>}
          </div>
          <i className="playhead" style={{ left: `${editedTimestamp * pixelsPerSecond}px` }}><span /></i>
        </div>
      </div>
    </div>
    <div className="edit-actions">
      <button onClick={onTrimLeft} disabled={!active}><span className="trim-icon">[</span>Trim to playhead</button>
      <button onClick={onSplit} disabled={!active}><Scissors size={14} />Split</button>
      <button onClick={onTrimRight} disabled={!active}>Trim to playhead<span className="trim-icon">]</span></button>
      <button className="danger" onClick={onDelete} disabled={!active || segments.length === 1}><Trash2 size={14} />Ripple delete</button>
      <small>Drag clip edges to trim or restore source footage.</small>
    </div>
  </section>;
}
