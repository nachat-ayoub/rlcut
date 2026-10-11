import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Check, CheckCircle2, Circle, Copy, Download, Eye, Film, FolderOpen, Gauge, Layers3, LayoutTemplate, LoaderCircle, Maximize2, Pencil, Plus, Settings2, ShieldCheck, SlidersHorizontal, Trash2, Upload, X } from 'lucide-react';
import type { Init, Layer, Preset, Preview, Progress, Segment, Store, Video } from './types';
import { classic, clamp, copyPreset, filename, initialStore, duration } from './lib/presets';
import { invoke, isDesktop, message, onDrop } from './lib/native';
import { Dropdown } from './components/Dropdown';
import { Section, Slider } from './components/Controls';
import { Composition } from './components/Composition';
import { Alignment } from './components/Alignment';
import { CropEditor } from './components/CropEditor';
import { Timeline } from './components/Timeline';
type Modal = 'settings' | 'presets' | 'crop' | null;
export default function App() {
  const [store, setStore] = useState<Store>(initialStore), [ready, setReady] = useState(false), [init, setInit] = useState<Init | null>(null);
  const [video, setVideo] = useState<Video | null>(null), [preview, setPreview] = useState<Preview | null>(null), [timestamp, setTimestamp] = useState(0);
  const [proxyPath, setProxyPath] = useState('');
  const [busy, setBusy] = useState(false), [importing, setImporting] = useState(false), [before, setBefore] = useState(false), [guides, setGuides] = useState(true), [layer, setLayer] = useState<Layer | null>('boost');
  const [modal, setModal] = useState<Modal>(null), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null), [exportStarting, setExportStarting] = useState(false), [outputFolder, setOutputFolder] = useState(''), [outputName, setOutputName] = useState('rlcut-short.mp4');
  const [quality, setQuality] = useState(1080), [fps, setFps] = useState(60), [rename, setRename] = useState('');
  const [refresh, setRefresh] = useState(0), [saved, setSaved] = useState(true);
  const [segments, setSegments] = useState<Segment[]>([]), [playing, setPlaying] = useState(false);
  const undoStack = useRef<Array<{ preset: Preset; segments: Segment[] }>>([]), redoStack = useRef<Array<{ preset: Preset; segments: Segment[] }>>([]);
  const initialized = useRef(false), revision = useRef(0), importRevision = useRef(0), lastSaved = useRef(''), storeRef = useRef(store);
  storeRef.current = store;
  const preset = store.activePreset === 'classic' ? classic : store.presets.find(p => p.id === store.activePreset) ?? classic;
  const allPresets = [classic, ...store.presets];
  const exporting = progress?.phase === 'running';
  const report = useCallback((e: unknown) => setError(message(e)), []);
  useEffect(() => {
    if (initialized.current)
      return;
    initialized.current = true;
    if (!isDesktop()) {
      setReady(true);
      return;
    }
    invoke<Init>('initialize').then(data => { setInit(data); setStore(data.store); lastSaved.current = JSON.stringify(data.store); setOutputFolder(data.store.settings.outputFolder); setQuality(data.store.settings.quality); setFps(data.store.settings.fps); setError(data.storageError); setReady(true); }).catch(e => { report(e); setReady(true); });
  }, [report]);
  useEffect(() => {
    if (!ready || !isDesktop() || !init || init.storageError)
      return;
    const json = JSON.stringify(store);
    if (json === lastSaved.current)
      return;
    setSaved(false);
    const timer = setTimeout(() => { invoke<void>('save_store', { store }).then(() => { lastSaved.current = json; setSaved(JSON.stringify(storeRef.current) === json); }).catch(report); }, 600);
    return () => clearTimeout(timer);
  }, [store, ready, init?.storageError, report]);
  useEffect(() => {
    if (!notice)
      return; const timer = setTimeout(() => setNotice(null), 4000); return () => clearTimeout(timer);
  }, [notice]);
  const replacePreset = useCallback((next: Preset) => {
    setStore(s => {
      if (s.activePreset === 'classic') {
        const p = copyPreset(next, 'Classic RL Short — custom');
        return { ...s, activePreset: p.id, presets: [...s.presets, p] };
      }
      return { ...s, presets: s.presets.map(p => p.id === s.activePreset ? { ...next, id: p.id, name: p.name } : p) };
    });
  }, []);
  const change = useCallback((next: Preset) => {
    undoStack.current.push({ preset: structuredClone(preset), segments: structuredClone(segments) });
    redoStack.current = [];
    replacePreset(next);
  }, [preset, segments, replacePreset]);
  const restoreSnapshot = useCallback((snapshot: { preset: Preset; segments: Segment[] }) => {
    replacePreset(snapshot.preset);
    setSegments(structuredClone(snapshot.segments));
    setPlaying(false);
  }, [replacePreset]);
  const undo = useCallback(() => {
    const snapshot = undoStack.current.pop(); if (!snapshot) return;
    redoStack.current.push({ preset: structuredClone(preset), segments: structuredClone(segments) });
    restoreSnapshot(snapshot);
  }, [preset, segments, restoreSnapshot]);
  const redo = useCallback(() => {
    const snapshot = redoStack.current.pop(); if (!snapshot) return;
    undoStack.current.push({ preset: structuredClone(preset), segments: structuredClone(segments) });
    restoreSnapshot(snapshot);
  }, [preset, segments, restoreSnapshot]);
  const editSegments = useCallback((next: Segment[]) => {
    undoStack.current.push({ preset: structuredClone(preset), segments: structuredClone(segments) });
    redoStack.current = []; setSegments(next); setPlaying(false);
  }, [preset, segments]);
  function edit<K extends 'background' | 'gameplay' | 'boost'>(key: K, values: Partial<Preset[K]>) { change({ ...preset, [key]: { ...preset[key], ...values } }); }
  function reset(key: 'background' | 'gameplay' | 'boost') { change({ ...preset, [key]: structuredClone(classic[key]) }); }
  const importPath = useCallback(async (path: string) => {
    const ticket = ++importRevision.current;
    ++revision.current;
    setImporting(true);
    setError(null);
    void invoke<void>('invalidate_preview').catch(() => { });
    try {
      const v = await invoke<Video>('import_video', { path });
      if (ticket !== importRevision.current)
        return;
      setVideo(v);
      setProxyPath('');
      setSegments([{ id: crypto.randomUUID(), start: 0, end: v.duration }]);
      undoStack.current = []; redoStack.current = [];
      setPreview(null);
      setTimestamp(v.duration / 2);
      setBefore(false);
      setOutputName(`${filename(v.path).replace(/\.[^.]+$/, '')}-short.mp4`);
      setStore(s => ({ ...s, recentFiles: [v.path, ...s.recentFiles.filter(p => p !== v.path)].slice(0, 12) }));
      const prepare = invoke<string>('create_proxy', { path: v.path }).then(proxy => {
        if (ticket === importRevision.current) setProxyPath(proxy);
      });
      if (storeRef.current.settings.waitForPreview) await prepare;
      else void prepare.catch(e => { if (ticket === importRevision.current) report(e); });
    }
    catch (e) {
      if (ticket === importRevision.current)
        report(e);
    }
    finally {
      if (ticket === importRevision.current)
        setImporting(false);
    }
  }, [report]);
  const importVideo = useCallback(async () => {
    try {
      const path = await invoke<string | null>('pick_video');
      if (path)
        await importPath(path);
    }
    catch (e) {
      report(e);
    }
  }, [importPath, report]);
  useEffect(() => {
    let disposed = false; let off: (() => void) | undefined; onDrop(paths => void importPath(paths[0])).then(fn => {
      if (disposed)
        fn();
      else
        off = fn;
    }).catch(report); return () => { disposed = true; off?.(); };
  }, [importPath, report]);
  useEffect(() => {
    if (!video || playing)
      return;
    const ticket = ++revision.current;
    setBusy(true);
    void invoke<void>('invalidate_preview').catch(report);
    const timer = setTimeout(() => {
      invoke<Preview>('preview', { path: video.path, preset, timestamp, quality }).then(p => {
        if (ticket === revision.current)
          setPreview(p);
      }).catch(e => {
        if (ticket === revision.current && !message(e).includes('superseded'))
          report(e);
      }).finally(() => {
        if (ticket === revision.current)
          setBusy(false);
      });
    }, 220);
    return () => { clearTimeout(timer); ++revision.current; };
  }, [video, preset, timestamp, quality, refresh, playing, report]);
  useEffect(() => {
    if (!exporting)
      return;
    let disposed = false;
    const timer = setInterval(() => {
      invoke<Progress | null>('export_progress').then(p => {
        if (!disposed && p) {
          setProgress(p);
          if (p.phase === 'failed')
            setError(p.error);
        }
      }).catch(report);
    }, 450);
    return () => { disposed = true; clearInterval(timer); };
  }, [exporting, report]);
  const jump = useCallback((delta: number) => setTimestamp(t => clamp(t + delta, 0, Math.max(0, (video?.duration ?? 0) - 1 / (video?.fps ?? 30)))), [video]);
  const updatePlaybackTime = useCallback((value: number) => {
    const kept = segments.find(segment => value >= segment.start && value < segment.end);
    if (kept) { setTimestamp(value); return; }
    const next = segments.find(segment => segment.start > value);
    if (next) { setTimestamp(next.start); return next.start; }
    const end = segments.at(-1)?.end ?? value;
    setPlaying(false); setTimestamp(end); return end;
  }, [segments]);
  const chooseFolder = useCallback(async () => {
    try {
      const folder = await invoke<string | null>('pick_folder');
      if (folder)
        setOutputFolder(folder);
    }
    catch (e) {
      report(e);
    }
  }, [report]);
  const startExport = useCallback(async () => {
    if (!video || exporting || exportStarting)
      return;
    setExportStarting(true);
    setError(null);
    try {
      let folder = outputFolder;
      if (!folder) {
        folder = await invoke<string | null>('pick_folder') ?? '';
        if (!folder)
          return;
        setOutputFolder(folder);
      }
      const p = await invoke<Progress>('start_export', { path: video.path, preset, segments, options: { quality, fps, folder, filename: outputName } });
      setProgress(p);
    }
    catch (e) {
      report(e);
    }
    finally {
      setExportStarting(false);
    }
  }, [video, exporting, exportStarting, outputFolder, preset, segments, quality, fps, outputName, report]);
  useEffect(() => {
    function keyboard(e: KeyboardEvent) {
      const input = (e.target as HTMLElement).closest('input,textarea,select,[role=combobox],[contenteditable]'); if (e.key === 'Escape') {
        setModal(null);
        return;
      } if (input || modal)
        return; if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
          e.preventDefault();
          void importVideo();
        }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        void startExport();
      }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault(); if (e.shiftKey) redo(); else undo();
      }
      else if (e.code === 'Space' && proxyPath) { e.preventDefault(); setPlaying(p => !p); }
      else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        jump(e.shiftKey ? -1 : -1 / (video?.fps ?? 30));
      }
      else if (e.key === 'ArrowRight') {
        e.preventDefault();
        jump(e.shiftKey ? 1 : 1 / (video?.fps ?? 30));
      }
    } window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [importVideo, startExport, jump, video, modal, undo, redo, proxyPath]);
  function create() { const p = copyPreset(preset); setStore(s => ({ ...s, presets: [...s.presets, p], activePreset: p.id })); setRename(p.name); setModal('presets'); }
  function remove() {
    if (preset.id === 'classic')
      return; setStore(s => ({ ...s, presets: s.presets.filter(p => p.id !== preset.id), activePreset: 'classic', settings: { ...s.settings, defaultPreset: s.settings.defaultPreset === preset.id ? 'classic' : s.settings.defaultPreset } })); setRename('');
  }
  function select(id: string) { setStore(s => ({ ...s, activePreset: id })); setRename(allPresets.find(p => p.id === id)?.name ?? ''); }
  async function importPreset() {
    try {
      const p = await invoke<Preset | null>('import_preset');
      if (p) {
        setStore(s => ({ ...s, presets: [...s.presets, p], activePreset: p.id }));
        setRename(p.name);
        setNotice('Preset imported');
      }
    }
    catch (e) {
      report(e);
    }
  }
  async function exportPreset() {
    try {
      if (await invoke<boolean>('export_preset', { preset }))
        setNotice('Preset exported');
    }
    catch (e) {
      report(e);
    }
  }
  function finishSetup(custom = false) { setStore(s => { const p = custom ? copyPreset(classic, 'My RL Short') : null; return { ...s, setupComplete: true, activePreset: p?.id ?? 'classic', presets: p ? [...s.presets, p] : s.presets, settings: { ...s.settings, defaultPreset: p?.id ?? 'classic' } }; }); }
  const b = preset.boost;
  if (!ready)
    return <div className="boot">
      <img className="boot-logo" src="/branding/logo.png" alt="rlcut" />
      <span>Opening rlcut…</span>
    </div>;
  return <div className={`app-shell ${video ? '' : 'no-video'}`} onPointerDownCapture={e => { const target = e.target as HTMLElement; if (target.closest('.preview-stage') && !target.closest('.composition')) setLayer(null); }}>
    <aside className="sidebar">
      <div className="brand">
        <img className="brand-logo" src="/branding/logo.png" alt="rlcut" />
        <small>DESKTOP</small>
      </div>
      <button className="import-button" onClick={() => void importVideo()} disabled={importing}>
        {importing ? <LoaderCircle className="spin" size={17} /> : <Plus size={18} />}Import video<kbd>⌘ O</kbd>
      </button>
      <div className="nav-label presets-label">YOUR PRESETS<button aria-label="Create preset" title="Copy current preset" onClick={create}>
        <Plus size={15} />
      </button>
      </div>
      <div className="preset-list">
        {allPresets.map(p => <button className={`preset-item ${p.id === preset.id ? 'selected' : ''}`} key={p.id} onClick={() => select(p.id)}>
          <LayoutTemplate size={16} />
          <span>
            {p.name}{p.id === 'classic' && <small>BUILT-IN</small>}
          </span>
          {p.id === preset.id && <span className="selection-dot" />}
        </button>)}
      </div>
      <button className="subtle-button" onClick={create}>
        <Plus size={15} />Create preset</button>
      <button className="subtle-button" onClick={() => { setRename(preset.name); setModal('presets'); }}>
        <Layers3 size={15} />Manage presets</button>
      <div className="sidebar-bottom">
        <button className="nav-item" onClick={() => setModal('settings')}>
          <Settings2 size={17} />Settings<span className="version">v0.1</span>
        </button>
      </div>
    </aside>
    <main className="workspace">
      {!isDesktop() && <div className="runtime-notice">Desktop UI preview · Run <code>npm run desktop</code> for file import, FFmpeg previews, and export.</div>}{init && (!init.binaries.ffmpeg || !init.binaries.ffprobe) && <div className="runtime-notice warning">Video processing is unavailable. Reinstall the complete app package and restart rlcut.<button onClick={() => setModal('settings')}>Settings</button>
      </div>}
      {video && <div className="preview-toolbar">
        <div className="breadcrumb">
          <Film size={15} />
          <span title={video?.path}>
            {video ? filename(video.path) : 'No video selected'}
          </span>
          {video && <small>
            {video.width} × {video.height} · {video.fps.toFixed(2)} fps · {video.hasAudio ? 'Audio' : 'No audio'}
          </small>}
        </div>
        <div className="toolbar-actions">
          <button className={before ? 'active' : ''} onClick={() => setBefore(!before)} disabled={!preview} title="Before / after">
            <Eye size={15} />
            {before ? 'Source' : 'Before / after'}
          </button>
          <button className={guides ? 'active' : ''} onClick={() => setGuides(!guides)} title="Toggle layer boundaries" aria-label="Toggle layer boundaries">
            <Maximize2 size={15} />
          </button>
        </div>
      </div>}
      <Composition video={video} playbackPath={proxyPath} proxyPreparing={Boolean(video && !proxyPath)} preview={preview} preset={preset} before={before} guides={guides} layer={layer} setLayer={setLayer} change={change} busy={busy} importVideo={() => void importVideo()} quality={quality} playing={playing} timestamp={timestamp} onTimestamp={updatePlaybackTime} onPlayingChange={setPlaying} />
      {video && <Timeline duration={video.duration} timestamp={timestamp} segments={segments} playing={playing} playbackReady={Boolean(proxyPath)} canUndo={undoStack.current.length > 0} canRedo={redoStack.current.length > 0} onSeek={value => { setPlaying(false); setTimestamp(clamp(value, 0, video.duration)); }} onPlay={() => setPlaying(p => !p)} onUndo={undo} onRedo={redo}
        onSplit={() => { const active = segments.find(s => timestamp > s.start + .05 && timestamp < s.end - .05); if (active) editSegments(segments.flatMap(s => s.id === active.id ? [{ ...s, end: timestamp }, { id: crypto.randomUUID(), start: timestamp, end: s.end }] : [s])); }}
        onTrimLeft={() => { const active = segments.find(s => timestamp >= s.start && timestamp <= s.end); if (active && timestamp < active.end - .05) editSegments(segments.map(s => s.id === active.id ? { ...s, start: timestamp } : s)); }}
        onTrimRight={() => { const active = segments.find(s => timestamp >= s.start && timestamp <= s.end); if (active && timestamp > active.start + .05) editSegments(segments.map(s => s.id === active.id ? { ...s, end: timestamp } : s)); }}
        onDelete={() => { const active = segments.find(s => timestamp >= s.start && timestamp <= s.end); if (active && segments.length > 1) { const next = segments.filter(s => s.id !== active.id); editSegments(next); setTimestamp(next[0].start); } }} />}
      {video && <footer className="workspace-footer">
        <span>
          <span className="status-dot" />Offline by design</span>
        <span>H.264 video · AAC audio</span>
      </footer>}
    </main>
    {video && <aside className="inspector">
      <div className="inspector-heading">
        <span className="eyebrow">TEMPLATE SETTINGS</span>
        <h2>
          {preset.name}
        </h2>
        <span className="save-status">
          {preset.id === 'classic' ? <>
            <ShieldCheck size={12} />Built-in · edits create a copy</> : <>
            <Check size={12} />
            {saved ? 'All changes saved' : 'Saving changes…'}
          </>}
        </span>
      </div>
      <div className="inspector-scroll">
        {!layer && <div className="selection-empty"><SlidersHorizontal size={22} /><strong>Select a layer</strong><span>Click the background, gameplay, or boost element in the preview to edit it.</span></div>}
        {layer === 'background' && <Section title="Background" icon={<Layers3 size={16} />} reset={() => reset('background')}>
          <Slider label="Blur" value={preset.background.blur} max={100} step={1} onChange={blur => edit('background', { blur })} />
          <Slider label="Scale" value={preset.background.scale} min={1} max={2} onChange={scale => edit('background', { scale })} suffix="×" />
          <div className="two-controls">
            <Slider label="X offset" value={preset.background.x - .5} min={-.5} max={.5} onChange={x => edit('background', { x: x + .5 })} />
            <Slider label="Y offset" value={preset.background.y - .5} min={-.5} max={.5} onChange={y => edit('background', { y: y + .5 })} />
          </div>
          <Alignment width={0} height={0} onChange={(x, y) => edit('background', { x, y })} />
          <Slider label="Brightness" value={preset.background.brightness} min={-.5} max={.5} onChange={brightness => edit('background', { brightness })} />
        </Section>}
        {layer === 'gameplay' && <Section title="Gameplay" icon={<Film size={16} />} reset={() => reset('gameplay')}>
          <Slider label="Gameplay scale" value={preset.gameplay.scale} min={.2} max={4} onChange={scale => edit('gameplay', { scale })} suffix="×" />
          <div className="two-controls">
            <Slider label="X position" value={preset.gameplay.x - .5} min={-.5} max={.5} onChange={x => edit('gameplay', { x: x + .5 })} />
            <Slider label="Y position" value={preset.gameplay.y - .5} min={-.5} max={.5} onChange={y => edit('gameplay', { y: y + .5 })} />
          </div>
          <Alignment width={preset.gameplay.scale} height={preset.gameplay.scale * (video ? video.height / video.width : 9 / 16) * (quality === 480 ? 480 / 854 : 9 / 16)} onChange={(x, y) => edit('gameplay', { x, y })} />
          <button className="text-button" onClick={() => { edit('gameplay', { x: .5, y: .5 }); setLayer('gameplay'); }}>Center gameplay</button>
          <p className="help-text">Full frame at 1×. Aspect ratio always preserved.</p>
        </Section>}
        {layer === 'boost' && <Section title="Boost HUD" icon={<Gauge size={16} />} reset={() => reset('boost')}>
          <div className="row">
            <label htmlFor="boost-enabled">Show boost cutout</label>
            <input id="boost-enabled" className="switch" type="checkbox" checked={b.enabled} onChange={e => edit('boost', { enabled: e.target.checked })} />
          </div>
          <button className="crop-button" disabled={!preview} onClick={() => { setLayer('boost'); setModal('crop'); }}>
            <Maximize2 size={15} />Select boost area<span>↗</span>
          </button>
          <div className="segmented">
            <button className={b.shape === 'circle' ? 'active' : ''} onClick={() => edit('boost', { shape: 'circle' })}>
              <Circle size={12} />Circle</button>
            <button className={b.shape === 'ellipse' ? 'active' : ''} onClick={() => edit('boost', { shape: 'ellipse' })}>
              <Circle size={12} style={{ transform: 'scaleX(1.3)' }} />Ellipse</button>
          </div>
          <Slider label="Boost scale" value={b.scale} min={.25} max={4} onChange={scale => edit('boost', { scale })} suffix="×" />
          <div className="two-controls">
            <Slider label="Width" value={b.width} min={.01} max={1} step={.001} onChange={width => edit('boost', { width })} />
            <Slider label="Height" value={b.height} min={.005} max={1} step={.001} onChange={height => edit('boost', { height })} />
            <Slider label="X position" value={b.x - .5} min={-.5} max={.5} onChange={x => edit('boost', { x: x + .5 })} />
            <Slider label="Y position" value={b.y - .5} min={-.5} max={.5} onChange={y => edit('boost', { y: y + .5 })} />
          </div>
          <Alignment width={b.width * b.scale} height={b.height * b.scale} onChange={(x, y) => edit('boost', { x, y })} />
          <Slider label="Edge feather" value={b.feather} max={.25} step={.005} onChange={feather => edit('boost', { feather })} />
          <details className="crop-numbers">
            <summary>Source crop coordinates</summary>
            <div className="two-controls">
              <Slider label="Crop X" value={b.crop.x} max={1 - b.crop.width} step={.001} onChange={x => edit('boost', { crop: { ...b.crop, x } })} />
              <Slider label="Crop Y" value={b.crop.y} max={1 - b.crop.height} step={.001} onChange={y => edit('boost', { crop: { ...b.crop, y } })} />
              <Slider label="Crop width" value={b.crop.width} min={.001} max={1 - b.crop.x} step={.001} onChange={width => edit('boost', { crop: { ...b.crop, width } })} />
              <Slider label="Crop height" value={b.crop.height} min={.001} max={1 - b.crop.y} step={.001} onChange={height => edit('boost', { crop: { ...b.crop, height } })} />
            </div>
          </details>
          <p className="help-text">Width / height are canvas fractions. Scale multiplies both. Circle masks use the smaller dimension.</p>
        </Section>}
        <Section title="Export" icon={<Download size={16} />}>
          <div className="two-controls">
            <label className="field">Resolution<Dropdown label="Resolution" value={quality} onChange={value => setQuality(Number(value))} options={[{ value: 480, label: '480p · 480 × 854' }, { value: 720, label: '720p · 720 × 1280' }, { value: 1080, label: '1080p · 1080 × 1920' }]} />
            </label>
            <label className="field">Frame rate<Dropdown label="Frame rate" value={fps} onChange={value => setFps(Number(value))} options={[{ value: 30, label: '30 FPS' }, { value: 60, label: '60 FPS' }]} />
            </label>
          </div>
          <label className="field">Output filename<input value={outputName} onChange={e => setOutputName(e.target.value)} placeholder="rlcut-short.mp4" />
          </label>
          <label className="field">Destination folder<div className="folder-picker">
            <input value={outputFolder} onChange={e => setOutputFolder(e.target.value)} placeholder="Choose a folder…" />
            <button aria-label="Choose export folder" onClick={() => void chooseFolder()}>
              <FolderOpen size={16} />
            </button>
          </div>
          </label>
          <p className="help-text">MP4 · H.264 · {video?.hasAudio ? 'Original audio → AAC' : 'AAC when audio is present'}{quality === 480 ? ' · 480p uses approximate 9:16 dimensions.' : ''}
          </p>
        </Section>
      </div>
      <div className="export-bottom">
        {progress && <div className={`export-progress ${progress.phase}`}>
          <div className="row">
            <strong>
              {progress.phase === 'running' ? `Exporting · ${progress.percent.toFixed(0)}%` : progress.phase === 'complete' ? 'Your clip is ready' : progress.phase === 'canceled' ? 'Export canceled' : 'Export failed'}
            </strong>
            {progress.phase === 'running' ? <button aria-label="Cancel export" onClick={() => void invoke('cancel_export').catch(report)}>
              <X size={16} />
            </button> : <CheckCircle2 size={16} />}
          </div>
          <progress max="100" value={progress.percent} />
          <small>
            {duration(progress.elapsed)} elapsed{progress.remaining != null ? ` · ${duration(progress.remaining)} remaining` : ''}
          </small>
          {progress.phase === 'complete' && <div className="row">
            <button onClick={() => void invoke('open_export', { folder: false }).catch(report)}>Open file</button>
            <button onClick={() => void invoke('open_export', { folder: true }).catch(report)}>Open folder</button>
          </div>}
        </div>}<button className="primary export-button" disabled={!video || exporting || exportStarting} onClick={() => void startExport()}>
          {exportStarting ? <LoaderCircle size={18} className="spin" /> : <ArrowDownToLine size={18} />}Export clip<kbd>⌘ E</kbd>
        </button>
        <small>No watermark. Just your gameplay.</small>
      </div>
    </aside>}
    {error && <div className="toast error" role="alert">
      <div>
        <strong>Something needs your attention</strong>
        <p>
          {error}
        </p>
      </div>
      <button aria-label="Dismiss error" onClick={() => setError(null)}>
        <X size={16} />
      </button>
    </div>}{notice && <div className="toast success" role="status">
      <CheckCircle2 size={18} />
      {notice}
    </div>}
    {!store.setupComplete && <div className="modal-backdrop">
      <div className="modal welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        <img className="welcome-logo" src="/branding/logo.png" alt="rlcut" />
        <span className="eyebrow">WELCOME TO RLCUT</span>
        <h2 id="welcome-title">Big plays.<br />
          <span>Perfectly framed.</span>
        </h2>
        <p>Turn your Rocket League recordings into vertical clips with a blurred backdrop, sharp gameplay, and a live boost HUD.</p>
        <div className="welcome-options">
          <button onClick={() => finishSetup(false)}>
            <LayoutTemplate size={23} />
            <strong>Use Default Preset</strong>
            <span>Start with Classic RL Short.</span>
            <ArrowRight size={17} />
          </button>
          <button onClick={() => finishSetup(true)}>
            <SlidersHorizontal size={23} />
            <strong>Create Custom Preset</strong>
            <span>Make a copy and fine-tune your style.</span>
            <ArrowRight size={17} />
          </button>
        </div>
        <small>
          <ShieldCheck size={14} />Offline. No accounts. Your files stay on your device.</small>
      </div>
    </div>}
    {modal === 'crop' && preview && <CropEditor aspect={(video?.width ?? 16) / (video?.height ?? 9)} source={preview.source} preset={preset} onCancel={() => setModal(null)} onApply={boost => { edit('boost', boost); setBefore(false); setModal(null); }} />}
    {(modal === 'presets' || modal === 'settings') && <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-heading">
          <div>
            <span className="eyebrow">YOUR WORKSPACE</span>
            <h2 id="modal-title">
              {modal === 'presets' ? 'Manage presets' : 'Settings'}
            </h2>
          </div>
          <button aria-label="Close dialog" onClick={() => setModal(null)}>
            <X size={20} />
          </button>
        </div>
        {modal === 'presets' ? <>
          <label className="field">Selected preset<Dropdown label="Selected preset" value={preset.id} onChange={value => select(value)} options={allPresets.map(p => ({ value: p.id, label: p.name }))} />
          </label>
          <label className="field">Preset name<div className="folder-picker">
            <input value={rename} onChange={e => setRename(e.target.value)} disabled={preset.id === 'classic'} maxLength={100} />
            <button aria-label="Rename custom preset" disabled={preset.id === 'classic' || !rename.trim()} onClick={() => { setStore(s => ({ ...s, presets: s.presets.map(p => p.id === preset.id ? { ...p, name: rename.trim() } : p) })); setNotice('Preset renamed'); }}>
              <Pencil size={16} />
            </button>
          </div>
          </label>
          <p className="help-text">Built-in presets are immutable. Every new preset starts as a complete copy of the current selection.</p>
          <div className="modal-actions">
            <button onClick={create}>
              <Copy size={15} />Duplicate</button>
            <button disabled={preset.id === 'classic'} onClick={remove}>
              <Trash2 size={15} />Delete custom</button>
            <button onClick={() => select('classic')}>
              <LayoutTemplate size={15} />Restore default</button>
            <button onClick={() => void importPreset()}>
              <Upload size={15} />Import JSON</button>
            <button onClick={() => void exportPreset()}>
              <Download size={15} />Export JSON</button>
          </div>
        </> : <>
          <div className="two-controls">
            <label className="field">Default quality<Dropdown label="Default quality" value={store.settings.quality} onChange={value => setStore(s => ({ ...s, settings: { ...s.settings, quality: Number(value) } }))} options={[{ value: 480, label: '480p' }, { value: 720, label: '720p' }, { value: 1080, label: '1080p' }]} />
            </label>
            <label className="field">Default FPS<Dropdown label="Default FPS" value={store.settings.fps} onChange={value => setStore(s => ({ ...s, settings: { ...s.settings, fps: Number(value) } }))} options={[{ value: 30, label: '30 FPS' }, { value: 60, label: '60 FPS' }]} />
            </label>
          </div>
          <label className="field">Default preset<Dropdown label="Default preset" value={store.settings.defaultPreset} onChange={value => setStore(s => ({ ...s, settings: { ...s.settings, defaultPreset: value } }))} options={allPresets.map(p => ({ value: p.id, label: p.name }))} />
          </label>
          <div className="setting-toggle">
            <div><strong>Wait for smooth preview</strong><small>Keep import loading until the optimized playback proxy is ready.</small></div>
            <input className="switch" type="checkbox" aria-label="Wait for smooth preview" checked={store.settings.waitForPreview} onChange={e => setStore(s => ({ ...s, settings: { ...s.settings, waitForPreview: e.target.checked } }))} />
          </div>
          <label className="field">Default output folder<div className="folder-picker">
            <input value={store.settings.outputFolder} onChange={e => setStore(s => ({ ...s, settings: { ...s.settings, outputFolder: e.target.value } }))} />
            <button aria-label="Choose default output folder" onClick={() => void invoke<string | null>('pick_folder').then(folder => {
              if (folder)
                setStore(s => ({ ...s, settings: { ...s.settings, outputFolder: folder } }));
            }).catch(report)}>
              <FolderOpen size={16} />
            </button>
          </div>
          </label>
          <div className="modal-actions">
            <button onClick={() => void invoke('clear_cache').then(() => { setRefresh(n => n + 1); setNotice('Preview cache cleared'); }).catch(report)}>
              <Trash2 size={15} />Clear preview cache</button>
            <button onClick={() => { setStore(s => ({ ...s, settings: structuredClone(initialStore.settings) })); setInit(data => data ? { ...data, storageError: null } : data); setNotice('App settings reset. Presets retained.'); }}>Reset settings</button>
            <button className="primary" onClick={() => { setQuality(store.settings.quality); setFps(store.settings.fps); setOutputFolder(store.settings.outputFolder); select(store.settings.defaultPreset); setModal(null); }}>Apply defaults</button>
          </div>
          <p className="help-text">Shortcuts: Ctrl / ⌘ O import · Ctrl / ⌘ E export · ← / → frame · Shift ← / → one second</p>
        </>}
      </div>
    </div>}
  </div>;
}
