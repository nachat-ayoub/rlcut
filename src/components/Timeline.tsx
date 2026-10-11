import { Pause, Play, Redo2, Scissors, SkipBack, SkipForward, Trash2, Undo2 } from 'lucide-react';
import type { Segment } from '../types';
import { time } from '../lib/presets';

export function Timeline({ duration, timestamp, segments, playing, playbackReady, canUndo, canRedo, onSeek, onPlay, onSplit, onTrimLeft, onTrimRight, onDelete, onUndo, onRedo }: {
  duration: number;
  timestamp: number;
  segments: Segment[];
  playing: boolean;
  playbackReady: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onSeek: (value: number) => void;
  onPlay: () => void;
  onSplit: () => void;
  onTrimLeft: () => void;
  onTrimRight: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const active = segments.find(s => timestamp >= s.start && timestamp <= s.end);
  const editedDuration = segments.reduce((total, segment) => total + segment.end - segment.start, 0);
  const sourceToEdited = (source: number) => {
    let edited = 0;
    for (const segment of segments) {
      if (source < segment.start) return edited;
      if (source <= segment.end) return edited + source - segment.start;
      edited += segment.end - segment.start;
    }
    return edited;
  };
  const editedToSource = (edited: number) => {
    let offset = 0;
    for (const segment of segments) {
      const length = segment.end - segment.start;
      if (edited <= offset + length) return segment.start + Math.max(0, edited - offset);
      offset += length;
    }
    return segments.at(-1)?.end ?? 0;
  };
  const editedTimestamp = sourceToEdited(timestamp);
  const seekFromPointer = (element: HTMLElement, clientX: number) => {
    const rect = element.getBoundingClientRect();
    onSeek(editedToSource(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * editedDuration));
  };
  return <section className="timeline" aria-label="Video timeline">
    <div className="seek-rail" aria-label="Drag playhead" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); seekFromPointer(e.currentTarget, e.clientX); }} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) seekFromPointer(e.currentTarget, e.clientX); }}>
      <span style={{ width: `${editedDuration ? editedTimestamp / editedDuration * 100 : 0}%` }} />
      <i style={{ left: `${editedDuration ? editedTimestamp / editedDuration * 100 : 0}%` }} />
    </div>
    <div className="transport">
      <button onClick={onPlay} disabled={!duration || !playbackReady} title={playbackReady ? undefined : 'Preparing optimized preview…'} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
      <button onClick={() => onSeek(editedToSource(Math.max(0, editedTimestamp - 5)))} disabled={!duration} aria-label="Back 5 seconds"><SkipBack size={15} /><small>5s</small></button>
      <button onClick={() => onSeek(editedToSource(Math.min(editedDuration, editedTimestamp + 5)))} disabled={!duration} aria-label="Forward 5 seconds"><small>5s</small><SkipForward size={15} /></button>
      <span className="timecode">{time(editedTimestamp)} <i>/</i> {time(editedDuration)}</span>
      <span className="transport-spacer" />
      <button onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)"><Undo2 size={15} /></button>
      <button onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)"><Redo2 size={15} /></button>
    </div>
    <div className="timeline-track" onPointerDown={e => seekFromPointer(e.currentTarget, e.clientX)}>
      {segments.map((segment, index) => { const offset = segments.slice(0, index).reduce((total, item) => total + item.end - item.start, 0); return <div key={segment.id} className={`timeline-segment ${active?.id === segment.id ? 'active' : ''}`} style={{ left: `${offset / editedDuration * 100}%`, width: `${(segment.end - segment.start) / editedDuration * 100}%` }}><span /></div>; })}
      <i className="playhead" style={{ left: `${editedDuration ? editedTimestamp / editedDuration * 100 : 0}%` }} />
    </div>
    <div className="edit-actions">
      <button onClick={onTrimLeft} disabled={!active}><span className="trim-icon">[</span>Trim left</button>
      <button onClick={onSplit} disabled={!active}><Scissors size={14} />Split</button>
      <button onClick={onTrimRight} disabled={!active}>Trim right<span className="trim-icon">]</span></button>
      <button className="danger" onClick={onDelete} disabled={!active || segments.length === 1}><Trash2 size={14} />Delete segment</button>
      <small>Edits are non-destructive and applied when exporting.</small>
    </div>
  </section>;
}
