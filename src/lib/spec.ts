/**
 * Friendly JSON "node spec" used by the MCP connector (and any scripting) to create/update layers.
 * Coordinates in specs are relative to the parent (or to the page for top-level nodes).
 */
import type { AutoLayout, DocumentData, Effect, Paint, SceneNode } from '../types';
import { createNode, defaultEffect, defaultStroke, solid, uid } from './factory';
import { applyAutoLayout, relayoutAncestors, resizeTree, translateTree } from './layout';
import { parsePath } from './svgImport';
import { samplePath } from './boolean';
import { textBoxSize } from './text';
import { componentPropsFor, nestedLayers, setOf, variantDefs } from './components';

export type FillSpec = string | { type: 'solid'; color: string; opacity?: number } | { type: 'linear' | 'radial'; angle?: number; stops: { offset: number; color: string }[]; opacity?: number } | { type: 'image'; src: string };

export interface NodeSpec {
  type: 'frame' | 'component' | 'group' | 'rect' | 'ellipse' | 'polygon' | 'star' | 'line' | 'text' | 'image' | 'path';
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  visible?: boolean;
  locked?: boolean;
  fill?: FillSpec | null;
  fills?: FillSpec[];
  stroke?: string | null;
  strokeWidth?: number;
  strokeAlign?: 'inside' | 'center' | 'outside';
  dash?: number;
  radius?: number;
  radii?: [number, number, number, number];
  clip?: boolean;
  shadow?: { x?: number; y?: number; blur?: number; spread?: number; color?: string; opacity?: number; inner?: boolean } | null;
  blur?: number;
  backgroundBlur?: number;
  blend?: SceneNode['blend'];
  // text
  text?: string;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  italic?: boolean;
  color?: string;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  lineHeight?: number;
  letterSpacing?: number;
  textCase?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  underline?: boolean;
  autoResize?: 'width' | 'height' | 'fixed';
  // layout
  autoLayout?: {
    direction?: 'horizontal' | 'vertical';
    gap?: number;
    padding?: number | { top?: number; right?: number; bottom?: number; left?: number };
    align?: 'start' | 'center' | 'end';
    justify?: 'start' | 'center' | 'end' | 'space-between';
    hugWidth?: boolean;
    hugHeight?: boolean;
    wrap?: boolean;
  } | null;
  constraints?: SceneNode['constraints'];
  // shapes
  sides?: number;
  innerRatio?: number;
  svgPath?: string;
  src?: string;
  overflow?: SceneNode['overflow'];
  fixed?: boolean;
  description?: string;
  children?: NodeSpec[];
}

export function toPaint(f: FillSpec): Paint {
  if (typeof f === 'string') return solid(normColor(f));
  if (f.type === 'solid') return solid(normColor(f.color), f.opacity ?? 1);
  if (f.type === 'image') return { ...solid('#d9d9d9'), kind: 'image', src: f.src };
  return {
    ...solid(normColor(f.stops[0]?.color ?? '#000000'), f.opacity ?? 1),
    kind: f.type,
    angle: 'angle' in f ? f.angle ?? 90 : 90,
    stops: f.stops.map((s) => ({ offset: Math.max(0, Math.min(1, s.offset)), color: normColor(s.color) })),
  };
}

/** Accept #rgb, #rrggbb, #rrggbbaa and a few CSS names. Returns #rrggbb. */
export function normColor(c: string): string {
  const named: Record<string, string> = { white: '#ffffff', black: '#000000', red: '#ff0000', green: '#00a000', blue: '#0000ff', gray: '#808080', grey: '#808080', transparent: '#000000' };
  let s = c.trim().toLowerCase();
  if (named[s]) return named[s];
  const rgb = s.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (rgb) return '#' + [rgb[1], rgb[2], rgb[3]].map((v) => Math.min(255, Number(v)).toString(16).padStart(2, '0')).join('');
  if (!s.startsWith('#')) s = '#' + s;
  if (/^#[0-9a-f]{3}$/.test(s)) s = '#' + [...s.slice(1)].map((x) => x + x).join('');
  if (/^#[0-9a-f]{8}$/.test(s)) s = s.slice(0, 7);
  return /^#[0-9a-f]{6}$/.test(s) ? s : '#000000';
}

function autoLayoutFrom(a: NonNullable<NodeSpec['autoLayout']>, prev?: AutoLayout | null): AutoLayout {
  const p = typeof a.padding === 'number' ? { t: a.padding, r: a.padding, b: a.padding, l: a.padding } : a.padding ? { t: a.padding.top ?? 0, r: a.padding.right ?? 0, b: a.padding.bottom ?? 0, l: a.padding.left ?? 0 } : prev?.padding ?? { t: 0, r: 0, b: 0, l: 0 };
  return {
    direction: a.direction ?? prev?.direction ?? 'vertical',
    gap: a.gap ?? prev?.gap ?? 0,
    padding: p,
    align: a.align ?? prev?.align ?? 'start',
    justify: a.justify ?? prev?.justify ?? 'start',
    hugW: a.hugWidth ?? prev?.hugW ?? false,
    hugH: a.hugHeight ?? prev?.hugH ?? false,
    wrap: a.wrap ?? prev?.wrap ?? false,
  };
}

/** Apply the non-structural parts of a spec to a node (mutates). Geometry is handled by callers. */
export function applySpecProps(n: SceneNode, s: Partial<NodeSpec>) {
  if (s.name !== undefined) n.name = s.name;
  if (s.rotation !== undefined) n.rotation = s.rotation;
  if (s.opacity !== undefined) n.opacity = s.opacity > 1 ? s.opacity / 100 : s.opacity;
  if (s.visible !== undefined) n.visible = s.visible;
  if (s.locked !== undefined) n.locked = s.locked;
  if (s.blend !== undefined) n.blend = s.blend;
  if (s.fills) n.fills = s.fills.map(toPaint);
  else if (s.fill !== undefined && n.type !== 'text') n.fills = s.fill === null ? [] : [toPaint(s.fill)];
  if (s.stroke !== undefined) n.strokes = s.stroke === null ? [] : [{ ...(n.strokes[0] ?? defaultStroke()), color: normColor(s.stroke), visible: true }];
  if (s.strokeWidth !== undefined) n.strokes = n.strokes.length ? n.strokes.map((x, i) => (i ? x : { ...x, width: s.strokeWidth! })) : [defaultStroke('#000000', s.strokeWidth)];
  if (s.strokeAlign && n.strokes[0]) n.strokes[0] = { ...n.strokes[0], align: s.strokeAlign };
  if (s.dash !== undefined && n.strokes[0]) n.strokes[0] = { ...n.strokes[0], dash: s.dash };
  if (s.radius !== undefined) {
    n.radius = s.radius;
    n.radii = null;
  }
  if (s.radii) n.radii = s.radii;
  if (s.clip !== undefined) n.clip = s.clip;
  if (s.shadow !== undefined || s.blur !== undefined || s.backgroundBlur !== undefined) {
    let fx: Effect[] = n.effects.filter((e) => {
      if (s.shadow !== undefined && (e.kind === 'drop-shadow' || e.kind === 'inner-shadow')) return false;
      if (s.blur !== undefined && e.kind === 'layer-blur') return false;
      if (s.backgroundBlur !== undefined && e.kind === 'background-blur') return false;
      return true;
    });
    if (s.shadow) fx = [...fx, { ...defaultEffect(s.shadow.inner ? 'inner-shadow' : 'drop-shadow'), x: s.shadow.x ?? 0, y: s.shadow.y ?? 4, blur: s.shadow.blur ?? 12, spread: s.shadow.spread ?? 0, color: normColor(s.shadow.color ?? '#000000'), opacity: s.shadow.opacity ?? 0.2 }];
    if (s.blur) fx = [...fx, { ...defaultEffect('layer-blur'), blur: s.blur }];
    if (s.backgroundBlur) fx = [...fx, { ...defaultEffect('background-blur'), blur: s.backgroundBlur }];
    n.effects = fx;
  }
  if (s.constraints) n.constraints = s.constraints;
  if (s.sides !== undefined) n.sides = Math.max(3, Math.round(s.sides));
  if (s.innerRatio !== undefined) n.innerRatio = s.innerRatio;
  if (s.overflow !== undefined) n.overflow = s.overflow;
  if (s.fixed !== undefined) n.fixed = s.fixed;
  if (s.description !== undefined) n.description = s.description;
  if (s.src !== undefined && n.type === 'image') n.src = s.src;
  if (s.autoLayout !== undefined && (n.type === 'frame' || n.type === 'component')) n.autoLayout = s.autoLayout === null ? null : autoLayoutFrom(s.autoLayout, n.autoLayout);
  if (n.type === 'text' && n.text) {
    const t = { ...n.text };
    if (s.text !== undefined) t.content = s.text;
    if (s.fontSize !== undefined) t.fontSize = s.fontSize;
    if (s.fontWeight !== undefined) t.fontWeight = s.fontWeight;
    if (s.fontFamily !== undefined) t.fontFamily = s.fontFamily;
    if (s.italic !== undefined) t.italic = s.italic;
    if (s.textAlign !== undefined) t.align = s.textAlign;
    if (s.verticalAlign !== undefined) t.vAlign = s.verticalAlign;
    if (s.lineHeight !== undefined) t.lineHeight = s.lineHeight > 4 ? s.lineHeight / t.fontSize : s.lineHeight;
    if (s.letterSpacing !== undefined) t.letterSpacing = s.letterSpacing;
    if (s.textCase !== undefined) t.transform = s.textCase;
    if (s.underline !== undefined) t.underline = s.underline;
    if (s.autoResize !== undefined) t.autoResize = s.autoResize;
    n.text = t;
    const color = s.color ?? (typeof s.fill === 'string' ? s.fill : undefined);
    if (color) n.fills = [solid(normColor(color))];
    else if (s.fill && typeof s.fill === 'object') n.fills = [toPaint(s.fill)];
  }
}

/** Build nodes from a spec tree and insert them into the document (mutates `d`). Returns the root id. */
export function insertSpec(d: DocumentData, pageId: string, spec: NodeSpec, parentId: string | null, index?: number): string {
  const parent = parentId ? d.nodes[parentId] : null;
  const ox = parent?.x ?? 0,
    oy = parent?.y ?? 0;
  const isText = spec.type === 'text';
  const n = createNode(spec.type, {
    x: ox + (spec.x ?? 0),
    y: oy + (spec.y ?? 0),
    w: spec.width ?? (isText ? 200 : spec.type === 'group' ? 0 : 100),
    h: spec.height ?? (isText ? 24 : spec.type === 'line' ? 0 : spec.type === 'group' ? 0 : 100),
    parentId,
  });
  if (spec.type === 'line') {
    n.type = 'path';
    n.name = 'Line';
    n.points = [
      { x: 0, y: 0 },
      { x: n.w, y: n.h },
    ];
    n.closed = false;
    n.h = Math.max(0.01, n.h);
  }
  if (spec.type === 'path') {
    const subs = parsePath(spec.svgPath ?? '');
    if (subs.length === 1) {
      n.points = subs[0].points;
      n.closed = subs[0].closed;
    } else if (subs.length > 1) {
      n.points = [];
      n.closed = true;
      n.rings = subs.map((s) => samplePath(s.points, true));
    }
    normalizePathBox(n, spec.width, spec.height);
    if (!spec.fill && !spec.fills && subs.some((s) => s.closed)) n.fills = [solid('#000000')];
  }
  if (spec.type === 'image' && !spec.src) n.fills = [solid('#d9d9d9')];
  if (spec.type === 'frame' || spec.type === 'component') {
    if (spec.fill === undefined && !spec.fills) n.fills = [solid('#ffffff')];
  }
  applySpecProps(n, spec);
  if (isText && n.text) {
    if (spec.autoResize === undefined) n.text.autoResize = spec.width ? 'height' : 'width';
    if (n.text.autoResize !== 'fixed') Object.assign(n, textBoxSize(n.text, n.w));
  }
  d.nodes[n.id] = n;
  const list = parentId ? d.nodes[parentId].children : d.pages.find((p) => p.id === pageId)!.children;
  if (index === undefined || index < 0 || index > list.length) list.push(n.id);
  else list.splice(index, 0, n.id);
  for (const c of spec.children ?? []) insertSpec(d, pageId, c, n.id);
  if (spec.type === 'group') {
    // groups wrap their children
    if (n.children.length) {
      const kids = n.children.map((c) => d.nodes[c]);
      const x1 = Math.min(...kids.map((k) => k.x)),
        y1 = Math.min(...kids.map((k) => k.y));
      n.x = x1;
      n.y = y1;
      n.w = Math.max(...kids.map((k) => k.x + k.w)) - x1;
      n.h = Math.max(...kids.map((k) => k.y + k.h)) - y1;
    }
  }
  if (n.autoLayout) applyAutoLayout(d.nodes, n.id);
  return n.id;
}

function normalizePathBox(n: SceneNode, w?: number, h?: number) {
  const pts = n.rings?.length ? n.rings.flat() : (n.points ?? []).flatMap((p) => [p, p.cin, p.cout].filter(Boolean) as { x: number; y: number }[]);
  if (!pts.length) return;
  const minX = Math.min(...pts.map((p) => p.x)),
    minY = Math.min(...pts.map((p) => p.y));
  const bw = Math.max(...pts.map((p) => p.x)) - minX || 0.01,
    bh = Math.max(...pts.map((p) => p.y)) - minY || 0.01;
  const sx = w ? w / bw : 1,
    sy = h ? h / bh : 1;
  const f = (p: { x: number; y: number }) => ({ x: (p.x - minX) * sx, y: (p.y - minY) * sy });
  if (n.rings) n.rings = n.rings.map((r) => r.map(f));
  n.points = (n.points ?? []).map((p) => ({ ...f(p), cin: p.cin && f(p.cin), cout: p.cout && f(p.cout) }));
  n.w = bw * sx;
  n.h = bh * sy;
}

/** Update an existing node from a partial spec (mutates). Geometry is relative to its parent. */
export function updateFromSpec(d: DocumentData, id: string, s: Partial<NodeSpec>) {
  const n = d.nodes[id];
  if (!n) throw new Error(`Node ${id} not found`);
  const parent = n.parentId ? d.nodes[n.parentId] : null;
  const ox = parent?.x ?? 0,
    oy = parent?.y ?? 0;
  if (s.x !== undefined || s.y !== undefined || s.width !== undefined || s.height !== undefined) {
    const nx = s.x !== undefined ? ox + s.x : n.x;
    const ny = s.y !== undefined ? oy + s.y : n.y;
    const nw = s.width ?? n.w,
      nh = s.height ?? n.h;
    if (nw !== n.w || nh !== n.h) {
      if (n.type === 'text' && n.text && s.width !== undefined && n.text.autoResize === 'width') n.text = { ...n.text, autoResize: 'height' };
      if (n.type === 'path') {
        const sx = nw / (n.w || 1),
          sy = nh / (n.h || 1);
        if (n.rings) n.rings = n.rings.map((r) => r.map((p) => ({ x: p.x * sx, y: p.y * sy })));
        if (n.points) n.points = n.points.map((p) => ({ x: p.x * sx, y: p.y * sy, cin: p.cin && { x: p.cin.x * sx, y: p.cin.y * sy }, cout: p.cout && { x: p.cout.x * sx, y: p.cout.y * sy } }));
      }
      resizeTree(d.nodes, id, nx, ny, nw, nh);
    } else translateTree(d.nodes, id, nx - n.x, ny - n.y);
  }
  if (s.svgPath && n.type === 'path') {
    const subs = parsePath(s.svgPath);
    if (subs.length === 1) {
      n.points = subs[0].points;
      n.closed = subs[0].closed;
      n.rings = undefined;
    } else if (subs.length) n.rings = subs.map((x) => samplePath(x.points, true));
    normalizePathBox(n, s.width ?? n.w, s.height ?? n.h);
  }
  applySpecProps(n, s);
  if (n.type === 'text' && n.text && n.text.autoResize !== 'fixed' && (s.text !== undefined || s.fontSize !== undefined || s.fontFamily !== undefined || s.fontWeight !== undefined || s.letterSpacing !== undefined || s.width !== undefined)) {
    Object.assign(n, textBoxSize(n.text, n.w));
  }
  if (n.autoLayout) applyAutoLayout(d.nodes, n.id);
  relayoutAncestors(d.nodes, n.parentId);
}

/** Compact JSON view of a node for AI consumption (relative coords, no heavy image data). */
export function describeNode(d: DocumentData, id: string, depth = 0, maxDepth = 3): Record<string, unknown> | null {
  const n = d.nodes[id];
  if (!n) return null;
  const parent = n.parentId ? d.nodes[n.parentId] : null;
  const r = (v: number) => Math.round(v * 100) / 100;
  const out: Record<string, unknown> = {
    id: n.id,
    type: n.type,
    name: n.name,
    x: r(n.x - (parent?.x ?? 0)),
    y: r(n.y - (parent?.y ?? 0)),
    width: r(n.w),
    height: r(n.h),
  };
  if (n.rotation) out.rotation = n.rotation;
  if (n.opacity < 1) out.opacity = n.opacity;
  if (!n.visible) out.visible = false;
  if (n.locked) out.locked = true;
  const fills = n.fills.filter((f) => f.visible).map((f) => (f.kind === 'solid' ? (f.opacity < 1 ? { color: f.color, opacity: f.opacity } : f.color) : f.kind === 'image' ? 'image' : { type: f.kind, angle: f.angle, stops: f.stops }));
  if (fills.length) out.fills = fills;
  const st = n.strokes.find((s) => s.visible);
  if (st) out.stroke = { color: st.color, width: st.width, align: st.align };
  if (n.radius) out.radius = n.radius;
  if (n.effects.length) out.effects = n.effects.filter((e) => e.visible).map((e) => ({ kind: e.kind, x: e.x, y: e.y, blur: e.blur, color: e.color, opacity: e.opacity }));
  if (n.text) out.text = { content: n.text.content, fontFamily: n.text.fontFamily, fontSize: n.text.fontSize, fontWeight: n.text.fontWeight, align: n.text.align, autoResize: n.text.autoResize };
  if (n.autoLayout) out.autoLayout = n.autoLayout;
  if (n.componentId) out.componentId = n.componentId;
  if (n.isComponentSet) out.componentSet = { properties: variantDefs(d.nodes, n.id) };
  if (n.variantProps) out.variantProps = n.variantProps;
  if (n.componentProps?.length) out.componentProperties = n.componentProps.map((p) => ({ id: p.id, name: p.name, type: p.type, default: p.default, layer: p.layer }));
  if (n.type === 'instance' && n.componentId) {
    const set = setOf(d.nodes, n.componentId);
    if (set) out.variant = { set: set.name, current: d.nodes[n.componentId]?.variantProps, options: variantDefs(d.nodes, set.id) };
    const props = componentPropsFor(d.nodes, n.componentId);
    if (props.length) out.properties = Object.fromEntries(props.map((p) => [p.name, n.propValues?.[p.id] ?? p.default]));
    const nested = nestedLayers(d.nodes, n).filter((e) => e.node.type === 'instance' || e.node.type === 'text');
    if (nested.length)
      out.nestedLayers = nested.slice(0, 60).map((e) => ({ path: e.path, type: e.node.type, ...(e.node.type === 'instance' ? { component: d.nodes[e.node.componentId!]?.name } : { text: e.node.text?.content }), ...(n.overrides?.[e.key] ? { overridden: true } : {}) }));
  }
  if (n.prototype?.length) out.interactions = n.prototype;
  if (n.bindings && Object.keys(n.bindings).length) out.bindings = n.bindings;
  if (n.children.length) {
    if (depth < maxDepth) out.children = n.children.map((c) => describeNode(d, c, depth + 1, maxDepth)).filter(Boolean);
    else out.childCount = n.children.length;
  }
  return out;
}

export const newId = uid;
