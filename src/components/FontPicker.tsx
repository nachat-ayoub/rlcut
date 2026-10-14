import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, CloudDownload, Search, X } from 'lucide-react';
import type { FontOption } from '../types';

const fallbackGoogleFonts = [
  'Anton', 'Archivo', 'Bebas Neue', 'Bitter', 'Bungee', 'Cairo', 'Comfortaa', 'DM Sans', 'Exo 2', 'Fira Sans',
  'Fredoka', 'Inter', 'Kanit', 'Lato', 'League Spartan', 'Lexend', 'Libre Baskerville', 'Lilita One', 'Lobster',
  'Manrope', 'Merriweather', 'Montserrat', 'Noto Sans', 'Nunito', 'Open Sans', 'Oswald', 'Outfit', 'Pacifico',
  'Permanent Marker', 'Playfair Display', 'Poppins', 'Press Start 2P', 'Prompt', 'Raleway', 'Roboto', 'Roboto Condensed',
  'Roboto Mono', 'Rubik', 'Russo One', 'Source Sans 3', 'Space Grotesk', 'Teko', 'Titillium Web', 'Ubuntu', 'Work Sans',
];

export function FontPicker({ value, fonts, onSystemFont, onGoogleFont }: {
  value: string;
  fonts: FontOption[];
  onSystemFont: (font: FontOption) => void;
  onGoogleFont: (family: string) => Promise<void>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [source, setSource] = useState<'system' | 'google'>('system'), [query, setQuery] = useState('');
  const [googleFonts, setGoogleFonts] = useState(fallbackGoogleFonts), [loading, setLoading] = useState(false), [installing, setInstalling] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: globalThis.PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => {
    if (!open || source !== 'google' || googleFonts.length > fallbackGoogleFonts.length) return;
    setLoading(true);
    fetch('https://fonts.google.com/metadata/fonts').then(response => response.text()).then(raw => {
      const json = JSON.parse(raw.replace(/^\)\]\}'\s*/, '')) as { familyMetadataList?: { family: string }[] };
      const names = json.familyMetadataList?.map(item => item.family).filter(Boolean) ?? [];
      if (names.length) setGoogleFonts(names.sort((a, b) => a.localeCompare(b)));
    }).catch(() => undefined).finally(() => setLoading(false));
  }, [open, source, googleFonts.length]);
  const normalized = query.trim().toLocaleLowerCase();
  const systemResults = useMemo(() => fonts.filter(font => !normalized || font.family.toLocaleLowerCase().includes(normalized)).slice(0, 100), [fonts, normalized]);
  const googleResults = useMemo(() => googleFonts.filter(family => !normalized || family.toLocaleLowerCase().includes(normalized)).slice(0, 100), [googleFonts, normalized]);
  return <div className="font-picker" ref={root}>
    <button type="button" className={`font-picker-trigger ${open ? 'open' : ''}`} onClick={() => setOpen(current => !current)}><span style={{ fontFamily: value }}>{value || 'Choose a font'}</span><ChevronDown size={15} /></button>
    {open && <div className="font-picker-popover">
      <div className="font-source-tabs"><button className={source === 'system' ? 'active' : ''} onClick={() => setSource('system')}>Installed</button><button className={source === 'google' ? 'active' : ''} onClick={() => setSource('google')}><CloudDownload size={13} />Google Fonts</button></div>
      <label className="font-search"><Search size={14} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${source === 'system' ? 'installed' : 'Google'} fonts`} />{query && <button onClick={() => setQuery('')} aria-label="Clear font search"><X size={13} /></button>}</label>
      <div className="font-results">
        {source === 'system' ? systemResults.map(font => <button key={font.path} className={font.family === value ? 'selected' : ''} style={{ fontFamily: font.family }} onClick={() => { onSystemFont(font); setOpen(false); }}><span>{font.family}</span>{font.family === value && <Check size={14} />}</button>) : googleResults.map(family => <button key={family} disabled={Boolean(installing)} className={family === value ? 'selected' : ''} style={{ fontFamily: family }} onClick={async () => { setInstalling(family); try { await onGoogleFont(family); setOpen(false); setQuery(''); } catch { /* The editor toast shows the download error. */ } finally { setInstalling(null); } }}><span>{installing === family ? `Installing ${family}…` : family}</span><CloudDownload className={installing === family ? 'spin' : ''} size={13} /></button>)}
        {!loading && !(source === 'system' ? systemResults : googleResults).length && <div className="font-empty">No matching fonts</div>}
        {loading && <div className="font-empty">Loading Google Fonts…</div>}
      </div>
    </div>}
  </div>;
}
