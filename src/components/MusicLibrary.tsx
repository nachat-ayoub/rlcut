import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, Download, Eye, FolderOpen, Headphones, LoaderCircle, Music2, Pause, Play, Search, Star, X } from 'lucide-react';
import type { MusicFile, MusicLibrarySong } from '../types';
import { invoke, message } from '../lib/native';
type AudioSource = { path: string; mime: string };
type AudioPreview = AudioSource & { url: string };
function clock(value: number) {
  const hours = Math.floor(value / 3600), minutes = Math.floor(value / 60) % 60, seconds = Math.floor(value) % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function MusicLibrary({ favorites, installed, onFavoritesChange, onInstalledChange, onClose, onChooseLocal, onUseInstalled, onSaveOnline }: {
  favorites: MusicLibrarySong[];
  installed: MusicLibrarySong[];
  onFavoritesChange: (value: MusicLibrarySong[]) => void;
  onInstalledChange: (value: MusicLibrarySong[]) => void;
  onClose: () => void;
  onChooseLocal: () => Promise<MusicFile | null>;
  onUseInstalled: (path: string) => Promise<boolean>;
  onSaveOnline: (song: MusicLibrarySong) => Promise<MusicFile | null>;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MusicLibrarySong[]>([]);
  const [selected, setSelected] = useState<MusicLibrarySong | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playerVersion, setPlayerVersion] = useState(0);
  const [audioPreview, setAudioPreview] = useState<(AudioPreview & { id: string }) | null>(null);
  const [playback, setPlayback] = useState({ current: 0, duration: 0, playing: false });
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [view, setView] = useState<'search' | 'favorites' | 'downloaded'>('search');
  const [shortsOnly, setShortsOnly] = useState(false);
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const previewRequest = useRef(0);
  const player = useRef<HTMLAudioElement>(null);
  const previewUrl = useRef<string | null>(null);
  const autoStarted = useRef<string | null>(null);
  const releasePreviewUrl = () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); previewUrl.current = null; };
  useEffect(() => () => releasePreviewUrl(), []);
  const clearPreview = () => {
    previewRequest.current += 1; player.current?.pause(); releasePreviewUrl(); autoStarted.current = null;
    setPlayingId(null); setAudioPreview(null); setPreviewLoading(false); setPreviewError(null); setPlayback({ current: 0, duration: 0, playing: false });
  };
  const runSearch = async (term: string, onlyShorts: boolean) => {
    if (!term) return;
    const id = ++request.current;
    setLoading(true); setError(null);
    try {
      const next = await invoke<MusicLibrarySong[]>('search_youtube', { query: term, shortsOnly: onlyShorts });
      if (request.current !== id) return;
      const installedById = new Map(installed.map(item => [item.id, item]));
      const merged = next.map(item => ({ ...item, localPath: installedById.get(item.id)?.localPath, localName: installedById.get(item.id)?.localName }));
      setResults(merged); setSelected(merged[0] ?? null); clearPreview(); setView('search');
    } catch (reason) {
      if (request.current === id) setError(message(reason));
    } finally {
      if (request.current === id) setLoading(false);
    }
  };
  const search = (event: FormEvent) => { event.preventDefault(); void runSearch(query.trim(), shortsOnly); };
  const changeSearchScope = (onlyShorts: boolean) => {
    setShortsOnly(onlyShorts);
    const term = query.trim();
    if (term) void runSearch(term, onlyShorts);
  };
  const importLocal = async () => { if (await onChooseLocal()) onClose(); };
  const installSelected = async () => {
    if (!selected) return;
    if (selected.localPath) { if (await onUseInstalled(selected.localPath)) onClose(); return; }
    setSaving(true); setError(null);
    try {
      const file = await onSaveOnline(selected);
      if (!file) return;
      const linked = { ...selected, localPath: file.path, localName: file.name };
      onInstalledChange([...installed.filter(item => item.id !== linked.id), linked]);
      onClose();
    } finally { setSaving(false); }
  };
  const matchSelected = async () => {
    if (!selected) return;
    const file = await onChooseLocal();
    if (!file) return;
    const linked = { ...selected, localPath: file.path, localName: file.name };
    onInstalledChange([...installed.filter(item => item.id !== linked.id), linked]);
    onClose();
  };
  const toggleFavorite = (item: MusicLibrarySong) => onFavoritesChange(favorites.some(song => song.id === item.id) ? favorites.filter(song => song.id !== item.id) : [...favorites, { ...item, localPath: undefined, localName: undefined }]);
  const select = (item: MusicLibrarySong) => { setSelected(item); if (item.id !== selected?.id) clearPreview(); };
  const play = async (item: MusicLibrarySong) => {
    const token = ++previewRequest.current;
    player.current?.pause(); releasePreviewUrl(); autoStarted.current = null;
    setSelected(item); setPlayingId(item.id); setAudioPreview(null); setPreviewLoading(true); setPreviewError(null); setPlayback({ current: 0, duration: 0, playing: false });
    try {
      const extension = item.localPath?.split('.').pop()?.toLowerCase();
      const preview: AudioSource = item.localPath ? { path: item.localPath, mime: extension === 'mp3' ? 'audio/mpeg' : extension === 'ogg' || extension === 'opus' ? 'audio/ogg' : extension === 'wav' ? 'audio/wav' : 'audio/mp4' } : await invoke<AudioSource>('youtube_audio_preview', { id: item.id });
      const response = await invoke<ArrayBuffer | number[]>('audio_preview_bytes', { path: preview.path });
      const buffer = response instanceof ArrayBuffer ? response : Uint8Array.from(response).buffer as ArrayBuffer;
      const url = URL.createObjectURL(new Blob([buffer], { type: preview.mime }));
      if (previewRequest.current !== token) { URL.revokeObjectURL(url); return; }
      previewUrl.current = url; setAudioPreview({ ...preview, url, id: item.id }); setPlayerVersion(version => version + 1);
    } catch (reason) {
      if (previewRequest.current === token) setPreviewError(message(reason));
    } finally {
      if (previewRequest.current === token) setPreviewLoading(false);
    }
  };
  const togglePreview = () => {
    const audio = player.current;
    if (!audio) { if (selected) void play(selected); return; }
    if (audio.paused) void audio.play().catch(reason => setPreviewError(message(reason)));
    else audio.pause();
  };
  const show = (next: typeof view) => {
    const items = next === 'favorites' ? favorites : next === 'downloaded' ? installed : results;
    setView(next); setSelected(items[0] ?? null); clearPreview();
  };
  const installedById = new Map(installed.map(item => [item.id, item]));
  const visible = (view === 'favorites' ? favorites : view === 'downloaded' ? installed : results).map(item => ({ ...item, localPath: installedById.get(item.id)?.localPath, localName: installedById.get(item.id)?.localName }));
  return <div className="modal-backdrop music-library-backdrop">
    <div className="modal music-library-modal" role="dialog" aria-modal="true" aria-labelledby="music-library-title">
      <header className="music-library-header">
        <div className="music-library-title"><span><Music2 size={19} /></span><div><small>MUSIC</small><h2 id="music-library-title">Find your soundtrack</h2></div></div>
        <div><button className="music-local-button" onClick={() => void importLocal()}><FolderOpen size={15} />Choose local audio</button><button aria-label="Close music library" onClick={onClose}><X size={19} /></button></div>
      </header>
      <div className="music-library-search-row">
        <form onSubmit={search}>
          <Search size={16} /><input value={query} maxLength={200} onChange={event => setQuery(event.target.value)} placeholder="Search songs, edits, phonk, creators…" aria-label="Search YouTube" /><div className="music-search-scope" aria-label="YouTube search scope"><button type="button" className={!shortsOnly ? 'active' : ''} onClick={() => changeSearchScope(false)}>Videos + Shorts</button><button type="button" className={shortsOnly ? 'active' : ''} onClick={() => changeSearchScope(true)}>Shorts only</button></div><button className="primary" disabled={loading || !query.trim()}>{loading ? <LoaderCircle className="spin" size={16} /> : 'Search'}</button>
        </form>
      </div>
      <div className="music-library-tabs"><div><button className={view === 'search' ? 'active' : ''} onClick={() => show('search')}><Search size={13} />Search</button><button className={view === 'favorites' ? 'active' : ''} onClick={() => show('favorites')}><Star size={13} fill={view === 'favorites' ? 'currentColor' : 'none'} />Favorites <span>{favorites.length}</span></button><button className={view === 'downloaded' ? 'active' : ''} onClick={() => show('downloaded')}><Download size={13} />Downloaded <span>{installed.length}</span></button></div><small>{visible.length} {visible.length === 1 ? 'result' : 'results'}</small></div>
      <div className="music-library-content">
        <section className="music-results" aria-label="YouTube search results">
          {error && <div className="music-library-error">{error}</div>}
          {!loading && !error && !visible.length && <div className="music-results-empty">{view === 'favorites' ? <Star size={24} /> : view === 'downloaded' ? <Download size={24} /> : <Search size={24} />}<strong>{view === 'favorites' ? 'No favorite songs yet' : view === 'downloaded' ? 'No downloaded songs yet' : 'Search YouTube'}</strong><span>{view === 'favorites' ? 'Use the star on any result to keep it here.' : view === 'downloaded' ? 'Match a search result with a local audio file to reuse it here.' : 'Preview a result, favorite it, or match it with audio you can use.'}</span></div>}
          {visible.map(item => <article key={item.id} className={`music-result ${item.isShort ? 'short' : ''} ${selected?.id === item.id ? 'selected' : ''}`}>
            <div className="music-result-cover"><img src={item.thumbnail} alt="" /><button aria-label={`Play ${item.title}`} onClick={() => void play(item)}>{previewLoading && playingId === item.id ? <LoaderCircle className="spin" size={15} /> : <Play size={15} fill="currentColor" />}</button>{item.duration > 0 && <small>{clock(item.duration)}</small>}</div>
            <button className="music-result-copy" onClick={() => select(item)}><strong>{item.title}</strong><span>{item.channel}</span><span className="music-result-meta">{item.views > 0 && <small><Eye size={11} />{Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(item.views)} views</small>}{item.isShort && <small className="music-short-badge">Short</small>}<em className={item.localPath ? 'installed' : ''}>{item.localPath ? <CheckCircle2 size={10} /> : <FolderOpen size={10} />}{item.localPath ? 'Downloaded' : 'Local file needed'}</em></span></button>
            <button className={`music-result-favorite ${favorites.some(song => song.id === item.id) ? 'active' : ''}`} title={favorites.some(song => song.id === item.id) ? 'Remove from favorites' : 'Add to favorites'} aria-label={favorites.some(song => song.id === item.id) ? `Remove ${item.title} from favorites` : `Favorite ${item.title}`} onClick={() => toggleFavorite(item)}><Star size={13} fill={favorites.some(song => song.id === item.id) ? 'currentColor' : 'none'} /></button>
          </article>)}
        </section>
        <aside className="music-audition">
          {selected ? <>
            <div className="music-player-card">
              <div className="music-player-cover"><img src={selected.thumbnail} alt="" /><button aria-label={playback.playing ? 'Pause preview' : `Play ${selected.title}`} onClick={togglePreview}>{previewLoading && playingId === selected.id ? <LoaderCircle className="spin" size={22} /> : playback.playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</button></div>
              <div className="music-player-copy"><small>{selected.isShort ? 'YOUTUBE SHORT · AUDIO' : 'AUDIO PREVIEW'}</small><strong title={selected.title}>{selected.title}</strong><span>{selected.channel}</span></div>
              {audioPreview?.id === selected.id && <audio ref={player} key={`${selected.id}-${playerVersion}`} src={audioPreview.url} preload="auto" autoPlay onCanPlay={event => { if (autoStarted.current === selected.id) return; autoStarted.current = selected.id; void event.currentTarget.play().catch(reason => setPreviewError(message(reason))); }} onLoadedMetadata={event => setPlayback(value => ({ ...value, duration: Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0 }))} onTimeUpdate={event => setPlayback(value => ({ ...value, current: event.currentTarget.currentTime }))} onPlay={() => { setPreviewError(null); setPlayback(value => ({ ...value, playing: true })); }} onPause={() => setPlayback(value => ({ ...value, playing: false }))} onEnded={() => setPlayback(value => ({ ...value, current: 0, playing: false }))} onError={() => setPreviewError('This downloaded preview could not be decoded by the audio player.')} />}
              <div className="music-player-progress"><input aria-label="Audio preview position" type="range" min="0" max={Math.max(.01, playback.duration)} step=".01" value={Math.min(playback.current, Math.max(.01, playback.duration))} style={{ '--range-fill': `${playback.duration > 0 ? playback.current / playback.duration * 100 : 0}%` } as React.CSSProperties} onChange={event => { if (player.current) player.current.currentTime = Number(event.target.value); }} /><div><span>{clock(playback.current)}</span><span>{playback.duration > 0 ? clock(playback.duration) : '--:--'}</span></div></div>
              {!audioPreview && !previewLoading && <button className="music-preview-start" onClick={() => void play(selected)}><Headphones size={16} />Preview audio</button>}
            </div>
            {previewError && <div className="music-preview-error"><span>{previewError}</span><button onClick={() => void play(selected)}>Try again</button></div>}
            <button className="primary" disabled={saving} onClick={() => void installSelected()}>{saving ? <LoaderCircle className="spin" size={16} /> : selected.localPath ? <CheckCircle2 size={16} /> : <Download size={16} />}{saving ? 'Saving audio…' : selected.localPath ? 'Use downloaded audio' : 'Save offline & use'}</button>
            {!selected.localPath && <button className="music-match-local" disabled={saving} onClick={() => void matchSelected()}><FolderOpen size={14} />Match an existing audio file</button>}
            <p>{selected.localPath ? `${selected.localName || 'Local audio'} is available without Wi-Fi.` : 'Preview files are temporary and removed when rlcut closes. Save the track to your Music Library folder for offline reuse.'}</p>
          </> : <div className="music-audition-empty"><Play size={24} /><span>Select a result to preview it.</span></div>}
        </aside>
      </div>
    </div>
  </div>;
}
