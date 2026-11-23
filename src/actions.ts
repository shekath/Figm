import { useEditor } from './store/store';
import { emptyDocument, uid } from './lib/factory';
import { openDocumentFile, saveDocumentFile, librarySave, saveBlob, pickFiles, resetWebHandle, desktop } from './lib/platform';
import { exportNodes, exportSvgString, rasterize, blobToDataUrl } from './lib/exporter';
import { importSvg } from './lib/svgImport';
import type { Tool } from './types';

const S = () => useEditor.getState();

export async function makeThumbnail(): Promise<string | undefined> {
  const s = S();
  const ids = s.doc.pages[0].children.filter((id) => s.doc.nodes[id]?.visible);
  if (!ids.length) return undefined;
  try {
    const svg = exportSvgString(s.doc.nodes, ids, s.doc.pages[0].background, 20);
    const m = svg.match(/width="([\d.]+)"/);
    const w = m ? parseFloat(m[1]) : 400;
    const blob = await rasterize(svg, Math.min(1, 320 / w), 'image/jpeg', s.doc.pages[0].background);
    return await blobToDataUrl(blob);
  } catch {
    return undefined;
  }
}

export async function saveToLibrary() {
  const s = S();
  await librarySave(s.fileId, s.doc, await makeThumbnail(), s.filePath);
}

export const actions: Record<string, { label: string; shortcut?: string; run: () => void | Promise<void> }> = {
  new: { label: 'New design file', shortcut: 'Ctrl+N', run: () => { resetWebHandle(); S().setDoc(emptyDocument('Untitled')); S().set({ zoom: 1, panX: 200, panY: 120 }); } },
  open: {
    label: 'Open…',
    shortcut: 'Ctrl+O',
    run: async () => {
      try {
        const r = await openDocumentFile();
        if (r) {
          S().setDoc(r.doc, { filePath: r.path });
          setTimeout(() => S().zoomToFit(), 0);
        }
      } catch (e) {
        S().notify('Could not open file: ' + (e as Error).message);
      }
    },
  },
  save: {
    label: 'Save',
    shortcut: 'Ctrl+S',
    run: async () => {
      const s = S();
      await saveToLibrary();
      if (desktop || s.filePath) {
        const r = await saveDocumentFile(s.doc, s.filePath);
        if (typeof r === 'string') S().set({ filePath: r, dirty: false });
        if (r) S().notify('Saved');
      } else {
        S().set({ dirty: false });
        S().notify('Saved to browser library — use “Save as file” to download');
      }
    },
  },
  saveAs: {
    label: 'Save as file…',
    shortcut: 'Ctrl+Shift+S',
    run: async () => {
      const r = await saveDocumentFile(S().doc, S().filePath, true);
      if (typeof r === 'string') S().set({ filePath: r });
      if (r) S().set({ dirty: false });
    },
  },
  importFiles: {
    label: 'Import images / SVG…',
    shortcut: 'Ctrl+Shift+K',
    run: async () => {
      const files = await pickFiles('image/*,.svg');
      const s = S();
      let x = 0;
      for (const f of files) {
        const c = { x: (innerWidth / 2 - s.panX) / s.zoom + x, y: (innerHeight / 2 - s.panY) / s.zoom };
        if (f.name.endsWith('.svg')) {
          const r = importSvg(await f.text(), c.x, c.y);
          if (r) {
            s.mutate((d) => {
              Object.assign(d.nodes, r.nodes);
              d.pages.find((p) => p.id === s.pageId)!.children.push(r.rootId);
            });
          }
        } else {
          const src = await blobToDataUrl(f);
          const img = new Image();
          img.onload = async () => {
            const { createNode } = await import('./lib/factory');
            const k = Math.min(1, 800 / Math.max(img.width, img.height));
            const n = createNode('image', { x: c.x, y: c.y, w: img.width * k, h: img.height * k, src, name: f.name });
            S().addNode(n);
            S().set({ selection: [n.id] });
          };
          img.src = src;
        }
        x += 60;
      }
    },
  },
  figmaImport: { label: 'Import from Figma…', run: () => { window.dispatchEvent(new Event('figmy:figma-import')); } },
  export: { label: 'Export…', shortcut: 'Ctrl+Shift+E', run: () => { window.dispatchEvent(new CustomEvent('figmy:export')); } },
  exportHtml: { label: 'Export design to HTML…', run: () => { window.dispatchEvent(new CustomEvent('figmy:export', { detail: { format: 'html' } })); } },
  exportSelection: {
    label: 'Quick export PNG @2x',
    shortcut: 'Ctrl+Alt+E',
    run: async () => {
      const s = S();
      const ids = s.selection.length ? s.selection : s.page().children;
      if (!ids.length) return s.notify('Nothing to export');
      const name = ids.length === 1 ? s.doc.nodes[ids[0]].name : s.page().name;
      await saveBlob(await exportNodes(s.doc.nodes, ids, 'png', 2), `${name}@2x.png`);
    },
  },
  exportSvg: {
    label: 'Export selection as SVG',
    run: async () => {
      const s = S();
      const ids = s.selection.length ? s.selection : s.page().children;
      if (!ids.length) return;
      await saveBlob(await exportNodes(s.doc.nodes, ids, 'svg'), `${s.doc.nodes[ids[0]]?.name ?? 'export'}.svg`);
    },
  },
  exportPdf: {
    label: 'Export frames to PDF',
    run: async () => {
      const s = S();
      const frames = s.page().children.filter((id) => ['frame', 'component'].includes(s.doc.nodes[id]?.type));
      if (!frames.length) return s.notify('No frames on this page');
      await saveBlob(await exportNodes(s.doc.nodes, frames, 'pdf'), `${s.doc.name}.pdf`);
    },
  },
  undo: { label: 'Undo', shortcut: 'Ctrl+Z', run: () => S().undo() },
  redo: { label: 'Redo', shortcut: 'Ctrl+Shift+Z', run: () => S().redo() },
  copy: { label: 'Copy', shortcut: 'Ctrl+C', run: () => S().copy() },
  cut: { label: 'Cut', shortcut: 'Ctrl+X', run: () => S().cut() },
  paste: { label: 'Paste', shortcut: 'Ctrl+V', run: () => S().paste() },
  duplicate: { label: 'Duplicate', shortcut: 'Ctrl+D', run: () => S().duplicate() },
  delete: { label: 'Delete', shortcut: 'Del', run: () => S().deleteSelection() },
  selectAll: { label: 'Select all', shortcut: 'Ctrl+A', run: () => S().selectAll() },
  group: { label: 'Group selection', shortcut: 'Ctrl+G', run: () => S().group() },
  ungroup: { label: 'Ungroup', shortcut: 'Ctrl+Shift+G', run: () => S().ungroup() },
  frameSelection: { label: 'Frame selection', shortcut: 'Ctrl+Alt+G', run: () => S().frameSelection() },
  autoLayout: { label: 'Add / remove auto layout', shortcut: 'Shift+A', run: () => S().toggleAutoLayout() },
  component: { label: 'Create component', shortcut: 'Ctrl+Alt+K', run: () => S().makeComponent() },
  combineVariants: { label: 'Combine as variants', shortcut: 'Ctrl+Alt+Shift+K', run: () => S().combineAsVariants() },
  addVariant: { label: 'Add variant', run: () => S().addVariant() },
  detach: { label: 'Detach instance', shortcut: 'Ctrl+Alt+B', run: () => S().detachInstance() },
  mask: { label: 'Use as mask', shortcut: 'Ctrl+Alt+M', run: () => S().useAsMask() },
  union: { label: 'Union selection', shortcut: 'Ctrl+Alt+U', run: () => S().booleanOp('union') },
  subtract: { label: 'Subtract selection', shortcut: 'Ctrl+Alt+S', run: () => S().booleanOp('subtract') },
  intersect: { label: 'Intersect selection', shortcut: 'Ctrl+Alt+I', run: () => S().booleanOp('intersect') },
  exclude: { label: 'Exclude selection', shortcut: 'Ctrl+Alt+X', run: () => S().booleanOp('exclude') },
  flatten: { label: 'Flatten', shortcut: 'Ctrl+E', run: () => S().booleanOp('flatten') },
  bringFront: { label: 'Bring to front', shortcut: 'Ctrl+Alt+]', run: () => S().reorder('front') },
  bringForward: { label: 'Bring forward', shortcut: 'Ctrl+]', run: () => S().reorder('forward') },
  sendBackward: { label: 'Send backward', shortcut: 'Ctrl+[', run: () => S().reorder('backward') },
  sendBack: { label: 'Send to back', shortcut: 'Ctrl+Alt+[', run: () => S().reorder('back') },
  flipH: { label: 'Flip horizontal', shortcut: 'Shift+H', run: () => S().flip('x') },
  flipV: { label: 'Flip vertical', shortcut: 'Shift+V', run: () => S().flip('y') },
  toggleVisible: { label: 'Show / hide', shortcut: 'Ctrl+Shift+H', run: () => S().toggleVisible() },
  toggleLock: { label: 'Lock / unlock', shortcut: 'Ctrl+Shift+L', run: () => S().toggleLocked() },
  alignLeft: { label: 'Align left', shortcut: 'Alt+A', run: () => S().align('left') },
  alignRight: { label: 'Align right', shortcut: 'Alt+D', run: () => S().align('right') },
  alignTop: { label: 'Align top', shortcut: 'Alt+W', run: () => S().align('top') },
  alignBottom: { label: 'Align bottom', shortcut: 'Alt+S', run: () => S().align('bottom') },
  alignHCenter: { label: 'Align horizontal centres', shortcut: 'Alt+H', run: () => S().align('hcenter') },
  alignVCenter: { label: 'Align vertical centres', shortcut: 'Alt+V', run: () => S().align('vcenter') },
  distributeH: { label: 'Distribute horizontally', shortcut: 'Alt+Shift+H', run: () => S().distribute('h') },
  distributeV: { label: 'Distribute vertically', shortcut: 'Alt+Shift+V', run: () => S().distribute('v') },
  tidy: { label: 'Tidy up', shortcut: 'Ctrl+Alt+Shift+T', run: () => S().tidy() },
  zoomIn: { label: 'Zoom in', shortcut: 'Ctrl+=', run: () => S().zoomTo(S().zoom * 1.5) },
  zoomOut: { label: 'Zoom out', shortcut: 'Ctrl+-', run: () => S().zoomTo(S().zoom / 1.5) },
  zoom100: { label: 'Zoom to 100%', shortcut: 'Shift+0', run: () => S().zoomTo(1) },
  zoomFit: { label: 'Zoom to fit', shortcut: 'Shift+1', run: () => S().zoomToFit() },
  zoomSel: { label: 'Zoom to selection', shortcut: 'Shift+2', run: () => S().zoomToSelection() },
  toggleGrid: { label: 'Pixel grid', shortcut: "Ctrl+'", run: () => S().set({ showGrid: !S().showGrid }) },
  toggleRulers: { label: 'Rulers', shortcut: 'Shift+R', run: () => S().set({ showRulers: !S().showRulers }) },
  toggleOutlines: { label: 'Outline mode', shortcut: 'Ctrl+Y', run: () => { S().set({ showOutlines: !S().showOutlines }); } },
  toggleUI: { label: 'Show / hide UI', shortcut: 'Ctrl+\\', run: () => { document.body.classList.toggle('hide-ui'); } },
  present: { label: 'Present prototype', shortcut: 'Ctrl+Alt+Enter', run: () => S().set({ presenting: true }) },
  addPage: { label: 'New page', run: () => S().addPage() },
  saveVersion: { label: 'Save version to history…', shortcut: 'Ctrl+Alt+H', run: () => { const n = prompt('Version name', new Date().toLocaleString()); if (n !== null) S().saveVersion(n); } },
  variables: { label: 'Variables…', shortcut: 'Ctrl+Alt+V', run: () => { window.dispatchEvent(new Event('figmy:variables')); } },
  share: { label: 'Share / collaborate…', run: () => { window.dispatchEvent(new Event('figmy:share')); } },
  connectAI: { label: 'Connect Claude / ChatGPT (MCP)…', run: () => { window.dispatchEvent(new CustomEvent('figmy:share', { detail: { tab: 'ai' } })); } },
  shortcuts: { label: 'Keyboard shortcuts', shortcut: 'Ctrl+Shift+?', run: () => { window.dispatchEvent(new Event('figmy:shortcuts')); } },
  home: { label: 'Back to files', run: async () => { await saveToLibrary(); window.dispatchEvent(new Event('figmy:home')); } },
  newFromTemplate: { label: 'Duplicate file', run: () => { S().set({ fileId: uid(), filePath: null }); S().mutate((d) => (d.name = d.name + ' copy'), false); } },
};

export const toolKeys: Record<string, Tool> = {
  v: 'move',
  k: 'scale',
  f: 'frame',
  a: 'frame',
  s: 'section',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  p: 'pen',
  t: 'text',
  h: 'hand',
  c: 'comment',
};
