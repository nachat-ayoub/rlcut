import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, CloudDownload, Search, Star, X } from 'lucide-react';
import type { FontOption } from '../types';

import googleFontFamilies from '../data/google-fonts.json';

type FavoriteFont = { id: string; source: 'system'; family: string; font: FontOption } | { id: string; source: 'google'; family: string };

export function FontPicker({ value, fonts, favorites, onSystemFont, onGoogleFont, onToggleFavorite }: {
  value: string;
  fonts: FontOption[];
  favorites: string[];
  onSystemFont: (font: FontOption) => void;
  onGoogleFont: (family: string) => Promise<void>;
  onToggleFavorite: (id: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [source, setSource] = useState<'system' | 'google'>('system'), [favoritesOnly, setFavoritesOnly] = useState(false), [query, setQuery] = useState('');
  const googleFonts = googleFontFamilies;
  const [installing, setInstalling] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: globalThis.PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const normalized = query.trim().toLocaleLowerCase();
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const systemResults = useMemo(() => fonts.filter(font => !normalized || font.family.toLocaleLowerCase().includes(normalized)).slice(0, 100), [fonts, normalized]);
  const googleResults = useMemo(() => googleFonts.filter(family => !normalized || family.toLocaleLowerCase().includes(normalized)).slice(0, 100), [googleFonts, normalized]);
  const favoriteResults = useMemo(() => favorites.flatMap<FavoriteFont>(id => {
    if (id.startsWith('system:')) {
      const family = id.slice(7), font = fonts.find(item => item.family.toLocaleLowerCase() === family.toLocaleLowerCase());
      return font ? [{ id, source: 'system' as const, family: font.family, font }] : [];
    }
    if (id.startsWith('google:')) {
      const family = id.slice(7);
      return [{ id, source: 'google' as const, family }];
    }
    return [];
  }).filter(item => !normalized || item.family.toLocaleLowerCase().includes(normalized)).slice(0, 100), [favorites, fonts, normalized]);
  const chooseSystem = (font: FontOption) => { onSystemFont(font); setOpen(false); setQuery(''); };
  const chooseGoogle = async (family: string) => { setInstalling(family); try { await onGoogleFont(family); setOpen(false); setQuery(''); } catch { /* The editor toast shows the download error. */ } finally { setInstalling(null); } };
  return <div className="font-picker" ref={root}>
    <button type="button" className={`font-picker-trigger ${open ? 'open' : ''}`} onClick={() => setOpen(current => !current)}><span style={{ fontFamily: value }}>{value || 'Choose a font'}</span><ChevronDown size={15} /></button>
    {open && <div className="font-picker-popover">
      <div className="font-source-tabs"><button className={!favoritesOnly && source === 'system' ? 'active' : ''} onClick={() => { setSource('system'); setFavoritesOnly(false); }}>Installed</button><button className={!favoritesOnly && source === 'google' ? 'active' : ''} onClick={() => { setSource('google'); setFavoritesOnly(false); }}><CloudDownload size={13} />Google Fonts</button><button className={favoritesOnly ? 'active' : ''} onClick={() => setFavoritesOnly(current => !current)} title="Show favorite fonts" aria-label="Show favorite fonts"><Star size={13} fill={favoritesOnly ? 'currentColor' : 'none'} /></button></div>
      <label className="font-search"><Search size={14} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={favoritesOnly ? 'Search favorite fonts' : `Search ${source === 'system' ? 'installed' : 'Google'} fonts`} />{query && <button onClick={() => setQuery('')} aria-label="Clear font search"><X size={13} /></button>}</label>
      <div className="font-results">
        {favoritesOnly ? favoriteResults.map(item => <div className={`font-result ${item.family === value ? 'selected' : ''}`} key={item.id} style={{ fontFamily: item.family }}><button className="font-result-select" disabled={Boolean(installing)} onClick={() => item.source === 'system' ? chooseSystem(item.font) : void chooseGoogle(item.family)}><span>{installing === item.family ? `Installing ${item.family}…` : item.family}</span>{item.source === 'google' ? <CloudDownload className={installing === item.family ? 'spin' : ''} size={13} /> : item.family === value && <Check size={14} />}</button><button className="font-favorite active" title="Remove from favorites" aria-label={`Remove ${item.family} from favorites`} onClick={() => onToggleFavorite(item.id)}><Star size={14} fill="currentColor" /></button></div>) : source === 'system' ? systemResults.map(font => { const id = `system:${font.family}`, favorite = favoriteSet.has(id); return <div className={`font-result ${font.family === value ? 'selected' : ''}`} key={font.path} style={{ fontFamily: font.family }}><button className="font-result-select" onClick={() => chooseSystem(font)}><span>{font.family}</span>{font.family === value && <Check size={14} />}</button><button className={`font-favorite ${favorite ? 'active' : ''}`} title={favorite ? 'Remove from favorites' : 'Add to favorites'} aria-label={`${favorite ? 'Remove' : 'Add'} ${font.family} ${favorite ? 'from' : 'to'} favorites`} onClick={() => onToggleFavorite(id)}><Star size={14} fill={favorite ? 'currentColor' : 'none'} /></button></div> }) : googleResults.map(family => { const id = `google:${family}`, favorite = favoriteSet.has(id); return <div className={`font-result ${family === value ? 'selected' : ''}`} key={family} style={{ fontFamily: family }}><button className="font-result-select" disabled={Boolean(installing)} onClick={() => void chooseGoogle(family)}><span>{installing === family ? `Installing ${family}…` : family}</span><CloudDownload className={installing === family ? 'spin' : ''} size={13} /></button><button className={`font-favorite ${favorite ? 'active' : ''}`} title={favorite ? 'Remove from favorites' : 'Add to favorites'} aria-label={`${favorite ? 'Remove' : 'Add'} ${family} ${favorite ? 'from' : 'to'} favorites`} onClick={() => onToggleFavorite(id)}><Star size={14} fill={favorite ? 'currentColor' : 'none'} /></button></div> })}
        {!(favoritesOnly ? favoriteResults : source === 'system' ? systemResults : googleResults).length && <div className="font-empty">{favoritesOnly ? 'No favorite fonts yet' : 'No matching fonts'}</div>}
      </div>
    </div>}
  </div>;
}
