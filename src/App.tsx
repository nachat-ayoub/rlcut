import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Check, CheckCircle2, Circle, Copy, Download, Eye, Film, FolderOpen, Gauge, Home, Keyboard, Layers3, LayoutTemplate, LoaderCircle, Maximize2, Minimize2, Music2, Palette, Pencil, Plus, Save, ScanLine, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, Upload, X } from 'lucide-react';
import type { EffectTrack, FlashEffect, FontOption, Init, Layer, MusicFile, MusicLibrarySong, MusicTrack, Preset, Preview, Progress, Project, Segment, Store, TextOverlay, TextTrack, TrackMarkers, Video } from './types';
import { classic, clamp, copyPreset, filename, initialStore, duration } from './lib/presets';
import { fileUrl, invoke, isDesktop, message, onDrop } from './lib/native';
import { Dropdown } from './components/Dropdown';
import { Section, Slider } from './components/Controls';
import { Composition } from './components/Composition';
import { Alignment } from './components/Alignment';
import { CropEditor } from './components/CropEditor';
import { Timeline } from './components/Timeline';
import { ProjectHome } from './components/ProjectHome';
import { TextInspector } from './components/TextInspector';
import { FlashInspector } from './components/FlashInspector';
import { MusicLibrary } from './components/MusicLibrary';
import { stampText } from './lib/text-stamp';
import { editedDuration, editedToSource, sourceToEdited } from './lib/timeline';
type Modal = 'settings' | 'presets' | 'shortcuts' | 'crop' | 'music' | null;
type InspectorView = 'edit' | 'export';
type EditorClipboard = { type: 'video' | 'music'; clip: Segment } | { type: 'text'; clip: TextOverlay } | { type: 'effect'; clip: FlashEffect };
const shortcuts = [
  ['Playback', [['Space', 'Play or pause'], ['← / →', 'Move one frame'], ['Shift + ← / →', 'Move one second'], ['Home / End', 'Jump to timeline start or end']]],
  ['Editing', [['Ctrl / ⌘ + K', 'Split selected clip'], ['Ctrl / ⌘ + C', 'Copy selected clip'], ['Ctrl / ⌘ + V', 'Paste at playhead'], ['Q', 'Trim left side to playhead'], ['W', 'Trim right side to playhead'], ['Delete', 'Delete selected item'], ['M', 'Toggle marker at playhead'], ['F', 'Toggle impact flash at playhead'], ['Ctrl / ⌘ + Z', 'Undo'], ['Ctrl / ⌘ + Shift + Z', 'Redo']]],
  ['Timeline', [['Drag clip', 'Reorder clips'], ['Shift + drag clip', 'Trim or restore the clip start'], ['Drag clip edge', 'Trim or restore that edge'], ['Alt while trimming', 'Temporarily disable snapping'], ['Ctrl + scroll', 'Zoom around the pointer']]],
  ['Preview & files', [['Ctrl + scroll', 'Zoom preview'], ['Alt + drag', 'Pan a zoomed preview'], ['Ctrl / ⌘ + O', 'Import videos'], ['Ctrl / ⌘ + S', 'Save project'], ['Ctrl / ⌘ + E', 'Export clip']]],
] as const;
const customPresetName = (presets: Preset[]) => {
  const names = new Set(presets.map(preset => preset.name));
  if (!names.has('Custom Preset')) return 'Custom Preset';
  let index = 1;
  while (names.has(`Custom Preset ${index}`)) index++;
  return `Custom Preset ${index}`;
};
const fileSize = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(bytes >= 100 * 1024 ** 2 ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const matchesHdr = (transfer?: string) => transfer === 'smpte2084' || transfer === 'arib-std-b67';
const normalizeMarkers = (value?: Partial<Record<'video' | 'music', number[] | number | null>>): TrackMarkers => ({
  video: Array.isArray(value?.video) ? value.video.filter(Number.isFinite) : Number.isFinite(value?.video) ? [value!.video as number] : [],
  music: Array.isArray(value?.music) ? value.music.filter(Number.isFinite) : Number.isFinite(value?.music) ? [value!.music as number] : [],
});
const normalizeFlash = (value: Partial<FlashEffect>): FlashEffect => ({
  id: value.id || crypto.randomUUID(), trackId: value.trackId || '', kind: value.kind === 'darkGray' ? 'darkGray' : 'flash', timing: value.timing === 'clip' ? 'clip' : 'duration', scope: value.scope === 'video' ? 'video' : 'all', time: Number.isFinite(value.time) ? Math.max(0, value.time!) : 0,
  duration: Number.isFinite(value.duration) ? Math.max(.08, value.duration!) : .45,
  intensity: Number.isFinite(value.intensity) ? Math.max(.05, Math.min(1, value.intensity!)) : .82,
  color: /^#[0-9a-f]{6}$/i.test(value.color ?? '') ? value.color! : '#ffffff', easing: value.easing ?? 'easeOut',
});
const fitFlash = (effect: FlashEffect, total: number): FlashEffect => {
  const time = Math.max(0, Math.min(effect.time, Math.max(0, total - .08)));
  const maximum = effect.kind === 'flash' ? Math.min(1.5, Math.max(.08, total - time)) : Math.max(.08, total - time);
  return { ...effect, time, duration: Math.max(.08, Math.min(effect.duration, maximum)) };
};
const fitEffectToClip = (effect: FlashEffect, segments: Segment[]): FlashEffect => {
  if (effect.timing !== 'clip' || !segments.length) return effect;
  let cursor = 0;
  for (let index = 0; index < segments.length; index++) {
    const end = cursor + segments[index].end - segments[index].start;
    if (effect.time < end || index === segments.length - 1) return { ...effect, time: cursor, duration: end - cursor };
    cursor = end;
  }
  return effect;
};
const overlaps = (start: number, end: number, itemStart: number, itemEnd: number) => start < itemEnd - .001 && end > itemStart + .001;
const sameCoverage = (left: Segment[], right: Segment[]) => {
  const ranges = (items: Segment[]) => items.map(item => `${item.start.toFixed(4)}:${item.end.toFixed(4)}`).sort();
  const a = ranges(left), b = ranges(right);
  return a.length === b.length && a.every((range, index) => range === b[index]);
};
const markersAfterEdit = (previous: Segment[], next: Segment[], values: number[]) => values.filter(marker => {
  if (!previous.some(clip => marker >= clip.start - .001 && marker <= clip.end + .001)) return true;
  if (next.some(clip => marker > clip.start + .001 && marker < clip.end - .001)) return true;
  const ending = next.some(clip => Math.abs(clip.end - marker) <= .001);
  const starting = next.some(clip => Math.abs(clip.start - marker) <= .001);
  return ending && starting;
});
const normalizeText = (value: Partial<TextOverlay>): TextOverlay => ({
  id: value.id || crypto.randomUUID(), trackId: value.trackId || '', text: value.text ?? 'Text', start: value.start ?? 0, end: value.end ?? 3,
  x: value.x ?? .5, y: value.y ?? .5, scale: value.scale ?? 1, boxWidth: value.boxWidth ?? .7, rotation: value.rotation ?? 0,
  fontFamily: value.fontFamily || 'DejaVu Sans', fontPath: value.fontPath || '', fontBoldPath: value.fontBoldPath || '', fontBlackPath: value.fontBlackPath || '', fontItalicPath: value.fontItalicPath || '', fontBoldItalicPath: value.fontBoldItalicPath || '', fontBlackItalicPath: value.fontBlackItalicPath || '', fontWeight: value.fontWeight ?? (value.bold ? 700 : 400), fontSize: value.fontSize ?? 72,
  color: value.color || '#ffffff', opacity: value.opacity ?? 1, align: value.align ?? 'center', bold: value.bold ?? false,
  italic: value.italic ?? false, underline: value.underline ?? false, letterSpacing: value.letterSpacing ?? 0,
  lineHeight: value.lineHeight ?? 1.2, strokeColor: value.strokeColor || '#000000', strokeWidth: value.strokeWidth ?? 9, strokePosition: value.strokePosition ?? 'outside',
  backgroundColor: value.backgroundColor || '#000000', backgroundOpacity: value.backgroundOpacity ?? 0,
  shadowEnabled: value.shadowEnabled ?? true, shadowColor: value.shadowColor || '#000000', shadowBlur: value.shadowBlur ?? 8, shadowX: value.shadowX ?? 0,
  shadowY: value.shadowY ?? 6, fadeIn: value.fadeIn ?? null, fadeOut: value.fadeOut ?? null,
});
type EditorSnapshot = { preset: Preset; segments: Segment[]; music: MusicTrack | null; markers: TrackMarkers; effects: FlashEffect[]; effectTracks: EffectTrack[]; texts: TextOverlay[]; textTracks: TextTrack[] };
const migratePresetNames = (store: Store): Store => {
  const renamed: Preset[] = [];
  for (const preset of store.presets) {
    const legacy = preset.name === 'My RL Short' || preset.name === 'Classic RL Short — custom' || /^(Classic RL Short|My RL Short) copy(?: \d+)?$/.test(preset.name);
    renamed.push(legacy ? { ...preset, name: customPresetName(renamed) } : preset);
  }
  return {
    ...store, settings: { ...store.settings, favoriteFonts: store.settings.favoriteFonts ?? [], favoriteSongs: store.settings.favoriteSongs ?? [], installedSongs: store.settings.installedSongs ?? [], musicLibraryFolder: store.settings.musicLibraryFolder ?? '' }, presets: renamed, projects: (store.projects ?? []).map(project => {
      const sourceTexts = project.texts ?? [], sourceEffects = project.effects ?? [];
      const textTracks = project.textTracks?.length ? project.textTracks : sourceTexts.length ? [{ id: crypto.randomUUID(), name: 'Text 1' }] : [];
      const effectTracks = project.effectTracks?.length ? project.effectTracks : sourceEffects.length ? [{ id: crypto.randomUUID(), name: 'Effects 1' }] : [];
      return { ...project, markers: normalizeMarkers(project.markers as never), effectTracks, effects: sourceEffects.map(effect => normalizeFlash({ ...effect, trackId: effect.trackId || effectTracks[0]?.id })), textTracks, texts: sourceTexts.map(text => normalizeText({ ...text, trackId: text.trackId || textTracks[0]?.id })), segments: project.segments.map(segment => ({ ...segment, volume: segment.volume ?? 1, colorFix: segment.colorFix ?? 0 })) };
    })
  };
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
  const [modal, setModal] = useState<Modal>(null), [error, setError] = useState<string | null>(null), [errorCopied, setErrorCopied] = useState(false), [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null), [exportStarting, setExportStarting] = useState(false), [outputFolder, setOutputFolder] = useState(''), [outputName, setOutputName] = useState('rlcut-edit.mp4');
  const [inspectorView, setInspectorView] = useState<InspectorView>('edit');
  const [aiEnhance, setAiEnhance] = useState(false);
  const [aiUpscale, setAiUpscale] = useState(false);
  const [aiUpscaleLite, setAiUpscaleLite] = useState(false);
  const [aiKeepResolution, setAiKeepResolution] = useState(true);
  const [quality, setQuality] = useState(1080), [fps, setFps] = useState(60), [rename, setRename] = useState('');
  const [saved, setSaved] = useState(true);
  const [segments, setSegments] = useState<Segment[]>([]), [playing, setPlaying] = useState(false);
  const [music, setMusic] = useState<MusicTrack | null>(null);
  const [markers, setMarkers] = useState<TrackMarkers>({ video: [], music: [] });
  const [effects, setEffects] = useState<FlashEffect[]>([]), [effectTracks, setEffectTracks] = useState<EffectTrack[]>([]), [selectedEffectId, setSelectedEffectId] = useState<string | null>(null);
  const [texts, setTexts] = useState<TextOverlay[]>([]), [textTracks, setTextTracks] = useState<TextTrack[]>([]), [selectedTextId, setSelectedTextId] = useState<string | null>(null), [fonts, setFonts] = useState<FontOption[]>([]);
  const [home, setHome] = useState(true), [projectLoading, setProjectLoading] = useState(false), [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [selectedClip, setSelectedClip] = useState<{ track: 'video' | 'music'; id: string } | null>(null), [colorScope, setColorScope] = useState<'clip' | 'all'>('clip');
  const [colorPreviewBefore, setColorPreviewBefore] = useState(false);
  const undoStack = useRef<EditorSnapshot[]>([]), redoStack = useRef<EditorSnapshot[]>([]), editorClipboard = useRef<EditorClipboard | null>(null);
  const playhead = useRef(0), lastTimeReport = useRef(0), manualSeekUntil = useRef(0);
  const lastPresetEdit = useRef(0), lastTextEdit = useRef(0), lastEffectEdit = useRef(0);
  const initialized = useRef(false), importRevision = useRef(0), lastSaved = useRef(''), storeRef = useRef(store);
  const loadedFonts = useRef(new Set<string>());
  storeRef.current = store;
  const preset = store.activePreset === 'classic' ? classic : store.presets.find(p => p.id === store.activePreset) ?? classic;
  const allPresets = [classic, ...store.presets];
  const exporting = progress?.phase === 'running';
  const snapshot = useCallback((): EditorSnapshot => ({ preset: structuredClone(preset), segments: structuredClone(segments), music: structuredClone(music), markers: structuredClone(markers), effects: structuredClone(effects), effectTracks: structuredClone(effectTracks), texts: structuredClone(texts), textTracks: structuredClone(textTracks) }), [preset, segments, music, markers, effects, effectTracks, texts, textTracks]);
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
  useEffect(() => { if (ready && isDesktop()) invoke<FontOption[]>('list_system_fonts').then(setFonts).catch(() => undefined); }, [ready]);
  useEffect(() => {
    const path = music?.path;
    if (!path || music.waveform?.length) return;
    let disposed = false;
    invoke<number[]>('music_waveform', { path }).then(waveform => {
      if (!disposed) setMusic(current => current?.path === path ? { ...current, waveform } : current);
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, [music?.path, music?.waveform?.length]);
  useEffect(() => { for (const text of texts) { const variants: Array<[string, string, string]> = [[text.fontPath, '400', 'normal'], [text.fontBoldPath, '700', 'normal'], [text.fontBlackPath, '900', 'normal'], [text.fontItalicPath, '400', 'italic'], [text.fontBoldItalicPath, '700', 'italic'], [text.fontBlackItalicPath, '900', 'italic']]; for (const [path, weight, style] of variants) { if (!path || loadedFonts.current.has(path)) continue; loadedFonts.current.add(path); const face = new FontFace(text.fontFamily, `url("${fileUrl(path)}")`, { weight, style }); face.load().then(loaded => document.fonts.add(loaded)).catch(() => loadedFonts.current.delete(path)); } } }, [texts]);
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
  useEffect(() => setErrorCopied(false), [error]);
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
      undoStack.current.push(snapshot());
      if (undoStack.current.length > 100) undoStack.current.shift();
    }
    lastPresetEdit.current = now;
    redoStack.current = [];
    replacePreset(next);
  }, [snapshot, replacePreset]);
  const restoreSnapshot = useCallback((snapshot: EditorSnapshot) => {
    lastPresetEdit.current = 0;
    replacePreset(snapshot.preset);
    setSegments(structuredClone(snapshot.segments));
    setMusic(structuredClone(snapshot.music));
    setMarkers(structuredClone(snapshot.markers));
    setEffects(structuredClone(snapshot.effects));
    setEffectTracks(structuredClone(snapshot.effectTracks));
    setTexts(structuredClone(snapshot.texts));
    setTextTracks(structuredClone(snapshot.textTracks));
    const value = editedToSource(snapshot.segments, sourceToEdited(snapshot.segments, playhead.current));
    playhead.current = value; setTimestamp(value); setPlaying(false);
  }, [replacePreset]);
  const undo = useCallback(() => {
    const previous = undoStack.current.pop(); if (!previous) return;
    redoStack.current.push(snapshot());
    restoreSnapshot(previous);
  }, [snapshot, restoreSnapshot]);
  const redo = useCallback(() => {
    const next = redoStack.current.pop(); if (!next) return;
    undoStack.current.push(snapshot());
    restoreSnapshot(next);
  }, [snapshot, restoreSnapshot]);
  const editSegments = useCallback((next: Segment[], preservePlayback = false) => {
    lastPresetEdit.current = 0;
    undoStack.current.push(snapshot());
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = []; if (!sameCoverage(segments, next)) setMarkers(current => ({ ...current, video: markersAfterEdit(segments, next, current.video) })); setSegments(next); setEffects(current => current.map(effect => fitFlash(fitEffectToClip(effect, next), editedDuration(next))));
    if (preservePlayback) return;
    const value = editedToSource(next, sourceToEdited(next, playhead.current));
    playhead.current = value; setTimestamp(value); setPlaying(false);
  }, [snapshot, segments]);
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
        undoStack.current.push(snapshot());
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
        setMusic(null); setMarkers({ video: [], music: [] }); setEffects([]); setEffectTracks([]); setSelectedEffectId(null); setTexts([]); setTextTracks([]); setSelectedTextId(null);
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
  }, [report, videoSources, segments, snapshot]);
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
  const applyMusic = useCallback((selected: MusicFile) => {
    undoStack.current.push(snapshot());
    if (undoStack.current.length > 100) undoStack.current.shift();
    lastPresetEdit.current = 0; redoStack.current = [];
    const id = crypto.randomUUID(); setMusic({ ...selected, segments: [{ id, start: 0, end: selected.duration, volume: 1, colorFix: 0 }] }); setSelectedClip({ track: 'music', id });
    setMarkers(current => ({ ...current, music: [] })); setPlaying(false);
  }, [snapshot]);
  const importMusic = useCallback(async (): Promise<MusicFile | null> => {
    try {
      const selected = await invoke<MusicFile | null>('pick_music');
      if (selected) {
        applyMusic(selected); return selected;
      }
    }
    catch (e) {
      report(e);
    }
    return null;
  }, [applyMusic, report]);
  const useInstalledMusic = useCallback(async (path: string): Promise<boolean> => {
    try { const selected = await invoke<MusicFile>('import_music_path', { path }); applyMusic(selected); return true; }
    catch (error) { report(error); return false; }
  }, [applyMusic, report]);
  const saveOnlineMusic = useCallback(async (song: MusicLibrarySong): Promise<MusicFile | null> => {
    try {
      let folder = storeRef.current.settings.musicLibraryFolder;
      if (!folder) {
        folder = await invoke<string | null>('pick_folder') ?? '';
        if (!folder) return null;
        setStore(current => ({ ...current, settings: { ...current.settings, musicLibraryFolder: folder } }));
      }
      const selected = await invoke<MusicFile>('save_youtube_audio', { id: song.id, title: song.title, folder });
      if (selected) { applyMusic(selected); setNotice('Audio saved for offline use'); }
      return selected;
    } catch (error) { report(error); return null; }
  }, [applyMusic, report]);
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
  useEffect(() => { setInspectorView('edit'); }, [layer, selectedTextId, selectedEffectId, selectedClip?.id, selectedClip?.track]);
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
      // 4 Hz instead of rebuilding the entire editor for every decoded frame.
      const now = performance.now();
      if (now - lastTimeReport.current >= 250) { lastTimeReport.current = now; setTimestamp(value); }
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
  const copySelection = useCallback(() => {
    const effect = effects.find(item => item.id === selectedEffectId);
    const text = texts.find(item => item.id === selectedTextId);
    const clip = selectedClip?.track === 'video' ? segments.find(item => item.id === selectedClip.id) : music?.segments.find(item => item.id === selectedClip?.id);
    if (effect) editorClipboard.current = { type: 'effect', clip: structuredClone(effect) };
    else if (text) editorClipboard.current = { type: 'text', clip: structuredClone(text) };
    else if (clip && selectedClip) editorClipboard.current = { type: selectedClip.track, clip: structuredClone(clip) };
    else return;
    setNotice('Clip copied');
  }, [effects, selectedEffectId, texts, selectedTextId, selectedClip, segments, music]);
  const pasteSelection = useCallback(() => {
    const copied = editorClipboard.current;
    if (!copied || !segments.length) return;
    const at = Math.max(0, Math.min(editedDuration(segments), sourceToEdited(segments, playhead.current)));
    undoStack.current.push(snapshot()); if (undoStack.current.length > 100) undoStack.current.shift(); redoStack.current = [];
    if (copied.type === 'effect') {
      const length = copied.clip.duration, start = Math.min(at, Math.max(0, editedDuration(segments) - length)), end = start + length;
      let track = [...effectTracks].reverse().find(candidate => !effects.some(item => item.trackId === candidate.id && overlaps(start, end, item.time, item.time + item.duration)));
      if (!track) { track = { id: crypto.randomUUID(), name: `Effects ${effectTracks.reduce((max, item) => Math.max(max, Number(item.name.match(/\d+$/)?.[0] ?? 0)), 0) + 1}` }; setEffectTracks(current => [...current, track!]); }
      const next = { ...structuredClone(copied.clip), id: crypto.randomUUID(), trackId: track.id, timing: 'duration' as const, time: start };
      setEffects(current => [...current, next].sort((a, b) => a.time - b.time)); setSelectedEffectId(next.id); setSelectedTextId(null); setSelectedClip(null); setLayer(null);
    } else if (copied.type === 'text') {
      const length = copied.clip.end - copied.clip.start, start = Math.min(at, Math.max(0, editedDuration(segments) - length)), end = start + length;
      let track = [...textTracks].reverse().find(candidate => !texts.some(item => item.trackId === candidate.id && overlaps(start, end, item.start, item.end)));
      if (!track) { track = { id: crypto.randomUUID(), name: `Text ${textTracks.reduce((max, item) => Math.max(max, Number(item.name.match(/\d+$/)?.[0] ?? 0)), 0) + 1}` }; setTextTracks(current => [...current, track!]); }
      const next = { ...structuredClone(copied.clip), id: crypto.randomUUID(), trackId: track.id, start, end };
      setTexts(current => [...current, next]); setSelectedTextId(next.id); setSelectedEffectId(null); setSelectedClip(null); setLayer(null);
    } else if (copied.type === 'video') {
      const offsets: number[] = []; let cursor = 0; for (const clip of segments) { offsets.push(cursor); cursor += clip.end - clip.start; }
      const index = offsets.findIndex((offset, item) => at < offset + segments[item].end - segments[item].start);
      const nextClip = { ...structuredClone(copied.clip), id: crypto.randomUUID() }, next = [...segments]; next.splice(index < 0 ? next.length : index + 1, 0, nextClip);
      setSegments(next); setSelectedClip({ track: 'video', id: nextClip.id }); setSelectedTextId(null); setSelectedEffectId(null); setLayer(null);
    } else if (music) {
      const lane = music.segments, offsets: number[] = []; let cursor = 0; for (const clip of lane) { offsets.push(cursor); cursor += clip.end - clip.start; }
      const index = offsets.findIndex((offset, item) => at < offset + lane[item].end - lane[item].start);
      const nextClip = { ...structuredClone(copied.clip), id: crypto.randomUUID() }, next = [...lane]; next.splice(index < 0 ? next.length : index + 1, 0, nextClip);
      setMusic({ ...music, segments: next }); setSelectedClip({ track: 'music', id: nextClip.id }); setSelectedTextId(null); setSelectedEffectId(null); setLayer(null);
    }
    setPlaying(false); setNotice('Clip pasted at playhead');
  }, [segments, snapshot, effectTracks, effects, textTracks, texts, music]);
  const startExport = useCallback(async () => {
    if (!video || exporting || exportStarting)
      return;
    if ((aiEnhance || aiUpscale) && !init?.aiAvailable) {
      setError('AI export components are not installed in this build. Use the Linux AI AppImage, or prepare the local AI runtime before exporting.');
      return;
    }
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
      const trackOrder = new Map(textTracks.map((track, index) => [track.id, index]));
      const orderedTexts = [...texts].sort((a, b) => (trackOrder.get(b.trackId) ?? -1) - (trackOrder.get(a.trackId) ?? -1));
      const outputFactor = aiUpscale && !aiKeepResolution ? 2 : 1;
      const exportTexts: TextOverlay[] = [];
      // Render one static transparent image per text clip, then animate opacity in FFmpeg.
      for (const text of orderedTexts) {
        let rendered: Awaited<ReturnType<typeof stampText>>;
        try {
          rendered = await stampText(text, quality * outputFactor, (quality === 480 ? 854 : quality === 720 ? 1280 : 1920) * outputFactor, quality);
        } catch (error) {
          const label = text.text.trim().replace(/\s+/g, ' ').slice(0, 32) || 'Untitled text';
          throw new Error(`Could not prepare text “${label}”: ${message(error)}`);
        }
        exportTexts.push({ ...text, ...rendered });
      }
      if (aiEnhance || aiUpscale) setPlaying(false);
      const effectOrder = new Map(effectTracks.map((track, index) => [track.id, index]));
      const exportEffects = [...effects]
        .sort((a, b) => (effectOrder.get(b.trackId) ?? -1) - (effectOrder.get(a.trackId) ?? -1) || a.time - b.time)
        .map(({ trackId, ...effect }) => { void trackId; return effect; });
      const payload = { paths: videoSources.map(source => source.path), preset, segments, texts: exportTexts, music, musicFadeOut: music && store.settings.musicFadeOut ? store.settings.musicFadeDuration : null, options: { quality, fps, aiEnhance, aiUpscale, aiUpscaleLite, aiKeepResolution, effects: exportEffects, folder, filename: outputName } };
      let p: Progress;
      try {
        p = await invoke<Progress>('start_export', { ...payload, overwrite: false });
      } catch (error) {
        if (message(error) !== 'OUTPUT_EXISTS') throw error;
        if (!window.confirm(`“${outputName}” already exists. Replace it?`)) return;
        p = await invoke<Progress>('start_export', { ...payload, overwrite: true });
      }
      setProgress(p);
    }
    catch (e) {
      report(e);
    }
    finally {
      setExportStarting(false);
    }
  }, [video, videoSources, exporting, exportStarting, outputFolder, preset, segments, effects, effectTracks, texts, textTracks, quality, fps, aiEnhance, aiUpscale, aiUpscaleLite, aiKeepResolution, outputName, music, store.settings.musicFadeOut, store.settings.musicFadeDuration, init?.aiAvailable, report, rememberOutputFolder]);
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
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault(); copySelection();
      }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault(); pasteSelection();
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
  }, [importVideo, startExport, jump, video, modal, undo, redo, proxyPath, togglePlayback, copySelection, pasteSelection]);
  function create() { const p = copyPreset(preset, customPresetName(store.presets)); setStore(s => ({ ...s, presets: [...s.presets, p], activePreset: p.id })); setRename(p.name); setModal('presets'); }
  function remove(id = preset.id) {
    const target = allPresets.find(item => item.id === id);
    if (!target || id === 'classic' || !window.confirm(`Delete “${target.name}”?`)) return;
    setStore(s => ({ ...s, presets: s.presets.filter(p => p.id !== id), activePreset: s.activePreset === id ? 'classic' : s.activePreset, settings: { ...s.settings, defaultPreset: s.settings.defaultPreset === id ? 'classic' : s.settings.defaultPreset } }));
    if (preset.id === id) setRename(classic.name);
    setNotice('Preset deleted');
  }
  function select(id: string) { setStore(s => ({ ...s, activePreset: id })); setRename(allPresets.find(p => p.id === id)?.name ?? ''); }
  function managePreset(id: string) { select(id); setModal('presets'); }
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
    importRevision.current++; setPlaying(false); setVideo(null); setVideoSources([]); setProxyPath(''); setPreview(null); setSegments([]); setMusic(null); setMarkers({ video: [], music: [] }); setEffects([]); setEffectTracks([]); setSelectedEffectId(null); setTexts([]); setTextTracks([]); setSelectedTextId(null); setSelectedClip(null); setCurrentProjectId(null); setProgress(null); setPreparation(null); setProxyPreparing(false); setTimestamp(0); playhead.current = 0; undoStack.current = []; redoStack.current = [];
  }
  function projectSnapshot(id: string, name: string, createdAt: number): Project {
    return { version: 1, id, name, createdAt, updatedAt: Date.now(), videoPaths: videoSources.map(source => source.path), segments: structuredClone(segments), music: structuredClone(music), markers: structuredClone(markers), effects: structuredClone(effects), effectTracks: structuredClone(effectTracks), texts: structuredClone(texts), textTracks: structuredClone(textTracks), preset: structuredClone(preset), quality, fps: fps === 120 ? 60 : fps, outputFolder, outputName };
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
  }, [currentProjectId, video, videoSources, segments, music, markers, effects, effectTracks, texts, textTracks, preset, quality, fps, outputFolder, outputName, proxyPreparing]);
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
      const projectPreset = project.preset.id === 'classic' ? classic : project.preset;
      setStore(current => {
        if (projectPreset.id === 'classic') return { ...current, activePreset: 'classic' };
        const legacyMatch = projectPreset.id.startsWith('project-') ? current.presets.find(item => !item.id.startsWith('project-') && item.name === projectPreset.name) : undefined;
        const restored = legacyMatch ? { ...projectPreset, id: legacyMatch.id, name: legacyMatch.name } : projectPreset;
        return { ...current, activePreset: restored.id, presets: [...current.presets.filter(item => item.id !== restored.id && !(item.id.startsWith('project-') && item.name === restored.name)), restored] };
      });
      const sourceTexts = project.texts ?? [], restoredTracks = project.textTracks?.length ? project.textTracks : sourceTexts.length ? [{ id: crypto.randomUUID(), name: 'Text 1' }] : [];
      const sourceEffects = project.effects ?? [], restoredEffectTracks = project.effectTracks?.length ? project.effectTracks : sourceEffects.length ? [{ id: crypto.randomUUID(), name: 'Effects 1' }] : [];
      setVideoSources(sources); setVideo({ ...sources[0], duration: total, hasAudio: sources.some(source => source.hasAudio) }); setProxyPath(proxy); setSourceVersion(version => version + 1); setSegments(restoredSegments); setMusic(project.music ? { ...project.music, waveform: project.music.waveform ?? [], segments: project.music.segments.map(segment => ({ ...segment, id: segment.id || crypto.randomUUID(), colorFix: 0 })) } : null); setMarkers(normalizeMarkers(project.markers as never)); setEffectTracks(restoredEffectTracks); setEffects(sourceEffects.map(effect => fitFlash(fitEffectToClip(normalizeFlash({ ...effect, trackId: effect.trackId || restoredEffectTracks[0]?.id }), restoredSegments), editedDuration(restoredSegments)))); setSelectedEffectId(null); setTextTracks(restoredTracks); setTexts(sourceTexts.map(text => normalizeText({ ...text, trackId: text.trackId || restoredTracks[0]?.id }))); setSelectedTextId(null); setAiEnhance(false); setAiUpscale(false); setQuality(project.quality); setFps(project.fps === 120 ? 60 : project.fps); setOutputFolder(project.outputFolder); setOutputName(project.outputName); setCurrentProjectId(project.id); setSelectedClip(restoredSegments[0] ? { track: 'video', id: restoredSegments[0].id } : null); setTimestamp(restoredSegments[0]?.start ?? 0); playhead.current = restoredSegments[0]?.start ?? 0; setHome(false); setPreview(null); undoStack.current = []; redoStack.current = [];
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
  function duplicateProject(project: Project) {
    setStore(current => {
      const names = new Set(current.projects.map(item => item.name));
      let name = `${project.name} Copy`, suffix = 2;
      while (names.has(name)) name = `${project.name} Copy ${suffix++}`;
      const now = Date.now();
      const duplicate: Project = { ...structuredClone(project), id: crypto.randomUUID(), name, createdAt: now, updatedAt: now };
      return { ...current, projects: [...current.projects, duplicate] };
    });
    setNotice('Project duplicated');
  }
  const b = preset.boost;
  const exportDuration = editedDuration(segments);
  const exportScale = aiUpscale && !aiKeepResolution ? 2 : 1;
  const exportWidth = quality * exportScale, exportHeight = (quality === 480 ? 854 : quality === 720 ? 1280 : 1920) * exportScale;
  const estimatedVideoRate = exportWidth * exportHeight * fps * (quality >= 1080 ? .095 : quality >= 720 ? .105 : .12);
  const estimatedAudioRate = video?.hasAudio || music ? 192_000 : 0;
  const estimatedExportBytes = exportDuration * (estimatedVideoRate + estimatedAudioRate) / 8;
  const estimatedExportSize = exportDuration > 0 ? `${fileSize(estimatedExportBytes * .8)}–${fileSize(estimatedExportBytes * 1.25)}` : '—';
  const textTrackOrder = new Map(textTracks.map((track, index) => [track.id, index]));
  const stackedTexts = [...texts].sort((a, b) => (textTrackOrder.get(b.trackId) ?? -1) - (textTrackOrder.get(a.trackId) ?? -1));
  const effectTrackOrder = new Map(effectTracks.map((track, index) => [track.id, index]));
  const stackedEffects = [...effects].sort((a, b) => (effectTrackOrder.get(b.trackId) ?? -1) - (effectTrackOrder.get(a.trackId) ?? -1) || a.time - b.time);
  const selectedText = texts.find(text => text.id === selectedTextId) ?? null;
  const editText = useCallback((next: TextOverlay) => {
    const now = performance.now();
    if (!lastTextEdit.current || now - lastTextEdit.current > 350) { undoStack.current.push(snapshot()); if (undoStack.current.length > 100) undoStack.current.shift(); }
    lastTextEdit.current = now; redoStack.current = [];
    setTexts(current => current.map(text => text.id === next.id ? next : text));
  }, [snapshot]);
  const addTextTrack = useCallback(() => { undoStack.current.push(snapshot()); redoStack.current = []; const number = textTracks.reduce((max, track) => Math.max(max, Number(track.name.match(/\d+$/)?.[0] ?? 0)), 0) + 1; setTextTracks(current => [{ id: crypto.randomUUID(), name: `Text ${number}` }, ...current]); }, [snapshot, textTracks]);
  const removeTextTrack = useCallback((id: string) => { undoStack.current.push(snapshot()); redoStack.current = []; setTextTracks(current => current.filter(track => track.id !== id)); setTexts(current => current.filter(text => text.trackId !== id)); if (texts.some(text => text.id === selectedTextId && text.trackId === id)) setSelectedTextId(null); }, [snapshot, texts, selectedTextId]);
  const addText = useCallback((trackId: string) => {
    const editedAt = sourceToEdited(segments, playhead.current), total = editedDuration(segments);
    if (total <= 0) return;
    undoStack.current.push(snapshot()); redoStack.current = [];
    const font = fonts[0];
    const next = normalizeText({ id: crypto.randomUUID(), trackId, text: 'Text', start: Math.min(editedAt, Math.max(0, total - .05)), end: Math.min(total, Math.max(editedAt + 3, editedAt + .05)), fontFamily: font?.family, fontPath: font?.path });
    setTexts(current => [...current, next]); setSelectedTextId(next.id); setSelectedClip(null); setLayer(null);
  }, [segments, fonts, snapshot]);
  const removeText = useCallback((id: string) => { undoStack.current.push(snapshot()); redoStack.current = []; setTexts(current => current.filter(text => text.id !== id)); setSelectedTextId(null); }, [snapshot]);
  const splitText = useCallback((id: string, at: number) => { undoStack.current.push(snapshot()); redoStack.current = []; setTexts(current => current.flatMap(text => text.id !== id ? [text] : [{ ...text, end: at }, { ...text, id: crypto.randomUUID(), start: at }])); }, [snapshot]);
  const addEffectTrack = useCallback(() => {
    undoStack.current.push(snapshot()); redoStack.current = [];
    const number = effectTracks.reduce((max, track) => Math.max(max, Number(track.name.match(/\d+$/)?.[0] ?? 0)), 0) + 1;
    setEffectTracks(current => [{ id: crypto.randomUUID(), name: `Effects ${number}` }, ...current]);
  }, [snapshot, effectTracks]);
  const removeEffectTrack = useCallback((id: string) => {
    undoStack.current.push(snapshot()); redoStack.current = [];
    setEffectTracks(current => current.filter(track => track.id !== id));
    setEffects(current => current.filter(effect => effect.trackId !== id));
    if (effects.some(effect => effect.id === selectedEffectId && effect.trackId === id)) setSelectedEffectId(null);
  }, [snapshot, effects, selectedEffectId]);
  const addEffect = useCallback((at: number, requestedTrackId?: string) => {
    const total = editedDuration(segments); if (total < .08) return;
    undoStack.current.push(snapshot()); if (undoStack.current.length > 100) undoStack.current.shift(); redoStack.current = [];
    const candidate = fitFlash(normalizeFlash({ id: crypto.randomUUID(), trackId: '', time: at }), total);
    const freeTrack = requestedTrackId ? effectTracks.find(track => track.id === requestedTrackId) : [...effectTracks].reverse().find(track => !effects.some(effect => effect.trackId === track.id && overlaps(candidate.time, candidate.time + candidate.duration, effect.time, effect.time + effect.duration)));
    const trackId = freeTrack?.id || crypto.randomUUID();
    if (!freeTrack) {
      const number = effectTracks.reduce((max, track) => Math.max(max, Number(track.name.match(/\d+$/)?.[0] ?? 0)), 0) + 1;
      setEffectTracks(current => [...current, { id: trackId, name: `Effects ${number}` }]);
    }
    const next = { ...candidate, trackId };
    setEffects(current => [...current, next].sort((a, b) => a.time - b.time)); setSelectedEffectId(next.id); setSelectedTextId(null); setSelectedClip(null); setLayer(null); setPlaying(false);
  }, [segments, snapshot, effects, effectTracks]);
  const editEffect = useCallback((next: FlashEffect) => {
    const now = performance.now();
    if (!lastEffectEdit.current || now - lastEffectEdit.current > 350) { undoStack.current.push(snapshot()); if (undoStack.current.length > 100) undoStack.current.shift(); }
    lastEffectEdit.current = now; redoStack.current = [];
    const fitted = fitFlash(fitEffectToClip(next, segments), editedDuration(segments));
    setEffects(current => current.map(effect => effect.id === fitted.id ? fitted : effect).sort((a, b) => a.time - b.time));
  }, [segments, snapshot]);
  const removeEffect = useCallback((id: string) => {
    undoStack.current.push(snapshot()); if (undoStack.current.length > 100) undoStack.current.shift(); redoStack.current = []; lastEffectEdit.current = 0;
    setEffects(current => current.filter(effect => effect.id !== id)); setSelectedEffectId(null);
  }, [snapshot]);
  const addGoogleFont = useCallback(async (requestedFamily: string) => {
    const family = requestedFamily.trim();
    if (!family) return;
    try {
      type Variant = 'regular' | 'bold' | 'black' | 'italic' | 'boldItalic' | 'blackItalic';
      const encoded = encodeURIComponent(family).replace(/%20/g, '+');
      const requests: Array<[Variant, string]> = [['regular', encoded], ['bold', `${encoded}:wght@700`], ['black', `${encoded}:wght@900`], ['italic', `${encoded}:ital@1`], ['boldItalic', `${encoded}:ital,wght@1,700`], ['blackItalic', `${encoded}:ital,wght@1,900`]];
      const urls = new Map<Variant, string>((await Promise.all(requests.map(async ([variant, query]) => {
        try {
          const response = await fetch(`https://fonts.googleapis.com/css2?family=${query}&display=swap`); if (!response.ok) return null;
          const css = await response.text(), matches = [...css.matchAll(/url\((https:\/\/[^)]+)\)/g)];
          return matches.length ? [variant, matches.at(-1)![1]] as [Variant, string] : null;
        } catch { return null; }
      }))).filter((item): item is [Variant, string] => item != null));
      if (!urls.get('regular')) throw new Error('Google Fonts did not return a compatible regular font');
      const paths: Partial<Record<Variant, string>> = {};
      await Promise.all([...urls].map(async ([variant, url]) => {
        const buffer = await fetch(url).then(response => response.arrayBuffer());
        const bytes = Array.from(new Uint8Array(buffer as ArrayBuffer));
        const saved = await invoke<FontOption>('save_google_font', { family, variant, bytes }); paths[variant] = saved.path;
        const weight = variant === 'black' || variant === 'blackItalic' ? '900' : variant === 'bold' || variant === 'boldItalic' ? '700' : '400';
        const style = variant.toLowerCase().includes('italic') ? 'italic' : 'normal';
        const face = new FontFace(family, `url(${url})`, { weight, style }); await face.load(); document.fonts.add(face);
      }));
      const font: FontOption = { family, path: paths.regular!, variants: paths };
      setFonts(current => [...current.filter(item => item.family.toLowerCase() !== font.family.toLowerCase()), font].sort((a, b) => a.family.localeCompare(b.family)));
      if (selectedText) editText({ ...selectedText, fontFamily: font.family, fontPath: font.path, fontBoldPath: paths.bold ?? '', fontBlackPath: paths.black ?? '', fontItalicPath: paths.italic ?? '', fontBoldItalicPath: paths.boldItalic ?? '', fontBlackItalicPath: paths.blackItalic ?? '' });
    } catch (error) { report(error); throw error; }
  }, [selectedText, editText, report]);
  const toggleFavoriteFont = useCallback((id: string) => setStore(current => {
    const favorites = current.settings.favoriteFonts ?? [];
    return { ...current, settings: { ...current.settings, favoriteFonts: favorites.includes(id) ? favorites.filter(item => item !== id) : [...favorites, id] } };
  }), []);
  const selectedVideoSegment = selectedClip?.track === 'video' ? segments.find(segment => segment.id === selectedClip.id) ?? null : null;
  const selectedMusicSegment = selectedClip?.track === 'music' ? music?.segments.find(segment => segment.id === selectedClip.id) ?? null : null;
  const selectedEffect = effects.find(effect => effect.id === selectedEffectId) ?? null;
  const colorFixValue = colorScope === 'all' ? (segments.every(segment => Math.abs(segment.colorFix - (segments[0]?.colorFix ?? 0)) < .001) ? segments[0]?.colorFix ?? 0 : selectedVideoSegment?.colorFix ?? 0) : selectedVideoSegment?.colorFix ?? 0;
  const setColorFix = (value: number) => {
    if (!selectedVideoSegment) return;
    editSegments(segments.map(segment => colorScope === 'all' || segment.id === selectedVideoSegment.id ? { ...segment, colorFix: value } : segment), true);
  };
  let selectedSource: Video | null = null, sourceOffset = 0;
  if (selectedVideoSegment) for (const source of videoSources) { if (selectedVideoSegment.start >= sourceOffset && selectedVideoSegment.start < sourceOffset + source.duration) { selectedSource = source; break; } sourceOffset += source.duration; }
  const inspectorTitle = selectedEffect ? selectedEffect.kind === 'darkGray' ? 'Black & white' : 'Impact flash' : selectedText ? 'Text' : layer === 'background' ? 'Background' : layer === 'gameplay' ? 'Gameplay' : layer === 'boost' ? 'Boost HUD' : selectedVideoSegment ? 'Video clip' : selectedMusicSegment ? 'Music clip' : 'Inspector';
  if (!ready)
    return <div className="boot">
      <img className="boot-logo" src="/branding/logo.png" alt="rlcut" />
      <span>Opening rlcut…</span>
    </div>;
  if (store.setupComplete && home) return <ProjectHome projects={store.projects} busy={projectLoading} alert={error ?? notice} onDismissAlert={() => { setError(null); setNotice(null); }} onNew={() => { resetProject(); setHome(false); }} onOpen={project => void openProject(project)} onImport={() => void importProjectFile()} onExport={project => void exportProjectFile(project)} onRename={(project, name) => {
    setStore(current => ({ ...current, projects: current.projects.map(item => item.id === project.id ? { ...item, name, updatedAt: Date.now() } : item) }));
    setNotice('Project renamed');
  }} onDelete={project => {
    if (!window.confirm(`Delete “${project.name}”? The source videos will not be deleted.`)) return;
    setStore(current => ({ ...current, projects: current.projects.filter(item => item.id !== project.id) }));
    if (currentProjectId === project.id) resetProject();
  }} onDuplicate={duplicateProject} onSettings={() => { setHome(false); setModal('settings'); }} />;
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
        {allPresets.map(p => <div className={`preset-row ${p.id === preset.id ? 'selected' : ''}`} key={p.id}>
          <button className="preset-item" onClick={() => select(p.id)}>
            <LayoutTemplate size={16} />
            <span>
              {p.name}{p.id === 'classic' && <small>BUILT-IN</small>}
            </span>
            {p.id === preset.id && <span className="selection-dot" />}
          </button>
          {p.id !== 'classic' && <div className="preset-actions">
            <button aria-label={`Rename ${p.name}`} title="Rename preset" onClick={() => managePreset(p.id)}><Pencil size={14} /></button>
            <button aria-label={`Delete ${p.name}`} title="Delete preset" onClick={() => remove(p.id)}><Trash2 size={14} /></button>
          </div>}
        </div>)}
      </div>
      <button className="subtle-button" onClick={create}>
        <Plus size={15} />Create preset</button>
      <button className="subtle-button" onClick={() => { setRename(preset.name); setModal('presets'); }}>
        <Layers3 size={15} />Manage presets</button>
      <div className="sidebar-bottom">
        <button className="nav-item" onClick={() => setModal('settings')}>
          <Settings2 size={17} />Settings<span className="version">{init?.version ? `v${init.version}` : 'preview'}</span>
        </button>
      </div>
    </aside>
    <main className="workspace">
      {init?.previewAudio === false && <div className="runtime-notice">Preview audio is unavailable in this Docker session. Playback is silent; exports retain audio. Restart with a working PulseAudio/PipeWire socket to hear preview audio.</div>}
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
      <Composition video={video} sourceVersion={sourceVersion} softwareRendering={init?.softwareRendering ?? false} playbackPath={proxyPath} proxyPreparing={proxyPreparing} preparation={preparation} segments={segments} music={music} musicFadeOut={store.settings.musicFadeOut ? store.settings.musicFadeDuration : null} effects={stackedEffects} texts={stackedTexts} selectedTextId={selectedTextId} onTextSelect={id => { lastTextEdit.current = 0; setSelectedTextId(id); setSelectedEffectId(null); setSelectedClip(null); setLayer(null); }} onTextChange={editText} preview={preview} preset={preset} before={before} colorPreviewBefore={colorPreviewBefore} guides={guides} layer={layer} setLayer={value => { setLayer(value); if (value) { setSelectedTextId(null); setSelectedEffectId(null); setSelectedClip(null); } }} change={change} importVideo={() => void importVideo()} quality={quality} playing={playing} timestamp={timestamp} onTimestamp={updatePlaybackTime} onPlayingChange={updatePlaying} onPlaybackError={report} onSourceFrame={source => setPreview({ source, composed: '', timestamp })} />
      {video && <Timeline duration={video.duration} sourceDurations={videoSources.map(source => source.duration)} timestamp={timestamp} playheadRef={playhead} segments={segments} music={music} markers={markers} effects={effects} effectTracks={effectTracks} selectedEffectId={selectedEffectId} texts={texts} textTracks={textTracks} selectedTextId={selectedTextId} onTextSelect={id => { lastTextEdit.current = 0; setSelectedTextId(id); setSelectedEffectId(null); setSelectedClip(null); setLayer(null); }} onTextEdit={editText} onTextSplit={splitText} onTextDelete={removeText} onAddText={addText} onAddTextTrack={addTextTrack} onDeleteTextTrack={removeTextTrack} onEffectAdd={addEffect} onEffectEdit={editEffect} onEffectDelete={removeEffect} onAddEffectTrack={addEffectTrack} onDeleteEffectTrack={removeEffectTrack} onEffectSelect={id => { lastEffectEdit.current = 0; setSelectedEffectId(id); setSelectedTextId(null); setSelectedClip(null); setLayer(null); }} playing={playing} playbackReady={Boolean(proxyPath && segments.length)} canUndo={undoStack.current.length > 0} canRedo={redoStack.current.length > 0} onSeek={value => { manualSeekUntil.current = performance.now() + 220; const next = clamp(value, 0, video.duration); playhead.current = next; setPlaying(false); setTimestamp(next); }} onPlay={togglePlayback} onUndo={undo} onRedo={redo} onImportVideo={() => void importVideo()} onImportMusic={() => { setPlaying(false); setModal('music'); }} onSelectionChange={(track, id) => { setSelectedTextId(null); setSelectedEffectId(null); setLayer(null); setSelectedClip({ track, id }); }}
        onMarker={(track, values) => {
          if (markers[track].length === values.length && markers[track].every((value, index) => Math.abs(value - values[index]) < .0001)) return;
          undoStack.current.push(snapshot());
          if (undoStack.current.length > 100) undoStack.current.shift();
          lastPresetEdit.current = 0; redoStack.current = [];
          setMarkers(current => ({ ...current, [track]: values }));
        }}
        onEdit={(track, next) => {
          const previous = track === 'video' ? segments : music?.segments ?? [];
          const volumeOnly = next.length === previous.length && next.every((s, index) => s.id === previous[index].id && s.start === previous[index].start && s.end === previous[index].end);
          if (track === 'video') { editSegments(next, volumeOnly); return; }
          if (!music) return;
          undoStack.current.push(snapshot());
          if (undoStack.current.length > 100) undoStack.current.shift();
          lastPresetEdit.current = 0;
          redoStack.current = [];
          if (!next.length) {
            setMusic(null);
            setMarkers(current => ({ ...current, music: [] }));
            setSelectedClip(null);
          } else { if (!sameCoverage(previous, next)) setMarkers(current => ({ ...current, music: markersAfterEdit(previous, next, current.music) })); setMusic({ ...music, segments: next }); }
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
        <div className="inspector-title-row">
          <span className="inspector-object-icon">
            {inspectorView === 'export' ? <Download size={17} /> : selectedEffect ? <Sparkles size={17} /> : selectedText ? <Pencil size={17} /> : layer === 'background' ? <Layers3 size={17} /> : layer === 'gameplay' ? <Film size={17} /> : layer === 'boost' ? <Gauge size={17} /> : selectedMusicSegment ? <Music2 size={17} /> : selectedVideoSegment ? <Palette size={17} /> : <SlidersHorizontal size={17} />}
          </span>
          <div>
            <span className="eyebrow">{inspectorView === 'export' ? 'DELIVERY' : 'SELECTED'}</span>
            <h2>{inspectorView === 'export' ? 'Export' : inspectorTitle}</h2>
          </div>
        </div>
        <span className="save-status">
          {preset.id === 'classic' ? <><ShieldCheck size={12} />{preset.name} · built-in</> : <><Check size={12} />{preset.name} · {saved ? 'saved' : 'saving…'}</>}
        </span>
      </div>
      <div className="inspector-tabs" role="tablist" aria-label="Inspector mode">
        <button role="tab" aria-selected={inspectorView === 'edit'} className={inspectorView === 'edit' ? 'active' : ''} onClick={() => setInspectorView('edit')}><SlidersHorizontal size={14} />Edit</button>
        <button role="tab" aria-selected={inspectorView === 'export'} className={inspectorView === 'export' ? 'active' : ''} onClick={() => setInspectorView('export')}><Download size={14} />Export</button>
      </div>
      <div className="inspector-scroll">
        {inspectorView === 'edit' ? <div className="inspector-pane">
          {!layer && !selectedEffect && !selectedText && !selectedVideoSegment && !selectedMusicSegment && <div className="selection-empty"><span className="selection-empty-icon"><SlidersHorizontal size={20} /></span><strong>What do you want to adjust?</strong><span>Select an element in the preview or timeline.</span><div className="layer-quick-actions"><button onClick={() => { setSelectedClip(null); setSelectedEffectId(null); setLayer('background'); }}><Layers3 size={15} /><span>Background</span></button><button onClick={() => { setSelectedClip(null); setSelectedEffectId(null); setLayer('gameplay'); }}><Film size={15} /><span>Gameplay</span></button><button onClick={() => { setSelectedClip(null); setSelectedEffectId(null); setLayer('boost'); }}><Gauge size={15} /><span>Boost HUD</span></button></div></div>}
          {selectedEffect && <FlashInspector value={selectedEffect} onChange={editEffect} onDelete={() => removeEffect(selectedEffect.id)} onPreview={() => { const source = editedToSource(segments, selectedEffect.time); playhead.current = source; setTimestamp(source); setPlaying(true); }} />}
          {selectedText && <TextInspector value={selectedText} fonts={fonts} favoriteFonts={store.settings.favoriteFonts ?? []} onChange={editText} onAddGoogleFont={addGoogleFont} onToggleFavoriteFont={toggleFavoriteFont} onDelete={() => removeText(selectedText.id)} />}
          {layer === 'background' && <Section title="Appearance" icon={<Layers3 size={16} />} reset={() => reset('background')}>
            <Slider label="Gaussian blur" value={preset.background.blur} max={100} step={1} defaultValue={classic.background.blur} onChange={blur => edit('background', { blur })} />
            <Slider label="Scale" value={preset.background.scale} min={1} max={2} defaultValue={classic.background.scale} onChange={scale => edit('background', { scale })} suffix="×" />
            <div className="two-controls">
              <Slider label="X offset" value={preset.background.x - .5} min={-.5} max={.5} defaultValue={classic.background.x - .5} onChange={x => edit('background', { x: x + .5 })} />
              <Slider label="Y offset" value={preset.background.y - .5} min={-.5} max={.5} defaultValue={classic.background.y - .5} onChange={y => edit('background', { y: y + .5 })} />
            </div>
            <Alignment width={0} height={0} onChange={(x, y) => edit('background', { x, y })} />
            <Slider label="Brightness" value={preset.background.brightness} min={-.5} max={.5} defaultValue={classic.background.brightness} onChange={brightness => edit('background', { brightness })} />
          </Section>}
          {layer === 'gameplay' && <Section title="Transform" icon={<Film size={16} />} reset={() => reset('gameplay')}>
            <Slider label="Gameplay scale" value={preset.gameplay.scale} min={.2} max={4} defaultValue={classic.gameplay.scale} onChange={scale => edit('gameplay', { scale })} suffix="×" />
            <div className="two-controls">
              <Slider label="X position" value={preset.gameplay.x - .5} min={-.5} max={.5} defaultValue={classic.gameplay.x - .5} onChange={x => edit('gameplay', { x: x + .5 })} />
              <Slider label="Y position" value={preset.gameplay.y - .5} min={-.5} max={.5} defaultValue={classic.gameplay.y - .5} onChange={y => edit('gameplay', { y: y + .5 })} />
            </div>
            <Alignment width={preset.gameplay.scale} height={preset.gameplay.scale * (video ? video.height / video.width : 9 / 16) * (quality === 480 ? 480 / 854 : 9 / 16)} onChange={(x, y) => edit('gameplay', { x, y })} />
            <button className="quiet-action" onClick={() => { edit('gameplay', { x: .5, y: .5 }); setLayer('gameplay'); }}><ScanLine size={14} />Center on canvas</button>
          </Section>}
          {layer === 'boost' && <>
            <Section title="Cutout" icon={<Gauge size={16} />} reset={() => reset('boost')}>
              <div className="setting-toggle compact flush">
                <div><strong>Show boost HUD</strong><small>Overlay the cropped meter above gameplay.</small></div>
                <input id="boost-enabled" aria-label="Show boost cutout" className="switch" type="checkbox" checked={b.enabled} onChange={e => edit('boost', { enabled: e.target.checked })} />
              </div>
              <button className="crop-button" disabled={!preview} onClick={() => { setPlaying(false); setLayer('boost'); setModal('crop'); }}>
                <Maximize2 size={15} />Edit source area<span>↗</span>
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
              <details className="crop-numbers">
                <summary>Precise source crop</summary>
                <div className="two-controls">
                  <Slider label="Crop X" value={b.crop.x} max={1 - b.crop.width} step={.001} onChange={x => edit('boost', { crop: { ...b.crop, x } })} />
                  <Slider label="Crop Y" value={b.crop.y} max={1 - b.crop.height} step={.001} onChange={y => edit('boost', { crop: { ...b.crop, y } })} />
                  <Slider label="Crop width" value={b.crop.width} min={.001} max={1 - b.crop.x} step={.001} onChange={width => edit('boost', { crop: { ...b.crop, width } })} />
                  <Slider label="Crop height" value={b.crop.height} min={.001} max={1 - b.crop.y} step={.001} onChange={height => edit('boost', { crop: { ...b.crop, height } })} />
                </div>
              </details>
            </Section>
            <Section title="Entrance animation" icon={<ArrowRight size={16} />}>
              <div className="setting-toggle compact">
                <div><strong>Animate from the left</strong><small>Previewed directly on the timeline.</small></div>
                <input className="switch" type="checkbox" aria-label="Add boost entrance animation" checked={b.intro.enabled} onChange={e => edit('boost', { intro: { ...b.intro, enabled: e.target.checked } })} />
              </div>
              {b.intro.enabled && <div className="boost-intro-settings">
                <Slider label="Duration" value={b.intro.duration} min={.1} max={5} step={.05} defaultValue={classic.boost.intro.duration} onChange={value => edit('boost', { intro: { ...b.intro, duration: value } })} suffix="s" />
                <label className="field">Easing<Dropdown label="Boost entrance easing" value={b.intro.easing} onChange={value => edit('boost', { intro: { ...b.intro, easing: value as typeof b.intro.easing } })} options={[{ value: 'linear', label: 'Linear' }, { value: 'ease', label: 'Ease' }, { value: 'easeIn', label: 'Ease in' }, { value: 'easeOut', label: 'Ease out' }, { value: 'easeInOut', label: 'Ease in-out' }]} /></label>
              </div>}
            </Section></>}
          {selectedMusicSegment && music && <Section title="Ending" icon={<Music2 size={16} />}>
            <div className="setting-toggle compact">
              <div><strong>Fade at timeline end</strong><small>So the music does not stop abruptly.</small></div>
              <input className="switch" type="checkbox" aria-label="Fade music at end" checked={store.settings.musicFadeOut} onChange={e => setStore(current => ({ ...current, settings: { ...current.settings, musicFadeOut: e.target.checked } }))} />
            </div>
            {store.settings.musicFadeOut && <div className="music-fade-settings"><Slider label="Fade duration" value={store.settings.musicFadeDuration} min={.1} max={10} step={.1} defaultValue={.5} onChange={value => setStore(current => ({ ...current, settings: { ...current.settings, musicFadeDuration: value } }))} suffix="s" /></div>}
          </Section>}
          {selectedVideoSegment && <Section title="Color correction" icon={<Palette size={16} />}>
            <div className="color-scope" role="group" aria-label="Color correction scope"><button className={colorScope === 'clip' ? 'active' : ''} onClick={() => setColorScope('clip')}>This clip</button><button className={colorScope === 'all' ? 'active' : ''} onClick={() => setColorScope('all')}>All clips</button></div>
            <div className="setting-toggle compact"><div><strong>Recover washed colors</strong>{selectedSource && matchesHdr(selectedSource.colorTransfer) && <small>HDR source · automatic tone mapping is active</small>}</div><input className="switch" type="checkbox" aria-label="Recover washed colors" checked={colorFixValue > 0} onChange={event => { setColorPreviewBefore(false); setColorFix(event.target.checked ? .5 : 0); }} /></div>
            {colorFixValue > 0 && <><div className="color-preview-toggle"><span>Preview at playhead</span><div><button className={colorPreviewBefore ? 'active' : ''} onClick={() => { setBefore(false); setColorPreviewBefore(true); }}>Before</button><button className={!colorPreviewBefore ? 'active' : ''} onClick={() => { setBefore(false); setColorPreviewBefore(false); }}>After</button></div></div><Slider label="Recovery strength" value={colorFixValue} min={.1} max={1} step={.05} defaultValue={.5} onChange={setColorFix} suffix="×" /></>}
          </Section>}
        </div> : <div className="inspector-pane export-pane">
          <Section title="Video" icon={<Film size={16} />}>
            <div className="two-controls">
              <label className="field">Resolution<Dropdown label="Resolution" value={quality} onChange={value => setQuality(Number(value))} options={[{ value: 480, label: '480p · 480 × 854' }, { value: 720, label: '720p · 720 × 1280' }, { value: 1080, label: '1080p · 1080 × 1920' }]} />
              </label>
              <label className="field">Frame rate<Dropdown label="Frame rate" value={fps} onChange={value => setFps(Number(value))} options={aiEnhance ? [{ value: 60, label: '60 FPS · AI 30 → 60' }, { value: 120, label: '120 FPS · AI 60 → 120' }] : [{ value: 30, label: '30 FPS' }, { value: 60, label: '60 FPS' }]} />
              </label>
            </div>
          </Section>
          <Section title="AI enhancement" icon={<Gauge size={16} />}>
            <label className="setting-toggle compact">
              <div><strong>AI smooth export</strong><small>Optional · RIFE frame interpolation</small></div>
              <input className="switch" type="checkbox" aria-label="AI smooth export" disabled={exporting || exportStarting} checked={aiEnhance} onChange={event => { const enabled = event.target.checked; setAiEnhance(enabled); if (enabled) { setFps(video && video.fps >= 50 ? 120 : 60); } else if (fps === 120) setFps(60); }} />
            </label>
            <label className="setting-toggle compact">
              <div><strong>AI upscale / enhance</strong><small>Optional · video first, text and music last</small></div>
              <input className="switch" type="checkbox" aria-label="AI upscale or enhance output" disabled={exporting || exportStarting} checked={aiUpscale} onChange={event => setAiUpscale(event.target.checked)} />
            </label>
            {aiUpscale && <>
              <label className="field">AI model<Dropdown label="AI model" value={aiUpscaleLite ? 'lite' : 'fast'} onChange={value => setAiUpscaleLite(value === 'lite')} options={[{ value: 'fast', label: 'Fast · compact video model' }, { value: 'lite', label: 'Upscayl Lite · general images' }]} /></label>
              <label className="field">AI output size<Dropdown label="AI output size" value={aiKeepResolution ? 'keep' : 'double'} onChange={value => setAiKeepResolution(value === 'keep')} options={[{ value: 'keep', label: 'Keep selected size · less AI work' }, { value: 'double', label: 'Double selected size · more AI work' }]} /></label>
              <div className="output-resolution-note"><strong>{quality * (aiKeepResolution ? 1 : 2)} × {(quality === 480 ? 854 : quality === 720 ? 1280 : 1920) * (aiKeepResolution ? 1 : 2)}</strong><span>Final AI output</span></div>
            </>}
            {(aiEnhance || aiUpscale) && <details className="inspector-help"><summary>How AI processing works</summary><p>Gameplay is processed first, then boost, text, and music are applied. Completed AI frames are cached so interrupted exports can continue.</p></details>}
            {!init?.aiAvailable && <div className="inline-warning">AI runtime is not available in this build.</div>}
          </Section>
          <Section title="File" icon={<FolderOpen size={16} />}>
            <div className="export-size-estimate"><span>Estimated size</span><strong>{estimatedExportSize}</strong><small>Content-aware encoding can vary within this range.</small></div>
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
        </div>}
      </div>
      <div className="export-bottom">
        {progress && <div className={`export-progress ${progress.phase}`}>
          <div className="row">
            <strong>
              {progress.phase === 'running' ? `${progress.stage || 'Exporting'} · ${progress.percent.toFixed(0)}%` : progress.phase === 'complete' ? 'Your clip is ready' : progress.phase === 'canceled' ? 'Export canceled' : 'Export failed'}
            </strong>
            {progress.phase === 'running' ? <button aria-label="Cancel export" onClick={() => void invoke('cancel_export').catch(report)}>
              <X size={16} />
            </button> : <CheckCircle2 size={16} />}
          </div>
          {progress.warning && <p role="status" className="enhancement-note">{progress.warning}</p>}
          {progress.error && <p role="alert" className="enhancement-note">{progress.error}</p>}
          <progress max="100" value={progress.percent} />
          <small>
            {duration(progress.elapsed)} elapsed{progress.remaining != null ? ` · ${duration(progress.remaining)} remaining` : ''}
          </small>
          {progress.phase === 'complete' && <div className="row">
            <button onClick={() => void invoke('open_export', { folder: false }).catch(report)}>Open file</button>
            <button onClick={() => void invoke('open_export', { folder: true }).catch(report)}>Open folder</button>
          </div>}
        </div>}
        <div className="export-summary"><div><small>Output</small><strong>{quality}p · {fps} FPS{aiEnhance || aiUpscale ? ' · AI' : ''}</strong></div>{inspectorView === 'edit' && <button title="Review export settings" aria-label="Review export settings" onClick={() => setInspectorView('export')}><Settings2 size={15} /></button>}</div>
        <button className="primary export-button" disabled={!video || exporting || exportStarting} onClick={() => void startExport()}>
          {exportStarting ? <LoaderCircle size={18} className="spin" /> : <ArrowDownToLine size={18} />}Export clip<kbd>⌘ E</kbd>
        </button>
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
      <div className="toast-actions">
        <button className="copy-error" title="Copy error" aria-label="Copy error" onClick={() => void navigator.clipboard.writeText(error).then(() => setErrorCopied(true)).catch(report)}>{errorCopied ? <Check size={14} /> : <Copy size={14} />}<span>{errorCopied ? 'Copied' : 'Copy error'}</span></button>
        <button aria-label="Dismiss error" title="Dismiss" onClick={() => setError(null)}><X size={16} /></button>
      </div>
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
    {modal === 'music' && <MusicLibrary favorites={store.settings.favoriteSongs} installed={store.settings.installedSongs} onFavoritesChange={(favoriteSongs: MusicLibrarySong[]) => setStore(current => ({ ...current, settings: { ...current.settings, favoriteSongs } }))} onInstalledChange={(installedSongs: MusicLibrarySong[]) => setStore(current => ({ ...current, settings: { ...current.settings, installedSongs } }))} onChooseLocal={importMusic} onUseInstalled={useInstalledMusic} onSaveOnline={saveOnlineMusic} onClose={() => setModal(null)} />}
    {(modal === 'presets' || modal === 'settings' || modal === 'shortcuts') && <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-heading">
          <div>
            <span className="eyebrow">YOUR WORKSPACE</span>
            <h2 id="modal-title">
              {modal === 'presets' ? 'Manage presets' : modal === 'shortcuts' ? 'Keyboard shortcuts' : 'Settings'}
            </h2>
          </div>
          <button aria-label="Close dialog" onClick={() => { setModal(null); if (!video) setHome(true); }}>
            <X size={20} />
          </button>
        </div>
        {modal === 'shortcuts' ? <div className="shortcuts-list">
          {shortcuts.map(([group, entries]) => <section key={group}><h3>{group}</h3>{entries.map(([keys, action]) => <div key={keys}><kbd>{keys}</kbd><span>{action}</span></div>)}</section>)}
        </div> : modal === 'presets' ? <>
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
            <button disabled={preset.id === 'classic'} onClick={() => remove()}>
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
          <label className="field">Music library folder<div className="folder-picker">
            <input value={store.settings.musicLibraryFolder} readOnly placeholder="Asked when you save your first song" />
            <button aria-label="Choose music library folder" onClick={() => void invoke<string | null>('pick_folder').then(folder => {
              if (folder) setStore(s => ({ ...s, settings: { ...s.settings, musicLibraryFolder: folder } }));
            }).catch(report)}><FolderOpen size={16} /></button>
          </div><span className="help-text">Downloaded songs stay here for offline reuse. Change this folder whenever you want.</span></label>
          <div className="modal-actions">
            <button onClick={() => setModal('shortcuts')}><Keyboard size={15} />View shortcuts</button>
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
            <button disabled={exporting || exportStarting} onClick={() => void invoke('clear_ai_cache').then(() => setNotice('Prepared AI video cache cleared')).catch(report)}><Trash2 size={15} />Clear AI cache</button>
            <button onClick={() => { setStore(s => ({ ...s, settings: structuredClone(initialStore.settings) })); setInit(data => data ? { ...data, storageError: null } : data); setNotice('App settings reset. Presets retained.'); }}>Reset settings</button>
            <button className="primary" onClick={() => { setAiEnhance(false); setAiUpscale(false); setQuality(store.settings.quality); setFps(store.settings.fps); setOutputFolder(store.settings.outputFolder); select(store.settings.defaultPreset); setModal(null); if (!video) setHome(true); }}>Apply defaults</button>
          </div>
          <p className="help-text">Keyboard and mouse controls are listed under View shortcuts.</p>
        </>}
      </div>
    </div>}
  </div>;
}
