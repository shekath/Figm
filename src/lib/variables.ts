import type { BindableProp, DocumentData, SceneNode, Variable, VariableCollection } from '../types';
import { solid, defaultStroke, uid } from './factory';
import { applyAutoLayout } from './layout';

export const BIND_TYPES: Record<BindableProp, Variable['type']> = {
  fill: 'color',
  stroke: 'color',
  radius: 'number',
  opacity: 'number',
  gap: 'number',
  padding: 'number',
  width: 'number',
  height: 'number',
  strokeWidth: 'number',
  fontSize: 'number',
  text: 'string',
  visible: 'boolean',
};

export function findVariable(doc: DocumentData, id: string): { col: VariableCollection; v: Variable } | null {
  for (const col of doc.variables) {
    const v = col.variables.find((x) => x.id === id);
    if (v) return { col, v };
  }
  return null;
}

/** Mode in effect for a node: nearest ancestor override, then document active mode, then first mode. */
export function resolveMode(doc: DocumentData, nodeId: string | null, col: VariableCollection): string {
  let cur = nodeId ? doc.nodes[nodeId] : undefined;
  while (cur) {
    const m = cur.modeOverrides?.[col.id];
    if (m && col.modes.some((x) => x.id === m)) return m;
    cur = cur.parentId ? doc.nodes[cur.parentId] : undefined;
  }
  const active = doc.activeModes?.[col.id];
  if (active && col.modes.some((x) => x.id === active)) return active;
  return col.modes[0]?.id ?? '';
}

export function variableValue(doc: DocumentData, varId: string, nodeId: string | null): string | number | boolean | undefined {
  const found = findVariable(doc, varId);
  if (!found) return undefined;
  const mode = resolveMode(doc, nodeId, found.col);
  return found.v.values[mode] ?? Object.values(found.v.values)[0];
}

/** Write bound variable values into node properties (mutates). */
export function applyBindingsToNode(doc: DocumentData, n: SceneNode) {
  if (!n.bindings) return;
  for (const [prop, varId] of Object.entries(n.bindings) as [BindableProp, string][]) {
    if (!varId) continue;
    const val = variableValue(doc, varId, n.id);
    if (val === undefined) continue;
    const num = Number(val);
    switch (prop) {
      case 'fill':
        if (n.fills[0]) n.fills[0] = { ...n.fills[0], kind: 'solid', color: String(val) };
        else n.fills = [solid(String(val))];
        break;
      case 'stroke':
        if (n.strokes[0]) n.strokes[0] = { ...n.strokes[0], color: String(val) };
        else n.strokes = [defaultStroke(String(val))];
        break;
      case 'strokeWidth':
        if (n.strokes[0]) n.strokes[0] = { ...n.strokes[0], width: num };
        break;
      case 'radius':
        n.radius = num;
        n.radii = null;
        break;
      case 'opacity':
        n.opacity = num > 1 ? num / 100 : num;
        break;
      case 'gap':
        if (n.autoLayout) n.autoLayout = { ...n.autoLayout, gap: num };
        break;
      case 'padding':
        if (n.autoLayout) n.autoLayout = { ...n.autoLayout, padding: { t: num, r: num, b: num, l: num } };
        break;
      case 'width':
        n.w = Math.max(0.01, num);
        break;
      case 'height':
        n.h = Math.max(0.01, num);
        break;
      case 'fontSize':
        if (n.text) n.text = { ...n.text, fontSize: num };
        break;
      case 'text':
        if (n.text) n.text = { ...n.text, content: String(val) };
        break;
      case 'visible':
        n.visible = val === true || val === 'true';
        break;
    }
  }
}

/** Re-apply every binding in the document, then re-run auto layout where needed (mutates). */
export function applyAllBindings(doc: DocumentData) {
  const touched: SceneNode[] = [];
  for (const n of Object.values(doc.nodes)) {
    if (n.bindings && Object.keys(n.bindings).length) {
      applyBindingsToNode(doc, n);
      touched.push(n);
    }
  }
  const relayout = new Set<string>();
  for (const n of touched) {
    if (n.autoLayout) relayout.add(n.id);
    if (n.parentId && doc.nodes[n.parentId]?.autoLayout) relayout.add(n.parentId);
  }
  relayout.forEach((id) => applyAutoLayout(doc.nodes, id));
}

export function newCollection(name = 'Collection'): VariableCollection {
  return { id: uid(), name, modes: [{ id: uid(), name: 'Mode 1' }], variables: [] };
}

export function defaultValue(type: Variable['type']): string | number | boolean {
  return type === 'color' ? '#5b5bf7' : type === 'number' ? 0 : type === 'boolean' ? true : 'Text';
}
