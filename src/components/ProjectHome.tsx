import { useEffect, useRef, useState } from 'react';
import { Clock3, Copy, Download, Film, FolderOpen, Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import type { Project } from '../types';
import { filename } from '../lib/presets';
import { invoke, isDesktop } from '../lib/native';

function projectDate(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 10) return 'A few seconds ago';
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(timestamp);
}

export function ProjectHome({ projects, busy, alert, onDismissAlert, onNew, onOpen, onDelete, onDuplicate, onImport, onExport, onRename, onSettings }: {
  projects: Project[];
  busy: boolean;
  alert?: string | null;
  onDismissAlert: () => void;
  onNew: () => void;
  onOpen: (project: Project) => void;
  onDelete: (project: Project) => void;
  onDuplicate: (project: Project) => void;
  onImport: () => void;
  onExport: (project: Project) => void;
  onRename: (project: Project, name: string) => void;
  onSettings: () => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now());
  const cancelRename = useRef(false);
  const thumbnailKey = projects.map(project => project.videoPaths[0] ?? '').join('\n');
  useEffect(() => {
    if (!isDesktop()) return;
    const paths = [...new Set(projects.map(project => project.videoPaths[0]).filter((path): path is string => Boolean(path)))];
    if (!paths.length) { setThumbnails({}); return; }
    let active = true;
    void invoke<(string | null)[]>('project_thumbnails', { paths }).then(images => {
      if (!active) return;
      setThumbnails(Object.fromEntries(paths.flatMap((path, index) => images[index] ? [[path, images[index]!]] : [])));
    }).catch(() => { /* Missing media keeps the icon fallback. */ });
    return () => { active = false; };
  }, [thumbnailKey]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);
  const beginRename = (project: Project) => { cancelRename.current = false; setRenaming(project.id); setDraftName(project.name); };
  const finishRename = (project: Project) => {
    if (cancelRename.current) { cancelRename.current = false; setRenaming(null); return; }
    const name = draftName.trim();
    if (name && name !== project.name) onRename(project, name);
    setRenaming(null);
  };
  const sorted = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);
  return <main className="project-home">
    <header>
      <img src="/branding/logo.png" alt="rlcut" />
      <div className="project-home-actions">
        <button onClick={onImport}><FolderOpen size={16} />Import project</button>
        <button aria-label="Settings" title="Settings" onClick={onSettings}><Settings2 size={17} /></button>
      </div>
    </header>
    <section className="project-hero">
      <span className="eyebrow">YOUR EDITS</span>
      <h1>Projects</h1>
      <p>Pick up where you left off or start a new Rocket League edit.</p>
      <button className="primary" onClick={onNew} disabled={busy}><Plus size={18} />New project</button>
    </section>
    <section className="project-library">
      <div className="project-library-heading"><h2>Recent projects</h2><span>{projects.length} saved locally</span></div>
      {sorted.length ? <div className="project-grid">{sorted.map(project => <article className="project-card" key={project.id}>
        <button className="project-cover" onClick={() => onOpen(project)} disabled={busy} aria-label={`Open ${project.name}`}>
          {project.videoPaths[0] && thumbnails[project.videoPaths[0]] ? <img src={thumbnails[project.videoPaths[0]]} alt="" /> : <Film size={28} />}
          <i>{project.videoPaths.length}</i>
        </button>
        <div className="project-card-body">
          {renaming === project.id ? <form className="project-rename" onSubmit={event => { event.preventDefault(); finishRename(project); }}>
            <input autoFocus value={draftName} maxLength={80} aria-label="Project name" onChange={event => setDraftName(event.target.value)} onBlur={() => finishRename(project)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); cancelRename.current = true; event.currentTarget.blur(); } }} />
          </form> : <button className="project-title" onClick={() => onOpen(project)} disabled={busy} title={project.name}><strong>{project.name}</strong></button>}
          <small><Clock3 size={13} />{projectDate(project.updatedAt, now)}</small>
          <span>{project.videoPaths[0] ? filename(project.videoPaths[0]) : 'No media'}</span>
        </div>
        <div className="project-card-actions">
          <button title="Duplicate project" aria-label={`Duplicate ${project.name}`} onClick={() => onDuplicate(project)}><Copy size={14} /></button>
          <button title="Rename project" aria-label={`Rename ${project.name}`} onClick={() => beginRename(project)}><Pencil size={14} /></button>
          <button title="Export project file" aria-label={`Export ${project.name}`} onClick={() => onExport(project)}><Download size={15} /></button>
          <button title="Delete project" aria-label={`Delete ${project.name}`} onClick={() => onDelete(project)}><Trash2 size={15} /></button>
        </div>
      </article>)}</div> : <div className="project-empty"><Film size={30} /><strong>No projects yet</strong><span>Your edits are saved locally and will appear here.</span></div>}
    </section>
    {busy && <div className="project-opening"><span className="spin" />Opening project…</div>}
    {alert && <div className="project-alert" role="alert"><span>{alert}</span><button aria-label="Dismiss" onClick={onDismissAlert}>×</button></div>}
  </main>;
}
