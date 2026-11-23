import type { PathPoint, SceneNode } from '../types';

type P = { x: number; y: number };

const cubicAt = (a: P, b: P, c: P, d: P, t: number): P => {
  const u = 1 - t;
  return { x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x, y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y };
};

/** Segment i goes from point i to point i+1 (wrapping when closed). */
export function segmentCount(n: SceneNode) {
  const len = n.points?.length ?? 0;
  return n.closed ? len : Math.max(0, len - 1);
}
function seg(n: SceneNode, i: number): [PathPoint, PathPoint] {
  const pts = n.points!;
  return [pts[i], pts[(i + 1) % pts.length]];
}

/** Nearest segment to a local point: index, parameter t and distance. */
export function nearestSegment(n: SceneNode, x: number, y: number): { i: number; t: number; d: number } | null {
  if (!n.points || n.points.length < 2) return null;
  let best: { i: number; t: number; d: number } | null = null;
  for (let i = 0; i < segmentCount(n); i++) {
    const [a, b] = seg(n, i);
    for (let k = 0; k <= 24; k++) {
      const t = k / 24;
      const p = cubicAt(a, a.cout ?? a, b.cin ?? b, b, t);
      const d = Math.hypot(p.x - x, p.y - y);
      if (!best || d < best.d) best = { i, t, d };
    }
  }
  return best;
}

/** Bend a segment so the curve passes through (x, y) near parameter t. Mutates. */
export function bendSegment(n: SceneNode, i: number, t: number, x: number, y: number) {
  const pts = n.points!;
  const a = pts[i], b = pts[(i + 1) % pts.length];
  const tt = Math.min(0.9, Math.max(0.1, t));
  // put both handles on the line from a→b, then offset so B(tt) hits the target
  const c1 = { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 };
  const c2 = { x: a.x + ((b.x - a.x) * 2) / 3, y: a.y + ((b.y - a.y) * 2) / 3 };
  const cur = cubicAt(a, c1, c2, b, tt);
  const w = 3 * (1 - tt) * tt; // combined weight of both handles at tt
  const ox = (x - cur.x) / w, oy = (y - cur.y) / w;
  a.cout = { x: c1.x + ox, y: c1.y + oy };
  b.cin = { x: c2.x + ox, y: c2.y + oy };
}

/** Delete anchors by index. Returns false if the path should be removed (fewer than 2 points left). Mutates. */
export function deletePoints(n: SceneNode, idxs: number[]): boolean {
  if (!n.points) return true;
  const drop = new Set(idxs);
  n.points = n.points.filter((_, i) => !drop.has(i));
  if (n.points.length < 3) n.closed = false;
  return n.points.length >= 2;
}

/**
 * Cut the path at anchor idx. A closed path opens there (one piece); an open path splits into two.
 * Returns the points of the second piece (or null). Mutates n.
 */
export function cutAt(n: SceneNode, idx: number): PathPoint[] | null {
  const pts = n.points;
  if (!pts || pts.length < 2) return null;
  if (n.closed) {
    n.points = [...pts.slice(idx), ...pts.slice(0, idx), { ...pts[idx], cin: undefined }];
    n.points[0] = { ...n.points[0], cin: undefined };
    n.points[n.points.length - 1] = { ...n.points[n.points.length - 1], cout: undefined };
    n.closed = false;
    return null;
  }
  if (idx <= 0 || idx >= pts.length - 1) return null;
  const first = pts.slice(0, idx + 1).map((p, i, arr) => (i === arr.length - 1 ? { ...p, cout: undefined } : p));
  const second = pts.slice(idx).map((p, i) => (i === 0 ? { ...p, cin: undefined } : p));
  n.points = first;
  return second;
}

export function pointInPolygon(p: P, poly: P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Smooth corner anchors (auto handles, Catmull-Rom style). Mutates. */
export function smoothAnchors(n: SceneNode, idxs?: number[]) {
  const pts = n.points;
  if (!pts || pts.length < 3) return;
  const which = new Set(idxs?.length ? idxs : pts.map((_, i) => i));
  const len = pts.length;
  for (let i = 0; i < len; i++) {
    if (!which.has(i)) continue;
    const prev = pts[i === 0 ? (n.closed ? len - 1 : 0) : i - 1];
    const next = pts[i === len - 1 ? (n.closed ? 0 : len - 1) : i + 1];
    const tx = (next.x - prev.x) / 6, ty = (next.y - prev.y) / 6;
    pts[i] = { ...pts[i], cin: { x: pts[i].x - tx, y: pts[i].y - ty }, cout: { x: pts[i].x + tx, y: pts[i].y + ty } };
  }
}

/** Make anchors sharp (remove handles). Mutates. */
export function sharpenAnchors(n: SceneNode, idxs?: number[]) {
  if (!n.points) return;
  const which = new Set(idxs?.length ? idxs : n.points.map((_, i) => i));
  n.points = n.points.map((p, i) => (which.has(i) ? { x: p.x, y: p.y } : p));
}

export function reversePath(n: SceneNode) {
  if (!n.points) return;
  n.points = [...n.points].reverse().map((p) => ({ x: p.x, y: p.y, cin: p.cout, cout: p.cin }));
}
