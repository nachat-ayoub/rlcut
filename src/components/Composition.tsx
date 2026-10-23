import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type WheelEvent, type RefObject } from 'react';
import { Dropdown } from './Dropdown';
import { LoaderCircle, Move, Scan, Video as VideoIcon } from 'lucide-react';
import type { FlashEffect, Layer, Preset, Preview, Video, Segment, MusicTrack, TextOverlay } from '../types';
import { clamp } from '../lib/presets';
import { NativePlayback } from '../lib/native-playback';
import { Compositor, type CompositionCanvas } from '../lib/compositor';
import { corners, snapAxis, type Corner } from '../lib/geometry';
import { ease } from '../lib/easing';
import { sourceToEdited } from '../lib/timeline';
type Gesture = {
  layer: 'gameplay' | 'boost';
  resize: Corner | null;
  x: number;
  y: number;
  preset: Preset;
};
type PanGesture = { pointer: number; x: number; y: number; originX: number; originY: number };
type TextGesture = { pointer: number; x: number; y: number; value: TextOverlay };
function PreviewPerformance({ canvas, playing }: { canvas: RefObject<HTMLCanvasElement | null>; playing: boolean }) {
  const [sample, setSample] = useState<{ fps: number; backend: string } | null>(null);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now(), frames = (canvas.current as CompositionCanvas | null)?.compositionStats?.presented ?? 0;
    const timer = window.setInterval(() => {
      const stats = (canvas.current as CompositionCanvas | null)?.compositionStats, now = performance.now();
      if (stats) { setSample({ fps: Math.round(Math.max(0, stats.presented - frames) * 1000 / (now - last)), backend: stats.backend.toUpperCase() }); frames = stats.presented; }
      last = now;
    }, 1000);
    return () => clearInterval(timer);
  }, [canvas, playing]);
  return <small className="preview-performance">{playing && sample ? `${sample.fps} FPS · ${sample.backend} preview` : 'Preview'}</small>;
}
export function Composition({ video, sourceVersion = 0, softwareRendering = false, playbackPath, proxyPreparing, preparation = null, segments = [], music = null, musicFadeOut = null, effects = [], texts = [], selectedTextId = null, onTextSelect, onTextChange, preview, preset, before, colorPreviewBefore = false, guides, layer, setLayer, change, importVideo, quality, playing, timestamp, onTimestamp, onPlayingChange, onPlaybackError, onSourceFrame }: {
  video: Video | null;
  sourceVersion?: number;
  softwareRendering?: boolean;
  playbackPath: string;
  proxyPreparing: boolean;
  preparation?: { percent: number; elapsed: number; remaining: number | null } | null;
  segments?: Segment[];
  music?: MusicTrack | null;
  musicFadeOut?: number | null;
  effects?: FlashEffect[];
  texts?: TextOverlay[];
  selectedTextId?: string | null;
  onTextSelect: (id: string) => void;
  onTextChange: (text: TextOverlay) => void;
  preview: Preview | null;
  preset: Preset;
  before: boolean;
  colorPreviewBefore?: boolean;
  guides: boolean;
  layer: Layer | null;
  setLayer: (l: Layer | null) => void;
  change: (p: Preset) => void;
  importVideo: () => void;
  quality: number;
  playing: boolean;
  timestamp: number;
  onTimestamp: (value: number) => number | void;
  onPlayingChange: (value: boolean) => void;
  onPlaybackError?: (error: unknown) => void;
  onSourceFrame?: (source: string) => void;
}) {
  const canvas = useRef<HTMLDivElement>(null), viewport = useRef<HTMLDivElement>(null), player = useRef<NativePlayback | null>(null), gesture = useRef<Gesture | null>(null), panGesture = useRef<PanGesture | null>(null), textGesture = useRef<TextGesture | null>(null);
  const output = useRef<HTMLCanvasElement>(null), renderer = useRef<Compositor | null>(null);
  const playbackTimestamp = useRef(timestamp);
  const textFrame = useRef(-1), textSignature = useRef('');
  const [forceCPU, setForceCPU] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [mediaReady, setMediaReady] = useState(false);
  const [playbackFailed, setPlaybackFailed] = useState(false), [playbackAttempt, setPlaybackAttempt] = useState(0);
  const [visualTime, setVisualTime] = useState(() => sourceToEdited(segments, timestamp));
  const [snaps, setSnaps] = useState<(number | null)[]>([null, null]);
  const ratio = quality === 480 ? 480 / 854 : 9 / 16;
  const callbacks = useRef({ onTimestamp, onPlayingChange, onPlaybackError, onSourceFrame, timestamp, preset, quality, before, colorPreviewBefore, video, playing, segments, effects, texts });
  useEffect(() => { callbacks.current = { onTimestamp, onPlayingChange, onPlaybackError, onSourceFrame, timestamp, preset, quality, before, colorPreviewBefore, video, playing, segments, effects, texts }; });
  const [waiting, setWaiting] = useState(false);
  const draw = useRef<() => void>(() => { });
  const snapshot = useRef<() => void>(() => { });
  useEffect(() => {
    const target = output.current;
    if (!target || !playbackPath) return;
    let compositor: Compositor;
    try { compositor = new Compositor(target, forceCPU || softwareRendering); }
    catch { setForceCPU(true); return; }
    renderer.current = compositor;
    const lost = (event: Event) => { event.preventDefault(); setForceCPU(true); };
    target.addEventListener('webglcontextlost', lost); target.addEventListener('compositionfallback', lost);
    draw.current = () => {
      const current = callbacks.current, source = player.current?.frame;
      if (!current.video || !source) return;
      try {
        let drawingPreset = current.preset;
        const editedTime = sourceToEdited(current.segments, playbackTimestamp.current);
        if (current.preset.boost.intro.enabled && current.preset.boost.enabled && !current.before && editedTime < current.preset.boost.intro.duration) {
          const boost = current.preset.boost;
          const hidden = -(boost.width * boost.scale) / 2 - 5 / current.quality;
          const progress = ease(editedTime / boost.intro.duration, boost.intro.easing);
          drawingPreset = { ...current.preset, boost: { ...boost, x: hidden + (boost.x - hidden) * progress } };
        }
        const activeClip = current.segments.find(segment => playbackTimestamp.current >= segment.start - .001 && playbackTimestamp.current <= segment.end + .001);
        compositor.draw(source, source.width, source.height, current.video, drawingPreset, current.quality, current.before, current.playing, current.colorPreviewBefore ? 0 : activeClip?.colorFix ?? 0);
      }
      catch (error) { current.onPlayingChange(false); current.onPlaybackError?.(error); }
    };
    snapshot.current = () => {
      const source = !callbacks.current.playing && player.current?.snapshotCanvas();
      if (source) callbacks.current.onSourceFrame?.(source.toDataURL('image/jpeg', .92));
    };
    const observer = new ResizeObserver(() => draw.current()); observer.observe(target);
    draw.current();
    return () => { observer.disconnect(); target.removeEventListener('webglcontextlost', lost); target.removeEventListener('compositionfallback', lost); compositor.dispose(); renderer.current = null; };
  }, [playbackPath, forceCPU, softwareRendering, sourceVersion]);
  useEffect(() => {
    if (!playbackPath || !video || !segments.length) { setMediaReady(false); setWaiting(false); return; }
    setMediaReady(false); setWaiting(true); setPlaybackFailed(false);
    let disposed = false;
    const session = new NativePlayback(playbackPath, callbacks.current.timestamp, segments, {
      frame: (_source, time) => {
        if (disposed) return;
        playbackTimestamp.current = time;
        const current = callbacks.current, edited = sourceToEdited(current.segments, time);
        // Static text does not need 30 React renders/sec. Update on visibility
        // boundaries and while fades animate; decoded gameplay stays frame-paced.
        const active = current.texts.filter(text => edited >= text.start && edited <= text.end);
        const signature = active.map(text => text.id).join(',');
        const fading = active.some(text => (text.fadeIn && edited < text.start + text.fadeIn) || (text.fadeOut && edited > text.end - text.fadeOut));
        const flashing = current.effects.some(effect => edited >= effect.time && edited <= effect.time + effect.duration);
        if (!current.playing || signature !== textSignature.current || ((fading || flashing) && Math.abs(edited - textFrame.current) >= 1 / 30)) {
          textFrame.current = edited; textSignature.current = signature; setVisualTime(edited);
        }
        setMediaReady(true); draw.current(); snapshot.current();
      },
      cost: value => { if (callbacks.current.playing) renderer.current?.feedback(value); },
      time: value => { if (!disposed) { playbackTimestamp.current = value; callbacks.current.onTimestamp(value); } },
      waiting: value => { if (!disposed) setWaiting(value); },
      ended: () => { if (!disposed) callbacks.current.onPlayingChange(false); },
      error: error => { if (!disposed) { setMediaReady(false); setPlaybackFailed(true); callbacks.current.onPlayingChange(false); callbacks.current.onPlaybackError?.(error); } },
    }, video.fps >= 50 ? 60 : 30, renderer.current?.backend === 'cpu' ? 480 : 640);
    player.current = session;
    return () => { disposed = true; session.dispose(); if (player.current === session) player.current = null; };
    // Native source lifetime is independent of scene and timeline changes.
  }, [playbackPath, sourceVersion, segments.length > 0, playbackAttempt]);
  useEffect(() => { player.current?.control({ segments }); }, [segments, playbackPath, sourceVersion, playbackAttempt]);
  useEffect(() => {
    player.current?.control({ music: music ? { ...music, fadeOut: musicFadeOut } : { path: '', name: '', duration: 1, waveform: [], segments: [], fadeOut: null } });
  }, [music, musicFadeOut, playbackPath, sourceVersion, playbackAttempt]);
  useEffect(() => { if (playing) player.current?.seek(callbacks.current.timestamp); player.current?.control({ playing }); if (!playing) snapshot.current(); }, [playing, playbackPath, sourceVersion, playbackAttempt]);
  useEffect(() => { if (!playing) { playbackTimestamp.current = timestamp; setVisualTime(sourceToEdited(segments, timestamp)); player.current?.seek(timestamp); } }, [timestamp, playing, segments]);
  useEffect(() => { const frame = requestAnimationFrame(() => draw.current()); return () => cancelAnimationFrame(frame); }, [preset, before, colorPreviewBefore, quality, video, playing, segments, effects]);
  const updateZoom = (next: number) => {
    const bounded = Math.max(1, Math.min(4, next));
    const snapped = Math.abs(bounded - 1) < .08 ? 1 : bounded;
    setZoom(snapped);
    if (snapped === 1) setPan({ x: 0, y: 0 });
  };
  const previewWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    updateZoom(zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12));
  };
  const beginPan = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.altKey || zoom <= 1) return;
    event.preventDefault(); event.stopPropagation();
    panGesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, originX: pan.x, originY: pan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const movePan = (event: PointerEvent<HTMLDivElement>) => {
    const state = panGesture.current;
    if (!state || state.pointer !== event.pointerId) return;
    setPan({ x: state.originX + event.clientX - state.x, y: state.originY + event.clientY - state.y });
  };
  const finishPan = (event: PointerEvent<HTMLDivElement>) => {
    if (panGesture.current?.pointer === event.pointerId) panGesture.current = null;
  };
  function begin(e: PointerEvent, target: 'gameplay' | 'boost', resize: Corner | null = null) { if (e.altKey) return; e.preventDefault(); e.stopPropagation(); setLayer(target); gesture.current = { layer: target, resize, x: e.clientX, y: e.clientY, preset: structuredClone(preset) }; e.currentTarget.setPointerCapture(e.pointerId); }
  function beginText(e: PointerEvent<HTMLDivElement>, text: TextOverlay) { if (e.altKey) return; e.preventDefault(); e.stopPropagation(); onTextSelect(text.id); textGesture.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, value: structuredClone(text) }; e.currentTarget.setPointerCapture(e.pointerId); }
  function moveText(e: PointerEvent<HTMLDivElement>) {
    const state = textGesture.current, target = canvas.current; if (!state || state.pointer !== e.pointerId || !target) return;
    const rect = target.getBoundingClientRect(), thresholdX = 8 / rect.width, thresholdY = 8 / rect.height;
    let x = clamp(state.value.x + (e.clientX - state.x) / rect.width), y = clamp(state.value.y + (e.clientY - state.y) / rect.height);
    let gx: number | null = null, gy: number | null = null;
    for (const point of [0, .5, 1]) if (Math.abs(x - point) <= thresholdX) { x = point; gx = point; }
    for (const point of [0, .5, 1]) if (Math.abs(y - point) <= thresholdY) { y = point; gy = point; }
    setSnaps([gx, gy]); onTextChange({ ...state.value, x, y });
  }
  function finishText(e: PointerEvent<HTMLDivElement>) { if (textGesture.current?.pointer === e.pointerId) { textGesture.current = null; setSnaps([null, null]); } }
  function move(e: PointerEvent) {
    const g = gesture.current;
    if (!g || !canvas.current)
      return;
    const r = canvas.current.getBoundingClientRect(), dx = (e.clientX - g.x) / r.width, dy = (e.clientY - g.y) / r.height;
    const p = structuredClone(g.preset);
    const item = p[g.layer];
    const width = g.layer === 'gameplay' ? p.gameplay.scale : p.boost.width * p.boost.scale;
    const height = g.layer === 'gameplay' ? width * (video!.height / video!.width) * ratio : p.boost.height * p.boost.scale;
    if (g.resize) {
      const sx = g.resize.includes('w') ? -1 : 1, sy = g.resize.includes('n') ? -1 : 1;
      let nw: number, nh: number;
      if (g.layer === 'gameplay') {
        const aspect = height / width;
        const delta = Math.abs(dx) >= Math.abs(dy / aspect) ? sx * dx : sy * dy / aspect;
        nw = clamp(width + delta, .2, 4); nh = nw * aspect;
        p.gameplay.scale = nw;
      } else {
        nw = clamp(width + sx * dx, .01 * p.boost.scale, p.boost.scale);
        nh = clamp(height + sy * dy, .005 * p.boost.scale, p.boost.scale);
        p.boost.width = nw / p.boost.scale; p.boost.height = nh / p.boost.scale;
      }
      item.x = clamp(item.x + sx * (nw - width) / 2);
      item.y = clamp(item.y + sy * (nh - height) / 2);
      setSnaps([null, null]);
    } else {
      const x = snapAxis(item.x + dx, width, e.altKey ? 0 : 8 / r.width);
      const y = snapAxis(item.y + dy, height, e.altKey ? 0 : 8 / r.height);
      item.x = x.position; item.y = y.position; setSnaps([x.guide, y.guide]);
    }
    change(p);
  }
  const rect = (target: 'gameplay' | 'boost'): CSSProperties => {
    let width: number, height: number, x: number, y: number; if (target === 'gameplay') {
      width = preset.gameplay.scale;
      height = width * (video!.height / video!.width) * ratio;
      x = preset.gameplay.x;
      y = preset.gameplay.y;
    }
    else {
      width = preset.boost.width * preset.boost.scale;
      height = preset.boost.height * preset.boost.scale;
      x = preset.boost.x;
      y = preset.boost.y;
    } return { width: `${width * 100}%`, height: `${height * 100}%`, left: `${x * 100}%`, top: `${y * 100}%`, transform: 'translate(-50%, -50%)' };
  };
  if (!video)
    return <div className="preview-stage">
      <div className="empty-preview">
        <div className="empty-icon">
          <VideoIcon size={34} strokeWidth={1.7} />
        </div>
        <h2>{proxyPreparing ? preparation ? `Preparing recording · ${Math.floor(preparation.percent)}%` : 'Reading your recording…' : 'Your next great clip starts here.'}</h2>
        <p>Drop a Rocket League recording anywhere,<br />or choose a video to get started.</p>
        <button className="primary" disabled={proxyPreparing} onClick={importVideo}>{proxyPreparing ? 'Preparing…' : 'Import gameplay'}</button>
        <small>MP4 · MOV · MKV · WEBM</small>
        <div className="layer-pills">
          <span>Blurred background</span>
          <span>Sharp gameplay</span>
          <span>Live boost HUD</span>
        </div>
      </div>
    </div>;
  const activeEffects = before ? [] : effects.filter(effect => visualTime >= effect.time && visualTime <= effect.time + effect.duration).map(effect => ({ effect, amount: effect.kind === 'darkGray' ? effect.intensity : effect.intensity * (1 - ease((visualTime - effect.time) / effect.duration, effect.easing)) }));
  const renderEffects = (scope: FlashEffect['scope']) => activeEffects.filter(item => item.effect.scope === scope).map(({ effect, amount }) => <div key={effect.id} className={`composition-effect ${scope === 'all' ? 'all-layers' : 'video-only'} ${effect.kind === 'darkGray' ? 'dark-gray' : 'flash'}`} aria-hidden="true" style={effect.kind === 'flash' ? { backgroundColor: effect.color, opacity: amount } : { opacity: 1, backdropFilter: `grayscale(${amount}) brightness(${1 - amount * .32}) contrast(${1 + amount * .08})`, WebkitBackdropFilter: `grayscale(${amount}) brightness(${1 - amount * .32}) contrast(${1 + amount * .08})` }} />);
  return <div className="preview-stage" onPointerDown={() => setLayer(null)}>
    <div className={`preview-viewport ${zoom > 1 ? 'pan-ready' : ''} ${panGesture.current ? 'panning' : ''}`} ref={viewport} onWheel={previewWheel} onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={finishPan} onPointerCancel={finishPan}>
      <div className={`composition ${before ? 'source-mode' : ''} ${layer === 'background' ? 'background-selected' : ''}`} ref={canvas} style={{ aspectRatio: before ? `${video.width}/${video.height}` : `${ratio}`, maxHeight: 'none', maxWidth: 'none', width: before ? `${zoom * 100}%` : 'auto', height: `${zoom * 100}%`, flexShrink: 0, transform: `translate(${pan.x}px, ${pan.y}px)` }} onPointerDown={e => { if (e.altKey) return; if (e.target !== e.currentTarget && !(e.target as HTMLElement).matches('canvas')) return; e.stopPropagation(); if (!before) setLayer('background'); }} onPointerMove={move} onPointerUp={() => { gesture.current = null; setSnaps([null, null]); }} onPointerCancel={() => { gesture.current = null; setSnaps([null, null]); }}>
        <PreviewPerformance canvas={output} playing={playing} />
        <canvas key={forceCPU || softwareRendering ? 'cpu' : 'gpu'} className="composition-output" ref={output} aria-label={before ? 'Original recording' : 'Live edited composition'} />
        {renderEffects('video')}
        {!before && texts.filter(text => visualTime >= text.start && visualTime <= text.end).map(text => {
          const current = visualTime, local = current - text.start, remaining = text.end - current;
          const fade = Math.min(1, text.fadeIn ? local / text.fadeIn : 1, text.fadeOut ? remaining / text.fadeOut : 1);
          const strokeFactor = text.strokePosition === 'outside' ? 2 : text.strokePosition === 'inside' ? .5 : 1;
          return <div key={text.id} className={`composition-text ${selectedTextId === text.id ? 'selected' : ''}`} style={{ left: `${text.x * 100}%`, top: `${text.y * 100}%`, width: `${text.boxWidth * 100}%`, transform: `translate(-50%,-50%) scale(${text.scale}) rotate(${text.rotation}deg)`, fontFamily: text.fontFamily, fontSize: `${text.fontSize / quality * 100}cqw`, fontWeight: text.fontWeight, fontStyle: text.italic ? 'italic' : 'normal', textDecoration: text.underline ? 'underline' : 'none', letterSpacing: `${text.letterSpacing / quality * 100}cqw`, lineHeight: text.lineHeight, textAlign: text.align, color: text.color, opacity: text.opacity * Math.max(0, fade), WebkitTextStroke: `${text.strokeWidth * strokeFactor / quality * 100}cqw ${text.strokeColor}`, paintOrder: text.strokePosition === 'outside' ? 'stroke fill' : 'fill stroke', backgroundColor: `${text.backgroundColor}${Math.round(text.backgroundOpacity * 255).toString(16).padStart(2, '0')}` }} onPointerDown={event => beginText(event, text)} onPointerMove={moveText} onPointerUp={finishText} onPointerCancel={finishText}>
            {text.shadowEnabled && <span aria-hidden="true" className="composition-text-shadow" style={{ color: text.shadowColor, WebkitTextStrokeColor: text.shadowColor, transform: `translate(${text.shadowX / quality * 100}cqw,${text.shadowY / quality * 100}cqw)`, filter: text.shadowBlur > 0 ? `blur(${text.shadowBlur / quality * 100}cqw)` : 'none' }}>{text.text}</span>}
            <span className="composition-text-fill">{text.text}</span>
          </div>;
        })}
        {renderEffects('all')}
        {!mediaReady && !proxyPreparing && <div className="preview-loading">{playbackFailed ? <><span>Playback unavailable. Check the error message.</span><button onClick={() => setPlaybackAttempt(value => value + 1)}>Retry playback</button></> : <><LoaderCircle className="spin" />Opening native decoder…</>}</div>}
        {!before && guides && (mediaReady || preview) && (['gameplay', 'boost'] as const).filter(l => l !== 'boost' || preset.boost.enabled).map(target => <div key={target} className={`layer-guide ${layer === target ? 'selected' : 'unselected'} ${target}`} style={rect(target)} onPointerDown={e => begin(e, target)}>
          {layer === target && <span>
            <Move size={10} />
            {target === 'gameplay' ? 'GAMEPLAY' : 'BOOST'}
          </span>}
          {layer === target && corners.map(corner => <button key={corner} className={`resize-handle ${corner}`} aria-label={`Resize ${target} ${corner}`} onPointerDown={e => begin(e, target, corner)} />)}
        </div>)}
        {snaps[0] !== null && <i className="snap-line vertical" style={{ left: `${snaps[0]! * 100}%` }} />}
        {snaps[1] !== null && <i className="snap-line horizontal" style={{ top: `${snaps[1]! * 100}%` }} />}
        {proxyPreparing && <div className="proxy-loading"><LoaderCircle className="spin" size={17} /><span>{preparation ? `Preparing video · ${Math.floor(preparation.percent)}%` : 'Reading recording…'}{preparation?.remaining != null && <small>About {Math.ceil(preparation.remaining)}s remaining</small>}<progress max="100" value={preparation?.percent} /></span></div>}
        {waiting && mediaReady && !proxyPreparing && <div className="proxy-loading"><LoaderCircle className="spin" size={17} /><span>Seeking frame…</span></div>}
      </div></div>
    <span className="canvas-caption">
      <Scan size={12} />
      {before ? 'Original frame' : `${quality === 480 ? 'Approx. 9:16' : '9:16'} · ${quality === 480 ? '480 × 854' : quality === 720 ? '720 × 1280' : '1080 × 1920'}`} · <label>Zoom <Dropdown label="Preview zoom" value={zoom} onChange={value => updateZoom(Number(value))} options={[1, 1.5, 2, 3, 4].map(z => ({ value: z, label: z === 1 ? 'Fit' : `${z * 100}%` }))} /></label></span>
  </div>;
}
