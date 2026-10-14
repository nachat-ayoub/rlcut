import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Check, CheckCircle2, Circle, Copy, Download, Eye, Film, FolderOpen, Gauge, Home, Layers3, LayoutTemplate, LoaderCircle, Maximize2, Minimize2, Music2, Palette, Pencil, Plus, Save, ScanLine, Settings2, ShieldCheck, SlidersHorizontal, Trash2, Upload, X } from 'lucide-react';
import type { Init, Layer, MusicFile, MusicTrack, Preset, Preview, Progress, Project, Segment, Store, TrackMarkers, Video } from './types';
import { classic, clamp, copyPreset, filename, initialStore, duration } from './lib/presets';
import { invoke, isDesktop, message, onDrop } from './lib/native';
import { Dropdown } from './components/Dropdown';
import { Section, Slider } from './components/Controls';
import { Composition } from './components/Composition';
import { Alignment } from './components/Alignment';
import { CropEditor } from './components/CropEditor';
import { Timeline } from './components/Timeline';
import { ProjectHome } from './components/ProjectHome';
import { editedToSource, sourceToEdited } from './lib/timeline';
type Modal = 'settings' | 'presets' | 'crop' | null;
const customPresetName = (presets: Preset[]) => {
  const names = new Set(presets.map(preset => preset.name));
  if (!names.has('Custom Preset')) return 'Custom Preset';
  let index = 1;
  while (names.has(`Custom Preset ${index}`)) index++;
  return `Custom Preset ${index}`;
};
const matchesHdr = (transfer?: string) => transfer === 'smpte2084' || transfer === 'arib-std-b67';
const normalizeMarkers = (value?: Partial<Record<'video' | 'music', number[] | number | null>>): TrackMarkers => ({
  video: Array.isArray(value?.video) ? value.video.filter(Number.isFinite) : Number.isFinite(value?.video) ? [value!.video as number] : [],
  music: Array.isArray(value?.music) ? value.music.filter(Number.isFinite) : Number.isFinite(value?.music) ? [value!.music as number] : [],
});
const migratePresetNames = (store: Store): Store => {
  const renamed: Preset[] = [];
  for (const preset of store.presets) {
    const legacy = preset.name === 'My RL Short' || preset.name === 'Classic RL Short — custom' || /^(Classic RL Short|My RL Short) copy(?: \d+)?$/.test(preset.name);
    renamed.push(legacy ? { ...preset, name: customPresetName(renamed) } : preset);
  }
  return { ...store, presets: renamed, projects: (store.projects ?? []).map(project => ({ ...project, markers: normalizeMarkers(project.markers as never), segments: project.segments.map(segment => ({ ...segment, volume: segment.volume ?? 1, colorFix: segment.colorFix ?? 0 })) })) };
};
export default function App() {
  const [store, setStore] = useState<Store>(initialStore), [ready, setReady] = useState(false), [init, setInit] = useState<Init | null>(null);
  const [video, setVideo] = useState<Video | null>(null), [preview, setPreview] = useState<Preview | null>(null), [timestamp, setTimestamp] = useState(0);
  const [videoSources, setVideoSources] = useState<Video[]>([]);
  const [proxyPath, setProxyPath] = useState('');
  const [sourceVersion, setSourceVersion] = useState(0);
  const [proxyPreparing, setProxyPreparing] = useState(false);
  const [preparation, setPreparation] = useState<{ percent: number; elapsed: number; remaining: number | null } | null>(null);
  const [importing, setImporting] = useState(false), [before, setBefore] = useState(false), [guides, setGuides] = useState(true), [layer, setLayer] = useState<Layer | null>('boost');
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [modal, setModal] = useState<Modal>(null), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null), [exportStarting, setExportStarting] = useState(false), [outputFolder, setOutputFolder] = useState(''), [outputName, setOutputName] = useState('rlcut-edit.mp4');
  const [quality, setQuality] = useState(1080), [fps, setFps] = useState(60), [rename, setRename] = useState('');
  const [saved, setSaved] = useState(true);
  const [segments, setSegments] = useState<Segment[]>([]), [playing, setPlaying] = useState(false);
  const [music, setMusic] = useState<MusicTrack | null>(null);
  const [markers, setMarkers] = useState<TrackMarkers>({ video: [], music: [] });
  const [home, setHome] = useState(true), [projectLoading, setProjectLoading] = useState(false), [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [selectedClip, setSelectedClip] = useState<{ track: 'video' | 'music'; id: string } | null>(null), [colorScope, setColorScope] = useState<'clip' | 'all'>('clip');
  const undoStack = useRef<Array<{ preset: Preset; segments: Segment[]; music: MusicTrack | null; markers: TrackMarkers }>>([]), redoStack = useRef<Array<{ preset: Preset; segments: Segment[]; music: MusicTrack | null; markers: TrackMarkers }>>([]);
  const playhead = useRef(0), lastTimeReport = useRef(0), manualSeekUntil = useRef(0);
  const lastPresetEdit = useRef(0);
  const initialized = useRef(false), importRevision = useRef(0), lastSaved = useRef(''), storeRef = useRef(store);
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
    invoke<Init>('initialize').then(data => { const migrated = migratePresetNames(data.store); setInit(data); setStore(migrated); lastSaved.current = JSON.stringify(data.store); setOutputFolder(migrated.settings.outputFolder); setQuality(migrated.settings.quality); setFps(migrated.settings.fps); setError(data.storageError); setReady(true); }).catch(e => { report(e); setReady(true); });
  }, [report]);
  useEffect(() => {
    if (!ready || !isDesktop() || !init || init.storageError)
      return;
    const json = JSON.stringify(store);
    if (json === lastSaved.current)
      return;
    setSaved(false);
    const timer = setTimeout(() => { invoke<void>('save_store', { store }).then(() => { lastSaved.current = json; setSaved(JSON.stringify(storeRef.current) === json); }).catch(report); }, 250);
    return () => clearTimeout(timer);
  }, [store, ready, init?.storageError, report]);
  useEffect(() => {
    if (!notice)
      return; const timer = setTimeout(() => setNotice(null), 4000); return () => clearTimeout(timer);
  }, [notice]);
  const replacePreset = useCallback((next: Preset) => {
    setStore(s => {
      if (s.activePreset === 'classic') {
        const p = copyPreset(next, customPresetName(s.presets));
        return { ...s, activePreset: p.id, presets: [...s.presets, p] };
      }
      return { ...s, presets: s.presets.map(p => p.id === s.activePreset ? { ...next, id: p.id, name: p.name } : p) };
    });
  }, []);
  const change = useCallback((next: Preset) => {
    const now = performance.now();
    if (!lastPresetEdit.current || now - lastPresetEdit.current > 350) {
      undoStack.current.push({ preset: structuredClone(preset), segments: structuredClone(segments), music: structuredClone(music), markers: structuredClone(markers) });
      if (undoStack.current.length > 100) undoStack.current.shift();
    }
    lastPresetEdit.current = now;
    redoStack.current = [];
    replacePreset(next);
  }, [preset, segments, music, markers, replacePreset]);
  const restoreSnapshot = useCallback((snapshot: { preset: Preset; segments: Segment[]; music: MusicTrack | null; markers: TrackMarkers }) => {
    lastPresetEdit.current = 0;
    replacePreset(snapshot.preset);
    setSegments(structuredClone(snapshot.segments));
    setMusic(structuredClone(snapshot.music));
    setMarkers(structuredClone(snapshot.markers));
    const value = editedToSource(snapshot.segments, sourceToEdited(snapshot.segments, playhead.current));
    playhead.current = value; setTimestamp(value); setPlaying(false);
  }, [replacePreset]);
  const undo = useCallback(() => {
    const snapshot = undoStack.current.pop(); if (!snapshot) return;
    redoStack.current.push({ preset: structuredClone(preset), segments: structuredClone(segments), music: structuredClone(music), markers: structuredClone(markers) });
    restoreSnapshot(snapshot);
  }, [preset, segments, music, markers, restoreSnapshot]);
  const redo = useCallback(() => {
    const snapshot = redoStack.current.pop(); if (!snapshot) return;
    undoStack.current.push({ preset: structuredClone(preset), segments: structuredClone(segments), music: structuredClone(music), markers: structuredClone(markers) });
    restoreSnapshot(snapshot);
  }, [preset, segments, music, markers, restoreSnapshot]);
  const editSegments = useCallback((next: Segment[], preservePlayback = false) => {
    lastPresetEdit.current = 0;
    undoStack.current.push({ preset: structuredClone(preset), segments: structuredClone(segments), music: structuredClone(music), markers: structuredClone(markers) });
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = []; setSegments(next);
    if (preservePlayback) return;
    const value = editedToSource(next, sourceToEdited(next, playhead.current));
    playhead.current = value; setTimestamp(value); setPlaying(false);
  }, [preset, segments, music, markers]);
  function edit<K extends 'background' | 'gameplay' | 'boost'>(key: K, values: Partial<Preset[K]>) { change({ ...preset, [key]: { ...preset[key], ...values } }); }
  function reset(key: 'background' | 'gameplay' | 'boost') { change({ ...preset, [key]: structuredClone(classic[key]) }); }
  const importPaths = useCallback(async (paths: string[]) => {
    if (!paths.length) return;
    setHome(false);
    const ticket = ++importRevision.current;
    setImporting(storeRef.current.settings.waitForPreview);
    setPreparation(null); setProxyPreparing(true); setPlaying(false); setError(null);
    try {
      const imported: Video[] = [];
      for (const path of paths) {
        imported.push(await invoke<Video>('import_video', { path }));
        if (ticket !== importRevision.current) return;
      }
      setPreparation({ percent: 0, elapsed: 0, remaining: null });
      const nextSources = [...videoSources, ...imported];
      const proxy = await invoke<string>('create_timeline_proxy', { paths: nextSources.map(source => source.path) });
      if (ticket !== importRevision.current) return;
      const sourceOffset = videoSources.reduce((sum, source) => sum + source.duration, 0);
      const addedDuration = imported.reduce((sum, source) => sum + source.duration, 0);
      const projectVideo = { ...nextSources[0], duration: sourceOffset + addedDuration, hasAudio: nextSources.some(source => source.hasAudio) };
      // Commit sources only after the new cached reel is ready. Failed appends
      // leave the current project and decoder untouched.
      setPlaying(false); setVideoSources(nextSources); setVideo(projectVideo); setProxyPath(proxy); setSourceVersion(version => version + 1);
      if (videoSources.length) {
        undoStack.current.push({ preset: structuredClone(preset), segments: structuredClone(segments), music: structuredClone(music), markers: structuredClone(markers) });
        if (undoStack.current.length > 100) undoStack.current.shift();
        redoStack.current = []; lastPresetEdit.current = 0;
        let offset = sourceOffset;
        const appended = imported.map(source => {
          const segment = { id: crypto.randomUUID(), start: offset, end: offset + source.duration, volume: segments[0]?.volume ?? 1, colorFix: 0 };
          offset += source.duration;
          return segment;
        });
        setSegments(current => [...current, ...appended]);
      } else {
        let offset = 0;
        const initial = imported.map(source => {
          const segment = { id: crypto.randomUUID(), start: offset, end: offset + source.duration, volume: 1, colorFix: 0 };
          offset += source.duration;
          return segment;
        });
        setSegments(initial); setSelectedClip({ track: 'video', id: initial[0].id });
        setMusic(null); setMarkers({ video: [], music: [] });
        undoStack.current = []; redoStack.current = []; lastPresetEdit.current = 0;
        playhead.current = 0; setTimestamp(0); setBefore(false);
        setOutputName(`${filename(imported[0].path).replace(/\.[^.]+$/, '')}-edit.mp4`);
      }
      setPreview(null);
      setStore(s => ({ ...s, recentFiles: [...paths, ...s.recentFiles.filter(p => !paths.includes(p))].slice(0, 12) }));
    } catch (e) {
      if (ticket === importRevision.current && !message(e).includes('superseded')) report(e);
    } finally {
      if (ticket === importRevision.current) { setImporting(false); setProxyPreparing(false); }
    }
  }, [report, videoSources, preset, segments, music, markers]);
  useEffect(() => {
    if (!proxyPreparing || !preparation) return;
    let disposed = false;
    const timer = setInterval(() => { invoke<typeof preparation>('preparation_progress').then(value => { if (!disposed) setPreparation(value); }).catch(() => { }); }, 250);
    return () => { disposed = true; clearInterval(timer); };
  }, [proxyPreparing, Boolean(preparation)]);
  const importVideo = useCallback(async () => {
    try {
      const paths = await invoke<string[]>('pick_video');
      await importPaths(paths);
    }
    catch (e) {
      report(e);
    }
  }, [importPaths, report]);
  const importMusic = useCallback(async () => {
    try {
      const selected = await invoke<MusicFile | null>('pick_music');
      if (selected) {
        undoStack.current.push({ preset: structuredClone(preset), segments: structuredClone(segments), music: structuredClone(music), markers: structuredClone(markers) });
        if (undoStack.current.length > 100) undoStack.current.shift();
        lastPresetEdit.current = 0;
        redoStack.current = [];
        const id = crypto.randomUUID(); setMusic({ ...selected, segments: [{ id, start: 0, end: selected.duration, volume: 1, colorFix: 0 }] }); setSelectedClip({ track: 'music', id });
        setMarkers(current => ({ ...current, music: [] }));
        setPlaying(false);
      }
    }
    catch (e) {
      report(e);
    }
  }, [report, preset, segments, music, markers]);
  useEffect(() => {
    let disposed = false; let off: (() => void) | undefined; onDrop(paths => void importPaths(paths)).then(fn => {
      if (disposed)
        fn();
      else
        off = fn;
    }).catch(report); return () => { disposed = true; off?.(); };
  }, [importPaths, report]);
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
  const jump = useCallback((delta: number) => {
    const value = editedToSource(segments, sourceToEdited(segments, playhead.current) + delta);
    playhead.current = value; setPlaying(false); setTimestamp(value);
  }, [segments]);
  const togglePlayback = useCallback(() => {
    if (!proxyPath) return;
    if (!playing && segments.length && playhead.current >= segments[segments.length - 1].end - .04) playhead.current = segments[0].start;
    setTimestamp(playhead.current); setPlaying(value => !value);
  }, [proxyPath, playing, segments]);
  const updatePlaybackTime = useCallback((value: number) => {
    if (performance.now() < manualSeekUntil.current) return playhead.current;
    playhead.current = value;
    const kept = segments.find(segment => value >= segment.start && value < segment.end);
    if (kept) {
      // The display loop remains frame-paced; update the React controls at
      // 12 Hz instead of rebuilding the entire editor for every decoded frame.
      const now = performance.now();
      if (now - lastTimeReport.current >= 80) { lastTimeReport.current = now; setTimestamp(value); }
      return;
    }
    if (playing) return;
    const next = segments.find(segment => segment.start > value);
    if (next) { playhead.current = next.start; setTimestamp(next.start); return next.start; }
    const end = segments.at(-1)?.end ?? value;
    playhead.current = end; setPlaying(false); setTimestamp(end); return end;
  }, [segments, playing]);
  const updatePlaying = useCallback((value: boolean) => { if (!value) setTimestamp(playhead.current); setPlaying(value); }, []);
  const rememberOutputFolder = useCallback((folder: string) => {
    setOutputFolder(folder);
    setStore(current => ({ ...current, settings: { ...current.settings, outputFolder: folder } }));
  }, []);
  const chooseFolder = useCallback(async () => {
    try {
      const folder = await invoke<string | null>('pick_folder');
      if (folder)
        rememberOutputFolder(folder);
    }
    catch (e) {
      report(e);
    }
  }, [report, rememberOutputFolder]);
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
        rememberOutputFolder(folder);
      }
      const p = await invoke<Progress>('start_export', { paths: videoSources.map(source => source.path), preset, segments, music, musicFadeOut: music && store.settings.musicFadeOut ? store.settings.musicFadeDuration : null, options: { quality, fps, folder, filename: outputName } });
      setProgress(p);
    }
    catch (e) {
      report(e);
    }
    finally {
      setExportStarting(false);
    }
  }, [video, videoSources, exporting, exportStarting, outputFolder, preset, segments, quality, fps, outputName, music, store.settings.musicFadeOut, store.settings.musicFadeDuration, report, rememberOutputFolder]);
  useEffect(() => {
    function keyboard(e: KeyboardEvent) {
      const input = (e.target as HTMLElement).closest('input,textarea,select,[role=combobox],[contenteditable]'); if (e.key === 'Escape') {
        if (modal) { setModal(null); if (!video) setHome(true); } else setPreviewExpanded(false);
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
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault(); saveCurrentProject();
      }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault(); if (e.shiftKey) redo(); else undo();
      }
      else if (e.code === 'Space' && proxyPath) { e.preventDefault(); togglePlayback(); }
      else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        jump(e.shiftKey ? -1 : -1 / (video?.fps ?? 30));
      }
      else if (e.key === 'ArrowRight') {
        e.preventDefault();
        jump(e.shiftKey ? 1 : 1 / (video?.fps ?? 30));
      }
    } window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [importVideo, startExport, jump, video, modal, undo, redo, proxyPath, togglePlayback]);
  function create() { const p = copyPreset(preset, customPresetName(store.presets)); setStore(s => ({ ...s, presets: [...s.presets, p], activePreset: p.id })); setRename(p.name); setModal('presets'); }
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
  function finishSetup(custom = false) { setStore(s => { const p = custom ? copyPreset(classic, customPresetName(s.presets)) : null; return { ...s, setupComplete: true, activePreset: p?.id ?? 'classic', presets: p ? [...s.presets, p] : s.presets, settings: { ...s.settings, defaultPreset: p?.id ?? 'classic' } }; }); }
  function resetProject() {
    importRevision.current++; setPlaying(false); setVideo(null); setVideoSources([]); setProxyPath(''); setPreview(null); setSegments([]); setMusic(null); setMarkers({ video: [], music: [] }); setSelectedClip(null); setCurrentProjectId(null); setProgress(null); setPreparation(null); setProxyPreparing(false); setTimestamp(0); playhead.current = 0; undoStack.current = []; redoStack.current = [];
  }
  function projectSnapshot(id: string, name: string, createdAt: number): Project {
    return { version: 1, id, name, createdAt, updatedAt: Date.now(), videoPaths: videoSources.map(source => source.path), segments: structuredClone(segments), music: structuredClone(music), markers: structuredClone(markers), preset: structuredClone(preset), quality, fps, outputFolder, outputName };
  }
  function saveCurrentProject(showNotice = true) {
    if (!video || !videoSources.length) return;
    const existing = storeRef.current.projects.find(project => project.id === currentProjectId);
    const id = existing?.id ?? crypto.randomUUID(), createdAt = existing?.createdAt ?? Date.now();
    const name = existing?.name ?? (filename(videoSources[0].path).replace(/\.[^.]+$/, '') || 'Untitled project');
    const project = projectSnapshot(id, name, createdAt);
    setCurrentProjectId(id);
    setStore(current => ({ ...current, projects: [...current.projects.filter(item => item.id !== id), project] }));
    if (showNotice) setNotice(existing ? 'Project saved' : 'Project added to your library');
  }
  useEffect(() => {
    if (!video || !videoSources.length || proxyPreparing) return;
    if (!currentProjectId) { saveCurrentProject(false); return; }
    const timer = setTimeout(() => saveCurrentProject(false), 650);
    return () => clearTimeout(timer);
    // Project edits are saved after a short idle period.
  }, [currentProjectId, video, videoSources, segments, music, markers, preset, quality, fps, outputFolder, outputName, proxyPreparing]);
  async function openProject(project: Project) {
    if (!project.videoPaths.length) { setError('This project has no video files.'); return; }
    const ticket = ++importRevision.current; setProjectLoading(true); setError(null); setPlaying(false);
    try {
      const sources: Video[] = [];
      for (const path of project.videoPaths) sources.push(await invoke<Video>('import_video', { path }));
      if (ticket !== importRevision.current) return;
      const proxy = await invoke<string>('create_timeline_proxy', { paths: project.videoPaths });
      if (ticket !== importRevision.current) return;
      const total = sources.reduce((sum, source) => sum + source.duration, 0);
      const restoredSegments = project.segments.map(segment => ({ ...segment, id: segment.id || crypto.randomUUID(), volume: segment.volume ?? 1, colorFix: segment.colorFix ?? 0 }));
      const projectPreset = project.preset.id === 'classic' ? classic : { ...project.preset, id: `project-${project.id}` };
      setStore(current => ({ ...current, activePreset: projectPreset.id, presets: projectPreset.id === 'classic' ? current.presets : [...current.presets.filter(item => item.id !== projectPreset.id), projectPreset] }));
      setVideoSources(sources); setVideo({ ...sources[0], duration: total, hasAudio: sources.some(source => source.hasAudio) }); setProxyPath(proxy); setSourceVersion(version => version + 1); setSegments(restoredSegments); setMusic(project.music ? { ...project.music, segments: project.music.segments.map(segment => ({ ...segment, id: segment.id || crypto.randomUUID(), colorFix: 0 })) } : null); setMarkers(normalizeMarkers(project.markers as never)); setQuality(project.quality); setFps(project.fps); setOutputFolder(project.outputFolder); setOutputName(project.outputName); setCurrentProjectId(project.id); setSelectedClip(restoredSegments[0] ? { track: 'video', id: restoredSegments[0].id } : null); setTimestamp(restoredSegments[0]?.start ?? 0); playhead.current = restoredSegments[0]?.start ?? 0; setHome(false); setPreview(null); undoStack.current = []; redoStack.current = [];
    } catch (error) { if (ticket === importRevision.current) report(error); }
    finally { if (ticket === importRevision.current) setProjectLoading(false); }
  }
  async function importProjectFile() {
    try {
      const imported = await invoke<Project | null>('import_project'); if (!imported) return;
      const project = { ...imported, id: crypto.randomUUID(), name: store.projects.some(item => item.name === imported.name) ? `${imported.name} (Imported)` : imported.name, createdAt: Date.now(), updatedAt: Date.now() };
      setStore(current => ({ ...current, projects: [...current.projects, project] }));
      await openProject(project);
    } catch (error) { report(error); }
  }
  async function exportProjectFile(project: Project) { try { if (await invoke<boolean>('export_project', { project })) setNotice('Project file exported'); } catch (error) { report(error); } }
  const b = preset.boost;
  const selectedVideoSegment = selectedClip?.track === 'video' ? segments.find(segment => segment.id === selectedClip.id) ?? null : null;
  const colorFixValue = colorScope === 'all' ? (segments.every(segment => Math.abs(segment.colorFix - (segments[0]?.colorFix ?? 0)) < .001) ? segments[0]?.colorFix ?? 0 : selectedVideoSegment?.colorFix ?? 0) : selectedVideoSegment?.colorFix ?? 0;
  const setColorFix = (value: number) => {
    if (!selectedVideoSegment) return;
    editSegments(segments.map(segment => colorScope === 'all' || segment.id === selectedVideoSegment.id ? { ...segment, colorFix: value } : segment), true);
  };
  let selectedSource: Video | null = null, sourceOffset = 0;
  if (selectedVideoSegment) for (const source of videoSources) { if (selectedVideoSegment.start >= sourceOffset && selectedVideoSegment.start < sourceOffset + source.duration) { selectedSource = source; break; } sourceOffset += source.duration; }
  if (!ready)
    return <div className="boot">
      <img className="boot-logo" src="/branding/logo.png" alt="rlcut" />
      <span>Opening rlcut…</span>
    </div>;
  if (store.setupComplete && home) return <ProjectHome projects={store.projects} busy={projectLoading} alert={error ?? notice} onDismissAlert={() => { setError(null); setNotice(null); }} onNew={() => { resetProject(); setHome(false); }} onOpen={project => void openProject(project)} onImport={() => void importProjectFile()} onExport={project => void exportProjectFile(project)} onDelete={project => {
    if (!window.confirm(`Delete “${project.name}”? The source videos will not be deleted.`)) return;
    setStore(current => ({ ...current, projects: current.projects.filter(item => item.id !== project.id) }));
    if (currentProjectId === project.id) resetProject();
  }} onSettings={() => { setHome(false); setModal('settings'); }} />;
  return <div className={`app-shell ${video ? '' : 'no-video'} ${previewExpanded ? 'preview-expanded' : ''}`} onPointerDownCapture={e => { const target = e.target as HTMLElement; if (target.closest('.preview-stage') && !target.closest('.composition')) setLayer(null); }}>
    <aside className="sidebar">
      <div className="brand">
        <img className="brand-logo" src="/branding/logo.png" alt="rlcut" />
        <small>DESKTOP</small>
      </div>
      <button className="nav-item home-button" onClick={() => { setPlaying(false); setHome(true); }}><Home size={17} />Projects</button>
      <button className="import-button" onClick={() => void importVideo()} disabled={importing}>
        {importing ? <LoaderCircle className="spin" size={17} /> : <Plus size={18} />}{video ? 'Add video' : 'Import video'}<kbd>⌘ O</kbd>
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
      {!isDesktop() && <div className="runtime-notice">Desktop UI preview · Run <code>npm run desktop</code> for file import, live composition previews, and export.</div>}{init && (!init.binaries.ffmpeg || !init.binaries.ffprobe) && <div className="runtime-notice warning">Video processing is unavailable. Reinstall the complete app package and restart rlcut.<button onClick={() => setModal('settings')}>Settings</button>
      </div>}
      {video && <div className="preview-toolbar">
        <div className="breadcrumb">
          <Film size={15} />
          <span title={video?.path}>
            {video ? filename(video.path) : 'No video selected'}
          </span>
          {video && <small>
            {videoSources.length} {videoSources.length === 1 ? 'clip' : 'clips'} · {video.width} × {video.height} · {video.fps.toFixed(2)} fps · {video.hasAudio ? 'Audio' : 'No audio'}
          </small>}
        </div>
        <div className="toolbar-actions">
          <button onClick={() => saveCurrentProject()} title="Save project (Ctrl+S)"><Save size={15} />Save</button>
          <button className={before ? 'active' : ''} onClick={() => setBefore(!before)} disabled={!preview} title="Before / after">
            <Eye size={15} />
            {before ? 'Source' : 'Before / after'}
          </button>
          <button className={guides ? 'active' : ''} onClick={() => setGuides(!guides)} title="Toggle layer outlines" aria-label="Toggle layer outlines">
            <ScanLine size={15} />
          </button>
          <button className={previewExpanded ? 'active' : ''} onClick={() => setPreviewExpanded(value => !value)} title={previewExpanded ? 'Exit expanded preview (Esc)' : 'Expand preview'} aria-label={previewExpanded ? 'Exit expanded preview' : 'Expand preview'}>
            {previewExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>
      </div>}
      <Composition video={video} sourceVersion={sourceVersion} playbackPath={proxyPath} proxyPreparing={proxyPreparing} preparation={preparation} segments={segments} music={music} musicFadeOut={store.settings.musicFadeOut ? store.settings.musicFadeDuration : null} preview={preview} preset={preset} before={before} guides={guides} layer={layer} setLayer={setLayer} change={change} importVideo={() => void importVideo()} quality={quality} playing={playing} timestamp={timestamp} onTimestamp={updatePlaybackTime} onPlayingChange={updatePlaying} onPlaybackError={report} onSourceFrame={source => setPreview({ source, composed: '', timestamp })} />
      {video && <Timeline duration={video.duration} sourceDurations={videoSources.map(source => source.duration)} timestamp={timestamp} segments={segments} music={music} markers={markers} playing={playing} playbackReady={Boolean(proxyPath && segments.length)} canUndo={undoStack.current.length > 0} canRedo={redoStack.current.length > 0} onSeek={value => { manualSeekUntil.current = performance.now() + 220; const next = clamp(value, 0, video.duration); playhead.current = next; setPlaying(false); setTimestamp(next); }} onPlay={togglePlayback} onUndo={undo} onRedo={redo} onImportVideo={() => void importVideo()} onImportMusic={() => void importMusic()} onSelectionChange={(track, id) => setSelectedClip({ track, id })}
        onMarker={(track, values) => {
          if (markers[track].length === values.length && markers[track].every((value, index) => Math.abs(value - values[index]) < .0001)) return;
          undoStack.current.push({ preset: structuredClone(preset), segments: structuredClone(segments), music: structuredClone(music), markers: structuredClone(markers) });
          if (undoStack.current.length > 100) undoStack.current.shift();
          lastPresetEdit.current = 0; redoStack.current = [];
          setMarkers(current => ({ ...current, [track]: values }));
        }}
        onEdit={(track, next) => {
          const previous = track === 'video' ? segments : music?.segments ?? [];
          const volumeOnly = next.length === previous.length && next.every((s, index) => s.id === previous[index].id && s.start === previous[index].start && s.end === previous[index].end);
          if (track === 'video') { editSegments(next, volumeOnly); return; }
          if (!music) return;
          undoStack.current.push({ preset: structuredClone(preset), segments: structuredClone(segments), music: structuredClone(music), markers: structuredClone(markers) });
          if (undoStack.current.length > 100) undoStack.current.shift();
          lastPresetEdit.current = 0;
          redoStack.current = [];
          setMusic({ ...music, segments: next });
          if (!volumeOnly) setPlaying(false);
        }} />}
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
          <Slider label="Blur" value={preset.background.blur} max={100} step={1} defaultValue={classic.background.blur} onChange={blur => edit('background', { blur })} />
          <Slider label="Scale" value={preset.background.scale} min={1} max={2} defaultValue={classic.background.scale} onChange={scale => edit('background', { scale })} suffix="×" />
          <div className="two-controls">
            <Slider label="X offset" value={preset.background.x - .5} min={-.5} max={.5} defaultValue={classic.background.x - .5} onChange={x => edit('background', { x: x + .5 })} />
            <Slider label="Y offset" value={preset.background.y - .5} min={-.5} max={.5} defaultValue={classic.background.y - .5} onChange={y => edit('background', { y: y + .5 })} />
          </div>
          <Alignment width={0} height={0} onChange={(x, y) => edit('background', { x, y })} />
          <Slider label="Brightness" value={preset.background.brightness} min={-.5} max={.5} defaultValue={classic.background.brightness} onChange={brightness => edit('background', { brightness })} />
        </Section>}
        {layer === 'gameplay' && <Section title="Gameplay" icon={<Film size={16} />} reset={() => reset('gameplay')}>
          <Slider label="Gameplay scale" value={preset.gameplay.scale} min={.2} max={4} defaultValue={classic.gameplay.scale} onChange={scale => edit('gameplay', { scale })} suffix="×" />
          <div className="two-controls">
            <Slider label="X position" value={preset.gameplay.x - .5} min={-.5} max={.5} defaultValue={classic.gameplay.x - .5} onChange={x => edit('gameplay', { x: x + .5 })} />
            <Slider label="Y position" value={preset.gameplay.y - .5} min={-.5} max={.5} defaultValue={classic.gameplay.y - .5} onChange={y => edit('gameplay', { y: y + .5 })} />
          </div>
          <Alignment width={preset.gameplay.scale} height={preset.gameplay.scale * (video ? video.height / video.width : 9 / 16) * (quality === 480 ? 480 / 854 : 9 / 16)} onChange={(x, y) => edit('gameplay', { x, y })} />
          <button className="text-button" onClick={() => { edit('gameplay', { x: .5, y: .5 }); setLayer('gameplay'); }}>Center gameplay</button>
        </Section>}
        {layer === 'boost' && <Section title="Boost HUD" icon={<Gauge size={16} />} reset={() => reset('boost')}>
          <div className="row">
            <label htmlFor="boost-enabled">Show boost cutout</label>
            <input id="boost-enabled" className="switch" type="checkbox" checked={b.enabled} onChange={e => edit('boost', { enabled: e.target.checked })} />
          </div>
          <button className="crop-button" disabled={!preview} onClick={() => { setPlaying(false); setLayer('boost'); setModal('crop'); }}>
            <Maximize2 size={15} />Select boost area<span>↗</span>
          </button>
          <div className="segmented">
            <button className={b.shape === 'circle' ? 'active' : ''} onClick={() => edit('boost', { shape: 'circle' })}>
              <Circle size={12} />Circle</button>
            <button className={b.shape === 'ellipse' ? 'active' : ''} onClick={() => edit('boost', { shape: 'ellipse' })}>
              <Circle size={12} style={{ transform: 'scaleX(1.3)' }} />Ellipse</button>
          </div>
          <Slider label="Boost scale" value={b.scale} min={.25} max={4} defaultValue={classic.boost.scale} onChange={scale => edit('boost', { scale })} suffix="×" />
          <div className="two-controls">
            <Slider label="Width" value={b.width} min={.01} max={1} step={.001} defaultValue={classic.boost.width} onChange={width => edit('boost', { width })} />
            <Slider label="Height" value={b.height} min={.005} max={1} step={.001} defaultValue={classic.boost.height} onChange={height => edit('boost', { height })} />
            <Slider label="X position" value={b.x - .5} min={-.5} max={.5} defaultValue={classic.boost.x - .5} onChange={x => edit('boost', { x: x + .5 })} />
            <Slider label="Y position" value={b.y - .5} min={-.5} max={.5} defaultValue={classic.boost.y - .5} onChange={y => edit('boost', { y: y + .5 })} />
          </div>
          <Alignment width={b.width * b.scale} height={b.height * b.scale} onChange={(x, y) => edit('boost', { x, y })} />
          <Slider label="Edge feather" value={b.feather} max={.25} step={.005} defaultValue={classic.boost.feather} onChange={feather => edit('boost', { feather })} />
          <div className="setting-toggle compact">
            <div><strong>Entrance animation</strong></div>
            <input className="switch" type="checkbox" aria-label="Add boost entrance animation" checked={b.intro.enabled} onChange={e => edit('boost', { intro: { ...b.intro, enabled: e.target.checked } })} />
          </div>
          {b.intro.enabled && <div className="boost-intro-settings">
            <Slider label="Duration" value={b.intro.duration} min={.1} max={5} step={.05} defaultValue={classic.boost.intro.duration} onChange={value => edit('boost', { intro: { ...b.intro, duration: value } })} suffix="s" />
            <label className="field">Easing<Dropdown label="Boost entrance easing" value={b.intro.easing} onChange={value => edit('boost', { intro: { ...b.intro, easing: value as typeof b.intro.easing } })} options={[{ value: 'linear', label: 'Linear' }, { value: 'ease', label: 'Ease' }, { value: 'easeIn', label: 'Ease in' }, { value: 'easeOut', label: 'Ease out' }, { value: 'easeInOut', label: 'Ease in-out' }]} /></label>
          </div>}
          <details className="crop-numbers">
            <summary>Source crop coordinates</summary>
            <div className="two-controls">
              <Slider label="Crop X" value={b.crop.x} max={1 - b.crop.width} step={.001} onChange={x => edit('boost', { crop: { ...b.crop, x } })} />
              <Slider label="Crop Y" value={b.crop.y} max={1 - b.crop.height} step={.001} onChange={y => edit('boost', { crop: { ...b.crop, y } })} />
              <Slider label="Crop width" value={b.crop.width} min={.001} max={1 - b.crop.x} step={.001} onChange={width => edit('boost', { crop: { ...b.crop, width } })} />
              <Slider label="Crop height" value={b.crop.height} min={.001} max={1 - b.crop.y} step={.001} onChange={height => edit('boost', { crop: { ...b.crop, height } })} />
            </div>
          </details>
        </Section>}
        {music && <Section title="Music" icon={<Music2 size={16} />}>
          <div className="setting-toggle compact">
            <div><strong>Fade at timeline end</strong></div>
            <input className="switch" type="checkbox" aria-label="Fade music at end" checked={store.settings.musicFadeOut} onChange={e => setStore(current => ({ ...current, settings: { ...current.settings, musicFadeOut: e.target.checked } }))} />
          </div>
          {store.settings.musicFadeOut && <div className="music-fade-settings"><Slider label="Fade duration" value={store.settings.musicFadeDuration} min={.1} max={10} step={.1} defaultValue={.5} onChange={value => setStore(current => ({ ...current, settings: { ...current.settings, musicFadeDuration: value } }))} suffix="s" /></div>}
        </Section>}
        {selectedVideoSegment && <Section title="Color recovery" icon={<Palette size={16} />}>
          <div className="color-scope" role="group" aria-label="Color correction scope"><button className={colorScope === 'clip' ? 'active' : ''} onClick={() => setColorScope('clip')}>This clip</button><button className={colorScope === 'all' ? 'active' : ''} onClick={() => setColorScope('all')}>All clips</button></div>
          <div className="setting-toggle compact"><div><strong>Recover washed colors</strong>{selectedSource && matchesHdr(selectedSource.colorTransfer) && <small>HDR source · automatic tone mapping is active</small>}</div><input className="switch" type="checkbox" aria-label="Recover washed colors" checked={colorFixValue > 0} onChange={event => setColorFix(event.target.checked ? .65 : 0)} /></div>
          {colorFixValue > 0 && <Slider label="Strength" value={colorFixValue} min={.1} max={1} step={.05} defaultValue={.65} onChange={setColorFix} suffix="×" />}
        </Section>}
        <Section title="Export" icon={<Download size={16} />}>
          <div className="two-controls">
            <label className="field">Resolution<Dropdown label="Resolution" value={quality} onChange={value => setQuality(Number(value))} options={[{ value: 480, label: '480p · 480 × 854' }, { value: 720, label: '720p · 720 × 1280' }, { value: 1080, label: '1080p · 1080 × 1920' }]} />
            </label>
            <label className="field">Frame rate<Dropdown label="Frame rate" value={fps} onChange={value => setFps(Number(value))} options={[{ value: 30, label: '30 FPS' }, { value: 60, label: '60 FPS' }]} />
            </label>
          </div>
          <label className="field">Output filename<input value={outputName} onChange={e => setOutputName(e.target.value)} placeholder="rlcut-edit.mp4" />
          </label>
          <label className="field">Destination folder<div className="folder-picker">
            <input value={outputFolder} onChange={e => rememberOutputFolder(e.target.value)} placeholder="Choose a folder…" />
            <button aria-label="Choose export folder" onClick={() => void chooseFolder()}>
              <FolderOpen size={16} />
            </button>
          </div>
          </label>
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
    {proxyPreparing && <div className="preparation-status" role="status" aria-live="polite">
      <LoaderCircle className="spin" size={18} /><div><strong>{preparation ? `Preparing recording · ${Math.floor(preparation.percent)}%` : 'Reading recording…'}</strong>
        <progress max="100" value={preparation?.percent} /><small>{preparation?.remaining != null ? `About ${duration(preparation.remaining)} remaining` : 'Preparing a smooth editing source'}{preparation && ` · ${duration(preparation.elapsed)} elapsed`}</small></div>
      <button title="Cancel import" aria-label="Cancel import" onClick={() => { importRevision.current++; setImporting(false); setProxyPreparing(false); void invoke('cancel_preparation').catch(report); }}><X size={16} /></button>
    </div>}
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
            <span>Start with the built-in layout.</span>
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
          <button aria-label="Close dialog" onClick={() => { setModal(null); if (!video) setHome(true); }}>
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
            <div><strong>Wait for smooth preview</strong><small>Show import loading while clips are prepared. Additional videos append only when ready.</small></div>
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
            <button onClick={() => {
              const ticket = ++importRevision.current;
              setPlaying(false); setProxyPath(''); setProxyPreparing(Boolean(video));
              void invoke('clear_cache').then(async () => {
                if (video) {
                  const path = await invoke<string>('create_timeline_proxy', { paths: videoSources.map(source => source.path) });
                  if (ticket === importRevision.current) setProxyPath(path);
                }
                setNotice('Preview cache cleared');
              }).catch(e => { if (ticket === importRevision.current && !message(e).includes('superseded')) report(e); }).finally(() => { if (ticket === importRevision.current) { setProxyPreparing(false); setImporting(false); } });
            }}>
              <Trash2 size={15} />Clear preview cache</button>
            <button onClick={() => { setStore(s => ({ ...s, settings: structuredClone(initialStore.settings) })); setInit(data => data ? { ...data, storageError: null } : data); setNotice('App settings reset. Presets retained.'); }}>Reset settings</button>
            <button className="primary" onClick={() => { setQuality(store.settings.quality); setFps(store.settings.fps); setOutputFolder(store.settings.outputFolder); select(store.settings.defaultPreset); setModal(null); if (!video) setHome(true); }}>Apply defaults</button>
          </div>
          <p className="help-text">Shortcuts: Ctrl / ⌘ O import · Ctrl / ⌘ E export · ← / → frame · Shift ← / → one second</p>
        </>}
      </div>
    </div>}
  </div>;
}
