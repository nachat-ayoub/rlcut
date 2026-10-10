import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, CheckCircle2, Circle, Copy, Download, Eye, Film, FolderOpen, Gauge, Layers3, LayoutTemplate, LoaderCircle, Maximize2, Pencil, Plus, Settings2, ShieldCheck, SkipBack, SkipForward, SlidersHorizontal, Trash2, Upload, X, Zap } from 'lucide-react';
import type { Init, Layer, Preset, Preview, Progress, Store, Video } from './types';
import { classic, clamp, copyPreset, filename, initialStore, time } from './lib/presets';
import { invoke, isDesktop, message, onDrop } from './lib/native';
import { Section, Slider } from './components/Controls';
import { Composition } from './components/Composition';
import { CropEditor } from './components/CropEditor';
type Modal = 'settings' | 'presets' | 'crop' | null;
export default function App() {
  const [store, setStore] = useState<Store>(initialStore), [ready, setReady] = useState(false), [init, setInit] = useState<Init | null>(null);
  const [video, setVideo] = useState<Video | null>(null), [preview, setPreview] = useState<Preview | null>(null), [timestamp, setTimestamp] = useState(0);
  const [busy, setBusy] = useState(false), [importing, setImporting] = useState(false), [before, setBefore] = useState(false), [guides, setGuides] = useState(true), [layer, setLayer] = useState<Layer>('boost');
  const [modal, setModal] = useState<Modal>(null), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null), [exportStarting, setExportStarting] = useState(false), [outputFolder, setOutputFolder] = useState(''), [outputName, setOutputName] = useState('rlcut-short.mp4');
  const [quality, setQuality] = useState(1080), [fps, setFps] = useState(60), [rename, setRename] = useState('');
  const [refresh, setRefresh] = useState(0), [saved, setSaved] = useState(true);
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
  const change = useCallback((next: Preset) => {
    setStore(s => {
      if (s.activePreset === 'classic') {
        const p = copyPreset(next, 'Classic RL Short — custom');
        return { ...s, activePreset: p.id, presets: [...s.presets, p] };
      }
      return { ...s, presets: s.presets.map(p => p.id === s.activePreset ? { ...next, id: p.id, name: p.name } : p) };
    });
  }, []);
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
      setPreview(null);
      setTimestamp(v.duration / 2);
      setBefore(false);
      setOutputName(`${filename(v.path).replace(/\.[^.]+$/, '')}-short.mp4`);
      setStore(s => ({ ...s, recentFiles: [v.path, ...s.recentFiles.filter(p => p !== v.path)].slice(0, 12) }));
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
    if (!video)
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
  }, [video, preset, timestamp, quality, refresh, report]);
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
      const p = await invoke<Progress>('start_export', { path: video.path, preset, options: { quality, fps, folder, filename: outputName } });
      setProgress(p);
    }
    catch (e) {
      report(e);
    }
    finally {
      setExportStarting(false);
    }
  }, [video, exporting, exportStarting, outputFolder, preset, quality, fps, outputName, report]);
  useEffect(() => {
    function keyboard(e: KeyboardEvent) {
      const input = (e.target as HTMLElement).closest('input,textarea,select,[contenteditable]'); if (e.key === 'Escape') {
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
      else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        jump(e.shiftKey ? -1 : -1 / (video?.fps ?? 30));
      }
      else if (e.key === 'ArrowRight') {
        e.preventDefault();
        jump(e.shiftKey ? 1 : 1 / (video?.fps ?? 30));
      }
    } window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [importVideo, startExport, jump, video, modal]);
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
      <Zap size={32} />
      <span>Opening rlcut…</span>
    </div>;
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">
          <Zap size={22} fill="currentColor" />
        </span>
        <span>rlcut<span className="brand-dot">.</span>
        </span>
        <small>DESKTOP</small>
      </div>
      <button className="import-button" onClick={() => void importVideo()} disabled={importing}>
        {importing ? <LoaderCircle className="spin" size={17} /> : <Plus size={18} />}Import video<kbd>⌘ O</kbd>
      </button>
      <div className="nav-label">WORKSPACE</div>
      <button className="nav-item active" onClick={() => setModal(null)}>
        <SlidersHorizontal size={17} />Composition</button>
      <div className="sidebar-divider" />
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
      {store.recentFiles.length > 0 && <>
        <div className="sidebar-divider" />
        <div className="nav-label">RECENT FILES</div>
        <div className="recent-list">
          {store.recentFiles.slice(0, 4).map(path => <button key={path} title={path} onClick={() => void importPath(path)}>
            <Film size={13} />
            <span>
              {filename(path)}
            </span>
          </button>)}
        </div>
      </>}<div className="sidebar-bottom">
        <div className="offline-note">
          <ShieldCheck size={15} />
          <span>Local files. All yours.<small>No uploads. No watermark.</small>
          </span>
        </div>
        <button className="nav-item" onClick={() => setModal('settings')}>
          <Settings2 size={17} />Settings<span className="version">v0.1</span>
        </button>
      </div>
    </aside>
    <main className="workspace">
      <header className="topbar">
        <div>
          <span className="eyebrow">ROCKET LEAGUE SHORTS</span>
          <h1>Make the play. Own the frame.</h1>
        </div>
        <div className="top-status">
          <span className="status-dot" />
          {video ? 'Video imported' : 'Ready to create'}
        </div>
      </header>
      {!isDesktop() && <div className="runtime-notice">Desktop UI preview · Run <code>npm run desktop</code> for file import, FFmpeg previews, and export.</div>}{init && (!init.binaries.ffmpeg || !init.binaries.ffprobe) && <div className="runtime-notice warning">FFmpeg / FFprobe missing. Install both or bundle them, then restart rlcut.<button onClick={() => setModal('settings')}>View settings</button>
      </div>}
      <div className="preview-toolbar">
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
      </div>
      <Composition video={video} preview={preview} preset={preset} before={before} guides={guides} layer={layer} setLayer={setLayer} change={change} busy={busy} importVideo={() => void importVideo()} quality={quality} />
      <div className="frame-controls">
        <div className="scrubber-label">
          <span>PREVIEW FRAME</span>
          <span>
            {time(timestamp)} <span className="muted">/ {time(video?.duration ?? 0)}
            </span>
          </span>
        </div>
        <input aria-label="Preview timestamp" type="range" min="0" max={Math.max(0, (video?.duration ?? 0) - 1 / (video?.fps ?? 30))} step={1 / (video?.fps ?? 30)} value={timestamp} disabled={!video} onChange={e => setTimestamp(Number(e.target.value))} />
        <div className="frame-buttons">
          <span className="frame-hint">
            {video ? 'Drag a layer to position · Use corner handle to resize' : 'A single-frame preview. A full-motion export.'}
          </span>
          <button aria-label="Back one second" disabled={!video} onClick={() => jump(-1)}>
            <SkipBack size={15} />
            <small>1s</small>
          </button>
          <button aria-label="Previous frame" disabled={!video} onClick={() => jump(-1 / (video?.fps ?? 30))}>
            <ArrowLeft size={15} />
          </button>
          <span className="frame-indicator">FRAME {Math.round(timestamp * (video?.fps ?? 0))}
          </span>
          <button aria-label="Next frame" disabled={!video} onClick={() => jump(1 / (video?.fps ?? 30))}>
            <ArrowRight size={15} />
          </button>
          <button aria-label="Forward one second" disabled={!video} onClick={() => jump(1)}>
            <small>1s</small>
            <SkipForward size={15} />
          </button>
        </div>
      </div>
      <footer className="workspace-footer">
        <span>
          <span className="status-dot" />Offline by design</span>
        <span>FFmpeg composition · H.264 / AAC</span>
      </footer>
    </main>
    <aside className="inspector">
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
        <Section title="Background" icon={<Layers3 size={16} />} reset={() => reset('background')}>
          <Slider label="Blur" value={preset.background.blur} max={100} step={1} onChange={blur => edit('background', { blur })} />
          <Slider label="Scale" value={preset.background.scale} min={1} max={2} onChange={scale => edit('background', { scale })} suffix="×" />
          <div className="two-controls">
            <Slider label="X offset" value={preset.background.x} onChange={x => edit('background', { x })} />
            <Slider label="Y offset" value={preset.background.y} onChange={y => edit('background', { y })} />
          </div>
          <Slider label="Brightness" value={preset.background.brightness} min={-.5} max={.5} onChange={brightness => edit('background', { brightness })} />
        </Section>
        <Section title="Gameplay" icon={<Film size={16} />} reset={() => reset('gameplay')}>
          <Slider label="Gameplay scale" value={preset.gameplay.scale} min={.2} max={4} onChange={scale => edit('gameplay', { scale })} suffix="×" />
          <div className="two-controls">
            <Slider label="X position" value={preset.gameplay.x} onChange={x => edit('gameplay', { x })} />
            <Slider label="Y position" value={preset.gameplay.y} onChange={y => edit('gameplay', { y })} />
          </div>
          <button className="text-button" onClick={() => { edit('gameplay', { x: .5, y: .5 }); setLayer('gameplay'); }}>Center gameplay</button>
          <p className="help-text">Full frame at 1×. Aspect ratio always preserved.</p>
        </Section>
        <Section title="Boost HUD" icon={<Gauge size={16} />} reset={() => reset('boost')}>
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
            <Slider label="X position" value={b.x} onChange={x => edit('boost', { x })} />
            <Slider label="Y position" value={b.y} onChange={y => edit('boost', { y })} />
          </div>
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
        </Section>
        <Section title="Export" icon={<Download size={16} />}>
          <div className="two-controls">
            <label className="field">Resolution<select value={quality} onChange={e => setQuality(Number(e.target.value))}>
              <option value={480}>480p · 480 × 854</option>
              <option value={720}>720p · 720 × 1280</option>
              <option value={1080}>1080p · 1080 × 1920</option>
            </select>
            </label>
            <label className="field">Frame rate<select value={fps} onChange={e => setFps(Number(e.target.value))}>
              <option value={30}>30 FPS</option>
              <option value={60}>60 FPS</option>
            </select>
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
            {time(progress.elapsed)} elapsed{progress.remaining != null ? ` · ${time(progress.remaining)} remaining` : ''}
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
    </aside>
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
        <span className="welcome-mark">
          <Zap size={30} fill="currentColor" />
        </span>
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
    {modal === 'crop' && preview && <CropEditor aspect={(video?.width ?? 16) / (video?.height ?? 9)} source={preview.source} preset={preset} onCancel={() => setModal(null)} onApply={crop => { edit('boost', { crop }); setBefore(false); setModal(null); }} />}
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
          <label className="field">Selected preset<select value={preset.id} onChange={e => select(e.target.value)}>
            {allPresets.map(p => <option key={p.id} value={p.id}>
              {p.name}
            </option>)}
          </select>
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
            <label className="field">Default quality<select value={store.settings.quality} onChange={e => setStore(s => ({ ...s, settings: { ...s.settings, quality: Number(e.target.value) } }))}>
              <option value={480}>480p</option>
              <option value={720}>720p</option>
              <option value={1080}>1080p</option>
            </select>
            </label>
            <label className="field">Default FPS<select value={store.settings.fps} onChange={e => setStore(s => ({ ...s, settings: { ...s.settings, fps: Number(e.target.value) } }))}>
              <option value={30}>30 FPS</option>
              <option value={60}>60 FPS</option>
            </select>
            </label>
          </div>
          <label className="field">Default preset<select value={store.settings.defaultPreset} onChange={e => setStore(s => ({ ...s, settings: { ...s.settings, defaultPreset: e.target.value } }))}>
            {allPresets.map(p => <option key={p.id} value={p.id}>
              {p.name}
            </option>)}
          </select>
          </label>
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
          <div className="binary-status">
            <strong>Video processing tools</strong>
            <p>FFmpeg: <code>
              {init?.binaries.ffmpeg ?? 'Not detected'}
            </code>
            </p>
            <p>FFprobe: <code>
              {init?.binaries.ffprobe ?? 'Not detected'}
            </code>
            </p>
            <small>Uses bundled binaries or PATH. Restart after installing tools.</small>
          </div>
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
