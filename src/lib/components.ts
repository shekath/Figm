/**
 * Component variants and component properties. Pure functions over the document (mutating helpers
 * take a draft). Shared by the editor, presenter, HTML export and the MCP tools.
 */
import type { ComponentProp, DocumentData, SceneNode } from '../types';
import { createNode, defaultStroke, uid } from './factory';
import { applyAutoLayout, relayoutAncestors, translateTree } from './layout';

type Nodes = Record<string, SceneNode>;

/* ---------- variant names ---------- */

/** "State=Hover, Size=Large" → { State: 'Hover', Size: 'Large' } (null if the name isn't in that form). */
export function parseVariantName(name: string): Record<string, string> | null {
  const parts = name.split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length || !parts.every((p) => p.includes('='))) return null;
  const out: Record<string, string> = {};
  for (const p of parts) {
    const i = p.indexOf('=');
    const k = p.slice(0, i).trim(),
      v = p.slice(i + 1).trim();
    if (!k) return null;
    out[k] = v;
  }
  return out;
}

export const variantName = (props: Record<string, string>) =>
  Object.entries(props)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');

/* ---------- lookups ---------- */

export const isSet = (n?: SceneNode | null) => !!n && n.type === 'frame' && !!n.isComponentSet;

/** Component set that contains a variant component (or null). */
export function setOf(nodes: Nodes, compId: string | undefined): SceneNode | null {
  const c = compId ? nodes[compId] : undefined;
  const p = c?.parentId ? nodes[c.parentId] : undefined;
  return isSet(p) ? p! : null;
}

export function variantsOf(nodes: Nodes, setId: string): SceneNode[] {
  return (nodes[setId]?.children ?? []).map((c) => nodes[c]).filter((n): n is SceneNode => !!n && n.type === 'component');
}

/** Variant property definitions of a set, in first-seen order. */
export function variantDefs(nodes: Nodes, setId: string): { name: string; values: string[] }[] {
  const defs = new Map<string, string[]>();
  for (const v of variantsOf(nodes, setId))
    for (const [k, val] of Object.entries(v.variantProps ?? {})) {
      if (!defs.has(k)) defs.set(k, []);
      if (!defs.get(k)!.includes(val)) defs.get(k)!.push(val);
    }
  return [...defs].map(([name, values]) => ({ name, values }));
}

/** Variant matching `props` best: exact match, otherwise the one sharing the most values (ties → first). */
export function findVariant(nodes: Nodes, setId: string, props: Record<string, string>): string | null {
  let best: string | null = null,
    score = -1;
  for (const v of variantsOf(nodes, setId)) {
    const vp = v.variantProps ?? {};
    let s = 0;
    for (const [k, val] of Object.entries(props)) if (vp[k] === val) s++;
    if (s > score) {
      score = s;
      best = v.id;
    }
  }
  return best;
}

/** Name path of a node relative to a component root ("Row/Label"). */
export function pathOf(nodes: Nodes, rootId: string, id: string): string | null {
  const parts: string[] = [];
  let cur = nodes[id];
  while (cur && cur.id !== rootId) {
    parts.unshift(cur.name);
    cur = cur.parentId ? nodes[cur.parentId] : (undefined as unknown as SceneNode);
  }
  return cur?.id === rootId ? parts.join('/') : null;
}

/** Find a node under `rootId` by name path (first match at each level). */
export function findByPath(nodes: Nodes, rootId: string, path: string): string | null {
  if (!path) return rootId;
  let cur = rootId;
  for (const name of path.split('/')) {
    const next = (nodes[cur]?.children ?? []).find((c) => nodes[c]?.name === name);
    if (!next) return null;
    cur = next;
  }
  return cur;
}

/** Component properties that apply to a component (defined on its set, or on itself). */
export function componentPropsFor(nodes: Nodes, compId: string | undefined): ComponentProp[] {
  if (!compId) return [];
  const set = setOf(nodes, compId);
  return (set ?? nodes[compId])?.componentProps ?? [];
}

/**
 * Effective overrides for rendering an instance with a given (current) variant:
 * the instance's own overrides plus values coming from boolean/text component properties.
 */
export function instanceOverrides(nodes: Nodes, inst: SceneNode, compId = inst.componentId): Record<string, Partial<SceneNode>> {
  const out: Record<string, Partial<SceneNode>> = { ...(inst.overrides ?? {}) };
  if (!compId) return out;
  for (const p of componentPropsFor(nodes, compId)) {
    const val = inst.propValues?.[p.id] ?? p.default;
    const target = findByPath(nodes, compId, p.layer);
    if (!target || target === compId) continue;
    const t = nodes[target];
    if (p.type === 'boolean') out[target] = { ...(out[target] ?? {}), visible: val === true || val === 'true' };
    else if (p.type === 'text' && t?.text) out[target] = { ...(out[target] ?? {}), text: { ...t.text, ...(out[target]?.text ?? {}), content: String(val) } };
  }
  return out;
}

/* ---------- editing (mutating; pass an immer draft or plain object) ---------- */

function listOf(d: DocumentData, id: string): string[] {
  const n = d.nodes[id];
  return n.parentId ? d.nodes[n.parentId].children : d.pages.find((p) => p.children.includes(id))!.children;
}

/** Make sure every variant has props for every property in the set and a matching name. */
export function normalizeSet(d: DocumentData, setId: string) {
  const defs = variantDefs(d.nodes, setId);
  for (const v of variantsOf(d.nodes, setId)) {
    const vp = { ...(v.variantProps ?? {}) };
    for (const def of defs) if (!(def.name in vp)) vp[def.name] = def.values[0] ?? 'Default';
    v.variantProps = vp;
    v.name = variantName(vp);
  }
}

/** Wrap components (or frames/groups, converted to components) into a new component set. Returns its id. */
export function combineAsVariants(d: DocumentData, ids: string[], name?: string): string {
  const list = ids.filter((id) => d.nodes[id]);
  if (list.length < 1) throw new Error('Select components to combine');
  const first = d.nodes[list[0]];
  const parentId = first.parentId;
  const owner = listOf(d, first.id);
  const index = Math.max(0, ...list.map((id) => owner.indexOf(id)));
  const used = new Set<string>();
  list.forEach((id, i) => {
    const n = d.nodes[id];
    if (n.type === 'frame' || n.type === 'group') n.type = 'component';
    if (n.type !== 'component') throw new Error(`“${n.name}” is not a component`);
    let props = n.variantProps ?? parseVariantName(n.name);
    if (!props) {
      let v = n.name.replace(/^Component\s*/, '').trim() || `Variant ${i + 1}`;
      while (used.has(v)) v += ' copy';
      props = { 'Property 1': v };
    }
    used.add(Object.values(props).join('|'));
    n.variantProps = props;
  });
  const minX = Math.min(...list.map((id) => d.nodes[id].x)),
    minY = Math.min(...list.map((id) => d.nodes[id].y));
  const set = createNode('frame', {
    name: name ?? (first.name.includes('=') ? 'Component' : first.name.split(/[=,]/)[0].trim() || 'Component'),
    x: minX - 24,
    y: minY - 24,
    w: 100,
    h: 100,
    fills: [],
    strokes: [{ ...defaultStroke('#9747ff', 1), dash: 4 }],
    radius: 8,
    clip: false,
    parentId,
    isComponentSet: true,
    autoLayout: { direction: 'horizontal', gap: 24, padding: { t: 24, r: 24, b: 24, l: 24 }, align: 'start', justify: 'start', hugW: true, hugH: true, wrap: false },
  });
  d.nodes[set.id] = set;
  owner.splice(index + 1, 0, set.id);
  // keep visual order left → right
  const sorted = [...list].sort((a, b) => d.nodes[a].x - d.nodes[b].x || d.nodes[a].y - d.nodes[b].y);
  for (const id of sorted) {
    const own = listOf(d, id);
    own.splice(own.indexOf(id), 1);
    d.nodes[id].parentId = set.id;
    set.children.push(id);
  }
  // move component properties from the variants up to the set
  const props: ComponentProp[] = [];
  for (const id of sorted)
    for (const p of d.nodes[id].componentProps ?? []) if (!props.some((x) => x.name === p.name)) props.push(p);
  if (props.length) set.componentProps = props;
  for (const id of sorted) delete d.nodes[id].componentProps;
  normalizeSet(d, set.id);
  applyAutoLayout(d.nodes, set.id);
  relayoutAncestors(d.nodes, parentId);
  return set.id;
}

/** Duplicate a variant inside its set with a new, unique value for `prop` (default: first property). */
export function addVariant(d: DocumentData, setOrVariantId: string, prop?: string, value?: string): string {
  const n = d.nodes[setOrVariantId];
  const set = isSet(n) ? n : setOf(d.nodes, setOrVariantId);
  if (!set) throw new Error('Not a component set or variant');
  const variants = variantsOf(d.nodes, set.id);
  const src = isSet(n) ? variants[variants.length - 1] : n;
  const defs = variantDefs(d.nodes, set.id);
  const key = prop ?? defs[0]?.name ?? 'Property 1';
  const existing = new Set(defs.find((x) => x.name === key)?.values ?? []);
  let val = value ?? `Variant ${variants.length + 1}`;
  let k = 2;
  while (!value && existing.has(val)) val = `Variant ${variants.length + k++}`;
  const map: Record<string, string> = {};
  const copy = (oid: string, parent: string | null): string => {
    const o = d.nodes[oid];
    const nid = uid();
    map[oid] = nid;
    d.nodes[nid] = { ...JSON.parse(JSON.stringify(o)), id: nid, parentId: parent, children: [] };
    for (const c of o.children) d.nodes[nid].children.push(copy(c, nid));
    return nid;
  };
  const id = copy(src.id, set.id);
  const v = d.nodes[id];
  v.variantProps = { ...(src.variantProps ?? {}), [key]: val };
  v.prototype = undefined;
  // remap prototype links inside the copy that pointed into the source variant
  for (const nid of Object.values(map)) {
    const node = d.nodes[nid];
    if (node.prototype) node.prototype = node.prototype.map((l) => (map[l.targetId] ? { ...l, targetId: map[l.targetId] } : l));
  }
  set.children.splice(set.children.indexOf(src.id) + 1, 0, id);
  translateTree(d.nodes, id, 0, 0);
  normalizeSet(d, set.id);
  applyAutoLayout(d.nodes, set.id);
  relayoutAncestors(d.nodes, set.parentId);
  return id;
}

export function setVariantValue(d: DocumentData, variantId: string, prop: string, value: string) {
  const v = d.nodes[variantId];
  if (!v || v.type !== 'component') throw new Error('Not a variant');
  v.variantProps = { ...(v.variantProps ?? {}), [prop]: value };
  const set = setOf(d.nodes, variantId);
  if (set) normalizeSet(d, set.id);
  else v.name = variantName(v.variantProps);
}

export function renameVariantProp(d: DocumentData, setId: string, from: string, to: string) {
  if (!to.trim() || from === to) return;
  for (const v of variantsOf(d.nodes, setId)) {
    if (!v.variantProps || !(from in v.variantProps)) continue;
    const next: Record<string, string> = {};
    for (const [k, val] of Object.entries(v.variantProps)) next[k === from ? to : k] = val;
    v.variantProps = next;
    v.name = variantName(next);
  }
}

export function renameVariantValue(d: DocumentData, setId: string, prop: string, from: string, to: string) {
  if (!to.trim() || from === to) return;
  for (const v of variantsOf(d.nodes, setId))
    if (v.variantProps?.[prop] === from) {
      v.variantProps = { ...v.variantProps, [prop]: to };
      v.name = variantName(v.variantProps);
    }
}

export function addVariantProp(d: DocumentData, setId: string, name: string, defaultValue = 'Default') {
  for (const v of variantsOf(d.nodes, setId)) if (!(name in (v.variantProps ?? {}))) v.variantProps = { ...(v.variantProps ?? {}), [name]: defaultValue };
  normalizeSet(d, setId);
}

/**
 * Point an instance at another variant, carrying its overrides over by layer name path.
 */
export function swapVariant(d: DocumentData, instId: string, newCompId: string) {
  const inst = d.nodes[instId];
  if (!inst || inst.type !== 'instance' || !inst.componentId || inst.componentId === newCompId) return;
  const old = inst.componentId;
  const remapped: Record<string, Partial<SceneNode>> = {};
  for (const [cid, ov] of Object.entries(inst.overrides ?? {})) {
    const path = pathOf(d.nodes, old, cid);
    const target = path !== null ? findByPath(d.nodes, newCompId, path) : null;
    if (target) remapped[target] = ov;
  }
  const oldComp = d.nodes[old],
    newComp = d.nodes[newCompId];
  // keep explicit resizes, otherwise follow the new variant's size
  if (oldComp && newComp && Math.abs(inst.w - oldComp.w) < 0.5 && Math.abs(inst.h - oldComp.h) < 0.5) {
    inst.w = newComp.w;
    inst.h = newComp.h;
  }
  inst.componentId = newCompId;
  inst.overrides = remapped;
  inst.name = d.nodes[setOf(d.nodes, newCompId)?.id ?? newCompId]?.name ?? inst.name;
  relayoutAncestors(d.nodes, inst.parentId);
}

/** Set one variant property on an instance (switches to the best matching variant). */
export function setInstanceVariant(d: DocumentData, instId: string, prop: string, value: string): string | null {
  const inst = d.nodes[instId];
  const set = setOf(d.nodes, inst?.componentId);
  if (!inst || !set) return null;
  const cur = d.nodes[inst.componentId!].variantProps ?? {};
  const target = findVariant(d.nodes, set.id, { ...cur, [prop]: value });
  if (target) swapVariant(d, instId, target);
  return target;
}

/** Add a boolean or text property to a component (or its set) targeting a layer inside it. */
export function addComponentProp(d: DocumentData, layerId: string, type: ComponentProp['type'], name?: string): ComponentProp {
  // find the owning component
  let comp: SceneNode | undefined = d.nodes[layerId];
  while (comp && comp.type !== 'component') comp = comp.parentId ? d.nodes[comp.parentId] : undefined;
  if (!comp) throw new Error('Layer is not inside a main component');
  if (comp.id === layerId) throw new Error('Pick a layer inside the component');
  const owner = setOf(d.nodes, comp.id) ?? comp;
  const layer = pathOf(d.nodes, comp.id, layerId)!;
  const target = d.nodes[layerId];
  const prop: ComponentProp = {
    id: uid(),
    name: name ?? (type === 'boolean' ? `Show ${target.name}` : target.name),
    type,
    default: type === 'boolean' ? target.visible : target.text?.content ?? '',
    layer,
  };
  owner.componentProps = [...(owner.componentProps ?? []), prop];
  return prop;
}
