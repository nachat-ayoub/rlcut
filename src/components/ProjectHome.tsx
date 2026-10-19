import { Clock3, Download, Film, FolderOpen, Plus, Settings2, Trash2 } from 'lucide-react';
import type { Project } from '../types';
import { filename } from '../lib/presets';

export function ProjectHome({ projects, busy, alert, onDismissAlert, onNew, onOpen, onDelete, onImport, onExport, onSettings }: {
  projects: Project[];
  busy: boolean;
  alert?: string | null;
  onDismissAlert: () => void;
  onNew: () => void;
  onOpen: (project: Project) => void;
  onDelete: (project: Project) => void;
  onImport: () => void;
  onExport: (project: Project) => void;
  onSettings: () => void;
}) {
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
        <button className="project-open" onClick={() => onOpen(project)} disabled={busy}>
          <span className="project-cover"><Film size={28} /><i>{project.videoPaths.length}</i></span>
          <strong>{project.name}</strong>
          <small><Clock3 size={12} />{new Date(project.updatedAt).toLocaleString()}</small>
          <span>{project.videoPaths[0] ? filename(project.videoPaths[0]) : 'No media'}</span>
        </button>
        <div className="project-card-actions">
          <button title="Export project file" aria-label={`Export ${project.name}`} onClick={() => onExport(project)}><Download size={15} /></button>
          <button title="Delete project" aria-label={`Delete ${project.name}`} onClick={() => onDelete(project)}><Trash2 size={15} /></button>
        </div>
      </article>)}</div> : <div className="project-empty"><Film size={30} /><strong>No projects yet</strong><span>Your edits are saved locally and will appear here.</span></div>}
    </section>
    {busy && <div className="project-opening"><span className="spin" />Opening project…</div>}
    {alert && <div className="project-alert" role="alert"><span>{alert}</span><button aria-label="Dismiss" onClick={onDismissAlert}>×</button></div>}
  </main>;
}
