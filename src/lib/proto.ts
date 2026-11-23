/** Prototype animation helpers: easing curves and Smart Animate interpolation. Pure functions. */
import type { Easing, Paint, SceneNode } from '../types';

type Nodes = Record<string, SceneNode>;

/** Cubic-bezier timing function (same maths as CSS). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1,
    bx = 3 * (x2 - x1) - cx,
    ax = 1 - cx - bx;
  const cy = 3 * y1,
    by = 3 * (y2 - y1) - cy,
    ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dsx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - x;
      if (Math.abs(err) < 1e-5) break;
      const d = dsx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    // bisection fallback for robustness
    if (Math.abs(sx(t) - x) > 1e-3) {
      let lo = 0,
        hi = 1;
      t = x;
      for (let i = 0; i < 30; i++) {
        if (sx(t) < x) lo = t;
        else hi = t;
        t = (lo + hi) / 2;
      }
    }
    return sy(t);
  };
}

const spring = (stiffness: number, damping: number) => (t: number) => {
  if (t >= 1) return 1;
  const w = Math.sqrt(stiffness);
  const z = damping / (2 * w);
  const tt = t * 1.6; // normalise so the curve settles near t=1
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * tt) * (Math.cos(wd * tt) + ((z * w) / wd) * Math.sin(wd * tt));
  }
  return 1 - Math.exp(-w * tt) * (1 + w * tt);
};

export const EASINGS: Record<Easing, (t: number) => number> = {
  linear: (t) => t,
  'ease-in': cubicBezier(0.42, 0, 1, 1),
  'ease-out': cubicBezier(0, 0, 0.58, 1),
  'ease-in-out': cubicBezier(0.42, 0, 0.58, 1),
  'ease-in-back': cubicBezier(0.36, 0, 0.66, -0.56),
  'ease-out-back': cubicBezier(0.34, 1.56, 0.64, 1),
  spring: spring(100, 15),
  gentle: spring(80, 18),
  bouncy: spring(160, 9),
};

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function lerpColor(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1, 7), 16),
    pb = parseInt(b.slice(1, 7), 16);
  if (Number.isNaN(pa) || Number.isNaN(pb)) return t < 0.5 ? a : b;
  const ch = (v: number, s: number) => (v >> s) & 255;
  const mix = (s: number) =>
    Math.round(lerp(ch(pa, s), ch(pb, s), Math.max(0, Math.min(1, t))))
      .toString(16)
      .padStart(2, '0');
  return `#${mix(16)}${mix(8)}${mix(0)}`;
}

function lerpPaints(a: Paint[], b: Paint[], t: number): Paint[] {
  return b.map((pb, i) => {
    const pa = a[i];
    if (!pa || pa.kind !== 'solid' || pb.kind !== 'solid') return pb;
    return { ...pb, color: lerpColor(pa.color, pb.color, t), opacity: lerp(pa.opacity, pb.opacity, t) };
  });
}

/** Map of "name path relative to frame" -> node id, for layer matching. */
export function namePaths(nodes: Nodes, frameId: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (id: string, prefix: string) => {
    const counts: Record<string, number> = {};
    for (const c of nodes[id]?.children ?? []) {
      const n = nodes[c];
      if (!n) continue;
      const k = counts[n.name] = (counts[n.name] ?? 0) + 1;
      const key = `${prefix}/${n.name}${k > 1 ? `#${k}` : ''}`;
      out.set(key, c);
      walk(c, key);
    }
  };
  walk(frameId, '');
  return out;
}

export interface SmartFrame {
  /** nodes map to render for the destination frame at progress t */
  nodes: Nodes;
  /** layers only present in the source, already positioned in destination space */
  leaving: { nodes: Nodes; roots: string[] };
}

/**
 * Interpolate from frame `fromId` to frame `toId` at eased progress `t` (0..1).
 * Matching layers (same name path) tween position, size, rotation, opacity, radius and solid colours;
 * new layers fade in, removed layers fade out.
 */
export function smartAnimateFrame(nodes: Nodes, fromId: string, toId: string, t: number): SmartFrame {
  const A = nodes[fromId],
    B = nodes[toId];
  const pa = namePaths(nodes, fromId);
  const pb = namePaths(nodes, toId);
  const byIdB = new Map<string, string>();
  pb.forEach((id, key) => byIdB.set(id, key));
  const out: Nodes = { ...nodes };
  const ct = Math.max(0, Math.min(1, t)); // clamp for opacity/colour (positions may overshoot for springs)

  const walk = (id: string, ox: number, oy: number, fadeIn: boolean) => {
    const b = nodes[id];
    if (!b) return;
    const key = byIdB.get(id);
    const aId = key ? pa.get(key) : undefined;
    const a = aId ? nodes[aId] : undefined;
    let n: SceneNode;
    let cox = ox,
      coy = oy;
    if (a) {
      const ax = a.x - A.x + B.x,
        ay = a.y - A.y + B.y;
      const x = lerp(ax, b.x, t),
        y = lerp(ay, b.y, t);
      n = {
        ...b,
        x,
        y,
        w: Math.max(0, lerp(a.w, b.w, t)),
        h: Math.max(0, lerp(a.h, b.h, t)),
        rotation: lerp(a.rotation, b.rotation, t),
        opacity: lerp(a.visible ? a.opacity : 0, b.visible ? b.opacity : 0, ct),
        visible: a.visible || b.visible,
        radius: lerp(a.radius, b.radius, t),
        fills: lerpPaints(a.fills, b.fills, ct),
      };
      if (a.text && b.text) n.text = { ...b.text, fontSize: lerp(a.text.fontSize, b.text.fontSize, t) };
      cox = x - b.x;
      coy = y - b.y;
      fadeIn = false;
    } else {
      n = { ...b, x: b.x + ox, y: b.y + oy };
      if (!fadeIn) {
        n.opacity = b.opacity * ct;
        fadeIn = true; // descendants inherit the fade through the parent
      }
    }
    out[id] = n;
    for (const c of b.children) walk(c, cox, coy, fadeIn);
  };
  for (const c of B.children) walk(c, 0, 0, false);

  // leaving layers
  const matchedA = new Set<string>();
  pb.forEach((_, key) => {
    const id = pa.get(key);
    if (id) matchedA.add(id);
  });
  const leaving: Nodes = {};
  const roots: string[] = [];
  const dx = B.x - A.x,
    dy = B.y - A.y;
  const copy = (id: string) => {
    const n = nodes[id];
    leaving[id] = { ...n, x: n.x + dx, y: n.y + dy };
    n.children.forEach(copy);
  };
  pa.forEach((id) => {
    if (matchedA.has(id)) return;
    const n = nodes[id];
    // only top-most unmatched (parent matched or is the frame)
    if (n.parentId && n.parentId !== fromId && !matchedA.has(n.parentId)) return;
    copy(id);
    leaving[id] = { ...leaving[id], opacity: n.opacity * (1 - ct) };
    roots.push(id);
  });
  return { nodes: out, leaving: { nodes: { ...nodes, ...leaving }, roots } };
}

/** Content bounds of a frame's children relative to the frame (for prototype scrolling). */
export function scrollExtent(nodes: Nodes, frameId: string): { maxX: number; maxY: number } {
  const f = nodes[frameId];
  if (!f) return { maxX: 0, maxY: 0 };
  let right = f.w,
    bottom = f.h;
  for (const c of f.children) {
    const n = nodes[c];
    if (!n || !n.visible || n.fixed) continue;
    right = Math.max(right, n.x + n.w - f.x);
    bottom = Math.max(bottom, n.y + n.h - f.y);
  }
  const pad = f.autoLayout ? f.autoLayout.padding.b : 0;
  return { maxX: Math.max(0, right - f.w), maxY: Math.max(0, bottom + pad - f.h) };
}
