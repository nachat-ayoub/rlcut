import { useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, Download, Eye, FolderOpen, LoaderCircle, Music2, Play, Search, Star, X } from 'lucide-react';
import type { MusicFile, MusicLibrarySong } from '../types';
import { invoke, message } from '../lib/native';
type AudioPreview = { url: string; mime: string };
function clock(value: number) {
  const hours = Math.floor(value / 3600), minutes = Math.floor(value / 60) % 60, seconds = Math.floor(value) % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function MusicLibrary({ favorites, installed, onFavoritesChange, onInstalledChange, onClose, onChooseLocal, onUseInstalled }: {
  favorites: MusicLibrarySong[];
  installed: MusicLibrarySong[];
  onFavoritesChange: (value: MusicLibrarySong[]) => void;
  onInstalledChange: (value: MusicLibrarySong[]) => void;
  onClose: () => void;
  onChooseLocal: () => Promise<MusicFile | null>;
  onUseInstalled: (path: string) => Promise<boolean>;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MusicLibrarySong[]>([]);
  const [selected, setSelected] = useState<MusicLibrarySong | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playerVersion, setPlayerVersion] = useState(0);
  const [audioPreview, setAudioPreview] = useState<(AudioPreview & { id: string }) | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [view, setView] = useState<'search' | 'favorites' | 'downloaded'>('search');
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const previewRequest = useRef(0);
  const clearPreview = () => { previewRequest.current += 1; setPlayingId(null); setAudioPreview(null); setPreviewLoading(false); setPreviewError(null); };
  const search = async (event: FormEvent) => {
    event.preventDefault();
    const term = query.trim();
    if (!term) return;
    const id = ++request.current;
    setLoading(true); setError(null);
    try {
      const next = await invoke<MusicLibrarySong[]>('search_youtube', { query: term });
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
  const importLocal = async () => { if (await onChooseLocal()) onClose(); };
  const installSelected = async () => {
    if (!selected) return;
    if (selected.localPath) { if (await onUseInstalled(selected.localPath)) onClose(); return; }
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
    setSelected(item); setPlayingId(item.id); setAudioPreview(null); setPreviewLoading(true); setPreviewError(null);
    try {
      const preview = await invoke<AudioPreview>('youtube_audio_preview', { id: item.id });
      if (previewRequest.current !== token) return;
      setAudioPreview({ ...preview, id: item.id }); setPlayerVersion(version => version + 1);
    } catch (reason) {
      if (previewRequest.current === token) setPreviewError(message(reason));
    } finally {
      if (previewRequest.current === token) setPreviewLoading(false);
    }
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
        <form onSubmit={event => void search(event)}>
          <Search size={16} /><input value={query} maxLength={200} onChange={event => setQuery(event.target.value)} placeholder="Search songs, edits, phonk, creators…" aria-label="Search YouTube" /><button className="primary" disabled={loading || !query.trim()}>{loading ? <LoaderCircle className="spin" size={16} /> : 'Search'}</button>
        </form>
      </div>
      <div className="music-library-tabs"><div><button className={view === 'search' ? 'active' : ''} onClick={() => show('search')}><Search size={13} />Search</button><button className={view === 'favorites' ? 'active' : ''} onClick={() => show('favorites')}><Star size={13} fill={view === 'favorites' ? 'currentColor' : 'none'} />Favorites <span>{favorites.length}</span></button><button className={view === 'downloaded' ? 'active' : ''} onClick={() => show('downloaded')}><Download size={13} />Downloaded <span>{installed.length}</span></button></div><small>{visible.length} {visible.length === 1 ? 'result' : 'results'}</small></div>
      <div className="music-library-content">
        <section className="music-results" aria-label="YouTube search results">
          {error && <div className="music-library-error">{error}</div>}
          {!loading && !error && !visible.length && <div className="music-results-empty">{view === 'favorites' ? <Star size={24} /> : view === 'downloaded' ? <Download size={24} /> : <Search size={24} />}<strong>{view === 'favorites' ? 'No favorite songs yet' : view === 'downloaded' ? 'No downloaded songs yet' : 'Search YouTube'}</strong><span>{view === 'favorites' ? 'Use the star on any result to keep it here.' : view === 'downloaded' ? 'Match a search result with a local audio file to reuse it here.' : 'Preview a result, favorite it, or match it with audio you can use.'}</span></div>}
          {visible.map(item => <article key={item.id} className={`music-result ${selected?.id === item.id ? 'selected' : ''}`}>
            <div className="music-result-cover"><img src={item.thumbnail} alt="" /><button aria-label={`Play ${item.title}`} onClick={() => void play(item)}>{previewLoading && playingId === item.id ? <LoaderCircle className="spin" size={15} /> : <Play size={15} fill="currentColor" />}</button>{item.duration > 0 && <small>{clock(item.duration)}</small>}</div>
            <button className="music-result-copy" onClick={() => select(item)}><strong>{item.title}</strong><span>{item.channel}</span><span className="music-result-meta"><small><Eye size={11} />{Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(item.views)} views</small><em className={item.localPath ? 'installed' : ''}>{item.localPath ? <CheckCircle2 size={10} /> : <FolderOpen size={10} />}{item.localPath ? 'Downloaded' : 'Local file needed'}</em></span></button>
            <button className={`music-result-favorite ${favorites.some(song => song.id === item.id) ? 'active' : ''}`} title={favorites.some(song => song.id === item.id) ? 'Remove from favorites' : 'Add to favorites'} aria-label={favorites.some(song => song.id === item.id) ? `Remove ${item.title} from favorites` : `Favorite ${item.title}`} onClick={() => toggleFavorite(item)}><Star size={13} fill={favorites.some(song => song.id === item.id) ? 'currentColor' : 'none'} /></button>
          </article>)}
        </section>
        <aside className="music-audition">
          {selected ? <>
            <div className="youtube-player">{previewLoading && playingId === selected.id ? <div className="youtube-player-poster loading"><img src={selected.thumbnail} alt="" /><span><LoaderCircle className="spin" size={22} /></span><small>Preparing audio preview…</small></div> : audioPreview?.id === selected.id ? <div className="youtube-audio-preview"><img src={selected.thumbnail} alt="" /><div><small>AUDIO PREVIEW</small><strong>{selected.title}</strong><audio key={`${selected.id}-${playerVersion}`} controls autoPlay preload="auto"><source src={audioPreview.url} type={audioPreview.mime} /></audio></div></div> : <button className="youtube-player-poster" aria-label={`Play ${selected.title}`} onClick={() => void play(selected)}><img src={selected.thumbnail} alt="" /><span><Play size={22} fill="currentColor" /></span><small>Play audio preview</small></button>}</div>
            {previewError && <div className="music-preview-error"><span>{previewError}</span><button onClick={() => void play(selected)}>Try again</button></div>}
            <div className="music-audition-copy"><small>SELECTED TRACK</small><strong>{selected.title}</strong><span>{selected.channel}</span></div>
            <button className="primary" onClick={() => void installSelected()}>{selected.localPath ? <CheckCircle2 size={16} /> : <FolderOpen size={16} />}{selected.localPath ? 'Use downloaded audio' : 'Match local audio file'}</button>
            <p>{selected.localPath ? `${selected.localName || 'Local audio'} is available for this edit.` : 'Search and preview happen in rlcut. Match a local audio file you can use and rlcut will remember it for one-click reuse.'}</p>
          </> : <div className="music-audition-empty"><Play size={24} /><span>Select a result to preview it.</span></div>}
        </aside>
      </div>
    </div>
  </div>;
}
