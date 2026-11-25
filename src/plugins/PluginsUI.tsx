import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store/store';
import { loadPlugins, newPluginTemplate, pluginFromFiles, removePlugin, runPlugin, sendFromUI, upsertPlugin, validateManifest, type InstalledPlugin, type RunningPlugin } from './runtime';

const BUILTINS = [
  { id: 'builtin:research', name: 'Research Kit', blurb: 'Personas, journey maps, sitemaps, affinity maps…', icon: '✦', run: () => window.dispatchEvent(new CustomEvent('figmy:research')) },
  { id: 'builtin:variables', name: 'Variables', blurb: 'Design tokens with modes and aliases', icon: '◈', run: () => window.dispatchEvent(new Event('figmy:variables')) },
  { id: 'builtin:export-figma', name: 'Export for Figma', blurb: 'Save a .figmy file for the Figmy Importer plugin', icon: '⇪', run: () => window.dispatchEvent(new CustomEvent('figmy:export', { detail: { format: 'figma' } })) },
];

function pickFolder(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}
function pickFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.json,.js,.html,.htm';
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}

/** “Plugins & widgets” popover opened from the dock. */
export function PluginsPanel({ onClose }: { onClose: () => void }) {
  const st = useEditor();
  const [plugins, setPlugins] = useState<InstalledPlugin[]>(loadPlugins);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'all' | 'plugins' | 'widgets'>('plugins');
  const [menu, setMenu] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const ch = () => setPlugins(loadPlugins());
    window.addEventListener('figmy:plugins-changed', ch);
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('.tool-dock')) onClose(); };
    setTimeout(() => window.addEventListener('pointerdown', down), 0);
    return () => { window.removeEventListener('figmy:plugins-changed', ch); window.removeEventListener('pointerdown', down); };
  }, [onClose]);
  const query = q.trim().toLowerCase();
  const mine = plugins.filter((p) => !query || p.name.toLowerCase().includes(query));
  const builtins = BUILTINS.filter((b) => !query || b.name.toLowerCase().includes(query));
  const run = (p: InstalledPlugin) => { window.dispatchEvent(new CustomEvent('figmy:run-plugin', { detail: { id: p.id } })); onClose(); };
  const doImport = async (folder: boolean) => {
    setError(null);
    const files = folder ? await pickFolder() : await pickFiles();
    if (!files.length) return;
    try {
      const p = await pluginFromFiles(files);
      upsertPlugin(p);
      st.notify(`Imported plugin “${p.name}”`);
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="pw" ref={ref} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}>
      <div className="pw-search">
        <span>⌕</span>
        <input autoFocus placeholder="Search plugins" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="pw-tabs">
        {(['all', 'plugins', 'widgets'] as const).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'all' ? 'All' : t === 'plugins' ? 'Plugins' : 'Widgets'}</button>
        ))}
      </div>
      <div className="pw-list">
        {tab !== 'widgets' && (
          <>
            {mine.map((p) => (
              <div key={p.id} className="pw-item" onClick={() => run(p)} title={`Run ${p.name}`}>
                <span className="pw-ico dev">{'</>'}</span>
                <div className="pw-text">
                  <div className="pw-name">{p.name} <span className="pw-tag">{p.source === 'editor' ? 'Draft' : 'Development'}</span></div>
                  <div className="pw-sub">{p.path ?? (p.source === 'editor' ? 'Created in Figmy' : 'Imported')}</div>
                </div>
                <button className="pw-more" title="More" onClick={(e) => { e.stopPropagation(); setMenu(menu === p.id ? null : p.id); }}>•••</button>
                {menu === p.id && (
                  <div className="pw-menu" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => run(p)}>Run</button>
                    <button onClick={() => { window.dispatchEvent(new CustomEvent('figmy:edit-plugin', { detail: { id: p.id } })); onClose(); }}>Edit code…</button>
                    {p.source === 'manifest' && <button onClick={() => { setMenu(null); doImport(true); }}>Reload from folder…</button>}
                    <button onClick={() => { const blob = new Blob([JSON.stringify({ manifest: p.manifest, code: p.code, ui: p.ui }, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${p.name.replace(/[^a-z0-9]+/gi, '-')}.figmy-plugin.json`; a.click(); setMenu(null); }}>Download</button>
                    <hr />
                    <button className="danger" onClick={() => { if (confirm(`Remove “${p.name}”?`)) removePlugin(p.id); setMenu(null); }}>Remove</button>
                  </div>
                )}
              </div>
            ))}
            <button className="pw-action" onClick={() => { const name = prompt('Plugin name', 'My plugin'); if (!name) return; const p = newPluginTemplate(name); upsertPlugin(p); window.dispatchEvent(new CustomEvent('figmy:edit-plugin', { detail: { id: p.id } })); onClose(); }}>
              <span className="pw-ico">＋</span> New plugin…
            </button>
          </>
        )}
        {tab !== 'plugins' && (
          <button className="pw-action" disabled title="Widgets (interactive objects that live on the canvas) are not supported yet">
            <span className="pw-ico">＋</span> New widget… <span className="pw-tag soon">Coming later</span>
          </button>
        )}
        {tab !== 'widgets' && (
          <>
            <button className="pw-action" onClick={() => doImport(true)}><span className="pw-ico">⤓</span> Import from manifest…</button>
            <button className="pw-link" onClick={() => doImport(false)}>or pick manifest.json and its files individually</button>
            {error && <div className="pw-error">{error}</div>}
            <div className="pw-section">Built-in</div>
            {builtins.map((b) => (
              <div key={b.id} className="pw-item" onClick={() => { b.run(); onClose(); }}>
                <span className="pw-ico builtin">{b.icon}</span>
                <div className="pw-text"><div className="pw-name">{b.name}</div><div className="pw-sub">{b.blurb}</div></div>
              </div>
            ))}
          </>
        )}
        {tab === 'widgets' && <div className="pw-empty">Widgets are interactive objects that live on the canvas (voting, timers, checklists). They aren’t supported yet; plugins are.</div>}
      </div>
    </div>
  );
}

/** Runs plugins and shows their UI in a floating, draggable window. */
export function PluginHost() {
  const [running, setRunning] = useState<RunningPlugin | null>(null);
  const [ui, setUI] = useState<{ html: string; w: number; h: number; title: string; visible: boolean } | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const uiFrame = useRef<HTMLIFrameElement>(null);
  const runRef = useRef<RunningPlugin | null>(null);
  const pending = useRef<unknown[]>([]);

  useEffect(() => {
    const start = (e: Event) => {
      const id = (e as CustomEvent).detail?.id;
      const p = loadPlugins().find((x) => x.id === id);
      if (!p) return;
      runRef.current?.stop();
      setUI(null);
      pending.current = [];
      const r = runPlugin(p, {
        onUI: (html, opts) => { setUI({ html, w: opts.width ?? 300, h: opts.height ?? 200, title: opts.title ?? p.name, visible: opts.visible !== false }); setPos({ x: window.innerWidth - (opts.width ?? 300) - 290, y: 70 }); },
        onToUI: (msg) => { const w = uiFrame.current?.contentWindow; if (w) w.postMessage({ pluginMessage: msg, pluginId: p.id }, '*'); else pending.current.push(msg); },
        onUIResize: (w, h) => setUI((u) => (u ? { ...u, w, h } : u)),
        onUIVisible: (v) => setUI((u) => (u ? { ...u, visible: v } : u)),
        onClose: () => { if (runRef.current === r) { runRef.current = null; setRunning(null); setUI(null); } },
      });
      runRef.current = r;
      setRunning(r);
    };
    window.addEventListener('figmy:run-plugin', start);
    // messages from the plugin UI → plugin main code
    const fromUI = (e: MessageEvent) => {
      if (!uiFrame.current || e.source !== uiFrame.current.contentWindow || !runRef.current) return;
      if (e.data && typeof e.data === 'object' && 'pluginMessage' in e.data) sendFromUI(runRef.current, e.data.pluginMessage);
    };
    window.addEventListener('message', fromUI);
    return () => { window.removeEventListener('figmy:run-plugin', start); window.removeEventListener('message', fromUI); runRef.current?.stop(); };
  }, []);

  if (!running || !ui || !ui.visible) return null;
  const drag = (e: React.PointerEvent) => {
    const sx = e.clientX - pos.x, sy = e.clientY - pos.y;
    const mv = (ev: PointerEvent) => setPos({ x: Math.max(0, Math.min(window.innerWidth - 120, ev.clientX - sx)), y: Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - sy)) });
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className="plugin-win" style={{ left: pos.x, top: pos.y, width: ui.w }} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <header onPointerDown={drag}>
        <span className="pw-ico dev small">{'</>'}</span>
        <b>{ui.title}</b>
        <button title="Close plugin" onPointerDown={(e) => e.stopPropagation()} onClick={() => running.stop()}>✕</button>
      </header>
      <iframe
        ref={uiFrame}
        title={`${running.plugin.name} UI`}
        sandbox="allow-scripts allow-forms allow-modals allow-popups"
        srcDoc={ui.html}
        style={{ height: ui.h }}
        onLoad={() => { const w = uiFrame.current?.contentWindow; pending.current.splice(0).forEach((msg) => w?.postMessage({ pluginMessage: msg }, '*')); }}
      />
    </div>
  );
}

/** Built-in code editor for creating and editing plugins (manifest, code.js, ui.html). */
export function PluginEditor() {
  const st = useEditor();
  const [p, setP] = useState<InstalledPlugin | null>(null);
  const [tab, setTab] = useState<'code' | 'ui' | 'manifest'>('code');
  const [manifestText, setManifestText] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const open = (e: Event) => {
      const found = loadPlugins().find((x) => x.id === (e as CustomEvent).detail?.id);
      if (found) { setP(found); setManifestText(JSON.stringify(found.manifest, null, 2)); setTab('code'); setError(null); }
    };
    window.addEventListener('figmy:edit-plugin', open);
    return () => window.removeEventListener('figmy:edit-plugin', open);
  }, []);
  if (!p) return null;
  const save = (andRun: boolean) => {
    try {
      const manifest = validateManifest(JSON.parse(manifestText));
      const next = { ...p, manifest, name: manifest.name, updatedAt: Date.now() };
      upsertPlugin(next);
      setP(null);
      st.notify(`Saved “${next.name}”`);
      if (andRun) setTimeout(() => window.dispatchEvent(new CustomEvent('figmy:run-plugin', { detail: { id: next.id } })), 50);
    } catch (e) { setError(`manifest.json: ${(e as Error).message}`); setTab('manifest'); }
  };
  const tabKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (e.key === 'Tab') {
      e.preventDefault();
      const t = e.currentTarget, s = t.selectionStart, v = t.value;
      const nv = v.slice(0, s) + '  ' + v.slice(t.selectionEnd);
      if (tab === 'code') setP({ ...p, code: nv }); else if (tab === 'ui') setP({ ...p, ui: nv }); else setManifestText(nv);
      requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2; });
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(false); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save(true); }
  };
  const value = tab === 'code' ? p.code : tab === 'ui' ? p.ui : manifestText;
  return (
    <div className="modal-backdrop" onPointerDown={() => setP(null)}>
      <div className="modal pe" onPointerDown={(e) => e.stopPropagation()}>
        <header className="pe-head">
          <b>{p.name}</b>
          <div className="pe-tabs">
            {(['code', 'ui', 'manifest'] as const).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'code' ? 'code.js' : t === 'ui' ? 'ui.html' : 'manifest.json'}</button>)}
          </div>
          <div className="grow" />
          <a className="pe-help" href="https://www.figma.com/plugin-docs/" target="_blank" rel="noreferrer">Plugin API docs ↗</a>
          <button className="btn small" onClick={() => setP(null)}>Close</button>
        </header>
        <textarea className="pe-code" spellCheck={false} value={value} onKeyDown={tabKey} onChange={(e) => { const v = e.target.value; if (tab === 'code') setP({ ...p, code: v }); else if (tab === 'ui') setP({ ...p, ui: v }); else setManifestText(v); }} />
        <footer className="pe-foot">
          <span className="muted">Uses the Figma plugin API (a common subset). Ctrl+S to save, Ctrl+Enter to save and run.</span>
          {error && <span className="error-text">{error}</span>}
          <div className="grow" />
          <button className="btn" onClick={() => save(false)}>Save</button>
          <button className="btn primary" onClick={() => save(true)}>Save & run</button>
        </footer>
      </div>
    </div>
  );
}
