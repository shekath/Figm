import polygonClipping, { type MultiPolygon, type Polygon, type Ring } from 'polygon-clipping';
import type { DocumentData, PathPoint, SceneNode } from '../types';
import { createNode, uid } from './factory';
import { rotatePoint } from './geometry';

export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'exclude' | 'flatten';
type Pt = [number, number];

const SEG_CURVE = 16;
const SEG_ELLIPSE = 72;

function cubic(a: number, b: number, c: number, d: number, t: number) {
  const mt = 1 - t;
  return mt * mt * mt * a + 3 * mt * mt * t * b + 3 * mt * t * t * c + t * t * t * d;
}

/** Sample a path's points (with optional bezier handles) into a polyline. */
export function samplePath(points: PathPoint[], closed: boolean): { x: number; y: number }[] {
  if (!points.length) return [];
  const out: { x: number; y: number }[] = [{ x: points[0].x, y: points[0].y }];
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if (a.cout || b.cin) {
      const c1 = a.cout ?? a,
        c2 = b.cin ?? b;
      for (let s = 1; s <= SEG_CURVE; s++) {
        const t = s / SEG_CURVE;
        out.push({ x: cubic(a.x, c1.x, c2.x, b.x, t), y: cubic(a.y, c1.y, c2.y, b.y, t) });
      }
    } else out.push({ x: b.x, y: b.y });
  }
  return out;
}

/** Local-space rings for a single (non-container) node. */
function localRings(n: SceneNode): { x: number; y: number }[][] {
  const w = n.w,
    h = n.h;
  switch (n.type) {
    case 'ellipse': {
      const r: { x: number; y: number }[] = [];
      for (let i = 0; i < SEG_ELLIPSE; i++) {
        const a = (i / SEG_ELLIPSE) * Math.PI * 2;
        r.push({ x: w / 2 + (Math.cos(a) * w) / 2, y: h / 2 + (Math.sin(a) * h) / 2 });
      }
      return [r];
    }
    case 'polygon':
    case 'star': {
      const sides = n.sides ?? (n.type === 'star' ? 5 : 3);
      const count = n.type === 'star' ? sides * 2 : sides;
      const r: { x: number; y: number }[] = [];
      for (let i = 0; i < count; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / count;
        const k = n.type === 'star' && i % 2 ? n.innerRatio ?? 0.38 : 1;
        r.push({ x: w / 2 + (Math.cos(a) * w * k) / 2, y: h / 2 + (Math.sin(a) * h * k) / 2 });
      }
      return [r];
    }
    case 'path':
    case 'line': {
      if (n.rings?.length) return n.rings;
      const pts = samplePath(n.points ?? [], true);
      return pts.length >= 3 ? [pts] : [];
    }
    default: {
      // rect-like: frame, component, instance, image, text, rect
      const radii = n.radii ?? [n.radius, n.radius, n.radius, n.radius];
      const max = Math.min(w, h) / 2;
      const [tl, tr, br, bl] = radii.map((v) => Math.max(0, Math.min(v || 0, max)));
      if (!tl && !tr && !br && !bl)
        return [
          [
            { x: 0, y: 0 },
            { x: w, y: 0 },
            { x: w, y: h },
            { x: 0, y: h },
          ],
        ];
      const r: { x: number; y: number }[] = [];
      const arc = (cx: number, cy: number, rad: number, from: number) => {
        if (!rad) return r.push({ x: cx, y: cy });
        for (let i = 0; i <= 8; i++) {
          const a = from + (i / 8) * (Math.PI / 2);
          r.push({ x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad });
        }
      };
      arc(tl, tl, tl, Math.PI);
      arc(w - tr, tr, tr, -Math.PI / 2);
      arc(w - br, h - br, br, 0);
      arc(bl, h - bl, bl, Math.PI / 2);
      return [r];
    }
  }
}

function toWorld(n: SceneNode, p: { x: number; y: number }): Pt {
  let x = n.flipX ? n.w - p.x : p.x;
  let y = n.flipY ? n.h - p.y : p.y;
  x += n.x;
  y += n.y;
  if (n.rotation) {
    const r = rotatePoint(x, y, n.x + n.w / 2, n.y + n.h / 2, n.rotation);
    x = r.x;
    y = r.y;
  }
  return [x, y];
}

const closeRing = (r: Pt[]): Ring => (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) ? [...r, r[0]] : r);

/** World-space geometry for any node (containers union their children). */
export function nodeGeometry(nodes: Record<string, SceneNode>, id: string): MultiPolygon {
  const n = nodes[id];
  if (!n || !n.visible) return [];
  if (n.type === 'group' || ((n.type === 'frame' || n.type === 'component') && !n.fills.some((f) => f.visible))) {
    const parts = n.children.map((c) => nodeGeometry(nodes, c)).filter((g) => g.length);
    if (!parts.length) return [];
    return parts.length === 1 ? parts[0] : polygonClipping.union(parts[0], ...parts.slice(1));
  }
  const rings = localRings(n)
    .filter((r) => r.length >= 3)
    .map((r) => closeRing(r.map((p) => toWorld(n, p))));
  if (!rings.length) return [];
  // even-odd: XOR every ring together so holes come out right
  let g: MultiPolygon = [[rings[0]]];
  for (let i = 1; i < rings.length; i++) g = polygonClipping.xor(g, [[rings[i]]] as Polygon[]);
  return g;
}

export function computeBoolean(geoms: MultiPolygon[], op: BooleanOp): MultiPolygon {
  const g = geoms.filter((x) => x.length);
  if (!g.length) return [];
  if (op === 'flatten' || g.length === 1) return g.length === 1 ? g[0] : polygonClipping.union(g[0], ...g.slice(1));
  const [first, ...rest] = g;
  switch (op) {
    case 'union':
      return polygonClipping.union(first, ...rest);
    case 'subtract':
      return polygonClipping.difference(first, ...rest);
    case 'intersect':
      return polygonClipping.intersection(first, ...rest);
    case 'exclude':
      return polygonClipping.xor(first, ...rest);
  }
}

/**
 * Replace the given nodes with one vector node holding the boolean result.
 * Operates on a mutable document (immer draft or plain object). Returns the new node id.
 * `ids` must be ordered bottom-most first (paint order) — subtract keeps the bottom shape.
 */
export function applyBoolean(d: DocumentData, pageId: string, ids: string[], op: BooleanOp): string | null {
  const list = ids.filter((id) => d.nodes[id]);
  if (!list.length) return null;
  const result = computeBoolean(
    list.map((id) => nodeGeometry(d.nodes, id)),
    op,
  );
  const rings = result.flatMap((poly) => poly.map((ring) => ring.slice(0, -1).map(([x, y]) => ({ x, y }))));
  const bottom = d.nodes[list[0]];
  const parentId = bottom.parentId;
  const siblings = parentId ? d.nodes[parentId].children : d.pages.find((p) => p.id === pageId)!.children;
  const index = siblings.indexOf(bottom.id);

  let x1 = Infinity,
    y1 = Infinity,
    x2 = -Infinity,
    y2 = -Infinity;
  for (const r of rings)
    for (const p of r) {
      x1 = Math.min(x1, p.x);
      y1 = Math.min(y1, p.y);
      x2 = Math.max(x2, p.x);
      y2 = Math.max(y2, p.y);
    }
  if (!rings.length) {
    x1 = bottom.x;
    y1 = bottom.y;
    x2 = bottom.x;
    y2 = bottom.y;
  }
  const style = firstStyled(d.nodes, bottom.id) ?? bottom;
  const names: Record<BooleanOp, string> = { union: 'Union', subtract: 'Subtract', intersect: 'Intersect', exclude: 'Exclude', flatten: 'Vector' };
  const node = createNode('path', {
    name: names[op],
    x: x1,
    y: y1,
    w: Math.max(0.01, x2 - x1),
    h: Math.max(0.01, y2 - y1),
    points: [],
    closed: true,
    rings: rings.map((r) => r.map((p) => ({ x: p.x - x1, y: p.y - y1 }))),
    fills: style.fills.map((f) => ({ ...f, id: uid() })),
    strokes: style.strokes.map((s) => ({ ...s })),
    effects: style.effects.map((e) => ({ ...e, id: uid() })),
    opacity: bottom.opacity,
    blend: bottom.blend,
    parentId,
  });
  if (!node.fills.length && !node.strokes.length) node.fills = [{ id: uid(), kind: 'solid', color: '#d9d9d9', opacity: 1, visible: true }];
  // remove sources (and their subtrees)
  const removeTree = (id: string) => {
    const n = d.nodes[id];
    if (!n) return;
    for (const c of [...n.children]) removeTree(c);
    const owner = n.parentId ? d.nodes[n.parentId]?.children : d.pages.find((p) => p.children.includes(id))?.children;
    if (owner) {
      const i = owner.indexOf(id);
      if (i >= 0) owner.splice(i, 1);
    }
    delete d.nodes[id];
  };
  for (const id of list) removeTree(id);
  d.nodes[node.id] = node;
  const target = parentId && d.nodes[parentId] ? d.nodes[parentId].children : d.pages.find((p) => p.id === pageId)!.children;
  target.splice(Math.min(Math.max(0, index), target.length), 0, node.id);
  if (parentId && !d.nodes[parentId]) node.parentId = null;
  return node.id;
}

function firstStyled(nodes: Record<string, SceneNode>, id: string): SceneNode | null {
  const n = nodes[id];
  if (!n) return null;
  if (n.type !== 'group' && (n.fills.length || n.strokes.length)) return n;
  for (const c of n.children) {
    const s = firstStyled(nodes, c);
    if (s) return s;
  }
  return null;
}

/** SVG path data for rings. */
export function ringsPath(rings: { x: number; y: number }[][]): string {
  return rings
    .filter((r) => r.length > 1)
    .map((r) => 'M' + r.map((p) => `${round(p.x)},${round(p.y)}`).join(' L') + ' Z')
    .join(' ');
}
const round = (v: number) => Math.round(v * 100) / 100;
