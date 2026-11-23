import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, setViewportSize, deepCopy, type Guide } from '../store/store';
import { RenderNode } from './render';
import { hitPath, pickFromPath } from './hit';
import { createNode, solid } from '../lib/factory';
import { normalizeRect, rotatePoint, simplify, unionRects, visualBounds, intersects, contains, type Rect } from '../lib/geometry';
import type { PathPoint, SceneNode, Tool } from '../types';
import { textBoxSize, ensureFont } from '../lib/text';
import { importSvg } from '../lib/svgImport';
import { blobToDataUrl } from '../lib/exporter';
import { Overlay } from './Overlay';
import { TextEditor } from './TextEditor';
import { Rulers } from './Rulers';
import { CommentPins } from './CommentPins';
import { PeerCursors } from '../collab/CollabUI';
import { setOf, variantsOf } from '../lib/components';
import { collabCursor } from '../collab/client';

type Drag =
  | { kind: 'pan'; sx: number; sy: number; px: number; py: number }
  | { kind: 'move'; sx: number; sy: number; wx: number; wy: number; started: boolean; ids: string[]; lastDx: number; lastDy: number; dup: boolean }
  | { kind: 'marquee'; wx: number; wy: number; additive: string[] }
  | { kind: 'create'; tool: Tool; wx: number; wy: number; id: string | null; parentId: string | null }
  | { kind: 'resize'; handle: string; start: Rect; nodes: Record<string, SceneNode>; ids: string[]; wx: number; wy: number }
  | { kind: 'rotate'; cx: number; cy: number; startAngle: number; ids: string[]; startRot: Record<string, number> }
  | { kind: 'pencil'; pts: { x: number; y: number }[] }
  | { kind: 'pen-handle'; id: string; index: number }
  | { kind: 'point'; id: string; index: number; part: 'p' | 'cin' | 'cout'; wx: number; wy: number; orig: PathPoint }
  | { kind: 'proto'; fromId: string; x: number; y: number }
  | { kind: 'radius'; id: string; startR: number; wx: number; wy: number };

const SNAP = 6;

export function Canvas() {
  const ref = useRef<HTMLDivElement>(null);
  const st = useEditor();
  const { doc, zoom, panX, panY, tool } = st;
  const page = st.page();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [space, setSpace] = useState(false);
  const [cursorW, setCursorW] = useState<{ x: number; y: number } | null>(null);
  const [protoDrag, setProtoDrag] = useState<{ fromId: string; x: number; y: number } | null>(null);
  const [, force] = useState(0);
  const penRef = useRef<string | null>(null); // path being drawn by pen

  // resize observer
  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setViewportSize(el.clientWidth, el.clientHeight));
    ro.observe(el);
    setViewportSize(el.clientWidth, el.clientHeight);
    // center first time
    useEditor.getState().zoomToFit();
    const fonts = () => force((x) => x + 1);
    window.addEventListener('figmy:fonts', fonts);
    return () => {
      ro.disconnect();
      window.removeEventListener('figmy:fonts', fonts);
    };
  }, []);

  // load fonts used by text in the doc
  useEffect(() => {
    for (const n of Object.values(doc.nodes)) if (n.text) ensureFont(n.text.fontFamily);
  }, [doc.nodes]);

  // space to pan
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e)) {
        setSpace(true);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpace(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // finish pen path when tool changes
  useEffect(() => {
    if (tool !== 'pen') penRef.current = null;
  }, [tool]);

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const r = ref.current!.getBoundingClientRect();
      return { x: (clientX - r.left - panX) / zoom, y: (clientY - r.top - panY) / zoom };
    },
    [panX, panY, zoom],
  );

  // wheel zoom/pan (non-passive)
  useEffect(() => {
    const el = ref.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = useEditor.getState();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025) * (e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 30 ? 4 : 1));
        s.zoomTo(s.zoom * factor, e.clientX - r.left, e.clientY - r.top);
      } else if (e.shiftKey) s.set({ panX: s.panX - (e.deltaY || e.deltaX) });
      else s.set({ panX: s.panX - e.deltaX, panY: s.panY - e.deltaY });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const snapV = (v: number) => (st.snapToPixel ? Math.round(v) : v);

  /** Find top-most frame (not in exclude) containing point, for parenting new / moved nodes. */
  const frameAt = (x: number, y: number, exclude: string[] = []): string | null => {
    const nodes = useEditor.getState().doc.nodes;
    const walk = (list: string[]): string | null => {
      for (let i = list.length - 1; i >= 0; i--) {
        const n = nodes[list[i]];
        if (!n || !n.visible || exclude.includes(n.id)) continue;
        if ((n.type === 'frame' || n.type === 'component') && x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h) {
          return walk(n.children) ?? n.id;
        }
      }
      return null;
    };
    return walk(useEditor.getState().page().children);
  };

  /** Snap a moving rect against other nodes; returns corrections and guides. */
  const computeSnap = (r: Rect, exclude: Set<string>): { dx: number; dy: number; guides: Guide[] } => {
    const s = useEditor.getState();
    const nodes = s.doc.nodes;
    const th = SNAP / s.zoom;
    const cands: Rect[] = [];
    const collect = (list: string[], depth: number) => {
      for (const id of list) {
        const n = nodes[id];
        if (!n || exclude.has(id) || !n.visible) continue;
        cands.push(visualBounds(n));
        if (depth < 2 && (n.type === 'frame' || n.type === 'component')) collect(n.children, depth + 1);
      }
    };
    collect(s.page().children, 0);
    const xsSelf = [r.x, r.x + r.w / 2, r.x + r.w];
    const ysSelf = [r.y, r.y + r.h / 2, r.y + r.h];
    let bestX: { d: number; pos: number; c: Rect } | null = null;
    let bestY: { d: number; pos: number; c: Rect } | null = null;
    for (const c of cands) {
      for (const cx of [c.x, c.x + c.w / 2, c.x + c.w])
        for (const sx of xsSelf) {
          const d = cx - sx;
          if (Math.abs(d) < th && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, pos: cx, c };
        }
      for (const cy of [c.y, c.y + c.h / 2, c.y + c.h])
        for (const sy of ysSelf) {
          const d = cy - sy;
          if (Math.abs(d) < th && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, pos: cy, c };
        }
    }
    const guides: Guide[] = [];
    const bx = bestX as { d: number; pos: number; c: Rect } | null;
    const by = bestY as { d: number; pos: number; c: Rect } | null;
    if (bx) guides.push({ axis: 'x', pos: bx.pos, from: Math.min(r.y + (by?.d ?? 0), bx.c.y), to: Math.max(r.y + r.h + (by?.d ?? 0), bx.c.y + bx.c.h) });
    if (by) guides.push({ axis: 'y', pos: by.pos, from: Math.min(r.x + (bx?.d ?? 0), by.c.x), to: Math.max(r.x + r.w + (bx?.d ?? 0), by.c.x + by.c.w) });
    return { dx: bx?.d ?? 0, dy: by?.d ?? 0, guides };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    const s = useEditor.getState();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const w = toWorld(e.clientX, e.clientY);
    if (s.editingTextId) s.set({ editingTextId: null });
    if (e.button === 1 || space || s.tool === 'hand') {
      setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, px: s.panX, py: s.panY });
      return;
    }
    const target = e.target as HTMLElement;
    const handle = target.dataset?.handle;
    // vector point editing
    if (target.dataset?.point && s.editingPathId) {
      const idx = Number(target.dataset.point);
      const part = (target.dataset.part ?? 'p') as 'p' | 'cin' | 'cout';
      const n = s.doc.nodes[s.editingPathId];
      s.checkpoint();
      setDrag({ kind: 'point', id: s.editingPathId, index: idx, part, wx: w.x, wy: w.y, orig: structuredClone(n.points![idx]) });
      return;
    }
    if (handle === 'radius') {
      const n = s.selectedNodes()[0];
      s.checkpoint();
      setDrag({ kind: 'radius', id: n.id, startR: n.radius, wx: w.x, wy: w.y });
      return;
    }
    if (handle === 'proto') {
      setProtoDrag({ fromId: s.selection[0], x: w.x, y: w.y });
      setDrag({ kind: 'proto', fromId: s.selection[0], x: w.x, y: w.y });
      return;
    }
    if (handle === 'rotate') {
      const b = s.selectionBounds()!;
      const cx = b.x + b.w / 2,
        cy = b.y + b.h / 2;
      const startRot: Record<string, number> = {};
      for (const n of s.selectedNodes()) startRot[n.id] = n.rotation;
      s.checkpoint();
      setDrag({ kind: 'rotate', cx, cy, startAngle: Math.atan2(w.y - cy, w.x - cx), ids: s.selection, startRot });
      return;
    }
    if (handle) {
      const sel = s.selectedNodes();
      const start = sel.length === 1 ? { x: sel[0].x, y: sel[0].y, w: sel[0].w, h: sel[0].h } : s.selectionBounds()!;
      const snap: Record<string, SceneNode> = {};
      for (const n of sel) snap[n.id] = structuredClone(n);
      s.checkpoint();
      setDrag({ kind: 'resize', handle, start, nodes: snap, ids: sel.map((n) => n.id), wx: w.x, wy: w.y });
      return;
    }

    switch (s.tool) {
      case 'comment': {
        const text = prompt('Add a comment');
        if (text) s.addComment(w.x, w.y, text);
        s.set({ tool: 'move' });
        return;
      }
      case 'text': {
        const parent = frameAt(w.x, w.y);
        const t = createNode('text', { x: snapV(w.x), y: snapV(w.y), w: 20, h: 21, name: 'Text' });
        t.text!.content = '';
        s.addNode(t, parent);
        s.set({ selection: [t.id], editingTextId: t.id, tool: 'move' });
        return;
      }
      case 'pencil':
        setDrag({ kind: 'pencil', pts: [w] });
        return;
      case 'pen': {
        const nodes = s.doc.nodes;
        const cur = penRef.current ? nodes[penRef.current] : null;
        if (cur && cur.points) {
          const first = cur.points[0];
          const lx = w.x - cur.x,
            ly = w.y - cur.y;
          if (cur.points.length > 2 && Math.hypot(lx - first.x, ly - first.y) * s.zoom < 8) {
            // close path
            s.mutate((d) => {
              d.nodes[cur.id].closed = true;
              d.nodes[cur.id].fills = [solid('#d9d9d9')];
            });
            normalizePath(cur.id);
            penRef.current = null;
            s.set({ tool: 'move', selection: [cur.id] });
            return;
          }
          s.mutate((d) => d.nodes[cur.id].points!.push({ x: lx, y: ly }));
          setDrag({ kind: 'pen-handle', id: cur.id, index: cur.points.length });
          return;
        }
        const parent = frameAt(w.x, w.y);
        const p = createNode('path', { x: w.x, y: w.y, w: 0, h: 0, points: [{ x: 0, y: 0 }], closed: false });
        s.addNode(p, parent);
        penRef.current = p.id;
        s.set({ selection: [p.id] });
        setDrag({ kind: 'pen-handle', id: p.id, index: 0 });
        return;
      }
      case 'frame':
      case 'section':
      case 'rect':
      case 'ellipse':
      case 'polygon':
      case 'star':
      case 'line':
      case 'arrow':
      case 'image': {
        const parent = s.tool === 'frame' || s.tool === 'section' ? frameAt(w.x, w.y) : frameAt(w.x, w.y);
        s.checkpoint();
        setDrag({ kind: 'create', tool: s.tool, wx: snapV(w.x), wy: snapV(w.y), id: null, parentId: parent });
        return;
      }
    }

    // move tool
    if (s.mode === 'prototype' || s.mode === 'design' || s.mode === 'dev') {
      // frame title click
      if (target.dataset?.frameLabel) {
        const id = target.dataset.frameLabel;
        s.select([id], e.shiftKey);
        if (s.mode !== 'dev') {
          s.checkpoint();
          setDrag({ kind: 'move', sx: e.clientX, sy: e.clientY, wx: w.x, wy: w.y, started: false, ids: useEditor.getState().selection, lastDx: 0, lastDy: 0, dup: false });
        }
        return;
      }
      const roots = s.page().children;
      const path = hitPath(s.doc.nodes, roots, w.x, w.y, 2 / s.zoom);
      // if clicking inside current selection bounds (multi), drag selection
      const sb = s.selectionBounds();
      const insideSel = sb && s.selection.length > 1 && w.x >= sb.x && w.x <= sb.x + sb.w && w.y >= sb.y && w.y <= sb.y + sb.h;
      let picked = pickFromPath(s.doc.nodes, path, { deep: e.ctrlKey || e.metaKey, focusId: s.focusId, selection: s.selection });
      if (insideSel && !e.shiftKey && (!picked || s.selection.includes(picked))) picked = s.selection[0];
      if (!picked) {
        if (!e.shiftKey) s.set({ selection: [], focusId: null, editingPathId: null });
        setDrag({ kind: 'marquee', wx: w.x, wy: w.y, additive: e.shiftKey ? s.selection : [] });
        return;
      }
      if (s.editingPathId && picked !== s.editingPathId) s.set({ editingPathId: null });
      if (e.shiftKey) s.select([picked], true);
      else if (!s.selection.includes(picked)) s.select([picked]);
      if (s.mode === 'dev') return;
      const ids = useEditor.getState().selection;
      if (ids.some((id) => s.doc.nodes[id]?.locked)) return;
      s.checkpoint();
      setDrag({ kind: 'move', sx: e.clientX, sy: e.clientY, wx: w.x, wy: w.y, started: false, ids, lastDx: 0, lastDy: 0, dup: e.altKey });
    }
  };

  const normalizePath = (id: string) => {
    // recompute bbox of path so x,y,w,h wraps the points
    useEditor.getState().mutate((d) => {
      const n = d.nodes[id];
      if (!n?.points?.length) return;
      const all = n.points.flatMap((p) => [p, p.cin, p.cout].filter(Boolean) as { x: number; y: number }[]);
      const minX = Math.min(...all.map((p) => p.x)),
        minY = Math.min(...all.map((p) => p.y));
      const maxX = Math.max(...all.map((p) => p.x)),
        maxY = Math.max(...all.map((p) => p.y));
      const sh = (p?: { x: number; y: number }) => p && { x: p.x - minX, y: p.y - minY };
      n.points = n.points.map((p) => ({ x: p.x - minX, y: p.y - minY, cin: sh(p.cin), cout: sh(p.cout) }));
      n.x += minX;
      n.y += minY;
      n.w = Math.max(maxX - minX, 0.01);
      n.h = Math.max(maxY - minY, 0.01);
    }, false);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = useEditor.getState();
    const w = toWorld(e.clientX, e.clientY);
    setCursorW(w);
    collabCursor(w);
    if (!drag) {
      if (s.tool === 'move' && !space) {
        const path = hitPath(s.doc.nodes, s.page().children, w.x, w.y, 2 / s.zoom);
        const id = pickFromPath(s.doc.nodes, path, { deep: e.ctrlKey || e.metaKey, focusId: s.focusId, selection: s.selection });
        if (id !== s.hoverId) s.set({ hoverId: id });
      }
      return;
    }
    switch (drag.kind) {
      case 'pan':
        s.set({ panX: drag.px + e.clientX - drag.sx, panY: drag.py + e.clientY - drag.sy });
        break;
      case 'move': {
        if (!drag.started && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) return;
        if (!drag.started && drag.dup) {
          s.duplicate(0);
          drag.ids = useEditor.getState().selection;
        }
        drag.started = true;
        let dx = w.x - drag.wx,
          dy = w.y - drag.wy;
        if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
        // snapping against original position + delta
        const cur = useEditor.getState();
        const b = unionRects(drag.ids.map((id) => visualBounds(cur.doc.nodes[id])).filter(Boolean))!;
        const target = { x: b.x - drag.lastDx + dx, y: b.y - drag.lastDy + dy, w: b.w, h: b.h };
        const excl = new Set<string>(drag.ids);
        const snapped = e.altKey || e.ctrlKey ? { dx: 0, dy: 0, guides: [] } : computeSnap(target, excl);
        dx = snapV(dx + snapped.dx);
        dy = snapV(dy + snapped.dy);
        const mdx = dx - drag.lastDx,
          mdy = dy - drag.lastDy;
        if (mdx || mdy) s.moveBy(drag.ids, mdx, mdy, false);
        drag.lastDx = dx;
        drag.lastDy = dy;
        s.set({ guides: snapped.guides });
        break;
      }
      case 'marquee': {
        const r = normalizeRect(drag.wx, drag.wy, w.x, w.y);
        const nodes = s.doc.nodes;
        // select top-level children (or children of top level frames when fully inside them)
        const hits: string[] = [];
        const scan = (list: string[]) => {
          for (const id of list) {
            const n = nodes[id];
            if (!n || !n.visible || n.locked) continue;
            const b = visualBounds(n);
            if ((n.type === 'frame' || n.type === 'component') && !n.parentId && contains(b, r)) {
              scan(n.children);
              return;
            }
            if (intersects(b, r)) hits.push(id);
          }
        };
        scan(s.focusId ? nodes[s.focusId]?.children ?? [] : s.page().children);
        s.set({ marquee: r, selection: [...new Set([...drag.additive, ...hits])] });
        break;
      }
      case 'create': {
        let x2 = snapV(w.x),
          y2 = snapV(w.y);
        if (e.shiftKey) {
          const d = Math.max(Math.abs(x2 - drag.wx), Math.abs(y2 - drag.wy));
          if (drag.tool === 'line' || drag.tool === 'arrow') {
            const ang = Math.round(Math.atan2(y2 - drag.wy, x2 - drag.wx) / (Math.PI / 4)) * (Math.PI / 4);
            const len = Math.hypot(x2 - drag.wx, y2 - drag.wy);
            x2 = drag.wx + Math.cos(ang) * len;
            y2 = drag.wy + Math.sin(ang) * len;
          } else {
            x2 = drag.wx + Math.sign(x2 - drag.wx || 1) * d;
            y2 = drag.wy + Math.sign(y2 - drag.wy || 1) * d;
          }
        }
        let r = normalizeRect(drag.wx, drag.wy, x2, y2);
        if (e.altKey) r = { x: drag.wx - Math.abs(x2 - drag.wx), y: drag.wy - Math.abs(y2 - drag.wy), w: Math.abs(x2 - drag.wx) * 2, h: Math.abs(y2 - drag.wy) * 2 };
        const isLine = drag.tool === 'line' || drag.tool === 'arrow';
        if (!drag.id) {
          if (Math.hypot(x2 - drag.wx, y2 - drag.wy) * s.zoom < 3) return;
          const type = drag.tool === 'section' ? 'frame' : drag.tool === 'arrow' ? 'path' : drag.tool === 'image' ? 'rect' : (drag.tool as SceneNode['type']);
          const n = isLine
            ? createNode('path', { name: drag.tool === 'arrow' ? 'Arrow' : 'Line', x: drag.wx, y: drag.wy, w: 1, h: 1, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: false })
            : createNode(type, { ...r, name: drag.tool === 'section' ? 'Section' : undefined });
          if (drag.tool === 'section') {
            n.fills = [solid('#ffffff', 0.6)];
            n.radius = 8;
            n.strokes = [{ color: '#b3b3b3', width: 1, opacity: 1, align: 'inside', dash: 0, cap: 'butt', join: 'miter', visible: true }];
            n.clip = false;
          }
          if (drag.tool === 'arrow') n.name = 'Arrow';
          s.mutate((d) => {
            d.nodes[n.id] = n;
            const list = drag.parentId ? d.nodes[drag.parentId].children : d.pages.find((p) => p.id === s.pageId)!.children;
            n.parentId = drag.parentId;
            list.push(n.id);
          }, false);
          drag.id = n.id;
          s.set({ selection: [n.id] });
        } else if (isLine) {
          const dx = x2 - drag.wx,
            dy = y2 - drag.wy;
          s.mutate((d) => {
            const n = d.nodes[drag.id!];
            n.x = Math.min(drag.wx, x2);
            n.y = Math.min(drag.wy, y2);
            n.w = Math.abs(dx) || 0.01;
            n.h = Math.abs(dy) || 0.01;
            n.points = [
              { x: dx >= 0 ? 0 : -dx, y: dy >= 0 ? 0 : -dy },
              { x: dx >= 0 ? dx : 0, y: dy >= 0 ? dy : 0 },
            ];
            if (drag.tool === 'arrow') n.strokes = n.strokes.map((st) => ({ ...st, cap: 'round' }));
          }, false);
        } else {
          s.resizeNode(drag.id, r, false);
        }
        break;
      }
      case 'resize': {
        let dx = w.x - drag.wx,
          dy = w.y - drag.wy;
        const h = drag.handle;
        const st0 = drag.start;
        const single = drag.ids.length === 1 ? drag.nodes[drag.ids[0]] : null;
        if (single?.rotation) {
          const p = rotatePoint(dx, dy, 0, 0, -single.rotation);
          dx = p.x;
          dy = p.y;
        }
        let x = st0.x,
          y = st0.y,
          ww = st0.w,
          hh = st0.h;
        if (h.includes('e')) ww = st0.w + dx;
        if (h.includes('w')) {
          ww = st0.w - dx;
          x = st0.x + dx;
        }
        if (h.includes('s')) hh = st0.h + dy;
        if (h.includes('n')) {
          hh = st0.h - dy;
          y = st0.y + dy;
        }
        const keepRatio = e.shiftKey || single?.type === 'image' && !e.shiftKey && false;
        if (keepRatio && st0.w && st0.h) {
          const ratio = st0.w / st0.h;
          if (h.length === 2) {
            if (Math.abs(ww / st0.w) > Math.abs(hh / st0.h)) hh = ww / ratio;
            else ww = hh * ratio;
            if (h.includes('n')) y = st0.y + st0.h - hh;
            if (h.includes('w')) x = st0.x + st0.w - ww;
          } else if (h === 'e' || h === 'w') {
            hh = ww / ratio;
            y = st0.y + (st0.h - hh) / 2;
          } else {
            ww = hh * ratio;
            x = st0.x + (st0.w - ww) / 2;
          }
        }
        if (e.altKey) {
          // resize from center
          const cx = st0.x + st0.w / 2,
            cy = st0.y + st0.h / 2;
          if (h.includes('e') || h.includes('w')) {
            ww = Math.abs(ww - st0.w) * Math.sign(ww - st0.w) * 2 + st0.w;
            x = cx - ww / 2;
          }
          if (h.includes('n') || h.includes('s')) {
            hh = Math.abs(hh - st0.h) * Math.sign(hh - st0.h) * 2 + st0.h;
            y = cy - hh / 2;
          }
        }
        let flipX = false,
          flipY = false;
        if (ww < 0) {
          x += ww;
          ww = -ww;
          flipX = true;
        }
        if (hh < 0) {
          y += hh;
          hh = -hh;
          flipY = true;
        }
        void flipX;
        void flipY;
        x = snapV(x);
        y = snapV(y);
        ww = Math.max(snapV(ww), 1);
        hh = Math.max(snapV(hh), single?.type === 'line' ? 0 : 1);
        if (single) {
          if (single.rotation) {
            // keep opposite corner fixed in world space
            const oc = rotatePoint(st0.x + st0.w / 2, st0.y + st0.h / 2, 0, 0, 0);
            const newC = { x: x + ww / 2, y: y + hh / 2 };
            const shift = rotatePoint(newC.x, newC.y, oc.x, oc.y, single.rotation);
            x = shift.x - ww / 2;
            y = shift.y - hh / 2;
          }
          // restore original then resize so children scale from original
          s.mutate((d) => {
            restoreSubtree(d.nodes, drag.nodes, single.id);
          }, false);
          s.resizeNode(single.id, { x, y, w: ww, h: hh }, false);
        } else {
          // multi: scale each node relative to bounds
          const sx = ww / (st0.w || 1),
            sy = hh / (st0.h || 1);
          s.mutate((d) => restoreAll(d.nodes, drag.nodes), false);
          for (const id of drag.ids) {
            const o = drag.nodes[id];
            s.resizeNode(id, { x: x + (o.x - st0.x) * sx, y: y + (o.y - st0.y) * sy, w: Math.max(1, o.w * sx), h: Math.max(1, o.h * sy) }, false);
          }
        }
        break;
      }
      case 'rotate': {
        let ang = ((Math.atan2(w.y - drag.cy, w.x - drag.cx) - drag.startAngle) * 180) / Math.PI;
        if (e.shiftKey) ang = Math.round(ang / 15) * 15;
        s.mutate((d) => {
          for (const id of drag.ids) {
            const n = d.nodes[id];
            let r = (drag.startRot[id] + ang) % 360;
            if (r > 180) r -= 360;
            if (r < -180) r += 360;
            n.rotation = Math.round(r * 10) / 10;
          }
        }, false);
        break;
      }
      case 'pencil':
        drag.pts.push(w);
        force((x) => x + 1);
        break;
      case 'pen-handle': {
        const n = s.doc.nodes[drag.id];
        if (!n?.points) return;
        const p = n.points[drag.index];
        const lx = w.x - n.x,
          ly = w.y - n.y;
        if (Math.hypot(lx - p.x, ly - p.y) * s.zoom < 3) return;
        s.mutate((d) => {
          const pt = d.nodes[drag.id].points![drag.index];
          pt.cout = { x: lx, y: ly };
          pt.cin = { x: 2 * pt.x - lx, y: 2 * pt.y - ly };
        }, false);
        break;
      }
      case 'point': {
        const dx = w.x - drag.wx,
          dy = w.y - drag.wy;
        s.mutate((d) => {
          const n = d.nodes[drag.id];
          const pt = n.points![drag.index];
          const o = drag.orig;
          if (drag.part === 'p') {
            pt.x = o.x + dx;
            pt.y = o.y + dy;
            if (o.cin) pt.cin = { x: o.cin.x + dx, y: o.cin.y + dy };
            if (o.cout) pt.cout = { x: o.cout.x + dx, y: o.cout.y + dy };
          } else {
            const src = o[drag.part]!;
            const np = { x: src.x + dx, y: src.y + dy };
            pt[drag.part] = np;
            if (!e.altKey) {
              const other = drag.part === 'cin' ? 'cout' : 'cin';
              pt[other] = { x: 2 * pt.x - np.x, y: 2 * pt.y - np.y };
            }
          }
        }, false);
        break;
      }
      case 'proto':
        setProtoDrag({ fromId: drag.fromId, x: w.x, y: w.y });
        break;
      case 'radius': {
        const n = s.doc.nodes[drag.id];
        const d = Math.max(0, drag.startR + (w.x - drag.wx + (w.y - drag.wy)) / 2);
        s.mutate((dd) => {
          dd.nodes[drag.id].radius = Math.round(Math.min(d, Math.min(n.w, n.h) / 2));
          dd.nodes[drag.id].radii = null;
        }, false);
        break;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = useEditor.getState();
    const w = toWorld(e.clientX, e.clientY);
    if (!drag) return;
    switch (drag.kind) {
      case 'move': {
        if (!drag.started) {
          // plain click: select only the clicked item if it was part of a multi-selection
          const path = hitPath(s.doc.nodes, s.page().children, w.x, w.y, 2 / s.zoom);
          const picked = pickFromPath(s.doc.nodes, path, { deep: e.ctrlKey || e.metaKey, focusId: s.focusId, selection: s.selection });
          if (picked && !e.shiftKey && s.selection.length > 1) s.select([picked]);
          // discard empty checkpoint
          s.set({ past: s.past.slice(0, -1) });
          break;
        }
        // reparent into frame under cursor
        const nodes = s.doc.nodes;
        const top = drag.ids.filter((id) => nodes[id]);
        const parentNow = nodes[top[0]]?.parentId ?? null;
        const parentNode = parentNow ? nodes[parentNow] : null;
        if (parentNode?.autoLayout) {
          // reorder inside auto layout by pointer position
          const horiz = parentNode.autoLayout.direction === 'horizontal';
          const others = parentNode.children.filter((c) => !top.includes(c));
          let idx = others.findIndex((c) => {
            const n = nodes[c];
            return horiz ? w.x < n.x + n.w / 2 : w.y < n.y + n.h / 2;
          });
          if (idx < 0) idx = others.length;
          const inside = w.x >= parentNode.x && w.x <= parentNode.x + parentNode.w && w.y >= parentNode.y && w.y <= parentNode.y + parentNode.h;
          if (inside) {
            s.mutate((d) => {
              const p = d.nodes[parentNode.id];
              p.children = [...others.slice(0, idx), ...top, ...others.slice(idx)];
            }, false);
            s.updateNodes([parentNode.id], {});
            s.set({ past: s.past.slice(0, -1) });
          } else {
            const target = frameAt(w.x, w.y, top);
            s.reparent(top, target);
            s.set({ past: s.past.slice(0, -1) });
          }
        } else {
          const target = frameAt(w.x, w.y, top);
          if (target !== parentNow && !(parentNode?.type === 'group')) {
            s.reparent(top, target);
            s.set({ past: s.past.slice(0, -1) });
          }
        }
        break;
      }
      case 'create': {
        if (!drag.id) {
          // click without drag: default sized shape
          if (drag.tool === 'image') {
            s.set({ past: s.past.slice(0, -1) });
            insertImageFromPicker(drag.wx, drag.wy);
            break;
          }
          const size = drag.tool === 'frame' ? { w: 100, h: 100 } : drag.tool === 'line' || drag.tool === 'arrow' ? { w: 100, h: 0 } : { w: 100, h: 100 };
          const type = drag.tool === 'section' ? 'frame' : drag.tool === 'arrow' || drag.tool === 'line' ? 'path' : (drag.tool as SceneNode['type']);
          const n = createNode(type, { x: drag.wx, y: drag.wy, ...size });
          if (type === 'path') {
            n.points = [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
            ];
            n.h = 0.01;
            n.name = drag.tool === 'arrow' ? 'Arrow' : 'Line';
          }
          s.mutate((d) => {
            d.nodes[n.id] = n;
            n.parentId = drag.parentId;
            (drag.parentId ? d.nodes[drag.parentId].children : d.pages.find((p) => p.id === s.pageId)!.children).push(n.id);
          }, false);
          s.set({ selection: [n.id] });
        } else if (drag.tool === 'image') {
          const id = drag.id;
          pickImageData().then((src) => {
            if (src) useEditor.getState().mutate((d) => {
              const n = d.nodes[id];
              n.type = 'image';
              n.name = 'Image';
              n.src = src;
              n.fills = [];
            }, false);
          });
        } else if (drag.tool === 'frame') {
          // adopt nodes fully inside the new frame
          const f = s.doc.nodes[drag.id];
          const siblings = drag.parentId ? s.doc.nodes[drag.parentId].children : s.page().children;
          const inside = siblings.filter((id) => id !== f.id && contains(f, visualBounds(s.doc.nodes[id])));
          if (inside.length) {
            s.mutate((d) => {
              const list = drag.parentId ? d.nodes[drag.parentId].children : d.pages.find((p) => p.id === s.pageId)!.children;
              for (const id of inside) {
                list.splice(list.indexOf(id), 1);
                d.nodes[id].parentId = f.id;
                d.nodes[f.id].children.push(id);
              }
            }, false);
          }
        }
        if (drag.tool === 'arrow' && drag.id) addArrowHead(drag.id);
        s.updateNodes([], {});
        s.set({ past: s.past.slice(0, -1), tool: e.shiftKey && false ? s.tool : 'move' });
        // relayout parents if needed
        const id = useEditor.getState().selection[0];
        const par = id ? useEditor.getState().doc.nodes[id]?.parentId : null;
        if (par) useEditor.getState().updateNodes([par], {});
        useEditor.getState().set({ past: useEditor.getState().past.slice(0, -1) });
        break;
      }
      case 'pencil': {
        const pts = simplify(drag.pts, 1 / s.zoom);
        if (pts.length >= 2) {
          const minX = Math.min(...pts.map((p) => p.x)),
            minY = Math.min(...pts.map((p) => p.y));
          const maxX = Math.max(...pts.map((p) => p.x)),
            maxY = Math.max(...pts.map((p) => p.y));
          const n = createNode('path', {
            name: 'Pencil',
            x: minX,
            y: minY,
            w: Math.max(0.01, maxX - minX),
            h: Math.max(0.01, maxY - minY),
            points: smoothPoints(pts.map((p) => ({ x: p.x - minX, y: p.y - minY }))),
            closed: false,
          });
          n.strokes = [{ ...n.strokes[0], width: 2, cap: 'round', join: 'round' }];
          s.addNode(n, frameAt(pts[0].x, pts[0].y));
          s.set({ selection: [n.id] });
        }
        break;
      }
      case 'pen-handle':
        normalizePath(drag.id);
        break;
      case 'point':
        normalizePath(drag.id);
        break;
      case 'proto': {
        const target = frameAt(w.x, w.y, [drag.fromId]);
        // interactive components: dropping onto a sibling variant creates a "change to" link
        let owner: SceneNode | undefined = s.doc.nodes[drag.fromId];
        while (owner && owner.type !== 'component') owner = owner.parentId ? s.doc.nodes[owner.parentId] : undefined;
        const ownerSet = owner ? setOf(s.doc.nodes, owner.id) : null;
        if (ownerSet && owner) {
          const variant = variantsOf(s.doc.nodes, ownerSet.id).find((v) => v.id !== owner!.id && w.x >= v.x && w.x <= v.x + v.w && w.y >= v.y && w.y <= v.y + v.h);
          if (variant) {
            s.updateNodes([drag.fromId], (n) => ({ prototype: [...(n.prototype ?? []).filter((l) => l.trigger !== 'click'), { trigger: 'click', action: 'change-to', targetId: variant.id, animation: 'smart-animate', easing: 'ease-out', duration: 300 }] }));
            s.notify(`Change to “${variant.name}” on click`);
            setProtoDrag(null);
            break;
          }
        }
        // only top-level frames are targets
        let top = target;
        while (top && s.doc.nodes[top]?.parentId) top = s.doc.nodes[top].parentId;
        if (top && top !== drag.fromId) {
          s.updateNodes([drag.fromId], (n) => ({ prototype: [...(n.prototype ?? []).filter((l) => l.trigger !== 'click'), { trigger: 'click', targetId: top!, animation: 'dissolve', duration: 300 }] }));
          s.notify(`Linked to “${s.doc.nodes[top].name}”`);
        }
        setProtoDrag(null);
        break;
      }
    }
    if (drag.kind === 'resize' || drag.kind === 'rotate' || drag.kind === 'radius') {
      /* already checkpointed */
    }
    setDrag(null);
    s.set({ guides: [], marquee: null });
  };

  const addArrowHead = (id: string) => {
    useEditor.getState().mutate((d) => {
      const n = d.nodes[id];
      if (!n.points || n.points.length < 2) return;
      const [a, b] = [n.points[0], n.points[n.points.length - 1]];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const L = 12;
      const p1 = { x: b.x - L * Math.cos(ang - 0.45), y: b.y - L * Math.sin(ang - 0.45) };
      const p2 = { x: b.x - L * Math.cos(ang + 0.45), y: b.y - L * Math.sin(ang + 0.45) };
      n.points = [a, b, p1, b, p2];
      n.strokes = n.strokes.map((st) => ({ ...st, cap: 'round', join: 'round' }));
    }, false);
    normalizePath(id);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const s = useEditor.getState();
    const w = toWorld(e.clientX, e.clientY);
    if (s.tool === 'pen' && penRef.current) {
      normalizePath(penRef.current);
      penRef.current = null;
      s.set({ tool: 'move' });
      return;
    }
    const path = hitPath(s.doc.nodes, s.page().children, w.x, w.y, 2 / s.zoom);
    const sel = s.selection[0];
    const n = sel ? s.doc.nodes[sel] : null;
    if (n?.type === 'text' && path.includes(n.id)) {
      s.set({ editingTextId: n.id });
      return;
    }
    if (n?.type === 'path' && path.includes(n.id)) {
      s.set({ editingPathId: s.editingPathId === n.id ? null : n.id });
      return;
    }
    if (n?.type === 'instance' && path.includes(n.id)) return;
    // go one level deeper
    const i = sel ? path.indexOf(sel) : -1;
    if (i >= 0 && i < path.length - 1) {
      s.set({ selection: [path[i + 1]], focusId: sel });
      const deeper = s.doc.nodes[path[i + 1]];
      if (deeper?.type === 'text' && i + 1 === path.length - 1) s.set({ editingTextId: deeper.id });
    } else if (!sel && path.length) {
      const leaf = s.doc.nodes[path[path.length - 1]];
      if (leaf.type === 'text') s.set({ selection: [leaf.id], editingTextId: leaf.id });
    }
  };

  const insertImageFromPicker = async (x: number, y: number) => {
    const src = await pickImageData();
    if (src) insertImage(src, x, y);
  };

  const insertImage = (src: string, x: number, y: number) => {
    const img = new Image();
    img.onload = () => {
      const s = useEditor.getState();
      const max = 800;
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const n = createNode('image', { x: Math.round(x), y: Math.round(y), w: Math.round(img.width * k), h: Math.round(img.height * k), src, name: 'Image' });
      s.addNode(n, frameAt(x, y));
      s.set({ selection: [n.id], tool: 'move' });
    };
    img.src = src;
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const s = useEditor.getState();
    const w = toWorld(e.clientX, e.clientY);
    const comp = e.dataTransfer.getData('application/x-figmy-component');
    if (comp) {
      const c = s.doc.nodes[comp];
      if (c) s.createInstance(comp, Math.round(w.x - c.w / 2), Math.round(w.y - c.h / 2));
      return;
    }
    let ox = 0;
    for (const f of [...e.dataTransfer.files]) {
      if (f.type === 'image/svg+xml' || f.name.endsWith('.svg')) {
        const res = importSvg(await f.text(), w.x + ox, w.y);
        if (res) {
          s.mutate((d) => {
            Object.assign(d.nodes, res.nodes);
            d.pages.find((p) => p.id === s.pageId)!.children.push(res.rootId);
          });
          s.set({ selection: [res.rootId] });
        }
      } else if (f.type.startsWith('image/')) {
        insertImage(await blobToDataUrl(f), w.x + ox, w.y);
      }
      ox += 40;
    }
  };

  // paste images from clipboard
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      if (isTyping(e)) return;
      const items = [...(e.clipboardData?.items ?? [])];
      const img = items.find((i) => i.type.startsWith('image/'));
      const s = useEditor.getState();
      const vp = ref.current!.getBoundingClientRect();
      const center = { x: (vp.width / 2 - s.panX) / s.zoom, y: (vp.height / 2 - s.panY) / s.zoom };
      e.preventDefault();
      if (img) {
        const f = img.getAsFile();
        if (f) insertImage(await blobToDataUrl(f), center.x, center.y);
        return;
      }
      const text = e.clipboardData?.getData('text/plain');
      if (text) s.paste(text.includes('figmyClipboard') ? undefined : center, text);
      else s.paste();
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const cursor = drag?.kind === 'pan' || space || tool === 'hand' ? (drag?.kind === 'pan' ? 'grabbing' : 'grab') : tool === 'move' ? 'default' : tool === 'text' ? 'text' : tool === 'comment' ? 'copy' : 'crosshair';

  const hidden = new Set<string>(st.editingTextId ? [st.editingTextId] : []);

  return (
    <div
      ref={ref}
      className="canvas"
      style={{ background: page.background, cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => {
        setCursorW(null);
        collabCursor(null);
      }}
      onDoubleClick={onDoubleClick}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onContextMenu={(e) => {
        e.preventDefault();
        const s = useEditor.getState();
        const w = toWorld(e.clientX, e.clientY);
        const path = hitPath(s.doc.nodes, s.page().children, w.x, w.y, 2 / s.zoom);
        const picked = pickFromPath(s.doc.nodes, path, { focusId: s.focusId, selection: s.selection });
        if (picked && !s.selection.includes(picked)) s.select([picked]);
        window.dispatchEvent(new CustomEvent('figmy:context', { detail: { x: e.clientX, y: e.clientY, wx: w.x, wy: w.y } }));
      }}
    >
      {st.showGrid && zoom >= 4 && <PixelGrid zoom={zoom} panX={panX} panY={panY} />}
      <svg className="world" width="100%" height="100%">
        <g transform={`translate(${panX},${panY}) scale(${zoom})`}>
          {page.children.map((id) => (
            <RenderNode key={id} id={id} ctx={{ nodes: doc.nodes, outlines: st.showOutlines, hideIds: hidden }} />
          ))}
          {drag?.kind === 'pencil' && <polyline points={drag.pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#000" strokeWidth={2 / zoom} />}
        </g>
      </svg>
      <PeerCursors />
      <Overlay protoDrag={protoDrag} penId={penRef.current} cursor={cursorW} />
      {st.editingTextId && <TextEditor id={st.editingTextId} onDone={(id) => autoSizeText(id)} />}
      {st.showRulers && <Rulers />}
      <CommentPins />
    </div>
  );
}

function restoreSubtree(nodes: Record<string, SceneNode>, snap: Record<string, SceneNode>, id: string) {
  // Restores geometry of node + descendants from snapshot (descendants captured lazily)
  const o = snap[id];
  if (!o) return;
  const n = nodes[id];
  if (!snap['__desc_' + id]) {
    // capture descendants geometry on first call
    const desc: Record<string, SceneNode> = {};
    const walk = (i: string) => {
      for (const c of nodes[i]?.children ?? []) {
        desc[c] = deepCopy(nodes[c]);
        walk(c);
      }
    };
    walk(id);
    (snap as Record<string, unknown>)['__desc_' + id] = desc;
  }
  const desc = snap['__desc_' + id] as unknown as Record<string, SceneNode>;
  Object.assign(n, { x: o.x, y: o.y, w: o.w, h: o.h, points: o.points, text: o.text, autoLayout: o.autoLayout });
  for (const [cid, c] of Object.entries(desc)) if (nodes[cid]) Object.assign(nodes[cid], { x: c.x, y: c.y, w: c.w, h: c.h, points: c.points, text: c.text });
}

function restoreAll(nodes: Record<string, SceneNode>, snap: Record<string, SceneNode>) {
  for (const id of Object.keys(snap)) if (!id.startsWith('__desc_')) restoreSubtree(nodes, snap, id);
}

function smoothPoints(pts: { x: number; y: number }[]): PathPoint[] {
  // Catmull-Rom to bezier
  if (pts.length < 3) return pts;
  return pts.map((p, i) => {
    const p0 = pts[i - 1] ?? p,
      p2 = pts[i + 1] ?? p;
    const t = 1 / 6;
    return {
      x: p.x,
      y: p.y,
      cin: i > 0 ? { x: p.x - (p2.x - p0.x) * t, y: p.y - (p2.y - p0.y) * t } : undefined,
      cout: i < pts.length - 1 ? { x: p.x + (p2.x - p0.x) * t, y: p.y + (p2.y - p0.y) * t } : undefined,
    };
  });
}

export async function pickImageData(): Promise<string | null> {
  const { pickFile } = await import('../lib/platform');
  const f = await pickFile('image/*');
  return f ? blobToDataUrl(f) : null;
}

export function autoSizeText(id: string) {
  const s = useEditor.getState();
  const n = s.doc.nodes[id];
  if (!n?.text) return;
  if (!n.text.content.trim()) {
    s.set({ selection: [id] });
    s.deleteSelection();
    return;
  }
  if (n.text.autoResize === 'fixed') return;
  const size = textBoxSize(n.text, n.w);
  if (size.w !== n.w || size.h !== n.h) s.mutate((d) => Object.assign(d.nodes[id], size), false);
}

export const isTyping = (e: Event) => {
  const t = e.target as HTMLElement;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

function PixelGrid({ zoom, panX, panY }: { zoom: number; panX: number; panY: number }) {
  const size = zoom;
  return (
    <div
      className="pixel-grid"
      style={{
        backgroundSize: `${size}px ${size}px`,
        backgroundPosition: `${panX % size}px ${panY % size}px`,
      }}
    />
  );
}
