import type { SceneNode } from '../types';

type Nodes = Record<string, SceneNode>;

/** Move a node and all its descendants by dx, dy (mutates). */
export function translateTree(nodes: Nodes, id: string, dx: number, dy: number) {
  const n = nodes[id];
  if (!n) return;
  n.x += dx;
  n.y += dy;
  if (n.points && n.type !== 'path') {
    /* points are local; nothing */
  }
  for (const c of n.children) translateTree(nodes, c, dx, dy);
}

/** Scale descendants of a container when it is resized, honouring constraints (mutates). */
export function resizeTree(nodes: Nodes, id: string, nx: number, ny: number, nw: number, nh: number) {
  const n = nodes[id];
  if (!n) return;
  const ox = n.x,
    oy = n.y,
    ow = n.w || 1,
    oh = n.h || 1;
  n.x = nx;
  n.y = ny;
  n.w = nw;
  n.h = nh;
  const isGroup = n.type === 'group';
  for (const cid of n.children) {
    const c = nodes[cid];
    if (!c) continue;
    const con = isGroup ? { h: 'scale', v: 'scale' } : c.constraints ?? { h: 'left', v: 'top' };
    let cx = c.x,
      cy = c.y,
      cw = c.w,
      ch = c.h;
    const relL = c.x - ox,
      relR = ox + ow - (c.x + c.w),
      relT = c.y - oy,
      relB = oy + oh - (c.y + c.h);
    switch (con.h) {
      case 'left':
        cx = nx + relL;
        break;
      case 'right':
        cx = nx + nw - relR - cw;
        break;
      case 'left-right':
        cx = nx + relL;
        cw = Math.max(1, nw - relL - relR);
        break;
      case 'center':
        cx = nx + nw / 2 - (ow / 2 - relL);
        break;
      case 'scale':
        cx = nx + (relL / ow) * nw;
        cw = (c.w / ow) * nw;
        break;
    }
    switch (con.v) {
      case 'top':
        cy = ny + relT;
        break;
      case 'bottom':
        cy = ny + nh - relB - ch;
        break;
      case 'top-bottom':
        cy = ny + relT;
        ch = Math.max(1, nh - relT - relB);
        break;
      case 'center':
        cy = ny + nh / 2 - (oh / 2 - relT);
        break;
      case 'scale':
        cy = ny + (relT / oh) * nh;
        ch = (c.h / oh) * nh;
        break;
    }
    if (c.type === 'path' && (c.points || c.rings) && (cw !== c.w || ch !== c.h)) scalePoints(c, cw / (c.w || 1), ch / (c.h || 1));
    if (c.type === 'text' && c.text && isGroup && ch !== c.h) c.text = { ...c.text, fontSize: Math.max(1, c.text.fontSize * (ch / (c.h || 1))) };
    resizeTree(nodes, cid, cx, cy, cw, ch);
  }
}

export function scalePoints(n: SceneNode, sx: number, sy: number) {
  if (n.rings) n.rings = n.rings.map((r) => r.map((p) => ({ x: p.x * sx, y: p.y * sy })));
  if (!n.points) return;
  n.points = n.points.map((p) => ({
    x: p.x * sx,
    y: p.y * sy,
    cin: p.cin ? { x: p.cin.x * sx, y: p.cin.y * sy } : undefined,
    cout: p.cout ? { x: p.cout.x * sx, y: p.cout.y * sy } : undefined,
  }));
}

/** Fit a group's box to its children. */
export function fitGroup(nodes: Nodes, id: string) {
  const g = nodes[id];
  if (!g || g.type !== 'group' || !g.children.length) return;
  let x1 = Infinity,
    y1 = Infinity,
    x2 = -Infinity,
    y2 = -Infinity;
  for (const cid of g.children) {
    const c = nodes[cid];
    if (!c) continue;
    x1 = Math.min(x1, c.x);
    y1 = Math.min(y1, c.y);
    x2 = Math.max(x2, c.x + c.w);
    y2 = Math.max(y2, c.y + c.h);
  }
  g.x = x1;
  g.y = y1;
  g.w = x2 - x1;
  g.h = y2 - y1;
}

const clampSize = (c: SceneNode, axis: 'w' | 'h', v: number) => {
  const mn = axis === 'w' ? c.minW : c.minH, mx = axis === 'w' ? c.maxW : c.maxH;
  if (mx != null && mx > 0) v = Math.min(v, mx);
  if (mn != null) v = Math.max(v, mn);
  return Math.max(0.01, v);
};

/** Resize a child to an exact box, keeping nested layout correct (mutates). */
function setChildSize(nodes: Nodes, c: SceneNode, w: number, h: number) {
  if (Math.abs(w - c.w) < 0.001 && Math.abs(h - c.h) < 0.001) return;
  if (c.type === 'text' && c.text && Math.abs(w - c.w) > 0.001 && c.text.autoResize === 'width') c.text = { ...c.text, autoResize: 'height' };
  if (c.autoLayout) {
    // fill overrides hug on that axis
    c.w = w;
    c.h = h;
    applyAutoLayout(nodes, c.id, true);
  } else resizeTree(nodes, c.id, c.x, c.y, w, h);
}

/** Apply auto layout to a frame (mutates), recursing into nested auto-layout frames first. */
export function applyAutoLayout(nodes: Nodes, id: string, skipChildren = false) {
  const f = nodes[id];
  if (!f) return;
  if (!skipChildren) for (const cid of f.children) if (nodes[cid]?.autoLayout) applyAutoLayout(nodes, cid);
  const al = f.autoLayout;
  if (!al) return;
  const kids = f.children.map((c) => nodes[c]).filter((c): c is SceneNode => !!c && c.visible && !c.layoutAbsolute);
  const { t, r, b, l } = al.padding;
  const horiz = al.direction === 'horizontal';
  const fillMain = (c: SceneNode) => (horiz ? c.layoutSizing?.h : c.layoutSizing?.v) === 'fill';
  const fillCross = (c: SceneNode) => (horiz ? c.layoutSizing?.v : c.layoutSizing?.h) === 'fill';
  const sw = (c: SceneNode) => (al.strokesIncluded ? (c.strokes?.find((s) => s.visible)?.width ?? 0) : 0);
  const mainSize = (c: SceneNode) => (horiz ? c.w : c.h) + sw(c) * 2;
  const crossSize = (c: SceneNode) => (horiz ? c.h : c.w) + sw(c) * 2;
  const hugMain = horiz ? al.hugW && f.layoutSizing?.h !== 'fill' : al.hugH && f.layoutSizing?.v !== 'fill';
  const hugCross = horiz ? al.hugH && f.layoutSizing?.v !== 'fill' : al.hugW && f.layoutSizing?.h !== 'fill';
  const auto = al.justify === 'space-between';

  // split into lines (wrap only for horizontal, like Figma)
  const wrap = al.wrap && horiz && !hugMain;
  const innerMainFixed = (horiz ? f.w - l - r : f.h - t - b);
  const lines: SceneNode[][] = [];
  if (wrap) {
    let cur: SceneNode[] = [], used = 0;
    for (const c of kids) {
      const m = fillMain(c) ? 0 : mainSize(c);
      if (cur.length && used + al.gap + m > innerMainFixed + 0.01) { lines.push(cur); cur = []; used = 0; }
      used += (cur.length ? al.gap : 0) + m;
      cur.push(c);
    }
    if (cur.length) lines.push(cur);
  } else lines.push(kids);

  // hug sizes (fill children count as their current size when the container hugs)
  if (hugMain) {
    const total = kids.reduce((s, c) => s + mainSize(c), 0) + al.gap * Math.max(0, kids.length - 1);
    if (horiz) f.w = clampSize(f, 'w', total + l + r);
    else f.h = clampSize(f, 'h', total + t + b);
  }
  const counterGap = al.counterGap ?? al.gap;
  const lineCross = (line: SceneNode[]) => line.reduce((m, c) => Math.max(m, fillCross(c) && !hugCross ? 0 : crossSize(c)), 0);
  if (hugCross) {
    const total = lines.reduce((s, ln) => s + lineCross(ln), 0) + counterGap * Math.max(0, lines.length - 1);
    if (horiz) f.h = clampSize(f, 'h', total + t + b);
    else f.w = clampSize(f, 'w', total + l + r);
  }
  const innerMain = horiz ? f.w - l - r : f.h - t - b;
  const innerCross = horiz ? f.h - t - b : f.w - l - r;

  let crossCursor = 0;
  for (const line of lines) {
    const lc = lines.length > 1 ? lineCross(line) : innerCross;
    // fill along main axis shares leftover space
    const fills = line.filter(fillMain);
    if (fills.length && !hugMain) {
      const fixed = line.filter((c) => !fillMain(c)).reduce((s, c) => s + mainSize(c), 0);
      const free = innerMain - fixed - al.gap * Math.max(0, line.length - 1);
      const each = Math.max(0.01, free / fills.length);
      for (const c of fills) setChildSize(nodes, c, horiz ? clampSize(c, 'w', each) : c.w, horiz ? c.h : clampSize(c, 'h', each));
    }
    for (const c of line) if (fillCross(c)) setChildSize(nodes, c, horiz ? c.w : clampSize(c, 'w', lc), horiz ? clampSize(c, 'h', lc) : c.h);

    const total = line.reduce((s, c) => s + mainSize(c), 0) + al.gap * Math.max(0, line.length - 1);
    let gap = al.gap;
    let cursor = 0;
    if (auto && line.length > 1) gap = (innerMain - (total - al.gap * (line.length - 1))) / (line.length - 1);
    else if (auto && line.length === 1) cursor = (innerMain - total) / 2;
    else if (al.justify === 'center') cursor = (innerMain - total) / 2;
    else if (al.justify === 'end') cursor = innerMain - total;
    for (const c of line) {
      let cross = 0;
      if (al.align === 'center') cross = (lc - crossSize(c)) / 2;
      else if (al.align === 'end') cross = lc - crossSize(c);
      const nx = horiz ? f.x + l + cursor + sw(c) : f.x + l + crossCursor + cross + sw(c);
      const ny = horiz ? f.y + t + crossCursor + cross + sw(c) : f.y + t + cursor + sw(c);
      translateTree(nodes, c.id, nx - c.x, ny - c.y);
      cursor += mainSize(c) + gap;
    }
    crossCursor += lc + counterGap;
  }
}

/** Walk up from a node and re-run auto layout / group fitting on ancestors. */
export function relayoutAncestors(nodes: Nodes, id: string | null) {
  let cur = id ? nodes[id] : undefined;
  while (cur) {
    if (cur.type === 'group') fitGroup(nodes, cur.id);
    if (cur.autoLayout) applyAutoLayout(nodes, cur.id);
    cur = cur.parentId ? nodes[cur.parentId] : undefined;
  }
}

export function descendants(nodes: Nodes, id: string): string[] {
  const out: string[] = [];
  const walk = (i: string) => {
    for (const c of nodes[i]?.children ?? []) {
      out.push(c);
      walk(c);
    }
  };
  walk(id);
  return out;
}

export function isAncestor(nodes: Nodes, maybeAncestor: string, id: string): boolean {
  let cur = nodes[id]?.parentId;
  while (cur) {
    if (cur === maybeAncestor) return true;
    cur = nodes[cur]?.parentId ?? null;
  }
  return false;
}
