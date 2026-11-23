import type { SceneNode } from '../types';
import { resizeTree, scalePoints, translateTree } from './layout';
import { uid } from './factory';

/* ---------- model ---------- */
export type MotionProp = 'position' | 'scale' | 'rotation' | 'width' | 'height' | 'opacity' | 'radius' | 'fill';
export type Vec = { x: number; y: number };
export type MotionValue = number | Vec | string;
export type MotionEase = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'ease-out-back' | 'spring' | 'bouncy' | 'hold';
export interface Keyframe {
  id: string;
  t: number; // ms
  v: MotionValue;
  /** Easing of the segment that starts at this keyframe. */
  ease?: MotionEase;
}
export interface NodeMotion {
  tracks: Partial<Record<MotionProp, Keyframe[]>>;
}
export interface DocMotion {
  duration: number; // ms
  loop: boolean;
}

export const MOTION_PROPS: { id: MotionProp; label: string }[] = [
  { id: 'position', label: 'Position' },
  { id: 'scale', label: 'Scale' },
  { id: 'rotation', label: 'Rotation' },
  { id: 'width', label: 'Width' },
  { id: 'height', label: 'Height' },
  { id: 'opacity', label: 'Opacity' },
  { id: 'radius', label: 'Corner radius' },
  { id: 'fill', label: 'Fill' },
];
export const EASES: { id: MotionEase; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'ease-in', label: 'Ease in' },
  { id: 'ease-out', label: 'Ease out' },
  { id: 'ease-in-out', label: 'Ease in and out' },
  { id: 'ease-out-back', label: 'Ease out back' },
  { id: 'spring', label: 'Spring' },
  { id: 'bouncy', label: 'Bouncy' },
  { id: 'hold', label: 'Hold' },
];
export const DEFAULT_MOTION: DocMotion = { duration: 2000, loop: true };

/* ---------- easing ---------- */
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= (sx(t) - x) / d;
    }
    return sy(Math.max(0, Math.min(1, t)));
  };
}
const CURVES = {
  'ease-in': bezier(0.42, 0, 1, 1),
  'ease-out': bezier(0, 0, 0.58, 1),
  'ease-in-out': bezier(0.42, 0, 0.58, 1),
  'ease-out-back': bezier(0.34, 1.56, 0.64, 1),
};
export function ease(e: MotionEase | undefined, p: number): number {
  p = Math.max(0, Math.min(1, p));
  switch (e ?? 'ease-in-out') {
    case 'linear': return p;
    case 'hold': return p < 1 ? 0 : 1;
    case 'spring': return p >= 1 ? 1 : 1 - Math.exp(-6 * p) * Math.cos(p * Math.PI * 3);
    case 'bouncy': {
      const n = 7.5625, d = 2.75;
      if (p < 1 / d) return n * p * p;
      if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
      if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
      return n * (p -= 2.625 / d) * p + 0.984375;
    }
    default: return CURVES[e as keyof typeof CURVES]?.(p) ?? p;
  }
}

/* ---------- interpolation ---------- */
const hex = (s: string) => {
  const h = s.replace('#', '');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (c: number[]) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
function lerp(a: MotionValue, b: MotionValue, k: number): MotionValue {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * k;
  if (typeof a === 'string' && typeof b === 'string') {
    const A = hex(a), B = hex(b);
    return toHex(A.map((x, i) => x + (B[i] - x) * k));
  }
  if (typeof a === 'object' && typeof b === 'object') return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  return k < 1 ? a : b;
}
export function sampleTrack(kfs: Keyframe[] | undefined, t: number): MotionValue | undefined {
  if (!kfs?.length) return undefined;
  const list = kfs.length > 1 ? [...kfs].sort((a, b) => a.t - b.t) : kfs;
  if (t <= list[0].t) return list[0].v;
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i], b = list[i + 1];
    if (t <= b.t) return lerp(a.v, b.v, ease(a.ease, (t - a.t) / Math.max(1, b.t - a.t)));
  }
  return list[list.length - 1].v;
}

/** Static (un-animated) value of a property, used for the first keyframe and the panel. */
export function baseValue(n: SceneNode, prop: MotionProp): MotionValue {
  switch (prop) {
    case 'position': return { x: 0, y: 0 }; // offsets from the layer's design position
    case 'scale': return { x: 1, y: 1 };
    case 'rotation': return n.rotation;
    case 'width': return n.w;
    case 'height': return n.h;
    case 'opacity': return n.opacity;
    case 'radius': return n.radius;
    case 'fill': return n.fills.find((p) => p.kind === 'solid')?.color ?? '#d9d9d9';
  }
}

export function currentValue(n: SceneNode, prop: MotionProp, t: number): MotionValue {
  return sampleTrack(n.motion?.tracks[prop], t) ?? baseValue(n, prop);
}

export const hasMotion = (n: SceneNode | undefined) => !!n?.motion && Object.values(n.motion.tracks).some((k) => k && k.length);

function scaleTree(nodes: Record<string, SceneNode>, id: string, cx: number, cy: number, sx: number, sy: number) {
  const n = nodes[id];
  if (!n) return;
  const nw = n.w * sx, nh = n.h * sy;
  n.x = cx + (n.x - cx) * sx;
  n.y = cy + (n.y - cy) * sy;
  if ((n.points || n.rings) && (sx !== 1 || sy !== 1)) scalePoints(n, sx, sy);
  if (n.text) n.text = { ...n.text, fontSize: n.text.fontSize * Math.min(Math.abs(sx), Math.abs(sy)) };
  if (n.radius) n.radius *= Math.min(Math.abs(sx), Math.abs(sy));
  n.w = nw;
  n.h = nh;
  for (const c of n.children) scaleTree(nodes, c, cx, cy, sx, sy);
}

/** Node map with every animated layer (and its subtree) evaluated at time t. Unanimated nodes are shared. */
export function sampleNodes(nodes: Record<string, SceneNode>, t: number): Record<string, SceneNode> {
  const animated = Object.values(nodes).filter(hasMotion);
  if (!animated.length) return nodes;
  const out: Record<string, SceneNode> = { ...nodes };
  const cloned = new Set<string>();
  const cloneTree = (id: string) => {
    if (!cloned.has(id) && out[id]) {
      out[id] = { ...out[id] };
      cloned.add(id);
    }
    for (const c of out[id]?.children ?? []) cloneTree(c);
  };
  const depth = (n: SceneNode) => { let d = 0, p = n.parentId; while (p) { d++; p = nodes[p]?.parentId ?? null; } return d; };
  animated.sort((a, b) => depth(a) - depth(b));
  for (const a of animated) {
    cloneTree(a.id);
    const n = out[a.id];
    const tr = a.motion!.tracks;
    const w = sampleTrack(tr.width, t), h = sampleTrack(tr.height, t);
    if (typeof w === 'number' || typeof h === 'number') resizeTree(out, n.id, n.x, n.y, Math.max(0.01, typeof w === 'number' ? w : n.w), Math.max(0.01, typeof h === 'number' ? h : n.h));
    const sc = sampleTrack(tr.scale, t) as Vec | undefined;
    if (sc && (sc.x !== 1 || sc.y !== 1)) scaleTree(out, n.id, n.x + n.w / 2, n.y + n.h / 2, sc.x, sc.y);
    const pos = sampleTrack(tr.position, t) as Vec | undefined;
    if (pos && (pos.x || pos.y)) translateTree(out, n.id, pos.x, pos.y);
    const rot = sampleTrack(tr.rotation, t);
    if (typeof rot === 'number') n.rotation = rot;
    const op = sampleTrack(tr.opacity, t);
    if (typeof op === 'number') n.opacity = Math.max(0, Math.min(1, op));
    const rad = sampleTrack(tr.radius, t);
    if (typeof rad === 'number') { n.radius = Math.max(0, rad); n.radii = null; }
    const fill = sampleTrack(tr.fill, t);
    if (typeof fill === 'string') {
      const i = n.fills.findIndex((p) => p.kind === 'solid');
      n.fills = i >= 0 ? n.fills.map((p, j) => (j === i ? { ...p, color: fill } : p)) : [{ id: 'm', kind: 'solid', color: fill, opacity: 1, visible: true }, ...n.fills];
    }
  }
  return out;
}

/** Upsert a keyframe at time t (mutates the node). */
export function putKeyframe(n: SceneNode, prop: MotionProp, t: number, v: MotionValue, easeName?: MotionEase) {
  n.motion = n.motion ?? { tracks: {} };
  const list = [...(n.motion.tracks[prop] ?? [])];
  const t0 = Math.round(t);
  const i = list.findIndex((k) => Math.abs(k.t - t0) < 1);
  if (i >= 0) list[i] = { ...list[i], v };
  else {
    // a first keyframe away from 0 also anchors the design value at 0 (so the layer animates *to* the new value)
    if (!list.length && t0 > 0) list.push({ id: uid(), t: 0, v: baseValue(n, prop), ease: easeName ?? 'ease-in-out' });
    list.push({ id: uid(), t: t0, v, ease: easeName ?? 'ease-in-out' });
  }
  list.sort((a, b) => a.t - b.t);
  n.motion = { ...n.motion, tracks: { ...n.motion.tracks, [prop]: list } };
}

/* ---------- presets (Framer-style "appear" and loop effects) ---------- */
export type MotionPreset = 'fade-in' | 'slide-up' | 'slide-left' | 'scale-in' | 'pop' | 'spin' | 'pulse' | 'float' | 'shake' | 'color-cycle';
export const PRESETS: { id: MotionPreset; label: string; hint: string }[] = [
  { id: 'fade-in', label: 'Fade in', hint: 'Opacity 0 → 100%' },
  { id: 'slide-up', label: 'Slide up', hint: 'Rise 40px while fading in' },
  { id: 'slide-left', label: 'Slide in', hint: 'Enter from the right' },
  { id: 'scale-in', label: 'Scale in', hint: 'Grow from 60%' },
  { id: 'pop', label: 'Pop', hint: 'Springy scale overshoot' },
  { id: 'spin', label: 'Spin', hint: 'Full rotation' },
  { id: 'pulse', label: 'Pulse', hint: 'Breathing scale loop' },
  { id: 'float', label: 'Float', hint: 'Gentle up-down loop' },
  { id: 'shake', label: 'Shake', hint: 'Attention wiggle' },
  { id: 'color-cycle', label: 'Colour shift', hint: 'Fill blends to a second colour and back' },
];
export function presetTracks(n: SceneNode, p: MotionPreset, start: number, dur: number): Partial<Record<MotionProp, Keyframe[]>> {
  const k = (t: number, v: MotionValue, e: MotionEase = 'ease-out'): Keyframe => ({ id: uid(), t: Math.round(start + t * dur), v, ease: e });
  switch (p) {
    case 'fade-in': return { opacity: [k(0, 0), k(1, n.opacity)] };
    case 'slide-up': return { position: [k(0, { x: 0, y: 40 }), k(1, { x: 0, y: 0 })], opacity: [k(0, 0), k(1, n.opacity)] };
    case 'slide-left': return { position: [k(0, { x: 120, y: 0 }), k(1, { x: 0, y: 0 })], opacity: [k(0, 0), k(1, n.opacity)] };
    case 'scale-in': return { scale: [k(0, { x: 0.6, y: 0.6 }), k(1, { x: 1, y: 1 })], opacity: [k(0, 0), k(1, n.opacity)] };
    case 'pop': return { scale: [k(0, { x: 0.4, y: 0.4 }, 'spring'), k(1, { x: 1, y: 1 })] };
    case 'spin': return { rotation: [k(0, n.rotation, 'linear'), k(1, n.rotation + 360)] };
    case 'pulse': return { scale: [k(0, { x: 1, y: 1 }, 'ease-in-out'), k(0.5, { x: 1.08, y: 1.08 }, 'ease-in-out'), k(1, { x: 1, y: 1 })] };
    case 'float': return { position: [k(0, { x: 0, y: 0 }, 'ease-in-out'), k(0.5, { x: 0, y: -12 }, 'ease-in-out'), k(1, { x: 0, y: 0 })] };
    case 'shake': return { rotation: [0, 0.15, 0.3, 0.45, 0.6, 0.75].map((f, i) => k(f, n.rotation + (i === 0 || i === 5 ? 0 : i % 2 ? 8 : -8), 'ease-in-out')) };
    case 'color-cycle': {
      const c = baseValue(n, 'fill') as string;
      const rgb = hex(c);
      const alt = toHex([rgb[2], rgb[0], rgb[1]]);
      return { fill: [k(0, c, 'ease-in-out'), k(0.5, alt, 'ease-in-out'), k(1, c)] };
    }
  }
}

export const fmtTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:${String(Math.round(ms % 1000)).padStart(3, '0')}`;
};
