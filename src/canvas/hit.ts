import type { SceneNode } from '../types';
import { pointInNode } from '../lib/geometry';

type Nodes = Record<string, SceneNode>;

/** Returns the chain of nodes (root..leaf) under the point, topmost first. */
export function hitPath(nodes: Nodes, roots: string[], x: number, y: number, tol: number): string[] {
  for (let i = roots.length - 1; i >= 0; i--) {
    const n = nodes[roots[i]];
    if (!n || !n.visible) continue;
    const res = hitNode(nodes, n, x, y, tol);
    if (res) return res;
  }
  return [];
}

function hitNode(nodes: Nodes, n: SceneNode, x: number, y: number, tol: number): string[] | null {
  const container = n.type === 'frame' || n.type === 'component' || n.type === 'group';
  const inside = pointInNode(n, x, y, tol);
  if (container) {
    if (n.type !== 'group' && n.clip && !inside) return null;
    const kids = n.children;
    let maskHit = true;
    const mask = kids.map((k) => nodes[k]).find((k) => k?.isMask);
    if (mask) maskHit = pointInNode(mask, x, y, tol);
    if (maskHit)
      for (let i = kids.length - 1; i >= 0; i--) {
        const c = nodes[kids[i]];
        if (!c || !c.visible) continue;
        const r = hitNode(nodes, c, x, y, tol);
        if (r) return [n.id, ...r];
      }
    if (n.type === 'group') return null;
    return inside ? [n.id] : null;
  }
  if (!inside) return null;
  // ellipse precise test
  if (n.type === 'ellipse' && !n.rotation) {
    const rx = n.w / 2 + tol,
      ry = n.h / 2 + tol;
    const dx = x - (n.x + n.w / 2),
      dy = y - (n.y + n.h / 2);
    if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) > 1) return null;
  }
  return [n.id];
}

/**
 * Pick which node in a hit path should be selected.
 * - deep: deepest leaf
 * - inside a focused container: child just below it
 * - top-level frames are "transparent": selecting their direct child
 */
export function pickFromPath(nodes: Nodes, path: string[], opts: { deep?: boolean; focusId?: string | null; selection?: string[] }): string | null {
  if (!path.length) return null;
  const pickable = path.filter((id) => !nodes[id]?.locked);
  if (!pickable.length) return null;
  if (opts.deep) return pickable[pickable.length - 1];
  if (opts.focusId) {
    const i = path.indexOf(opts.focusId);
    if (i >= 0 && i < path.length - 1) return path[i + 1];
  }
  // keep current selection if clicking within an already-selected deeper item
  if (opts.selection?.length) {
    for (let i = path.length - 1; i >= 0; i--) if (opts.selection.includes(path[i])) return path[i];
    // siblings of current selection are reachable directly
    const parents = new Set(opts.selection.map((s) => nodes[s]?.parentId));
    for (const id of path) if (parents.has(nodes[id]?.parentId) && nodes[id]?.parentId) return id;
  }
  const root = nodes[path[0]];
  if ((root.type === 'frame' || root.type === 'component') && path.length > 1 && !root.parentId) return path[1];
  return path[0];
}
