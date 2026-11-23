import type { PathPoint, SceneNode } from '../types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const rectOf = (n: SceneNode): Rect => ({ x: n.x, y: n.y, w: n.w, h: n.h });

export function unionRects(rs: Rect[]): Rect | null {
  if (!rs.length) return null;
  let x1 = Infinity,
    y1 = Infinity,
    x2 = -Infinity,
    y2 = -Infinity;
  for (const r of rs) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function normalizeRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

export const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/** Rotate point (px,py) around (cx,cy) by deg. */
export function rotatePoint(px: number, py: number, cx: number, cy: number, deg: number) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r),
    s = Math.sin(r);
  const dx = px - cx,
    dy = py - cy;
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
}

/** Axis aligned bounds of a possibly rotated node. */
export function visualBounds(n: SceneNode): Rect {
  if (!n.rotation) return rectOf(n);
  const cx = n.x + n.w / 2,
    cy = n.y + n.h / 2;
  const pts = [
    [n.x, n.y],
    [n.x + n.w, n.y],
    [n.x + n.w, n.y + n.h],
    [n.x, n.y + n.h],
  ].map(([x, y]) => rotatePoint(x, y, cx, cy, n.rotation));
  const xs = pts.map((p) => p.x),
    ys = pts.map((p) => p.y);
  return normalizeRect(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
}

export function pointInNode(n: SceneNode, px: number, py: number, tolerance = 0): boolean {
  let p = { x: px, y: py };
  if (n.rotation) p = rotatePoint(px, py, n.x + n.w / 2, n.y + n.h / 2, -n.rotation);
  const t = tolerance + (n.type === 'line' || n.h === 0 || n.w === 0 ? 4 : 0);
  return p.x >= n.x - t && p.x <= n.x + n.w + t && p.y >= n.y - t && p.y <= n.y + n.h + t;
}

export function polygonPoints(w: number, h: number, sides: number): string {
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    pts.push(`${w / 2 + (Math.cos(a) * w) / 2},${h / 2 + (Math.sin(a) * h) / 2}`);
  }
  return pts.join(' ');
}

export function starPoints(w: number, h: number, sides: number, ratio: number): string {
  const pts: string[] = [];
  for (let i = 0; i < sides * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / sides;
    const r = i % 2 === 0 ? 1 : ratio;
    pts.push(`${w / 2 + (Math.cos(a) * w * r) / 2},${h / 2 + (Math.sin(a) * h * r) / 2}`);
  }
  return pts.join(' ');
}

export function roundedRectPath(w: number, h: number, r: [number, number, number, number]): string {
  const max = Math.min(w, h) / 2;
  const [tl, tr, br, bl] = r.map((v) => Math.max(0, Math.min(v, max)));
  return `M${tl},0 H${w - tr} A${tr},${tr} 0 0 1 ${w},${tr} V${h - br} A${br},${br} 0 0 1 ${w - br},${h} H${bl} A${bl},${bl} 0 0 1 0,${h - bl} V${tl} A${tl},${tl} 0 0 1 ${tl},0 Z`;
}

/** SVG path data for a path node, points in node-local coordinates. */
export function pathData(points: PathPoint[], closed: boolean): string {
  if (!points.length) return '';
  let d = `M${points[0].x},${points[0].y}`;
  const seg = (a: PathPoint, b: PathPoint) => {
    if (a.cout || b.cin) {
      const c1 = a.cout ?? a;
      const c2 = b.cin ?? b;
      return ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}`;
    }
    return ` L${b.x},${b.y}`;
  };
  for (let i = 1; i < points.length; i++) d += seg(points[i - 1], points[i]);
  if (closed && points.length > 2) d += seg(points[points.length - 1], points[0]) + ' Z';
  return d;
}

/** Ramer–Douglas–Peucker simplification for pencil strokes. */
export function simplify(pts: { x: number; y: number }[], eps = 1.5): { x: number; y: number }[] {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let idx = 0,
    dmax = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const num = Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x);
    const den = Math.hypot(b.y - a.y, b.x - a.x) || 1;
    const d = num / den;
    if (d > dmax) {
      dmax = d;
      idx = i;
    }
  }
  if (dmax > eps) {
    const l = simplify(pts.slice(0, idx + 1), eps);
    const r = simplify(pts.slice(idx), eps);
    return [...l.slice(0, -1), ...r];
  }
  return [a, b];
}

export const round = (v: number, p = 2) => Math.round(v * 10 ** p) / 10 ** p;
