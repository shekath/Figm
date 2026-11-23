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
    if (c.type === 'path' && c.points && (cw !== c.w || ch !== c.h)) scalePoints(c, cw / (c.w || 1), ch / (c.h || 1));
    if (c.type === 'text' && c.text && isGroup && ch !== c.h) c.text = { ...c.text, fontSize: Math.max(1, c.text.fontSize * (ch / (c.h || 1))) };
    resizeTree(nodes, cid, cx, cy, cw, ch);
  }
}

export function scalePoints(n: SceneNode, sx: number, sy: number) {
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

/** Apply auto layout to a frame (mutates), recursing into nested auto-layout frames first. */
export function applyAutoLayout(nodes: Nodes, id: string) {
  const f = nodes[id];
  if (!f) return;
  for (const cid of f.children) if (nodes[cid]?.autoLayout) applyAutoLayout(nodes, cid);
  const al = f.autoLayout;
  if (!al) return;
  const kids = f.children.map((c) => nodes[c]).filter((c): c is SceneNode => !!c && c.visible);
  const { t, r, b, l } = al.padding;
  const horiz = al.direction === 'horizontal';
  const mainSize = (c: SceneNode) => (horiz ? c.w : c.h);
  const crossSize = (c: SceneNode) => (horiz ? c.h : c.w);
  const total = kids.reduce((s, c) => s + mainSize(c), 0) + al.gap * Math.max(0, kids.length - 1);
  const maxCross = kids.reduce((m, c) => Math.max(m, crossSize(c)), 0);

  if (horiz) {
    if (al.hugW) f.w = total + l + r;
    if (al.hugH) f.h = maxCross + t + b;
  } else {
    if (al.hugH) f.h = total + t + b;
    if (al.hugW) f.w = maxCross + l + r;
  }
  const innerMain = horiz ? f.w - l - r : f.h - t - b;
  const innerCross = horiz ? f.h - t - b : f.w - l - r;
  let gap = al.gap;
  let cursor = 0;
  if (al.justify === 'center') cursor = (innerMain - total) / 2;
  else if (al.justify === 'end') cursor = innerMain - total;
  else if (al.justify === 'space-between' && kids.length > 1) {
    gap = (innerMain - (total - al.gap * (kids.length - 1))) / (kids.length - 1);
  }
  for (const c of kids) {
    let cross = 0;
    if (al.align === 'center') cross = (innerCross - crossSize(c)) / 2;
    else if (al.align === 'end') cross = innerCross - crossSize(c);
    const nx = horiz ? f.x + l + cursor : f.x + l + cross;
    const ny = horiz ? f.y + t + cross : f.y + t + cursor;
    translateTree(nodes, c.id, nx - c.x, ny - c.y);
    cursor += mainSize(c) + gap;
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
