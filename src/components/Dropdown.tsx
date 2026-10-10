import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
type Option = { value: string | number; label: string };
export function Dropdown({ label, value, options, onChange }: { label: string; value: string | number; options: Option[]; onChange: (value: string) => void }) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 160, maxHeight: 240 });
  const search = useRef({ text: '', time: 0 });
  const selected = Math.max(0, options.findIndex(o => String(o.value) === String(value)));
  function show(index = selected) {
    const rect = trigger.current!.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12, above = rect.top - 12;
    const height = Math.min(options.length * 38 + 12, 260);
    const upward = below < height && above > below;
    const maxHeight = Math.max(40, Math.min(height, upward ? above : below));
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - Math.max(160, rect.width) - 8)), top: upward ? rect.top - maxHeight - 6 : rect.bottom + 6, width: Math.min(Math.max(160, rect.width), window.innerWidth - 16), maxHeight });
    setActive(index); setOpen(true);
  }
  function choose(index: number) { onChange(String(options[index].value)); setOpen(false); trigger.current?.focus(); }
  useEffect(() => {
    if (!open) return;
    function outside(e: globalThis.PointerEvent) { if (!trigger.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node)) setOpen(false); }
    function dismiss(e: Event) { if (!menu.current?.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', dismiss); window.removeEventListener('scroll', dismiss, true); };
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, id]);
  function keyboard(e: KeyboardEvent) {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(e.key) || (e.key === 'Escape' && open)) { e.preventDefault(); e.stopPropagation(); }
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'Tab') { setOpen(false); return; }
    if (e.key === 'Enter' || e.key === ' ') { if (open) choose(active); else show(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!open) show(); else setActive((active + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    } else if (e.key === 'Home' || e.key === 'End') {
      const index = e.key === 'Home' ? 0 : options.length - 1;
      if (!open) show(index); else setActive(index);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now(); search.current = { text: (now - search.current.time < 800 ? search.current.text : '') + e.key.toLowerCase(), time: now };
      const index = options.findIndex(o => o.label.toLowerCase().startsWith(search.current.text));
      if (index >= 0) { e.preventDefault(); e.stopPropagation(); if (!open) show(index); else setActive(index); }
    }
  }
  return <span className="dropdown">
    <button ref={trigger} type="button" className={`dropdown-trigger ${open ? 'open' : ''}`} role="combobox" aria-label={label} aria-expanded={open} aria-controls={open ? `${id}-list` : undefined} aria-haspopup="listbox" aria-activedescendant={open ? `${id}-${active}` : undefined} onClick={() => open ? setOpen(false) : show()} onKeyDown={keyboard} onBlur={() => setOpen(false)}>
      <span>{options[selected]?.label}</span><ChevronDown size={15} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={menu} id={`${id}-list`} className="dropdown-menu" role="listbox" aria-label={label} style={position} onPointerDown={e => e.preventDefault()}>
      {options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option" aria-selected={index === selected} className={`dropdown-option ${index === active ? 'highlighted' : ''}`} onPointerMove={() => setActive(index)} onClick={() => choose(index)}><span>{option.label}</span>{index === selected && <Check size={14} aria-hidden="true" />}</div>)}
    </div>, document.body)}
  </span>;
}
