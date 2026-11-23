/**
 * Pure document operations shared by the editor, the collaboration server and the MCP tools.
 * Patches are node-granular last-writer-wins: a node value replaces the whole node, `null` deletes it.
 */
import type { DocumentData, SceneNode } from '../types';

export interface DocPatch {
  nodes?: Record<string, SceneNode | null>;
  pages?: DocumentData['pages'];
  meta?: Partial<Omit<DocumentData, 'nodes' | 'pages' | 'format' | 'version'>>;
}

const META_KEYS = ['name', 'comments', 'colorStyles', 'textStyles', 'effectStyles', 'variables', 'activeModes', 'versions'] as const;

/** Reference-based diff (relies on structural sharing from immer). */
export function diffDocs(a: DocumentData, b: DocumentData): DocPatch | null {
  if (a === b) return null;
  const patch: DocPatch = {};
  if (a.nodes !== b.nodes) {
    const nodes: Record<string, SceneNode | null> = {};
    let any = false;
    for (const k in b.nodes) {
      if (a.nodes[k] !== b.nodes[k]) {
        nodes[k] = b.nodes[k];
        any = true;
      }
    }
    for (const k in a.nodes) {
      if (!(k in b.nodes)) {
        nodes[k] = null;
        any = true;
      }
    }
    if (any) patch.nodes = nodes;
  }
  if (a.pages !== b.pages) patch.pages = b.pages;
  for (const k of META_KEYS) {
    if (a[k] !== b[k]) (patch.meta ??= {})[k] = b[k] as never;
  }
  return patch.nodes || patch.pages || patch.meta ? patch : null;
}

/** Returns a new document with the patch applied (input is not mutated). */
export function applyPatch(doc: DocumentData, patch: DocPatch): DocumentData {
  const out: DocumentData = { ...doc };
  if (patch.nodes) {
    out.nodes = { ...doc.nodes };
    for (const [k, v] of Object.entries(patch.nodes)) {
      if (v === null) delete out.nodes[k];
      else out.nodes[k] = v;
    }
  }
  if (patch.pages) out.pages = patch.pages;
  if (patch.meta) Object.assign(out, patch.meta);
  return out;
}

export function mergePatches(a: DocPatch | null, b: DocPatch | null): DocPatch | null {
  if (!a) return b;
  if (!b) return a;
  return {
    nodes: a.nodes || b.nodes ? { ...(a.nodes ?? {}), ...(b.nodes ?? {}) } : undefined,
    pages: b.pages ?? a.pages,
    meta: a.meta || b.meta ? { ...(a.meta ?? {}), ...(b.meta ?? {}) } : undefined,
  };
}

/**
 * Make the tree consistent after concurrent edits. `parentId` is the source of truth:
 * children arrays keep their order but drop ids that no longer belong, and gain ids that do.
 * Returns the same object if nothing needed fixing.
 */
export function repairDocument(doc: DocumentData): DocumentData {
  const nodes = doc.nodes;
  let changed = false;
  const fixedNodes: Record<string, SceneNode> = { ...nodes };
  const owned = new Map<string, string[]>(); // parentId -> ids claiming it
  const roots: string[] = [];
  for (const id in nodes) {
    const n = nodes[id];
    let pid = n.parentId;
    // break dangling parents and cycles
    if (pid && (!nodes[pid] || createsCycle(nodes, id))) {
      fixedNodes[id] = { ...n, parentId: null };
      pid = null;
      changed = true;
    }
    if (pid) {
      if (!owned.has(pid)) owned.set(pid, []);
      owned.get(pid)!.push(id);
    } else roots.push(id);
  }
  for (const id in fixedNodes) {
    const n = fixedNodes[id];
    const mine = owned.get(id) ?? [];
    const set = new Set(mine);
    const kept = n.children.filter((c, i) => set.has(c) && n.children.indexOf(c) === i);
    for (const c of mine) if (!kept.includes(c)) kept.push(c);
    if (kept.length !== n.children.length || kept.some((c, i) => c !== n.children[i])) {
      fixedNodes[id] = { ...n, children: kept };
      changed = true;
    }
  }
  // page roots
  const rootSet = new Set(roots);
  const seen = new Set<string>();
  const pages = doc.pages.map((p) => {
    const kept = p.children.filter((c) => rootSet.has(c) && !seen.has(c) && (seen.add(c), true));
    if (kept.length !== p.children.length) {
      changed = true;
      return { ...p, children: kept };
    }
    return p;
  });
  const orphanRoots = roots.filter((r) => !seen.has(r));
  if (orphanRoots.length && pages.length) {
    pages[0] = { ...pages[0], children: [...pages[0].children, ...orphanRoots] };
    changed = true;
  }
  return changed ? { ...doc, nodes: fixedNodes, pages } : doc;
}

function createsCycle(nodes: Record<string, SceneNode>, id: string) {
  const seen = new Set<string>([id]);
  let cur = nodes[id]?.parentId;
  while (cur) {
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = nodes[cur]?.parentId ?? null;
  }
  return false;
}

/** Which page a node lives on. */
export function pageOf(doc: DocumentData, id: string): string | undefined {
  let cur = doc.nodes[id];
  while (cur?.parentId) cur = doc.nodes[cur.parentId];
  return cur ? doc.pages.find((p) => p.children.includes(cur!.id))?.id : undefined;
}
