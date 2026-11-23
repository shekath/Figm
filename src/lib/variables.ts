import type { BindableProp, DocumentData, SceneNode, Variable, VariableCollection, VariableScope, VariableValue } from '../types';
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

/** "#rrggbbaa" → { hex: "#rrggbb", a: 0..1 }. */
export function splitAlpha(v: string): { hex: string; a: number } {
  return v.length === 9 ? { hex: v.slice(0, 7), a: Math.round((parseInt(v.slice(7, 9), 16) / 255) * 1000) / 1000 } : { hex: v, a: 1 };
}

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

export const isAlias = (v: VariableValue | undefined): v is { alias: string } => typeof v === 'object' && v !== null && 'alias' in v;

/** Resolved value for a node, following aliases (each alias resolves in its own collection's mode). Cycle-safe. */
export function variableValue(doc: DocumentData, varId: string, nodeId: string | null, seen = new Set<string>()): string | number | boolean | undefined {
  if (seen.has(varId)) return undefined;
  seen.add(varId);
  const found = findVariable(doc, varId);
  if (!found) return undefined;
  const mode = resolveMode(doc, nodeId, found.col);
  const raw = found.v.values[mode] ?? Object.values(found.v.values)[0];
  return isAlias(raw) ? variableValue(doc, raw.alias, nodeId, seen) : raw;
}

/** Resolve a value as shown in a given mode column (aliases followed with default modes). */
export function resolveInMode(doc: DocumentData, v: Variable, modeId: string, seen = new Set<string>()): string | number | boolean | undefined {
  if (seen.has(v.id)) return undefined;
  seen.add(v.id);
  const raw = v.values[modeId] ?? Object.values(v.values)[0];
  if (!isAlias(raw)) return raw;
  const t = findVariable(doc, raw.alias);
  if (!t) return undefined;
  return resolveInMode(doc, t.v, resolveMode(doc, null, t.col), seen);
}

/** Would aliasing `fromId` → `toId` create a loop? */
export function aliasCreatesCycle(doc: DocumentData, fromId: string, toId: string): boolean {
  const stack = [toId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === fromId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const f = findVariable(doc, id);
    if (f) for (const val of Object.values(f.v.values)) if (isAlias(val)) stack.push(val.alias);
  }
  return false;
}

export const PROP_SCOPE: Record<BindableProp, VariableScope> = {
  fill: 'fill', stroke: 'stroke', radius: 'radius', opacity: 'opacity', gap: 'gap', padding: 'padding',
  width: 'size', height: 'size', strokeWidth: 'stroke-width', fontSize: 'font-size', text: 'text-content', visible: 'visibility',
};
export const SCOPES_BY_TYPE: Record<Variable['type'], { id: VariableScope; label: string }[]> = {
  color: [{ id: 'fill', label: 'Fill' }, { id: 'stroke', label: 'Stroke' }, { id: 'text-fill', label: 'Text fill' }, { id: 'effect', label: 'Effects' }],
  number: [{ id: 'radius', label: 'Corner radius' }, { id: 'size', label: 'Width & height' }, { id: 'gap', label: 'Gap' }, { id: 'padding', label: 'Padding' }, { id: 'stroke-width', label: 'Stroke width' }, { id: 'opacity', label: 'Opacity' }, { id: 'font-size', label: 'Font size' }],
  string: [{ id: 'text-content', label: 'Text content' }],
  boolean: [{ id: 'visibility', label: 'Layer visibility' }],
};
export const inScope = (v: Variable, prop: BindableProp) => !v.scopes || !v.scopes.length || v.scopes.includes('all') || v.scopes.includes(PROP_SCOPE[prop]);

/** Group path ("color/brand") and leaf ("primary") of a variable name. */
export function splitName(name: string): { group: string; leaf: string } {
  const i = name.lastIndexOf('/');
  return i < 0 ? { group: '', leaf: name } : { group: name.slice(0, i), leaf: name.slice(i + 1) };
}

/* ---------- design tokens (W3C DTCG) ---------- */
export function exportTokens(doc: DocumentData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of doc.variables) {
    const colObj: Record<string, unknown> = {};
    for (const m of col.modes) {
      const modeObj: Record<string, unknown> = {};
      for (const v of col.variables) {
        const raw = v.values[m.id];
        let value: unknown = raw;
        if (isAlias(raw)) {
          const t = findVariable(doc, raw.alias);
          value = t ? `{${t.col.name}.${t.v.name.replace(/\//g, '.')}}` : null;
        }
        let cur = modeObj;
        const parts = v.name.split('/');
        for (const p of parts.slice(0, -1)) cur = (cur[p] ??= {}) as Record<string, unknown>;
        cur[parts[parts.length - 1]] = { $type: v.type === 'color' ? 'color' : v.type === 'number' ? 'number' : v.type === 'boolean' ? 'boolean' : 'string', $value: value, ...(v.description ? { $description: v.description } : {}) };
      }
      colObj[m.name] = modeObj;
    }
    out[col.name] = colObj;
  }
  return out;
}

/** Import DTCG-style tokens: { Collection: { Mode: { group: { token: {$type,$value} } } } }. Aliases "{Collection.a.b}" are linked after creation. */
export function importTokens(doc: DocumentData, json: Record<string, unknown>): number {
  const pending: { v: Variable; modeId: string; ref: string }[] = [];
  let count = 0;
  const isToken = (o: unknown): o is { $value: unknown; $type?: string; $description?: string } => !!o && typeof o === 'object' && '$value' in (o as object);
  for (const [colName, modesRaw] of Object.entries(json)) {
    if (!modesRaw || typeof modesRaw !== 'object') continue;
    let col = doc.variables.find((c) => c.name === colName);
    if (!col) doc.variables.push((col = { ...newCollection(colName), modes: [] }));
    for (const [modeName, tree] of Object.entries(modesRaw as Record<string, unknown>)) {
      let mode = col.modes.find((m) => m.name === modeName);
      if (!mode) {
        mode = { id: uid(), name: modeName };
        col.modes.push(mode);
        for (const v of col.variables) v.values[mode.id] = v.values[col.modes[0].id] ?? defaultValue(v.type);
      }
      const walk = (node: Record<string, unknown>, path: string[]) => {
        for (const [k, child] of Object.entries(node)) {
          if (k.startsWith('$')) continue;
          if (isToken(child)) {
            const name = [...path, k].join('/');
            const type: Variable['type'] = child.$type === 'color' ? 'color' : child.$type === 'number' || child.$type === 'dimension' ? 'number' : child.$type === 'boolean' ? 'boolean' : typeof child.$value === 'number' ? 'number' : typeof child.$value === 'boolean' ? 'boolean' : /^#[0-9a-f]{3,8}$/i.test(String(child.$value)) ? 'color' : 'string';
            let v = col!.variables.find((x) => x.name === name);
            if (!v) {
              v = { id: uid(), name, type, values: Object.fromEntries(col!.modes.map((m) => [m.id, defaultValue(type)])) };
              col!.variables.push(v);
              count++;
            }
            if (child.$description) v.description = child.$description;
            const val = child.$value;
            if (typeof val === 'string' && /^\{.+\}$/.test(val)) pending.push({ v, modeId: mode!.id, ref: val.slice(1, -1) });
            else v.values[mode!.id] = type === 'number' ? parseFloat(String(val)) || 0 : type === 'boolean' ? val === true || val === 'true' : type === 'color' ? String(val).toLowerCase().slice(0, 9) : String(val);
          } else if (child && typeof child === 'object') walk(child as Record<string, unknown>, [...path, k]);
        }
      };
      walk(tree as Record<string, unknown>, []);
    }
    if (!col.modes.length) col.modes.push({ id: uid(), name: 'Mode 1' });
  }
  for (const { v, modeId, ref } of pending) {
    const [cName, ...rest] = ref.split('.');
    const target = doc.variables.find((c) => c.name === cName)?.variables.find((x) => x.name === rest.join('/'))
      ?? doc.variables.flatMap((c) => c.variables).find((x) => x.name === ref.replace(/\./g, '/'));
    if (target && !aliasCreatesCycle(doc, v.id, target.id)) v.values[modeId] = { alias: target.id };
  }
  applyAllBindings(doc);
  return count;
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
      case 'fill': {
        const { hex, a } = splitAlpha(String(val));
        if (n.fills[0]) n.fills[0] = { ...n.fills[0], kind: 'solid', color: hex, opacity: a };
        else n.fills = [solid(hex, a)];
        break;
      }
      case 'stroke': {
        const { hex, a } = splitAlpha(String(val));
        if (n.strokes[0]) n.strokes[0] = { ...n.strokes[0], color: hex, opacity: a };
        else n.strokes = [{ ...defaultStroke(hex), opacity: a }];
        break;
      }
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
