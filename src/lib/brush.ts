import type { BrushStyle } from '../types';

export type BrushPoint = { x: number; y: number; p?: number; t?: number }; // pressure 0..1, time ms

export const BRUSH_STYLES: { id: BrushStyle; label: string }[] = [
  { id: 'round', label: 'Round' },
  { id: 'taper', label: 'Taper' },
  { id: 'marker', label: 'Marker' },
  { id: 'ink', label: 'Ink' },
  { id: 'calligraphy', label: 'Calligraphy' },
  { id: 'pressure', label: 'Pressure' },
];

/** Resample a polyline so points are roughly `step` apart (keeps pressure/time). */
function resample(pts: BrushPoint[], step: number): BrushPoint[] {
  if (pts.length < 2) return pts;
  const out: BrushPoint[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let d = step - carry;
    while (d <= len) {
      const k = d / len;
      out.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, p: (a.p ?? 0.5) + ((b.p ?? 0.5) - (a.p ?? 0.5)) * k, t: (a.t ?? 0) + ((b.t ?? 0) - (a.t ?? 0)) * k });
      d += step;
    }
    carry = len - (d - step);
  }
  const last = pts[pts.length - 1];
  if (Math.hypot(last.x - out[out.length - 1].x, last.y - out[out.length - 1].y) > step * 0.3) out.push(last);
  return out;
}

/** Chaikin smoothing for nicer edges. */
function smooth(pts: BrushPoint[], rounds = 2): BrushPoint[] {
  let cur = pts;
  for (let r = 0; r < rounds && cur.length > 2; r++) {
    const next: BrushPoint[] = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i], b = cur[i + 1];
      next.push({ ...a, x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { ...b, x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

/** Width multiplier (0..1.x) at sample i for a style. */
function widthAt(style: BrushStyle, pts: BrushPoint[], i: number, dir: number): number {
  const n = pts.length;
  const u = n > 1 ? i / (n - 1) : 0.5;
  switch (style) {
    case 'round': return 1;
    case 'marker': return 0.9 + 0.1 * Math.sin(i * 0.7);
    case 'taper': return Math.max(0.08, Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.7);
    case 'calligraphy': {
      // 45° nib: thick across, thin along the nib direction
      return 0.18 + 0.82 * Math.abs(Math.sin(dir - Math.PI / 4));
    }
    case 'ink': {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const dt = Math.max(1, (b.t ?? 0) - (a.t ?? 0));
      const speed = Math.hypot(b.x - a.x, b.y - a.y) / dt; // px per ms
      const ends = Math.min(1, u * 8, (1 - u) * 8);
      return Math.max(0.15, Math.min(1.2, 1.25 - speed * 0.35)) * (0.35 + 0.65 * ends);
    }
    case 'pressure': {
      const ends = Math.min(1, u * 10, (1 - u) * 10);
      return Math.max(0.1, (pts[i].p ?? 0.5) * 1.6) * (0.4 + 0.6 * ends);
    }
  }
}

/** Filled outline polygon (closed ring) for a brush stroke. */
export function brushOutline(raw: BrushPoint[], size: number, style: BrushStyle): { x: number; y: number }[] {
  if (raw.length === 0) return [];
  if (raw.length === 1 || raw.every((p) => Math.hypot(p.x - raw[0].x, p.y - raw[0].y) < 0.5)) {
    // a dab: circle
    const r = size / 2;
    return Array.from({ length: 16 }, (_, k) => ({ x: raw[0].x + Math.cos((k / 16) * Math.PI * 2) * r, y: raw[0].y + Math.sin((k / 16) * Math.PI * 2) * r }));
  }
  const pts = smooth(resample(raw, Math.max(1, size / 4)));
  const left: { x: number; y: number }[] = [], right: { x: number; y: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dir = Math.atan2(b.y - a.y, b.x - a.x);
    const w = (size / 2) * widthAt(style, pts, i, dir);
    const nx = -Math.sin(dir), ny = Math.cos(dir);
    left.push({ x: pts[i].x + nx * w, y: pts[i].y + ny * w });
    right.push({ x: pts[i].x - nx * w, y: pts[i].y - ny * w });
  }
  // round caps for styles that keep width at the ends
  const cap = (c: BrushPoint, from: { x: number; y: number }, to: { x: number; y: number }) => {
    const r = Math.hypot(from.x - to.x, from.y - to.y) / 2;
    if (r < 0.6) return [];
    const a0 = Math.atan2(from.y - c.y, from.x - c.x);
    return Array.from({ length: 6 }, (_, k) => {
      const a = a0 + ((k + 1) / 7) * Math.PI;
      return { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
    });
  };
  const end = pts[pts.length - 1], start = pts[0];
  return [...left, ...cap(end, left[left.length - 1], right[right.length - 1]), ...right.reverse(), ...cap(start, right[right.length - 1], left[0])];
}

/** Small SVG path for the brush-style preview in the toolbar. */
export function brushPreviewPath(style: BrushStyle, w = 160, h = 22, size = 8): string {
  const pts: BrushPoint[] = [];
  for (let i = 0; i <= 40; i++) {
    const u = i / 40;
    pts.push({ x: 6 + u * (w - 12), y: h / 2 + Math.sin(u * Math.PI * 2) * (h / 2 - size / 2 - 1), p: 0.3 + 0.7 * Math.sin(u * Math.PI), t: i * (8 + 10 * Math.sin(u * Math.PI)) });
  }
  const o = brushOutline(pts, size, style);
  return 'M' + o.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L') + ' Z';
}
