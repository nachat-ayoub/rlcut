import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, CloudDownload, Search, Star, X } from 'lucide-react';
import type { FontOption } from '../types';

import googleFontFamilies from '../data/google-fonts.json';

type FontResult = { id: string; source: 'system'; family: string; font: FontOption } | { id: string; source: 'google'; family: string };

export function FontPicker({ value, fonts, favorites, onSystemFont, onGoogleFont, onToggleFavorite }: {
  value: string;
  fonts: FontOption[];
  favorites: string[];
  onSystemFont: (font: FontOption) => void;
  onGoogleFont: (family: string) => Promise<void>;
  onToggleFavorite: (id: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [mode, setMode] = useState<'system' | 'google' | 'favorites'>('system'), [query, setQuery] = useState('');
  const googleFonts = googleFontFamilies;
  const [installing, setInstalling] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: globalThis.PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const normalized = query.trim().toLocaleLowerCase();
  const favoriteSet = useMemo(() => new Set(favorites.map(id => id.toLocaleLowerCase())), [favorites]);
  const results = useMemo(() => {
    const system = fonts.map<FontResult>(font => ({ id: `system:${font.family}`, source: 'system', family: font.family, font }));
    const google = googleFonts.map<FontResult>(family => ({ id: `google:${family}`, source: 'google', family }));
    const candidates = mode === 'favorites' ? [...system, ...google] : mode === 'system' ? system : google;
    const seen = new Set<string>();
    return candidates
      .filter(item => !normalized || item.family.toLocaleLowerCase().includes(normalized))
      // This final guard is deliberately applied after selecting the source catalog.
      // Favorites mode can therefore never render a row that is not a favorite.
      .filter(item => mode !== 'favorites' || favoriteSet.has(item.id.toLocaleLowerCase()))
      .filter(item => { const key = item.id.toLocaleLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; })
      .sort((a, b) => mode === 'favorites' ? a.family.localeCompare(b.family) : 0)
      .slice(0, 100);
  }, [favoriteSet, fonts, googleFonts, mode, normalized]);
  const chooseSystem = (font: FontOption) => { onSystemFont(font); setOpen(false); setQuery(''); };
  const chooseGoogle = async (family: string) => { setInstalling(family); try { await onGoogleFont(family); setOpen(false); setQuery(''); } catch { /* The editor toast shows the download error. */ } finally { setInstalling(null); } };
  return <div className="font-picker" ref={root}>
    <button type="button" className={`font-picker-trigger ${open ? 'open' : ''}`} onClick={() => setOpen(current => !current)}><span style={{ fontFamily: value }}>{value || 'Choose a font'}</span><ChevronDown size={15} /></button>
    {open && <div className="font-picker-popover">
      <div className="font-source-tabs"><button type="button" className={mode === 'system' ? 'active' : ''} onClick={() => setMode('system')}>Installed</button><button type="button" className={mode === 'google' ? 'active' : ''} onClick={() => setMode('google')}><CloudDownload size={13} />Google Fonts</button><button type="button" className={mode === 'favorites' ? 'active' : ''} onClick={() => setMode(current => current === 'favorites' ? 'system' : 'favorites')} title="Show only favorite fonts" aria-label="Show only favorite fonts"><Star size={13} fill={mode === 'favorites' ? 'currentColor' : 'none'} /></button></div>
      <label className="font-search"><Search size={14} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={mode === 'favorites' ? 'Search favorite fonts' : `Search ${mode === 'system' ? 'installed' : 'Google'} fonts`} />{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear font search"><X size={13} /></button>}</label>
      <div className="font-results">
        {results.map(item => { const favorite = favoriteSet.has(item.id.toLocaleLowerCase()); return <div className={`font-result ${item.family === value ? 'selected' : ''}`} key={item.id} style={{ fontFamily: item.family }}><button type="button" className="font-result-select" disabled={Boolean(installing)} onClick={() => item.source === 'system' ? chooseSystem(item.font) : void chooseGoogle(item.family)}><span>{installing === item.family ? `Installing ${item.family}…` : item.family}</span>{item.source === 'google' ? <CloudDownload className={installing === item.family ? 'spin' : ''} size={13} /> : item.family === value && <Check size={14} />}</button><button type="button" className={`font-favorite ${favorite ? 'active' : ''}`} title={favorite ? 'Remove from favorites' : 'Add to favorites'} aria-label={`${favorite ? 'Remove' : 'Add'} ${item.family} ${favorite ? 'from' : 'to'} favorites`} onClick={event => { event.stopPropagation(); onToggleFavorite(item.id); }}><Star size={14} fill={favorite ? 'currentColor' : 'none'} /></button></div>; })}
        {!results.length && <div className="font-empty">{mode === 'favorites' ? 'No favorite fonts yet' : 'No matching fonts'}</div>}
      </div>
    </div>}
  </div>;
}
