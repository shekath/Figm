/**
 * Figmy plugin host: stores installed plugins, imports Figma-style manifests and runs plugins in a
 * sandboxed iframe (opaque origin + strict CSP). The plugin talks to Figmy only through postMessage.
 */
import { useEditor } from '../store/store';
import type { SceneNode } from '../types';
import { SANDBOX_SHIM } from './sandboxShim';
import { applyAutoLayout, fitGroup, relayoutAncestors, translateTree, resizeTree } from '../lib/layout';
import { textBoxSize } from '../lib/text';

export interface PluginManifest {
  name: string;
  id?: string;
  api?: string;
  main: string;
  ui?: string | Record<string, string>;
  editorType?: string[];
  networkAccess?: { allowedDomains?: string[]; reasoning?: string };
  menu?: { name: string; command: string }[];
  containsWidget?: boolean;
}
export interface InstalledPlugin {
  id: string;
  name: string;
  manifest: PluginManifest;
  code: string;
  ui: string;
  /** Where it came from: an imported manifest, the built-in editor, or a bundled plugin. */
  source: 'manifest' | 'editor' | 'builtin';
  path?: string;
  updatedAt: number;
}

const STORE = 'figmy:plugins';
export function loadPlugins(): InstalledPlugin[] {
  try { return JSON.parse(localStorage.getItem(STORE) ?? '[]'); } catch { return []; }
}
export function savePlugins(list: InstalledPlugin[]) {
  try { localStorage.setItem(STORE, JSON.stringify(list)); } catch { useEditor.getState().notify('Could not save plugins (storage is full)'); }
  window.dispatchEvent(new Event('figmy:plugins-changed'));
}
export function upsertPlugin(p: InstalledPlugin) {
  const list = loadPlugins().filter((x) => x.id !== p.id);
  savePlugins([p, ...list]);
}
export function removePlugin(id: string) { savePlugins(loadPlugins().filter((x) => x.id !== id)); }

/* ---------- manifest import ---------- */
export function validateManifest(m: unknown): PluginManifest {
  const o = m as Partial<PluginManifest>;
  if (!o || typeof o !== 'object') throw new Error('manifest.json is not a JSON object');
  if (!o.name || typeof o.name !== 'string') throw new Error('manifest.json needs a "name"');
  if (!o.main || typeof o.main !== 'string') throw new Error('manifest.json needs a "main" file (e.g. "code.js")');
  if (o.containsWidget) throw new Error('This is a widget. Figmy runs plugins only; widgets are not supported yet.');
  return o as PluginManifest;
}

/** Build a plugin from a set of files (manifest.json plus the files it references). */
export async function pluginFromFiles(files: File[]): Promise<InstalledPlugin> {
  const byName = new Map<string, File>();
  for (const f of files) {
    const rel = ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name;
    byName.set(rel, f);
    byName.set(f.name, f);
  }
  const mf = byName.get('manifest.json');
  if (!mf) throw new Error('Select the plugin folder, or manifest.json together with its code and UI files.');
  const manifest = validateManifest(JSON.parse(await mf.text()));
  const find = (path: string) => byName.get(path.replace(/^\.\//, '')) ?? byName.get(path.split('/').pop()!);
  const mainFile = find(manifest.main);
  if (!mainFile) throw new Error(`The main file "${manifest.main}" was not selected. Select the whole plugin folder (or include ${manifest.main}).`);
  const uiPath = typeof manifest.ui === 'string' ? manifest.ui : manifest.ui ? Object.values(manifest.ui)[0] : null;
  const uiFile = uiPath ? find(uiPath) : null;
  if (uiPath && !uiFile) throw new Error(`The UI file "${uiPath}" was not selected.`);
  return {
    id: `manifest:${manifest.id ?? manifest.name}`,
    name: manifest.name,
    manifest,
    code: await mainFile.text(),
    ui: uiFile ? await uiFile.text() : '',
    source: 'manifest',
    path: (mf as File & { webkitRelativePath?: string }).webkitRelativePath || mf.name,
    updatedAt: Date.now(),
  };
}

/* ---------- new plugin template ---------- */
export function newPluginTemplate(name: string): InstalledPlugin {
  const id = `editor:${Date.now().toString(36)}`;
  return {
    id,
    name,
    source: 'editor',
    updatedAt: Date.now(),
    manifest: { name, id, api: '1.0.0', main: 'code.js', ui: 'ui.html', editorType: ['figma'], networkAccess: { allowedDomains: ['none'] } },
    code: `// ${name}: runs in a sandbox with the Figma-compatible \`figma\` API.
figma.showUI(__html__, { width: 280, height: 200 });

figma.ui.onmessage = (msg) => {
  if (msg.type === 'create-shapes') {
    const nodes = [];
    for (let i = 0; i < msg.count; i++) {
      const shape = msg.shape === 'circle' ? figma.createEllipse() : figma.createRectangle();
      shape.x = i * 120;
      shape.resize(100, 100);
      shape.fills = [{ type: 'SOLID', color: { r: 0.36, g: 0.36, b: 0.97 } }];
      figma.currentPage.appendChild(shape);
      nodes.push(shape);
    }
    figma.currentPage.selection = nodes;
    figma.viewport.scrollAndZoomIntoView(nodes);
    figma.notify('Created ' + msg.count + ' shapes');
  }
  if (msg.type === 'cancel') figma.closePlugin();
};
`,
    ui: `<style>
  body { font: 12px Inter, system-ui, sans-serif; margin: 12px; color: #1e1e24; }
  label { display: block; margin: 8px 0 4px; } input, select { width: 100%; padding: 6px; box-sizing: border-box; }
  .row { display: flex; gap: 8px; margin-top: 12px; } button { flex: 1; padding: 8px; border-radius: 6px; border: 1px solid #ddd; background: #fff; cursor: pointer; }
  button.primary { background: #5b5bf7; color: #fff; border-color: #5b5bf7; }
</style>
<label>Count</label><input id="count" type="number" value="3" min="1" max="20">
<label>Shape</label><select id="shape"><option value="rect">Rectangle</option><option value="circle">Circle</option></select>
<div class="row"><button id="cancel">Cancel</button><button id="create" class="primary">Create</button></div>
<script>
  document.getElementById('create').onclick = () => parent.postMessage({ pluginMessage: { type: 'create-shapes', count: +document.getElementById('count').value, shape: document.getElementById('shape').value } }, '*');
  document.getElementById('cancel').onclick = () => parent.postMessage({ pluginMessage: { type: 'cancel' } }, '*');
</script>
`,
  };
}

/* ---------- running ---------- */
type Op =
  | { op: 'create'; node: SceneNode }
  | { op: 'update'; id: string; props: Partial<SceneNode> }
  | { op: 'remove'; id: string }
  | { op: 'reparent'; id: string; parentId: string | null; index: number }
  | { op: 'select'; ids: string[] }
  | { op: 'fit'; id: string };

/** Keys a plugin may set on a node (everything else is ignored). */
const ALLOWED = new Set(['name', 'visible', 'locked', 'opacity', 'rotation', 'x', 'y', 'w', 'h', 'fills', 'strokes', 'effects', 'radius', 'radii', 'clip', 'text', 'autoLayout', 'layoutSizing', 'pluginData', 'sides', 'innerRatio', 'points', 'closed']);
const NODE_TYPES = new Set(['frame', 'rect', 'ellipse', 'text', 'group', 'component', 'polygon', 'star', 'path']);

function sanitize(props: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) if (ALLOWED.has(k)) out[k] = v;
  return out as Partial<SceneNode>;
}

/** Apply a batch of plugin operations to the document as one undo step. */
export function applyOps(ops: Op[], pluginId: string, created: Set<string>) {
  const st = useEditor.getState();
  let select: string[] | null = null;
  st.mutate((d) => {
    const page = d.pages.find((p) => p.id === st.pageId)!;
    const touched = new Set<string>();
    const listOf = (parentId: string | null) => (parentId ? d.nodes[parentId]?.children : page.children);
    for (const o of ops) {
      if (o.op === 'create') {
        if (!NODE_TYPES.has(o.node.type) || d.nodes[o.node.id]) continue;
        const n = { ...(o.node as SceneNode), ...sanitize(o.node as unknown as Record<string, unknown>), id: o.node.id, type: o.node.type, children: [], parentId: o.node.parentId && d.nodes[o.node.parentId] ? o.node.parentId : null };
        if (n.text) Object.assign(n, n.text.autoResize === 'fixed' ? {} : textBoxSize(n.text, n.w));
        d.nodes[n.id] = n as SceneNode;
        (listOf(n.parentId) ?? page.children).push(n.id);
        created.add(n.id);
        touched.add(n.id);
      } else if (o.op === 'update') {
        const n = d.nodes[o.id];
        if (!n) continue;
        const p = sanitize(o.props as Record<string, unknown>);
        if (p.x !== undefined || p.y !== undefined) translateTree(d.nodes, n.id, (p.x ?? n.x) - n.x, (p.y ?? n.y) - n.y);
        if ((p.w !== undefined || p.h !== undefined) && n.children.length) resizeTree(d.nodes, n.id, n.x, n.y, p.w ?? n.w, p.h ?? n.h);
        const { x, y, ...rest } = p;
        void x; void y;
        Object.assign(n, rest);
        if (n.text && (p.text || p.w !== undefined) && n.text.autoResize !== 'fixed') Object.assign(n, textBoxSize(n.text, n.w));
        touched.add(n.id);
      } else if (o.op === 'remove') {
        const n = d.nodes[o.id];
        if (!n) continue;
        const list = listOf(n.parentId);
        if (list) list.splice(list.indexOf(n.id), 1);
        const drop = (id: string) => { (d.nodes[id]?.children ?? []).forEach(drop); delete d.nodes[id]; };
        drop(n.id);
        if (n.parentId) touched.add(n.parentId);
      } else if (o.op === 'reparent') {
        const n = d.nodes[o.id];
        if (!n || (o.parentId && !d.nodes[o.parentId])) continue;
        const from = listOf(n.parentId);
        if (from) from.splice(from.indexOf(n.id), 1);
        if (n.parentId) touched.add(n.parentId);
        n.parentId = o.parentId;
        const to = listOf(o.parentId)!;
        if (o.index < 0 || o.index > to.length) to.push(n.id);
        else to.splice(o.index, 0, n.id);
        touched.add(n.id);
      } else if (o.op === 'select') {
        select = o.ids.filter((id) => d.nodes[id]);
      } else if (o.op === 'fit') {
        if (d.nodes[o.id]) fitGroup(d.nodes, o.id);
      }
    }
    for (const id of touched) {
      const n = d.nodes[id];
      if (!n) continue;
      if (n.autoLayout) applyAutoLayout(d.nodes, id);
      relayoutAncestors(d.nodes, n.parentId);
    }
  });
  if (select) st.set({ selection: select });
  void pluginId;
}

export interface RunningPlugin {
  plugin: InstalledPlugin;
  frame: HTMLIFrameElement;
  stop: () => void;
}

const escapeScript = (s: string) => s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

function cspFor(m: PluginManifest) {
  const domains = (m.networkAccess?.allowedDomains ?? ['none']).filter((d) => d && d !== 'none');
  const connect = domains.includes('*') ? '*' : domains.length ? domains.join(' ') : "'none'";
  return `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: ${connect === "'none'" ? '' : connect}; font-src data:; connect-src ${connect}`;
}

/** Wrap UI HTML so `parent.postMessage({pluginMessage})` works as in Figma, under the same CSP. */
export function uiDocument(plugin: InstalledPlugin) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${cspFor(plugin.manifest)}"><style>html,body{margin:0}</style></head><body>${plugin.ui}</body></html>`;
}

/** Start a plugin. Returns a handle; the plugin UI (if any) is shown via the `onUI` callback. */
export function runPlugin(plugin: InstalledPlugin, cb: { onUI: (html: string, opts: { width?: number; height?: number; title?: string; visible?: boolean }) => void; onToUI: (msg: unknown) => void; onUIResize: (w: number, h: number) => void; onUIVisible: (v: boolean) => void; onClose: () => void; command?: string }): RunningPlugin {
  const st = useEditor.getState();
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.style.display = 'none';
  frame.title = `${plugin.name} (plugin sandbox)`;
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${cspFor(plugin.manifest)}"></head><body><script>${SANDBOX_SHIM}</script><script>window.__figmyRun = function () {\n${escapeScript(plugin.code)}\n};</script></body></html>`;
  const created = new Set<string>();
  let stopped = false;
  const storageKey = `figmy:plugin-storage:${plugin.id}`;
  const post = (m: Record<string, unknown>) => frame.contentWindow?.postMessage({ __figmyHost: true, ...m }, '*');
  const onMessage = (e: MessageEvent) => {
    if (e.source !== frame.contentWindow || !e.data?.__figmyPlugin) return;
    const d = e.data;
    switch (d.type) {
      case 'ready': {
        const s = useEditor.getState();
        const page = s.page();
        const nodes: Record<string, SceneNode> = {};
        const walk = (id: string) => { const n = s.doc.nodes[id]; if (!n) return; nodes[id] = n; n.children.forEach(walk); };
        page.children.forEach(walk);
        post({ type: 'init', nodes: structuredClone(nodes), pageId: page.id, pageName: page.name, pageChildren: [...page.children], selection: [...s.selection], html: plugin.ui ? uiDocument(plugin) : '', command: cb.command ?? '' });
        break;
      }
      case 'ops': if (Array.isArray(d.ops)) applyOps(d.ops, plugin.id, created); break;
      case 'notify': st.notify(`${plugin.name}: ${d.message}`); break;
      case 'error': st.notify(`${plugin.name} error: ${d.message}`); console.warn(`[plugin ${plugin.name}]`, d.message); break;
      case 'showUI': cb.onUI(plugin.ui ? uiDocument(plugin) : String(d.html ?? ''), d.opts ?? {}); break;
      case 'toUI': cb.onToUI(d.msg); break;
      case 'uiResize': cb.onUIResize(Number(d.width) || 300, Number(d.height) || 200); break;
      case 'uiVisible': cb.onUIVisible(!!d.visible); break;
      case 'uiClose': cb.onUIVisible(false); break;
      case 'zoom': { const s = useEditor.getState(); const ids = (d.ids as string[]).filter((id) => s.doc.nodes[id]); if (ids.length) { s.set({ selection: ids }); s.zoomToSelection(); } break; }
      case 'storageGet': { let value: unknown; try { const all = JSON.parse(localStorage.getItem(storageKey) ?? '{}'); value = all[d.key]; } catch { /* ignore */ } post({ type: 'storageValue', reqId: d.reqId, value }); break; }
      case 'storageSet': { try { const all = JSON.parse(localStorage.getItem(storageKey) ?? '{}'); if (d.value === undefined) delete all[d.key]; else all[d.key] = d.value; localStorage.setItem(storageKey, JSON.stringify(all)); } catch { /* ignore */ } break; }
      case 'close': if (d.message) st.notify(d.message); stop(); break;
    }
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.removeEventListener('message', onMessage);
    frame.remove();
    cb.onClose();
  };
  window.addEventListener('message', onMessage);
  document.body.appendChild(frame);
  return { plugin, frame, stop };
}

/** Relay a message from the plugin UI iframe to the plugin's main code. */
export function sendFromUI(r: RunningPlugin, msg: unknown) {
  r.frame.contentWindow?.postMessage({ __figmyHost: true, type: 'fromUI', msg }, '*');
}
