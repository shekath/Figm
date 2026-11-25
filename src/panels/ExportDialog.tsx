import { useEffect, useMemo, useState } from 'react';
import { useEditor } from '../store/store';
import { exportNodes, exportSvgString } from '../lib/exporter';
import { generateHtml, reachableFrames, type HtmlExportOptions } from '../lib/htmlExport';
import { saveBlob } from '../lib/platform';

type Format = 'png' | 'jpg' | 'svg' | 'pdf' | 'html' | 'figma';
type Scope = 'selection' | 'frames' | 'page';

/** Unified export: raster/vector/PDF and design-to-HTML with live preview. */
export function ExportDialog() {
  const st = useEditor();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<Format>('html');
  const [scope, setScope] = useState<Scope>('frames');
  const [scale, setScale] = useState(2);
  const [html, setHtml] = useState<HtmlExportOptions>({ layout: 'flex', prototype: true, fitToViewport: true });
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = (e: Event) => {
      const f = (e as CustomEvent).detail?.format as Format | undefined;
      if (f) setFormat(f);
      const s = useEditor.getState();
      setScope(s.selection.length ? 'selection' : 'frames');
      setOpen(true);
    };
    window.addEventListener('figmy:export', t);
    return () => window.removeEventListener('figmy:export', t);
  }, []);

  const page = st.page();
  const ids = useMemo(() => {
    const frames = page.children.filter((id) => ['frame', 'component', 'instance'].includes(st.doc.nodes[id]?.type));
    if (scope === 'selection' && st.selection.length) {
      if (format !== 'html') return st.selection;
      // HTML exports whole screens: lift selection to top-level frames
      const tops = new Set<string>();
      for (const id of st.selection) {
        let cur = st.doc.nodes[id];
        while (cur?.parentId) cur = st.doc.nodes[cur.parentId];
        if (cur) tops.add(cur.id);
      }
      const list = [...tops];
      return html.prototype ? reachableFrames(st.doc, list) : list;
    }
    if (scope === 'frames') return frames.length ? frames : page.children;
    return page.children;
  }, [scope, st.selection, st.doc, page, format, html.prototype]);

  const code = useMemo(() => {
    if (!open) return '';
    try {
      if (format === 'html') return generateHtml(st.doc, ids, { ...html, title: st.doc.name });
      if (format === 'svg') return ids.length ? exportSvgString(st.doc.nodes, ids) : '';
    } catch (e) {
      return `<!-- export failed: ${(e as Error).message} -->`;
    }
    return '';
  }, [open, format, ids, html, st.doc]);

  // raster preview
  useEffect(() => {
    if (!open || format === 'html' || format === 'svg' || format === 'figma' || !ids.length) return setPreview(null);
    let url: string | null = null;
    let alive = true;
    exportNodes(st.doc.nodes, ids.slice(0, 1), format === 'pdf' ? 'png' : format, 1)
      .then((b) => {
        if (!alive) return;
        url = URL.createObjectURL(b);
        setPreview(url);
      })
      .catch(() => setPreview(null));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [open, format, ids, st.doc.nodes]);

  if (!open) return null;
  const name = ids.length === 1 ? st.doc.nodes[ids[0]]?.name ?? 'export' : st.doc.name || 'export';
  const safe = name.replace(/[\\/:*?"<>|]+/g, '-');

  const download = async () => {
    if (!ids.length) return st.notify('Nothing to export');
    setBusy(true);
    try {
      if (format === 'figma') await saveBlob(new Blob([JSON.stringify(st.doc)], { type: 'application/json' }), `${safe}.figmy`);
      else if (format === 'html') await saveBlob(new Blob([code], { type: 'text/html' }), `${safe}.html`);
      else if (format === 'svg') await saveBlob(new Blob([code], { type: 'image/svg+xml' }), `${safe}.svg`);
      else if (format === 'pdf') await saveBlob(await exportNodes(st.doc.nodes, ids, 'pdf'), `${safe}.pdf`);
      else
        for (const id of ids) {
          const n = st.doc.nodes[id];
          await saveBlob(await exportNodes(st.doc.nodes, [id], format, scale), `${(n?.name ?? 'layer').replace(/[\\/:*?"<>|]+/g, '-')}${scale !== 1 ? `@${scale}x` : ''}.${format}`);
        }
      st.notify('Exported');
    } catch (e) {
      st.notify('Export failed: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openPreview = () => {
    const w = window.open('', '_blank');
    if (w) {
      w.document.open();
      w.document.write(code);
      w.document.close();
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={() => setOpen(false)}>
      <div className="modal export-modal" onPointerDown={(e) => e.stopPropagation()}>
        <header>
          <h2>Export</h2>
          <button className="btn small" onClick={() => setOpen(false)}>Close</button>
        </header>
        <div className="export-layout">
          <aside className="export-options">
            <div className="field">
              <span>Format</span>
              <div className="seg">
                {(['html', 'png', 'jpg', 'svg', 'pdf', 'figma'] as Format[]).map((f) => (
                  <button key={f} className={format === f ? 'active' : ''} onClick={() => setFormat(f)}>
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span>What</span>
              <select className="select" value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
                <option value="selection" disabled={!st.selection.length}>Selection ({st.selection.length})</option>
                <option value="frames">All frames on “{page.name}”</option>
                <option value="page">Everything on “{page.name}”</option>
              </select>
              <small className="muted">{ids.length} item{ids.length === 1 ? '' : 's'}</small>
            </div>
            {(format === 'png' || format === 'jpg') && (
              <div className="field">
                <span>Scale</span>
                <select className="select" value={scale} onChange={(e) => setScale(Number(e.target.value))}>
                  {[0.5, 1, 1.5, 2, 3, 4].map((s) => (
                    <option key={s} value={s}>{s}x</option>
                  ))}
                </select>
              </div>
            )}
            {format === 'html' && (
              <>
                <div className="field">
                  <span>Layout</span>
                  <select className="select" value={html.layout} onChange={(e) => setHtml({ ...html, layout: e.target.value as HtmlExportOptions['layout'] })}>
                    <option value="flex">Responsive — auto layout → flexbox</option>
                    <option value="absolute">Pixel-perfect — absolute positions</option>
                  </select>
                </div>
                <label className="check"><input type="checkbox" checked={html.prototype} onChange={(e) => setHtml({ ...html, prototype: e.target.checked })} /> Include prototype interactions</label>
                <label className="check"><input type="checkbox" checked={html.fitToViewport} onChange={(e) => setHtml({ ...html, fitToViewport: e.target.checked })} /> Scale screens to fit the window</label>
                <p className="muted">One self-contained .html file: inline CSS, embedded images, real text, inline SVG vectors{html.prototype ? ', clickable navigation with transitions, overlays and scroll' : ''}.</p>
              </>
            )}
            <div className="row gap" style={{ marginTop: 12 }}>
              <button className="btn primary" disabled={busy || !ids.length} onClick={download}>
                {busy ? 'Exporting…' : `Export ${format.toUpperCase()}`}
              </button>
              {(format === 'html' || format === 'svg') && (
                <button className="btn" onClick={() => { navigator.clipboard?.writeText(code); st.notify('Code copied'); }}>Copy code</button>
              )}
              {format === 'html' && <button className="btn" onClick={openPreview}>Open in browser</button>}
            </div>
          </aside>
          <main className="export-preview">
            {format === 'figma' ? (
              <div className="pad">
                <h3>Open in Figma</h3>
                <ol className="muted">
                  <li>Export downloads this whole file as <b>.figmy</b>.</li>
                  <li>In Figma desktop: Plugins → Development → Import plugin from manifest… and pick <code>figma-plugin/manifest.json</code> from the Figmy repo (one-time).</li>
                  <li>Run <b>Figmy Importer</b> and choose the .figmy file.</li>
                </ol>
                <p className="muted">Pages, frames, auto layout, vectors, text, images, effects, components, variant sets, component properties, instances with overrides, prototype links and variables are rebuilt as native Figma layers.</p>
              </div>
            ) : format === 'html' ? (
              <iframe title="HTML preview" sandbox="allow-scripts" srcDoc={code} />
            ) : format === 'svg' ? (
              <div className="img-preview" dangerouslySetInnerHTML={{ __html: code }} />
            ) : preview ? (
              <div className="img-preview">
                <img src={preview} alt="Export preview" />
              </div>
            ) : (
              <div className="muted pad">Preview unavailable</div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
