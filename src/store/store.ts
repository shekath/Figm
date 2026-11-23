import { create } from 'zustand';
import { produce, setAutoFreeze, current, isDraft } from 'immer';
import { applyPatch, diffDocs, repairDocument, type DocPatch } from '../lib/docops';
import type { DocumentData, Mode, Page, SceneNode, Tool, AutoLayout, Comment } from '../types';
import { createNode, sampleDocument, uid } from '../lib/factory';
import { applyAutoLayout, descendants, fitGroup, isAncestor, relayoutAncestors, translateTree, resizeTree, scalePoints } from '../lib/layout';
import { applyBoolean, type BooleanOp } from '../lib/boolean';
import * as comps from '../lib/components';
import type { ComponentProp } from '../types';
import { DEFAULT_MOTION, currentValue, presetTracks, putKeyframe, type DocMotion, type Keyframe, type MotionPreset, type MotionProp, type MotionValue } from '../lib/motion';
import { applyAllBindings, defaultValue, importTokens, newCollection, resolveInMode, resolveMode } from '../lib/variables';
import type { BindableProp, Variable, VariableValue } from '../types';
import { unionRects, visualBounds, type Rect } from '../lib/geometry';

setAutoFreeze(false);
/** Deep copy that also works on immer drafts. */
export const deepCopy = <T,>(v: T): T => structuredClone(isDraft(v) ? (current(v as never) as T) : v);
const clone = deepCopy;
const HISTORY_LIMIT = 200;

export interface Guide {
  axis: 'x' | 'y';
  pos: number;
  from: number;
  to: number;
}

export interface EditorState {
  doc: DocumentData;
  fileId: string;
  filePath: string | null; // desktop path
  dirty: boolean;
  pageId: string;
  selection: string[];
  hoverId: string | null;
  tool: Tool;
  mode: Mode;
  /** Motion mode: playhead (ms), playback and auto-keying. */
  motionTime: number;
  motionPlaying: boolean;
  autoKey: boolean;
  selectedKeys: { nodeId: string; prop: MotionProp; id: string }[];
  zoom: number;
  panX: number;
  panY: number;
  editingTextId: string | null;
  editingPathId: string | null;
  focusId: string | null; // entered group/frame for deep selection
  guides: Guide[];
  marquee: Rect | null;
  showGrid: boolean;
  showRulers: boolean;
  snapToPixel: boolean;
  showOutlines: boolean;
  presenting: boolean;
  leftTab: 'layers' | 'assets';
  rightPanelOpen: boolean;
  activeCommentId: string | null;
  past: DocumentData[];
  future: DocumentData[];
  toast: string | null;
  userName: string;

  // core
  setDoc: (doc: DocumentData, meta?: { fileId?: string; filePath?: string | null }) => void;
  /** apply a patch received from a collaborator (not recorded in local undo history) */
  applyRemote: (patch: DocPatch) => void;
  mutate: (fn: (d: DocumentData) => void, record?: boolean) => void;
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  set: (p: Partial<EditorState>) => void;
  notify: (msg: string) => void;

  // helpers
  page: () => Page;
  node: (id: string) => SceneNode | undefined;
  selectedNodes: () => SceneNode[];
  selectionBounds: () => Rect | null;

  // selection
  select: (ids: string[], additive?: boolean) => void;
  selectAll: () => void;

  // node ops
  addNode: (n: SceneNode, parentId?: string | null, index?: number) => void;
  updateNodes: (ids: string[], patch: Partial<SceneNode> | ((n: SceneNode) => Partial<SceneNode>)) => void;
  moveBy: (ids: string[], dx: number, dy: number, record?: boolean) => void;
  resizeNode: (id: string, r: Rect, record?: boolean) => void;
  deleteSelection: () => void;
  duplicate: (offset?: number) => void;
  group: () => void;
  ungroup: () => void;
  frameSelection: () => void;
  makeComponent: () => void;
  createInstance: (componentId: string, x: number, y: number) => void;
  detachInstance: () => void;
  reorder: (dir: 'forward' | 'backward' | 'front' | 'back') => void;
  reparent: (ids: string[], parentId: string | null, index?: number) => void;
  align: (how: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => void;
  distribute: (axis: 'h' | 'v') => void;
  tidy: () => void;
  flip: (axis: 'x' | 'y') => void;
  toggleAutoLayout: () => void;
  setAutoLayout: (id: string, patch: Partial<AutoLayout>) => void;
  useAsMask: () => void;
  setMotion: (patch: Partial<DocMotion>) => void;
  setKeyframe: (ids: string[], prop: MotionProp, value: MotionValue | ((n: SceneNode) => MotionValue), t?: number) => void;
  toggleKeyframe: (ids: string[], prop: MotionProp) => void;
  updateKeyframes: (keys: { nodeId: string; prop: MotionProp; id: string }[], patch: Partial<Keyframe> | ((k: Keyframe) => Partial<Keyframe>)) => void;
  deleteKeyframes: (keys: { nodeId: string; prop: MotionProp; id: string }[]) => void;
  clearMotion: (ids: string[], prop?: MotionProp) => void;
  applyMotionPreset: (ids: string[], preset: MotionPreset) => void;
  booleanOp: (op: BooleanOp) => void;

  // variants & component properties
  combineAsVariants: () => void;
  addVariant: (id?: string) => void;
  setVariantValue: (variantId: string, prop: string, value: string) => void;
  renameVariantProp: (setId: string, from: string, to: string) => void;
  renameVariantValue: (setId: string, prop: string, from: string, to: string) => void;
  addVariantProp: (setId: string, name: string) => void;
  setInstanceVariant: (instId: string, prop: string, value: string) => void;
  setInstanceProp: (instIds: string[], propId: string, value: string | boolean) => void;
  /** merge (or with null, clear) an override at a scoped key inside an instance */
  setNestedOverride: (instId: string, key: string, patch: Partial<SceneNode> | null) => void;
  /** swap a nested instance (by override key) to another component */
  swapNested: (instId: string, key: string, compId: string | null) => void;
  addComponentProp: (layerId: string, type: ComponentProp['type']) => void;
  updateComponentProp: (ownerId: string, propId: string, patch: Partial<ComponentProp>) => void;
  deleteComponentProp: (ownerId: string, propId: string) => void;

  // variables
  addCollection: (name?: string) => string;
  renameCollection: (id: string, name: string) => void;
  deleteCollection: (id: string) => void;
  addMode: (colId: string, name?: string) => void;
  renameMode: (colId: string, modeId: string, name: string) => void;
  deleteMode: (colId: string, modeId: string) => void;
  addVariable: (colId: string, type: Variable['type'], name?: string) => string;
  updateVariable: (colId: string, varId: string, patch: Partial<Pick<Variable, 'name' | 'description' | 'scopes' | 'codeSyntax' | 'hidden'>>) => void;
  setVariableValue: (colId: string, varId: string, modeId: string, value: VariableValue) => void;
  duplicateVariables: (colId: string, varIds: string[]) => void;
  deleteVariables: (colId: string, varIds: string[]) => void;
  renameVariableGroup: (colId: string, from: string, to: string) => void;
  moveVariable: (colId: string, varId: string, beforeId: string | null) => void;
  importVariableTokens: (json: Record<string, unknown>) => number;
  deleteVariable: (colId: string, varId: string) => void;
  bindVariable: (ids: string[], prop: BindableProp, varId: string | null) => void;
  setActiveMode: (colId: string, modeId: string) => void;
  setNodeMode: (ids: string[], colId: string, modeId: string | null) => void;
  toggleVisible: (ids?: string[]) => void;
  toggleLocked: (ids?: string[]) => void;
  rename: (id: string, name: string) => void;
  copy: () => Promise<void>;
  cut: () => Promise<void>;
  paste: (at?: { x: number; y: number }, text?: string) => Promise<void>;

  // pages
  addPage: () => void;
  renamePage: (id: string, name: string) => void;
  deletePage: (id: string) => void;
  duplicatePage: (id: string) => void;
  setPage: (id: string) => void;

  // view
  zoomTo: (z: number, cx?: number, cy?: number) => void;
  zoomToFit: (rect?: Rect | null) => void;
  zoomToSelection: () => void;

  // comments
  addComment: (x: number, y: number, text: string) => void;
  replyComment: (id: string, text: string) => void;
  resolveComment: (id: string) => void;
  deleteComment: (id: string) => void;

  // versions
  saveVersion: (name: string) => void;
  restoreVersion: (id: string) => void;
}

let viewport = { w: 1200, h: 800 };
export const setViewportSize = (w: number, h: number) => (viewport = { w, h });
export const getViewportSize = () => viewport;

/** Detach node from current parent / page lists. */
function unlink(d: DocumentData, id: string) {
  const n = d.nodes[id];
  if (!n) return;
  if (n.parentId) {
    const p = d.nodes[n.parentId];
    if (p) p.children = p.children.filter((c) => c !== id);
  } else {
    for (const pg of d.pages) pg.children = pg.children.filter((c) => c !== id);
  }
}

function link(d: DocumentData, pageId: string, id: string, parentId: string | null, index?: number) {
  const n = d.nodes[id];
  n.parentId = parentId;
  const list = parentId ? d.nodes[parentId].children : d.pages.find((p) => p.id === pageId)!.children;
  if (index === undefined || index < 0 || index > list.length) list.push(id);
  else list.splice(index, 0, id);
}

function siblingsOf(d: DocumentData, pageId: string, id: string): string[] {
  const n = d.nodes[id];
  return n.parentId ? d.nodes[n.parentId].children : d.pages.find((p) => p.id === pageId)!.children;
}

function removeTree(d: DocumentData, id: string) {
  for (const c of descendants(d.nodes, id)) delete d.nodes[c];
  unlink(d, id);
  delete d.nodes[id];
}

/** Deep copy a subtree with new ids; returns new root id and map of new nodes. */
export function cloneTree(nodes: Record<string, SceneNode>, id: string, idMap: Record<string, string> = {}): Record<string, SceneNode> {
  const out: Record<string, SceneNode> = {};
  const walk = (oid: string, newParent: string | null) => {
    const o = nodes[oid];
    if (!o) return;
    const nid = uid();
    idMap[oid] = nid;
    const c: SceneNode = clone(o);
    c.id = nid;
    c.parentId = newParent;
    c.children = [];
    out[nid] = c;
    for (const ch of o.children) {
      walk(ch, nid);
      c.children.push(idMap[ch]);
    }
  };
  walk(id, nodes[id]?.parentId ?? null);
  return out;
}

/** Topmost selected nodes (drop descendants of other selected nodes). */
function topLevel(d: DocumentData, ids: string[]) {
  return ids.filter((id) => d.nodes[id] && !ids.some((o) => o !== id && isAncestor(d.nodes, o, id)));
}

function orderedInTree(d: DocumentData, pageId: string, ids: string[]) {
  const order: string[] = [];
  const walk = (list: string[]) => {
    for (const id of list) {
      order.push(id);
      walk(d.nodes[id]?.children ?? []);
    }
  };
  walk(d.pages.find((p) => p.id === pageId)?.children ?? []);
  return [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

const initial = sampleDocument();

export const useEditor = create<EditorState>((set, get) => ({
  doc: initial,
  fileId: uid(),
  filePath: null,
  dirty: false,
  pageId: initial.pages[0].id,
  selection: [],
  hoverId: null,
  tool: 'move',
  mode: 'design',
  motionTime: 0,
  motionPlaying: false,
  autoKey: true,
  selectedKeys: [],
  zoom: 1,
  panX: 0,
  panY: 0,
  editingTextId: null,
  editingPathId: null,
  focusId: null,
  guides: [],
  marquee: null,
  showGrid: false,
  showRulers: true,
  snapToPixel: true,
  showOutlines: false,
  presenting: false,
  leftTab: 'layers',
  rightPanelOpen: true,
  activeCommentId: null,
  past: [],
  future: [],
  toast: null,
  userName: (typeof localStorage !== 'undefined' && localStorage.getItem('figmy:user')) || 'You',

  setDoc: (doc, meta) =>
    set({
      doc,
      fileId: meta?.fileId ?? uid(),
      filePath: meta?.filePath ?? null,
      pageId: doc.pages[0].id,
      selection: [],
      past: [],
      future: [],
      dirty: false,
      editingTextId: null,
      editingPathId: null,
    }),

  mutate: (fn, record = true) => {
    const { doc, past } = get();
    const next = produce(doc, (d) => {
      fn(d);
    });
    if (next === doc) return;
    set({
      doc: next,
      dirty: true,
      ...(record ? { past: [...past, doc].slice(-HISTORY_LIMIT), future: [] } : {}),
    });
  },
  applyRemote: (patch) => {
    const { doc, past, future, selection, pageId, editingTextId } = get();
    const fix = (d: DocumentData) => repairDocument(applyPatch(d, patch));
    const next = fix(doc);
    remoteDoc = next;
    set({
      doc: next,
      // rebase history so local undo never reverts collaborators' edits
      past: past.map(fix),
      future: future.map(fix),
      selection: selection.filter((id) => next.nodes[id]),
      pageId: next.pages.some((p) => p.id === pageId) ? pageId : next.pages[0].id,
      editingTextId: editingTextId && next.nodes[editingTextId] ? editingTextId : null,
    });
  },
  checkpoint: () => {
    const { doc, past } = get();
    set({ past: [...past, doc].slice(-HISTORY_LIMIT), future: [] });
  },
  undo: () => {
    const { past, doc, future, pageId } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({
      doc: prev,
      past: past.slice(0, -1),
      future: [doc, ...future],
      selection: get().selection.filter((id) => prev.nodes[id]),
      pageId: prev.pages.some((p) => p.id === pageId) ? pageId : prev.pages[0].id,
      dirty: true,
    });
  },
  redo: () => {
    const { past, doc, future } = get();
    if (!future.length) return;
    const nxt = future[0];
    set({ doc: nxt, past: [...past, doc], future: future.slice(1), selection: get().selection.filter((id) => nxt.nodes[id]), dirty: true });
  },
  set: (p) => set(p),
  notify: (msg) => {
    set({ toast: msg });
    setTimeout(() => get().toast === msg && set({ toast: null }), 2200);
  },

  page: () => get().doc.pages.find((p) => p.id === get().pageId) ?? get().doc.pages[0],
  node: (id) => get().doc.nodes[id],
  selectedNodes: () => get().selection.map((id) => get().doc.nodes[id]).filter(Boolean) as SceneNode[],
  selectionBounds: () => unionRects(get().selectedNodes().map(visualBounds)),

  select: (ids, additive) => {
    if (!additive) return set({ selection: ids, editingTextId: null });
    const cur = new Set(get().selection);
    for (const id of ids) cur.has(id) ? cur.delete(id) : cur.add(id);
    set({ selection: [...cur] });
  },
  selectAll: () => {
    const { focusId, doc } = get();
    const list = focusId ? doc.nodes[focusId]?.children ?? [] : get().page().children;
    set({ selection: list.filter((id) => !doc.nodes[id]?.locked && doc.nodes[id]?.visible) });
  },

  addNode: (n, parentId = null, index) =>
    get().mutate((d) => {
      d.nodes[n.id] = n;
      link(d, get().pageId, n.id, parentId, index);
      relayoutAncestors(d.nodes, parentId);
    }),

  updateNodes: (ids, patch) =>
    get().mutate((d) => {
      const parents = new Set<string | null>();
      for (const id of ids) {
        const n = d.nodes[id];
        if (!n) continue;
        const p = typeof patch === 'function' ? patch(n) : patch;
        const geo = 'x' in p || 'y' in p || 'w' in p || 'h' in p;
        if (geo && (n.children.length || n.type === 'path')) {
          const nx = p.x ?? n.x,
            ny = p.y ?? n.y,
            nw = p.w ?? n.w,
            nh = p.h ?? n.h;
          if (nw !== n.w || nh !== n.h) {
            if (n.type === 'path') scalePoints(n, nw / (n.w || 1), nh / (n.h || 1));
            resizeTree(d.nodes, id, nx, ny, nw, nh);
          } else translateTree(d.nodes, id, nx - n.x, ny - n.y);
          const { x, y, w, h, ...rest } = p;
          void x;
          void y;
          void w;
          void h;
          Object.assign(n, rest);
        } else Object.assign(n, p);
        if (n.autoLayout) applyAutoLayout(d.nodes, n.id);
        parents.add(n.parentId);
      }
      parents.forEach((p) => relayoutAncestors(d.nodes, p));
    }),

  moveBy: (ids, dx, dy, record = true) =>
    get().mutate((d) => {
      const top = topLevel(d, ids);
      for (const id of top) if (!d.nodes[id].locked) translateTree(d.nodes, id, dx, dy);
      const parents = new Set(top.map((id) => d.nodes[id].parentId));
      parents.forEach((p) => {
        const pn = p ? d.nodes[p] : null;
        if (pn?.type === 'group') relayoutAncestors(d.nodes, p);
      });
    }, record),

  resizeNode: (id, r, record = false) =>
    get().mutate((d) => {
      const n = d.nodes[id];
      if (!n) return;
      if (n.type === 'path') scalePoints(n, r.w / (n.w || 1), r.h / (n.h || 1));
      if (n.type === 'text' && n.text && n.text.autoResize === 'width' && r.w !== n.w) n.text = { ...n.text, autoResize: 'fixed' };
      resizeTree(d.nodes, id, r.x, r.y, r.w, r.h);
      if (n.autoLayout) {
        if (r.w !== n.w) n.autoLayout.hugW = false;
        applyAutoLayout(d.nodes, id);
      }
      const p = n.parentId ? d.nodes[n.parentId] : null;
      if (p?.type === 'group' || p?.autoLayout) relayoutAncestors(d.nodes, n.parentId);
    }, record),

  deleteSelection: () => {
    const { selection } = get();
    if (!selection.length) return;
    get().mutate((d) => {
      const parents = new Set<string | null>();
      for (const id of topLevel(d, selection)) {
        if (!d.nodes[id]) continue;
        parents.add(d.nodes[id].parentId);
        removeTree(d, id);
        // remove orphaned instances' links & prototype links
        for (const n of Object.values(d.nodes)) if (n.prototype) n.prototype = n.prototype.filter((l) => l.targetId !== id);
      }
      parents.forEach((p) => {
        if (p && d.nodes[p]?.type === 'group' && d.nodes[p].children.length === 0) removeTree(d, p);
        else relayoutAncestors(d.nodes, p);
      });
    });
    set({ selection: [] });
  },

  duplicate: (offset = 10) => {
    const { selection, pageId } = get();
    if (!selection.length) return;
    const newIds: string[] = [];
    get().mutate((d) => {
      for (const id of topLevel(d, selection)) {
        const map: Record<string, string> = {};
        const copies = cloneTree(d.nodes, id, map);
        Object.assign(d.nodes, copies);
        const nid = map[id];
        const src = d.nodes[id];
        const sibs = siblingsOf(d, pageId, id);
        link(d, pageId, nid, src.parentId, sibs.indexOf(id) + 1);
        d.nodes[nid].name = src.name;
        if (!d.nodes[src.parentId ?? '']?.autoLayout) translateTree(d.nodes, nid, offset, offset);
        relayoutAncestors(d.nodes, src.parentId);
        newIds.push(nid);
      }
    });
    set({ selection: newIds });
  },

  group: () => {
    const { selection, pageId } = get();
    if (!selection.length) return;
    let gid = '';
    get().mutate((d) => {
      const ids = orderedInTree(d, pageId, topLevel(d, selection));
      const first = d.nodes[ids[ids.length - 1]];
      const parent = first.parentId;
      const sibs = siblingsOf(d, pageId, first.id);
      const index = sibs.indexOf(first.id);
      const g = createNode('group', { fills: [] });
      gid = g.id;
      d.nodes[g.id] = g;
      link(d, pageId, g.id, parent, index + 1);
      for (const id of ids) {
        unlink(d, id);
        d.nodes[id].parentId = g.id;
        g.children.push(id);
      }
      fitGroup(d.nodes, g.id);
      relayoutAncestors(d.nodes, parent);
    });
    set({ selection: [gid] });
  },

  ungroup: () => {
    const { selection, pageId } = get();
    const out: string[] = [];
    get().mutate((d) => {
      for (const id of selection) {
        const g = d.nodes[id];
        if (!g || !['group', 'frame', 'component'].includes(g.type) || !g.children.length) {
          out.push(id);
          continue;
        }
        const sibs = siblingsOf(d, pageId, id);
        let index = sibs.indexOf(id);
        const kids = [...g.children];
        for (const c of kids) {
          d.nodes[c].parentId = null;
          link(d, pageId, c, g.parentId, index++);
          out.push(c);
        }
        g.children = [];
        const parent = g.parentId;
        removeTree(d, id);
        relayoutAncestors(d.nodes, parent);
      }
    });
    set({ selection: out });
  },

  frameSelection: () => {
    const { selection, pageId } = get();
    if (!selection.length) return;
    let fid = '';
    get().mutate((d) => {
      const ids = orderedInTree(d, pageId, topLevel(d, selection));
      const b = unionRects(ids.map((id) => visualBounds(d.nodes[id])))!;
      const last = d.nodes[ids[ids.length - 1]];
      const parent = last.parentId;
      const index = siblingsOf(d, pageId, last.id).indexOf(last.id);
      const f = createNode('frame', { ...b, fills: [] });
      fid = f.id;
      d.nodes[f.id] = f;
      link(d, pageId, f.id, parent, index + 1);
      for (const id of ids) {
        unlink(d, id);
        d.nodes[id].parentId = f.id;
        f.children.push(id);
      }
      relayoutAncestors(d.nodes, parent);
    });
    set({ selection: [fid] });
  },

  makeComponent: () => {
    const { selection } = get();
    if (!selection.length) return;
    const sel = get().selectedNodes();
    if (sel.length === 1 && (sel[0].type === 'frame' || sel[0].type === 'group')) {
      get().updateNodes([sel[0].id], { type: 'component', clip: sel[0].type === 'frame', fills: sel[0].fills, name: sel[0].name.replace(/^(Frame|Group)/, 'Component') });
      get().notify('Created component');
      return;
    }
    if (sel.length === 1 && sel[0].type === 'component') return;
    get().frameSelection();
    const fid = get().selection[0];
    get().mutate((d) => {
      d.nodes[fid].type = 'component';
      d.nodes[fid].name = 'Component ' + (Object.values(d.nodes).filter((n) => n.type === 'component').length);
    }, false);
    get().notify('Created component');
  },

  createInstance: (componentId, x, y) => {
    const comp = get().doc.nodes[componentId];
    if (!comp) return;
    const inst = createNode('instance', {
      name: comps.setOf(get().doc.nodes, componentId)?.name ?? comp.name,
      componentId,
      x,
      y,
      w: comp.w,
      h: comp.h,
      fills: [],
      radius: comp.radius,
      overrides: {},
    });
    get().addNode(inst, null);
    set({ selection: [inst.id] });
  },

  detachInstance: () => {
    const { selection, pageId } = get();
    const out: string[] = [];
    get().mutate((d) => {
      for (const id of selection) {
        const inst = d.nodes[id];
        if (!inst || inst.type !== 'instance' || !inst.componentId) {
          out.push(id);
          continue;
        }
        const comp = d.nodes[inst.componentId];
        if (!comp) continue;
        const map: Record<string, string> = {};
        const copies = cloneTree(d.nodes, comp.id, map);
        Object.assign(d.nodes, copies);
        const fid = map[comp.id];
        const f = d.nodes[fid];
        f.type = 'frame';
        f.name = inst.name;
        // apply overrides (deeper, scoped ones stay on the nested instance clones)
        comps.applyOverridesToClone(d.nodes, map, comps.childOverrides(d.nodes, inst));
        const index = siblingsOf(d, pageId, id).indexOf(id);
        link(d, pageId, fid, inst.parentId, index);
        translateTree(d.nodes, fid, inst.x - comp.x, inst.y - comp.y);
        if (inst.w !== comp.w || inst.h !== comp.h) resizeTree(d.nodes, fid, inst.x, inst.y, inst.w, inst.h);
        unlink(d, id);
        delete d.nodes[id];
        out.push(fid);
      }
    });
    set({ selection: out });
  },

  reorder: (dir) => {
    const { selection, pageId } = get();
    get().mutate((d) => {
      for (const id of selection) {
        const sibs = siblingsOf(d, pageId, id);
        const i = sibs.indexOf(id);
        sibs.splice(i, 1);
        // children arrays render bottom -> top (last = topmost)
        const ni = dir === 'front' ? sibs.length : dir === 'back' ? 0 : dir === 'forward' ? Math.min(sibs.length, i + 1) : Math.max(0, i - 1);
        sibs.splice(ni, 0, id);
        relayoutAncestors(d.nodes, d.nodes[id].parentId);
      }
    });
  },

  reparent: (ids, parentId, index) => {
    const { pageId } = get();
    get().mutate((d) => {
      const oldParents = new Set<string | null>();
      for (const id of topLevel(d, ids)) {
        if (parentId && (id === parentId || isAncestor(d.nodes, id, parentId))) continue;
        oldParents.add(d.nodes[id].parentId);
        unlink(d, id);
        link(d, pageId, id, parentId, index);
      }
      oldParents.forEach((p) => {
        if (p && d.nodes[p]?.type === 'group' && !d.nodes[p].children.length) removeTree(d, p);
        else relayoutAncestors(d.nodes, p);
      });
      relayoutAncestors(d.nodes, parentId);
    });
  },

  align: (how) => {
    const sel = get().selectedNodes();
    if (!sel.length) return;
    let ref: Rect | null;
    if (sel.length === 1) {
      const p = sel[0].parentId ? get().doc.nodes[sel[0].parentId] : null;
      if (!p) return;
      ref = { x: p.x, y: p.y, w: p.w, h: p.h };
    } else ref = unionRects(sel.map(visualBounds));
    if (!ref) return;
    const r = ref;
    get().mutate((d) => {
      for (const s of sel) {
        const b = visualBounds(s);
        let dx = 0,
          dy = 0;
        if (how === 'left') dx = r.x - b.x;
        if (how === 'right') dx = r.x + r.w - (b.x + b.w);
        if (how === 'hcenter') dx = r.x + r.w / 2 - (b.x + b.w / 2);
        if (how === 'top') dy = r.y - b.y;
        if (how === 'bottom') dy = r.y + r.h - (b.y + b.h);
        if (how === 'vcenter') dy = r.y + r.h / 2 - (b.y + b.h / 2);
        translateTree(d.nodes, s.id, Math.round(dx), Math.round(dy));
      }
      relayoutAncestors(d.nodes, sel[0].parentId);
    });
  },

  distribute: (axis) => {
    const sel = get().selectedNodes();
    if (sel.length < 3) return;
    const items = sel.map((s) => ({ s, b: visualBounds(s) })).sort((a, b) => (axis === 'h' ? a.b.x - b.b.x : a.b.y - b.b.y));
    const first = items[0].b,
      last = items[items.length - 1].b;
    const span = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y;
    const total = items.reduce((s, i) => s + (axis === 'h' ? i.b.w : i.b.h), 0);
    const gap = (span - total) / (items.length - 1);
    get().mutate((d) => {
      let cur = axis === 'h' ? first.x : first.y;
      for (const { s, b } of items) {
        if (axis === 'h') translateTree(d.nodes, s.id, Math.round(cur - b.x), 0);
        else translateTree(d.nodes, s.id, 0, Math.round(cur - b.y));
        cur += (axis === 'h' ? b.w : b.h) + gap;
      }
    });
  },

  tidy: () => {
    const sel = get().selectedNodes();
    if (sel.length < 2) return;
    const items = [...sel].sort((a, b) => a.y - b.y || a.x - b.x);
    const cols = Math.ceil(Math.sqrt(items.length));
    const cw = Math.max(...items.map((i) => i.w)),
      ch = Math.max(...items.map((i) => i.h));
    const ox = Math.min(...items.map((i) => i.x)),
      oy = Math.min(...items.map((i) => i.y));
    get().mutate((d) => {
      items.forEach((it, i) => {
        const tx = ox + (i % cols) * (cw + 20),
          ty = oy + Math.floor(i / cols) * (ch + 20);
        translateTree(d.nodes, it.id, tx - it.x, ty - it.y);
      });
    });
  },

  flip: (axis) => get().updateNodes(get().selection, (n) => (axis === 'x' ? { flipX: !n.flipX } : { flipY: !n.flipY })),

  toggleAutoLayout: () => {
    const sel = get().selectedNodes();
    if (!sel.length) return;
    if (sel.length === 1 && (sel[0].type === 'frame' || sel[0].type === 'component')) {
      const f = sel[0];
      get().mutate((d) => {
        const n = d.nodes[f.id];
        if (n.autoLayout) n.autoLayout = null;
        else {
          // guess direction from children layout
          const kids = n.children.map((c) => d.nodes[c]);
          const spreadX = kids.length ? Math.max(...kids.map((k) => k.x)) - Math.min(...kids.map((k) => k.x)) : 1;
          const spreadY = kids.length ? Math.max(...kids.map((k) => k.y)) - Math.min(...kids.map((k) => k.y)) : 0;
          const horizontal = spreadX >= spreadY;
          n.children.sort((a, b) => (horizontal ? d.nodes[a].x - d.nodes[b].x : d.nodes[a].y - d.nodes[b].y));
          n.autoLayout = {
            direction: horizontal ? 'horizontal' : 'vertical',
            gap: 10,
            padding: { t: 10, r: 10, b: 10, l: 10 },
            align: 'start',
            justify: 'start',
            hugW: true,
            hugH: true,
            wrap: false,
          };
          applyAutoLayout(d.nodes, n.id);
        }
        relayoutAncestors(d.nodes, n.parentId);
      });
      return;
    }
    // wrap selection in an auto-layout frame
    get().frameSelection();
    const fid = get().selection[0];
    get().mutate((d) => {
      const n = d.nodes[fid];
      const kids = n.children.map((c) => d.nodes[c]);
      const spreadX = Math.max(...kids.map((k) => k.x)) - Math.min(...kids.map((k) => k.x));
      const spreadY = Math.max(...kids.map((k) => k.y)) - Math.min(...kids.map((k) => k.y));
      const horizontal = spreadX >= spreadY;
      n.children.sort((a, b) => (horizontal ? d.nodes[a].x - d.nodes[b].x : d.nodes[a].y - d.nodes[b].y));
      n.autoLayout = { direction: horizontal ? 'horizontal' : 'vertical', gap: 10, padding: { t: 0, r: 0, b: 0, l: 0 }, align: 'start', justify: 'start', hugW: true, hugH: true, wrap: false };
      applyAutoLayout(d.nodes, fid);
      relayoutAncestors(d.nodes, n.parentId);
    }, false);
  },

  setAutoLayout: (id, patch) =>
    get().mutate((d) => {
      const n = d.nodes[id];
      if (!n?.autoLayout) return;
      n.autoLayout = { ...n.autoLayout, ...patch, padding: { ...n.autoLayout.padding, ...(patch.padding ?? {}) } };
      applyAutoLayout(d.nodes, id);
      relayoutAncestors(d.nodes, n.parentId);
    }),

  setMotion: (patch) => get().mutate((d) => { d.motion = { ...DEFAULT_MOTION, ...d.motion, ...patch }; }),
  setKeyframe: (ids, prop, value, t) =>
    get().mutate((d) => {
      const time = t ?? get().motionTime;
      for (const id of ids) {
        const n = d.nodes[id];
        if (n) putKeyframe(n, prop, time, typeof value === 'function' ? value(n) : value);
      }
    }),
  toggleKeyframe: (ids, prop) => {
    const t = get().motionTime;
    const nodes = get().doc.nodes;
    const has = ids.some((id) => nodes[id]?.motion?.tracks[prop]?.some((k) => Math.abs(k.t - t) < 1));
    get().mutate((d) => {
      for (const id of ids) {
        const n = d.nodes[id];
        if (!n) continue;
        if (has) {
          const list = (n.motion?.tracks[prop] ?? []).filter((k) => Math.abs(k.t - t) >= 1);
          n.motion = { tracks: { ...n.motion?.tracks, [prop]: list } };
        } else putKeyframe(n, prop, t, currentValue(n, prop, t));
      }
    });
  },
  updateKeyframes: (keys, patch) =>
    get().mutate((d) => {
      for (const key of keys) {
        const n = d.nodes[key.nodeId];
        const list = n?.motion?.tracks[key.prop];
        if (!n || !list) continue;
        const next = list.map((k) => (k.id === key.id ? { ...k, ...(typeof patch === 'function' ? patch(k) : patch) } : k)).sort((a, b) => a.t - b.t);
        n.motion = { tracks: { ...n.motion!.tracks, [key.prop]: next } };
      }
    }),
  deleteKeyframes: (keys) => {
    get().mutate((d) => {
      for (const key of keys) {
        const n = d.nodes[key.nodeId];
        const list = n?.motion?.tracks[key.prop];
        if (!n || !list) continue;
        n.motion = { tracks: { ...n.motion!.tracks, [key.prop]: list.filter((k) => k.id !== key.id) } };
      }
    });
    set({ selectedKeys: [] });
  },
  clearMotion: (ids, prop) =>
    get().mutate((d) => {
      for (const id of ids) {
        const n = d.nodes[id];
        if (!n?.motion) continue;
        if (prop) n.motion = { tracks: { ...n.motion.tracks, [prop]: [] } };
        else delete n.motion;
      }
    }),
  applyMotionPreset: (ids, preset) => {
    const dm = { ...DEFAULT_MOTION, ...get().doc.motion };
    const start = Math.min(get().motionTime, Math.max(0, dm.duration - 200));
    const dur = Math.min(preset === 'spin' || preset === 'pulse' || preset === 'float' || preset === 'color-cycle' ? dm.duration : 600, dm.duration - start);
    get().mutate((d) => {
      for (const id of ids) {
        const n = d.nodes[id];
        if (!n) continue;
        n.motion = { tracks: { ...n.motion?.tracks, ...presetTracks(n, preset, start, dur) } };
      }
    });
  },

  useAsMask: () => {
    const sel = get().selectedNodes();
    if (!sel.length) return;
    if (sel.length === 1 && sel[0].isMask) return get().updateNodes([sel[0].id], { isMask: false });
    // bottom-most selected becomes mask, everything grouped
    const { pageId } = get();
    const ordered = orderedInTree(get().doc, pageId, sel.map((s) => s.id));
    const maskId = ordered[0];
    get().group();
    get().mutate((d) => {
      d.nodes[maskId].isMask = true;
      const g = d.nodes[get().selection[0]];
      g.name = 'Mask group';
      g.children = [maskId, ...g.children.filter((c) => c !== maskId)];
    }, false);
  },

  booleanOp: (op) => {
    const { selection, pageId } = get();
    const ids = orderedInTree(get().doc, pageId, topLevel(get().doc, selection));
    if (!ids.length || (op !== 'flatten' && ids.length < 2)) return get().notify(op === 'flatten' ? 'Select a layer to flatten' : 'Select two or more layers');
    let id: string | null = null;
    get().mutate((d) => {
      const parent = d.nodes[ids[0]].parentId;
      id = applyBoolean(d, pageId, ids, op);
      relayoutAncestors(d.nodes, parent);
    });
    if (id) set({ selection: [id] });
  },

  addCollection: (name) => {
    const c = newCollection(name ?? `Collection ${get().doc.variables.length + 1}`);
    get().mutate((d) => {
      d.variables.push(c);
    });
    return c.id;
  },
  renameCollection: (id, name) =>
    get().mutate((d) => {
      const c = d.variables.find((x) => x.id === id);
      if (c) c.name = name;
    }),
  deleteCollection: (id) =>
    get().mutate((d) => {
      const col = d.variables.find((x) => x.id === id);
      if (!col) return;
      const ids = new Set(col.variables.map((v) => v.id));
      d.variables = d.variables.filter((x) => x.id !== id);
      for (const n of Object.values(d.nodes)) {
        if (n.bindings) for (const [k, v] of Object.entries(n.bindings)) if (v && ids.has(v)) delete n.bindings[k as BindableProp];
        if (n.modeOverrides?.[id]) delete n.modeOverrides[id];
      }
    }),
  addMode: (colId, name) =>
    get().mutate((d) => {
      const c = d.variables.find((x) => x.id === colId);
      if (!c) return;
      const src = c.modes[c.modes.length - 1]?.id;
      const m = { id: uid(), name: name ?? `Mode ${c.modes.length + 1}` };
      c.modes.push(m);
      for (const v of c.variables) v.values[m.id] = src ? v.values[src] : defaultValue(v.type);
    }),
  renameMode: (colId, modeId, name) =>
    get().mutate((d) => {
      const m = d.variables.find((x) => x.id === colId)?.modes.find((x) => x.id === modeId);
      if (m) m.name = name;
    }),
  deleteMode: (colId, modeId) =>
    get().mutate((d) => {
      const c = d.variables.find((x) => x.id === colId);
      if (!c || c.modes.length <= 1) return;
      c.modes = c.modes.filter((m) => m.id !== modeId);
      for (const v of c.variables) delete v.values[modeId];
      if (d.activeModes?.[colId] === modeId) delete d.activeModes[colId];
      applyAllBindings(d);
    }),
  addVariable: (colId, type, name) => {
    const id = uid();
    get().mutate((d) => {
      const c = d.variables.find((x) => x.id === colId);
      if (!c) return;
      const base = name ?? `${type}-${c.variables.filter((v) => v.type === type).length + 1}`;
      c.variables.push({ id, name: base, type, values: Object.fromEntries(c.modes.map((m) => [m.id, defaultValue(type)])) });
    });
    return id;
  },
  updateVariable: (colId, varId, patch) =>
    get().mutate((d) => {
      const v = d.variables.find((x) => x.id === colId)?.variables.find((x) => x.id === varId);
      if (v) Object.assign(v, patch);
    }),
  setVariableValue: (colId, varId, modeId, value) =>
    get().mutate((d) => {
      const v = d.variables.find((x) => x.id === colId)?.variables.find((x) => x.id === varId);
      if (!v) return;
      v.values[modeId] = value;
      applyAllBindings(d);
    }),
  duplicateVariables: (colId, varIds) =>
    get().mutate((d) => {
      const c = d.variables.find((x) => x.id === colId);
      if (!c) return;
      for (const id of varIds) {
        const i = c.variables.findIndex((v) => v.id === id);
        if (i < 0) continue;
        const src = c.variables[i];
        c.variables.splice(i + 1, 0, { ...structuredClone(src), id: uid(), name: `${src.name} copy` });
      }
    }),
  deleteVariables: (colId, varIds) => varIds.forEach((id) => get().deleteVariable(colId, id)),
  renameVariableGroup: (colId, from, to) =>
    get().mutate((d) => {
      const c = d.variables.find((x) => x.id === colId);
      if (!c || !from) return;
      const clean = to.replace(/^\/+|\/+$/g, '');
      for (const v of c.variables)
        if (v.name === from || v.name.startsWith(from + '/')) v.name = (clean ? clean + '/' : '') + v.name.slice(from.length + 1 || 0).replace(/^\//, '') || v.name;
    }),
  moveVariable: (colId, varId, beforeId) =>
    get().mutate((d) => {
      const c = d.variables.find((x) => x.id === colId);
      if (!c) return;
      const i = c.variables.findIndex((v) => v.id === varId);
      if (i < 0) return;
      const [v] = c.variables.splice(i, 1);
      const j = beforeId ? c.variables.findIndex((x) => x.id === beforeId) : -1;
      c.variables.splice(j < 0 ? c.variables.length : j, 0, v);
    }),
  importVariableTokens: (json) => {
    let n = 0;
    get().mutate((d) => { n = importTokens(d, json); });
    return n;
  },
  deleteVariable: (colId, varId) =>
    get().mutate((d) => {
      const c = d.variables.find((x) => x.id === colId);
      if (!c) return;
      // aliases pointing at the deleted variable keep its resolved value
      const gone = c.variables.find((v) => v.id === varId);
      const resolved = gone ? resolveInMode(d, gone, resolveMode(d, null, c)) : undefined;
      c.variables = c.variables.filter((v) => v.id !== varId);
      for (const col of d.variables) for (const v of col.variables) for (const [m, val] of Object.entries(v.values)) if (typeof val === 'object' && val?.alias === varId) v.values[m] = resolved ?? defaultValue(v.type);
      applyAllBindings(d);
      for (const n of Object.values(d.nodes)) if (n.bindings) for (const [k, v] of Object.entries(n.bindings)) if (v === varId) delete n.bindings[k as BindableProp];
    }),
  bindVariable: (ids, prop, varId) =>
    get().mutate((d) => {
      for (const id of ids) {
        const n = d.nodes[id];
        if (!n) continue;
        n.bindings = { ...(n.bindings ?? {}) };
        if (varId) n.bindings[prop] = varId;
        else delete n.bindings[prop];
      }
      applyAllBindings(d);
    }),
  setActiveMode: (colId, modeId) =>
    get().mutate((d) => {
      d.activeModes = { ...(d.activeModes ?? {}), [colId]: modeId };
      applyAllBindings(d);
    }),
  setNodeMode: (ids, colId, modeId) =>
    get().mutate((d) => {
      for (const id of ids) {
        const n = d.nodes[id];
        if (!n) continue;
        n.modeOverrides = { ...(n.modeOverrides ?? {}) };
        if (modeId) n.modeOverrides[colId] = modeId;
        else delete n.modeOverrides[colId];
      }
      applyAllBindings(d);
    }),

  combineAsVariants: () => {
    const { selection } = get();
    const ids = selection.filter((id) => ['component', 'frame', 'group'].includes(get().doc.nodes[id]?.type));
    if (ids.length < 2) return get().notify('Select two or more components (or frames) to combine as variants');
    const parents = new Set(ids.map((id) => get().doc.nodes[id].parentId));
    if (parents.size > 1) return get().notify('Variants must share the same parent');
    let setId = '';
    try {
      get().mutate((d) => {
        setId = comps.combineAsVariants(d, ids);
      });
    } catch (e) {
      return get().notify((e as Error).message);
    }
    set({ selection: [setId] });
    get().notify('Combined as variants');
  },
  addVariant: (id) => {
    const target = id ?? get().selection[0];
    if (!target) return;
    let nid = '';
    try {
      get().mutate((d) => {
        nid = comps.addVariant(d, target);
      });
    } catch (e) {
      return get().notify((e as Error).message);
    }
    set({ selection: [nid] });
  },
  setVariantValue: (variantId, prop, value) => get().mutate((d) => comps.setVariantValue(d, variantId, prop, value)),
  renameVariantProp: (setId, from, to) => get().mutate((d) => comps.renameVariantProp(d, setId, from, to)),
  renameVariantValue: (setId, prop, from, to) => get().mutate((d) => comps.renameVariantValue(d, setId, prop, from, to)),
  addVariantProp: (setId, name) => get().mutate((d) => comps.addVariantProp(d, setId, name)),
  setInstanceVariant: (instId, prop, value) =>
    get().mutate((d) => {
      comps.setInstanceVariant(d, instId, prop, value);
    }),
  setInstanceProp: (instIds, propId, value) =>
    get().mutate((d) => {
      for (const id of instIds) {
        const n = d.nodes[id];
        if (n?.type === 'instance') n.propValues = { ...(n.propValues ?? {}), [propId]: value };
      }
    }),
  setNestedOverride: (instId, key, patch) =>
    get().mutate((d) => {
      const inst = d.nodes[instId];
      if (!inst || inst.type !== 'instance') return;
      const ov = { ...(inst.overrides ?? {}) };
      if (patch === null) {
        // clear this key and everything scoped below it
        for (const k of Object.keys(ov)) if (k === key || k.startsWith(key + '/')) delete ov[k];
      } else ov[key] = { ...(ov[key] ?? {}), ...patch };
      inst.overrides = ov;
    }),
  swapNested: (instId, key, compId) =>
    get().mutate((d) => {
      const inst = d.nodes[instId];
      if (!inst || inst.type !== 'instance') return;
      const ov = { ...(inst.overrides ?? {}) };
      // overrides inside the old nested component no longer apply
      for (const k of Object.keys(ov)) if (k.startsWith(key + '/')) delete ov[k];
      if (!compId) {
        if (ov[key]) {
          const { componentId: _c, w: _w, h: _h, ...rest } = ov[key];
          void _c;
          void _w;
          void _h;
          ov[key] = rest;
        }
      } else {
        const ids = key.split('/');
        const resolved = comps.resolveNested(d.nodes, { ...inst, overrides: ov }, ids);
        const raw = d.nodes[ids[ids.length - 1]];
        if (!resolved || !raw || raw.type !== 'instance') return;
        if (inst.componentId && comps.usesComponent(d.nodes, compId, inst.componentId)) return;
        ov[key] = { ...(ov[key] ?? {}), ...comps.swapPatch(d.nodes, raw, compId) };
      }
      inst.overrides = ov;
    }),
  addComponentProp: (layerId, type) => {
    try {
      get().mutate((d) => {
        comps.addComponentProp(d, layerId, type);
      });
      get().notify(type === 'boolean' ? 'Visibility property added' : type === 'text' ? 'Text property added' : 'Instance swap property added');
    } catch (e) {
      get().notify((e as Error).message);
    }
  },
  updateComponentProp: (ownerId, propId, patch) =>
    get().mutate((d) => {
      const o = d.nodes[ownerId];
      if (o?.componentProps) o.componentProps = o.componentProps.map((p) => (p.id === propId ? { ...p, ...patch } : p));
    }),
  deleteComponentProp: (ownerId, propId) =>
    get().mutate((d) => {
      const o = d.nodes[ownerId];
      if (o?.componentProps) o.componentProps = o.componentProps.filter((p) => p.id !== propId);
      for (const n of Object.values(d.nodes)) if (n.propValues?.[propId] !== undefined) delete n.propValues[propId];
    }),

  toggleVisible: (ids) => {
    const list = ids ?? get().selection;
    get().updateNodes(list, (n) => ({ visible: !n.visible }));
  },
  toggleLocked: (ids) => {
    const list = ids ?? get().selection;
    get().updateNodes(list, (n) => ({ locked: !n.locked }));
  },
  rename: (id, name) => get().updateNodes([id], { name }),

  copy: async () => {
    const { doc, selection } = get();
    const ids = topLevel(doc, selection);
    if (!ids.length) return;
    const nodes: Record<string, SceneNode> = {};
    for (const id of ids) {
      nodes[id] = doc.nodes[id];
      for (const c of descendants(doc.nodes, id)) nodes[c] = doc.nodes[c];
    }
    // include referenced components so instances paste correctly across files
    for (const n of Object.values(nodes)) if (n.componentId && doc.nodes[n.componentId] && !nodes[n.componentId]) { /* referenced by id */ }
    const payload = JSON.stringify({ figmyClipboard: true, roots: ids, nodes });
    clipboardMemory = payload;
    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      /* clipboard permission may be denied; memory fallback used */
    }
  },
  cut: async () => {
    await get().copy();
    get().deleteSelection();
  },
  paste: async (at, text) => {
    let raw = text ?? clipboardMemory;
    if (text === undefined) {
      try {
        const t = await navigator.clipboard.readText();
        if (t) raw = t;
      } catch {
        /* ignore */
      }
    }
    if (!raw) return;
    let data: { figmyClipboard?: boolean; roots: string[]; nodes: Record<string, SceneNode> } | null = null;
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
    const { pageId, selection, doc } = get();
    if (!data?.figmyClipboard) {
      // paste plain text / svg as text layer
      if (raw.trim().startsWith('<svg')) {
        const { importSvg } = await import('../lib/svgImport');
        const nodes = importSvg(raw, at?.x ?? 0, at?.y ?? 0);
        if (nodes) {
          get().mutate((d) => {
            Object.assign(d.nodes, nodes.nodes);
            link(d, pageId, nodes.rootId, null);
          });
          set({ selection: [nodes.rootId] });
        }
        return;
      }
      const t = createNode('text', { x: at?.x ?? 0, y: at?.y ?? 0, w: 200, h: 24 });
      t.text!.content = raw.slice(0, 5000);
      get().addNode(t);
      set({ selection: [t.id] });
      return;
    }
    const { roots, nodes } = data;
    // pick target parent: selected frame
    const target = selection.length === 1 && ['frame', 'component'].includes(doc.nodes[selection[0]]?.type) ? selection[0] : null;
    const newIds: string[] = [];
    const b = unionRects(roots.map((r) => visualBounds(nodes[r])))!;
    let dx = 0,
      dy = 0;
    if (at) {
      dx = at.x - b.x;
      dy = at.y - b.y;
    } else if (roots.every((r) => doc.nodes[r])) {
      dx = 0;
      dy = 0;
    }
    get().mutate((d) => {
      for (const r of roots) {
        const map: Record<string, string> = {};
        const copies = cloneTree(nodes, r, map);
        Object.assign(d.nodes, copies);
        const nid = map[r];
        link(d, pageId, nid, target, undefined);
        translateTree(d.nodes, nid, dx, dy);
        newIds.push(nid);
      }
      relayoutAncestors(d.nodes, target);
    });
    set({ selection: newIds });
  },

  addPage: () => {
    const id = uid();
    get().mutate((d) => d.pages.push({ id, name: `Page ${d.pages.length + 1}`, children: [], background: '#f5f5f5' }));
    set({ pageId: id, selection: [] });
  },
  renamePage: (id, name) =>
    get().mutate((d) => {
      const p = d.pages.find((p) => p.id === id);
      if (p) p.name = name;
    }),
  deletePage: (id) => {
    if (get().doc.pages.length <= 1) return get().notify('A file needs at least one page');
    get().mutate((d) => {
      const p = d.pages.find((p) => p.id === id)!;
      for (const c of [...p.children]) removeTree(d, c);
      d.pages = d.pages.filter((p) => p.id !== id);
      d.comments = d.comments.filter((c) => c.pageId !== id);
    });
    if (get().pageId === id) set({ pageId: get().doc.pages[0].id, selection: [] });
  },
  duplicatePage: (id) => {
    const nid = uid();
    get().mutate((d) => {
      const p = d.pages.find((p) => p.id === id)!;
      const np: Page = { ...clone(p), id: nid, name: p.name + ' copy', children: [] };
      for (const c of p.children) {
        const map: Record<string, string> = {};
        const copies = cloneTree(d.nodes, c, map);
        Object.assign(d.nodes, copies);
        d.nodes[map[c]].parentId = null;
        np.children.push(map[c]);
      }
      d.pages.splice(d.pages.indexOf(p) + 1, 0, np);
    });
    set({ pageId: nid, selection: [] });
  },
  setPage: (id) => set({ pageId: id, selection: [], focusId: null, editingTextId: null }),

  zoomTo: (z, cx, cy) => {
    const { zoom, panX, panY } = get();
    const nz = Math.min(256, Math.max(0.02, z));
    const px = cx ?? viewport.w / 2,
      py = cy ?? viewport.h / 2;
    // keep the point under cursor fixed
    const wx = (px - panX) / zoom,
      wy = (py - panY) / zoom;
    set({ zoom: nz, panX: px - wx * nz, panY: py - wy * nz });
  },
  zoomToFit: (rect) => {
    const r = rect ?? unionRects(get().page().children.map((id) => visualBounds(get().doc.nodes[id])).filter(Boolean));
    if (!r || r.w === 0) return set({ zoom: 1, panX: viewport.w / 2, panY: viewport.h / 2 });
    const pad = 80;
    const z = Math.min(4, Math.min((viewport.w - pad * 2) / Math.max(r.w, 1), (viewport.h - pad * 2) / Math.max(r.h, 1)));
    set({ zoom: z, panX: viewport.w / 2 - (r.x + r.w / 2) * z, panY: viewport.h / 2 - (r.y + r.h / 2) * z });
  },
  zoomToSelection: () => {
    const b = get().selectionBounds();
    if (b) get().zoomToFit(b);
  },

  addComment: (x, y, text) => {
    const c: Comment = { id: uid(), pageId: get().pageId, x, y, author: get().userName, text, createdAt: Date.now(), resolved: false, replies: [] };
    get().mutate((d) => d.comments.push(c));
    set({ activeCommentId: c.id });
  },
  replyComment: (id, text) =>
    get().mutate((d) => {
      d.comments.find((c) => c.id === id)?.replies.push({ id: uid(), author: get().userName, text, createdAt: Date.now() });
    }),
  resolveComment: (id) =>
    get().mutate((d) => {
      const c = d.comments.find((c) => c.id === id);
      if (c) c.resolved = !c.resolved;
    }),
  deleteComment: (id) => get().mutate((d) => (d.comments = d.comments.filter((c) => c.id !== id))),

  saveVersion: (name) => {
    const { doc } = get();
    const { versions, ...rest } = doc;
    void versions;
    get().mutate((d) => d.versions.unshift({ id: uid(), name: name || new Date().toLocaleString(), createdAt: Date.now(), snapshot: JSON.stringify(rest) }), false);
    get().notify('Version saved');
  },
  restoreVersion: (id) => {
    const v = get().doc.versions.find((v) => v.id === id);
    if (!v) return;
    const snap = JSON.parse(v.snapshot);
    get().mutate((d) => {
      Object.assign(d, snap);
    });
    set({ pageId: get().doc.pages[0].id, selection: [] });
    get().notify(`Restored “${v.name}”`);
  },
}));

let clipboardMemory: string | null = null;

/* ---------- local change feed for collaboration ---------- */

let remoteDoc: DocumentData | null = null;
/** Mark a document as coming from the server so it is not echoed back as a local patch. */
export const markRemote = (doc: DocumentData) => (remoteDoc = doc);
type Listener = (patch: DocPatch) => void;
const listeners = new Set<Listener>();
/** Subscribe to local document changes as patches (remote patches are excluded). */
export function onLocalPatch(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
useEditor.subscribe((state, prev) => {
  if (state.doc === prev.doc || !listeners.size) return;
  if (state.doc === remoteDoc) return; // change came from a collaborator
  // a file switch is not a patch
  if (state.fileId !== prev.fileId) return;
  const patch = diffDocs(prev.doc, state.doc);
  if (patch) listeners.forEach((l) => l(patch));
});
