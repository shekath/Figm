import type { PathPoint, SceneNode } from '../types';
import { createNode, defaultStroke, solid } from './factory';

/**
 * Lightweight SVG importer: rect, circle, ellipse, line, polyline, polygon, path (M/L/H/V/C/Q/Z absolute+relative), text, image.
 * Returns a group containing the converted shapes.
 */
export function importSvg(src: string, ox = 0, oy = 0): { rootId: string; nodes: Record<string, SceneNode> } | null {
  const doc = new DOMParser().parseFromString(src, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  if (!svg) return null;
  const nodes: Record<string, SceneNode> = {};
  const vb = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const vw = vb.length === 4 ? vb[2] : parseFloat(svg.getAttribute('width') ?? '100');
  const vh = vb.length === 4 ? vb[3] : parseFloat(svg.getAttribute('height') ?? '100');
  const vx = vb.length === 4 ? vb[0] : 0,
    vy = vb.length === 4 ? vb[1] : 0;
  const root = createNode('frame', { name: 'SVG', x: ox, y: oy, w: vw || 100, h: vh || 100, fills: [], clip: false });
  nodes[root.id] = root;

  const num = (el: Element, a: string, d = 0) => parseFloat(el.getAttribute(a) ?? '') || d;
  const style = (el: Element, key: string): string | null => {
    let cur: Element | null = el;
    while (cur && cur !== svg.parentElement) {
      const attr = cur.getAttribute(key);
      if (attr) return attr;
      const st = cur.getAttribute('style');
      const m = st?.match(new RegExp(`${key}\\s*:\\s*([^;]+)`));
      if (m) return m[1].trim();
      cur = cur.parentElement;
    }
    return null;
  };
  const toHex = (c: string | null): string | null => {
    if (!c || c === 'none' || c.startsWith('url')) return null;
    if (c.startsWith('#')) return c.length === 4 ? '#' + [...c.slice(1)].map((x) => x + x).join('') : c.slice(0, 7);
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.fillStyle = c;
    return ctx.fillStyle as string;
  };
  const apply = (el: Element, n: SceneNode) => {
    const f = style(el, 'fill');
    const fill = f === null ? '#000000' : toHex(f);
    n.fills = fill && n.type !== 'line' ? [solid(fill, parseFloat(style(el, 'fill-opacity') ?? '1'))] : [];
    const s = toHex(style(el, 'stroke'));
    if (s) n.strokes = [{ ...defaultStroke(s, parseFloat(style(el, 'stroke-width') ?? '1')), align: 'center' }];
    else if (n.type !== 'line') n.strokes = [];
    const op = el.getAttribute('opacity');
    if (op) n.opacity = parseFloat(op);
    n.x += ox - vx;
    n.y += oy - vy;
    n.parentId = root.id;
    root.children.push(n.id);
    nodes[n.id] = n;
  };

  const fromPoints = (pts: { x: number; y: number }[], closed: boolean, el: Element) => {
    if (!pts.length) return;
    const xs = pts.map((p) => p.x),
      ys = pts.map((p) => p.y);
    const minX = Math.min(...xs),
      minY = Math.min(...ys);
    const n = createNode('path', {
      x: minX,
      y: minY,
      w: Math.max(...xs) - minX || 1,
      h: Math.max(...ys) - minY || 1,
      points: pts.map((p) => ({ x: p.x - minX, y: p.y - minY })),
      closed,
    });
    apply(el, n);
  };

  svg.querySelectorAll('rect,circle,ellipse,line,polyline,polygon,path,text,image').forEach((el) => {
    if (el.closest('defs,clipPath,mask,pattern,symbol')) return;
    const tag = el.tagName.toLowerCase();
    if (tag === 'rect') apply(el, createNode('rect', { x: num(el, 'x'), y: num(el, 'y'), w: num(el, 'width'), h: num(el, 'height'), radius: num(el, 'rx') }));
    else if (tag === 'circle') {
      const r = num(el, 'r');
      apply(el, createNode('ellipse', { x: num(el, 'cx') - r, y: num(el, 'cy') - r, w: r * 2, h: r * 2 }));
    } else if (tag === 'ellipse') {
      const rx = num(el, 'rx'),
        ry = num(el, 'ry');
      apply(el, createNode('ellipse', { x: num(el, 'cx') - rx, y: num(el, 'cy') - ry, w: rx * 2, h: ry * 2 }));
    } else if (tag === 'line') {
      const x1 = num(el, 'x1'),
        y1 = num(el, 'y1'),
        x2 = num(el, 'x2'),
        y2 = num(el, 'y2');
      fromPoints(
        [
          { x: x1, y: y1 },
          { x: x2, y: y2 },
        ],
        false,
        el,
      );
    } else if (tag === 'polyline' || tag === 'polygon') {
      const nums = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number);
      const pts = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
      fromPoints(pts, tag === 'polygon', el);
    } else if (tag === 'path') {
      for (const sub of parsePath(el.getAttribute('d') ?? '')) {
        if (sub.points.length < 2) continue;
        const all = sub.points.flatMap((p) => [p, p.cin, p.cout].filter(Boolean) as { x: number; y: number }[]);
        const minX = Math.min(...all.map((p) => p.x)),
          minY = Math.min(...all.map((p) => p.y));
        const maxX = Math.max(...all.map((p) => p.x)),
          maxY = Math.max(...all.map((p) => p.y));
        const sh = (p?: { x: number; y: number }) => p && { x: p.x - minX, y: p.y - minY };
        const n = createNode('path', {
          x: minX,
          y: minY,
          w: maxX - minX || 1,
          h: maxY - minY || 1,
          closed: sub.closed,
          points: sub.points.map((p) => ({ x: p.x - minX, y: p.y - minY, cin: sh(p.cin), cout: sh(p.cout) })),
        });
        apply(el, n);
      }
    } else if (tag === 'text') {
      const n = createNode('text', { x: num(el, 'x'), y: num(el, 'y') - num(el, 'font-size', 16), w: 200, h: 24 });
      n.text!.content = el.textContent ?? '';
      n.text!.fontSize = parseFloat(style(el, 'font-size') ?? '16');
      apply(el, n);
    } else if (tag === 'image') {
      const href = el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '';
      apply(el, createNode('image', { x: num(el, 'x'), y: num(el, 'y'), w: num(el, 'width', 100), h: num(el, 'height', 100), src: href }));
    }
  });
  return { rootId: root.id, nodes };
}

export function parsePath(d: string): { points: PathPoint[]; closed: boolean }[] {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const subs: { points: PathPoint[]; closed: boolean }[] = [];
  let cur: { points: PathPoint[]; closed: boolean } | null = null;
  let i = 0,
    cmd = '',
    x = 0,
    y = 0,
    sx = 0,
    sy = 0;
  const n = () => parseFloat(toks[i++]);
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'Z') {
      if (cur) cur.closed = true;
      x = sx;
      y = sy;
      continue;
    }
    if (C === 'M') {
      x = (rel ? x : 0) + n();
      y = (rel ? y : 0) + n();
      sx = x;
      sy = y;
      cur = { points: [{ x, y }], closed: false };
      subs.push(cur);
      cmd = rel ? 'l' : 'L';
      continue;
    }
    if (!cur) {
      cur = { points: [{ x, y }], closed: false };
      subs.push(cur);
    }
    if (C === 'L') {
      x = (rel ? x : 0) + n();
      y = (rel ? y : 0) + n();
      cur.points.push({ x, y });
    } else if (C === 'H') {
      x = (rel ? x : 0) + n();
      cur.points.push({ x, y });
    } else if (C === 'V') {
      y = (rel ? y : 0) + n();
      cur.points.push({ x, y });
    } else if (C === 'C' || C === 'S' || C === 'Q' || C === 'T') {
      const prev = cur.points[cur.points.length - 1];
      let c1: { x: number; y: number }, c2: { x: number; y: number };
      if (C === 'C') {
        c1 = { x: (rel ? x : 0) + n(), y: (rel ? y : 0) + n() };
        c2 = { x: (rel ? x : 0) + n(), y: (rel ? y : 0) + n() };
      } else if (C === 'S') {
        c1 = prev.cin ? { x: 2 * x - prev.cin.x, y: 2 * y - prev.cin.y } : { x, y };
        c2 = { x: (rel ? x : 0) + n(), y: (rel ? y : 0) + n() };
      } else {
        const q = C === 'Q' ? { x: (rel ? x : 0) + n(), y: (rel ? y : 0) + n() } : { x, y };
        const nx = (rel ? x : 0) + n(),
          ny = (rel ? y : 0) + n();
        c1 = { x: x + (2 / 3) * (q.x - x), y: y + (2 / 3) * (q.y - y) };
        c2 = { x: nx + (2 / 3) * (q.x - nx), y: ny + (2 / 3) * (q.y - ny) };
        prev.cout = c1;
        x = nx;
        y = ny;
        cur.points.push({ x, y, cin: c2 });
        continue;
      }
      x = (rel ? x : 0) + n();
      y = (rel ? y : 0) + n();
      prev.cout = c1;
      cur.points.push({ x, y, cin: c2 });
    } else if (C === 'A') {
      // approximate arcs with a line to endpoint
      n();
      n();
      n();
      n();
      n();
      x = (rel ? x : 0) + n();
      y = (rel ? y : 0) + n();
      cur.points.push({ x, y });
    } else i++;
  }
  // drop duplicated closing point
  for (const s of subs) {
    const a = s.points[0],
      b = s.points[s.points.length - 1];
    if (s.closed && s.points.length > 2 && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01) {
      a.cin = b.cin;
      s.points.pop();
    }
  }
  return subs;
}
