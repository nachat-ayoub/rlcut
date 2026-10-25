import { useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, Eye, FolderOpen, KeyRound, LoaderCircle, Music2, Play, Search, Star, X } from 'lucide-react';
import type { MusicFile, MusicLibrarySong } from '../types';

type SearchResponse = {
  items?: { id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string; thumbnails?: { medium?: { url?: string }; high?: { url?: string } } } }[];
  error?: { message?: string };
};
type DetailsResponse = {
  items?: { id?: string; statistics?: { viewCount?: string }; contentDetails?: { duration?: string } }[];
  error?: { message?: string };
};

function isoDuration(value = '') {
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  return match ? Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0) : 0;
}
function clock(value: number) {
  const hours = Math.floor(value / 3600), minutes = Math.floor(value / 60) % 60, seconds = Math.floor(value) % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${minutes}:${String(seconds).padStart(2, '0')}`;
}
function clean(value = '') {
  if (typeof document === 'undefined') return value;
  const textarea = document.createElement('textarea'); textarea.innerHTML = value;
  return textarea.value;
}

export function MusicLibrary({ apiKey, favorites, installed, onApiKeyChange, onFavoritesChange, onInstalledChange, onClose, onChooseLocal, onUseInstalled }: {
  apiKey: string;
  favorites: MusicLibrarySong[];
  installed: MusicLibrarySong[];
  onApiKeyChange: (value: string) => void;
  onFavoritesChange: (value: MusicLibrarySong[]) => void;
  onInstalledChange: (value: MusicLibrarySong[]) => void;
  onClose: () => void;
  onChooseLocal: () => Promise<MusicFile | null>;
  onUseInstalled: (path: string) => Promise<boolean>;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MusicLibrarySong[]>([]);
  const [selected, setSelected] = useState<MusicLibrarySong | null>(null);
  const [view, setView] = useState<'search' | 'favorites'>('search');
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const search = async (event: FormEvent) => {
    event.preventDefault();
    const term = query.trim(), key = apiKey.trim();
    if (!term || !key) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(null);
    try {
      const parameters = new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: '18', q: term, key });
      const searchResponse = await fetch(`https://www.googleapis.com/youtube/v3/search?${parameters}`, { signal: controller.signal });
      const searchData = await searchResponse.json() as SearchResponse;
      if (!searchResponse.ok) throw new Error(searchData.error?.message || 'YouTube search failed.');
      const base = (searchData.items ?? []).flatMap(item => item.id?.videoId ? [{
        id: item.id.videoId,
        title: clean(item.snippet?.title),
        channel: clean(item.snippet?.channelTitle),
        thumbnail: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url || '',
        views: 0,
        duration: 0,
      }] : []);
      if (!base.length) { setResults([]); setSelected(null); return; }
      const detailParameters = new URLSearchParams({ part: 'statistics,contentDetails', id: base.map(item => item.id).join(','), key });
      const detailResponse = await fetch(`https://www.googleapis.com/youtube/v3/videos?${detailParameters}`, { signal: controller.signal });
      const detailData = await detailResponse.json() as DetailsResponse;
      if (!detailResponse.ok) throw new Error(detailData.error?.message || 'Could not load video details.');
      const details = new Map((detailData.items ?? []).map(item => [item.id, item]));
      const next = base.map(item => ({ ...item, views: Number(details.get(item.id)?.statistics?.viewCount ?? 0), duration: isoDuration(details.get(item.id)?.contentDetails?.duration) }));
      const installedById = new Map(installed.map(item => [item.id, item]));
      const merged = next.map(item => ({ ...item, localPath: installedById.get(item.id)?.localPath, localName: installedById.get(item.id)?.localName }));
      setResults(merged); setSelected(merged[0] ?? null); setView('search');
    } catch (reason) {
      if ((reason as Error).name !== 'AbortError') setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (request.current === controller) setLoading(false);
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
  const installedById = new Map(installed.map(item => [item.id, item]));
  const visible = (view === 'favorites' ? favorites : results).map(item => ({ ...item, localPath: installedById.get(item.id)?.localPath, localName: installedById.get(item.id)?.localName }));
  return <div className="modal-backdrop music-library-backdrop">
    <div className="modal music-library-modal" role="dialog" aria-modal="true" aria-labelledby="music-library-title">
      <header className="music-library-header">
        <div className="music-library-title"><span><Music2 size={19} /></span><div><small>MUSIC</small><h2 id="music-library-title">Find your soundtrack</h2></div></div>
        <div><button className="music-local-button" onClick={() => void importLocal()}><FolderOpen size={15} />Choose local audio</button><button aria-label="Close music library" onClick={onClose}><X size={19} /></button></div>
      </header>
      <div className="music-library-search-row">
        <form onSubmit={event => void search(event)}>
          <Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search songs, edits, phonk, creators…" aria-label="Search YouTube" /><button className="primary" disabled={loading || !query.trim() || !apiKey.trim()}>{loading ? <LoaderCircle className="spin" size={16} /> : 'Search'}</button>
        </form>
        <label className="youtube-key"><KeyRound size={14} /><input type="password" value={apiKey} onChange={event => onApiKeyChange(event.target.value)} placeholder="YouTube API key" aria-label="YouTube API key" /><span>Stored locally</span></label>
      </div>
      <div className="music-library-tabs"><div><button className={view === 'search' ? 'active' : ''} onClick={() => setView('search')}><Search size={13} />Search</button><button className={view === 'favorites' ? 'active' : ''} onClick={() => setView('favorites')}><Star size={13} fill={view === 'favorites' ? 'currentColor' : 'none'} />Favorites <span>{favorites.length}</span></button></div><small><CheckCircle2 size={12} />{installed.length} installed locally</small></div>
      {!apiKey.trim() && view === 'search' ? <div className="music-library-setup"><span><KeyRound size={22} /></span><strong>Connect YouTube search</strong><p>Add a YouTube Data API v3 key above. It stays in rlcut’s local settings and is used only for search metadata.</p><button onClick={() => void importLocal()}><FolderOpen size={15} />Continue with a local file</button></div> :
        <div className="music-library-content">
          <section className="music-results" aria-label="YouTube search results">
            {error && <div className="music-library-error">{error}</div>}
            {!loading && !error && !visible.length && <div className="music-results-empty">{view === 'favorites' ? <Star size={24} /> : <Search size={24} />}<strong>{view === 'favorites' ? 'No favorite songs yet' : 'Search YouTube'}</strong><span>{view === 'favorites' ? 'Use the star on any result to keep it here.' : 'Preview a result here, then match it with audio you are licensed to use.'}</span></div>}
            {visible.map(item => <article key={item.id} className={`music-result ${selected?.id === item.id ? 'selected' : ''}`}>
              <button className="music-result-main" onClick={() => setSelected(item)}>
                <span className="music-result-cover"><img src={item.thumbnail} alt="" /><i><Play size={13} fill="currentColor" /></i>{item.duration > 0 && <small>{clock(item.duration)}</small>}</span>
                <span className="music-result-copy"><strong>{item.title}</strong><span>{item.channel}</span><small><Eye size={11} />{Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(item.views)} views</small><em className={item.localPath ? 'installed' : ''}>{item.localPath ? <CheckCircle2 size={10} /> : <FolderOpen size={10} />}{item.localPath ? 'Installed' : 'Not installed'}</em></span>
              </button>
              <button className={`music-result-favorite ${favorites.some(song => song.id === item.id) ? 'active' : ''}`} title={favorites.some(song => song.id === item.id) ? 'Remove from favorites' : 'Add to favorites'} aria-label={favorites.some(song => song.id === item.id) ? `Remove ${item.title} from favorites` : `Favorite ${item.title}`} onClick={() => toggleFavorite(item)}><Star size={13} fill={favorites.some(song => song.id === item.id) ? 'currentColor' : 'none'} /></button>
            </article>)}
          </section>
          <aside className="music-audition">
            {selected ? <>
              <div className="youtube-player"><iframe key={selected.id} src={`https://www.youtube-nocookie.com/embed/${selected.id}?autoplay=0&playsinline=1&rel=0`} title={`Preview ${selected.title}`} allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowFullScreen /></div>
              <div className="music-audition-copy"><small>NOW PREVIEWING</small><strong>{selected.title}</strong><span>{selected.channel}</span></div>
              <button className="primary" onClick={() => void installSelected()}>{selected.localPath ? <CheckCircle2 size={16} /> : <FolderOpen size={16} />}{selected.localPath ? 'Use installed audio' : 'Match licensed audio file'}</button>
              <p>{selected.localPath ? `${selected.localName || 'Local audio'} is installed and available for this edit.` : 'YouTube allows search and embedded playback, but not copying its audio. Match a file you own or are licensed to use; rlcut remembers it for one-click reuse.'}</p>
            </> : <div className="music-audition-empty"><Play size={24} /><span>Select a result to preview it.</span></div>}
          </aside>
        </div>}
    </div>
  </div>;
}
