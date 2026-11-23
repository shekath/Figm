/**
 * Converts the JSON returned by Figma's public REST API (GET /v1/files/:key?geometry=paths)
 * into a Figmy document. Only the documented REST format is supported; the binary .fig
 * format is proprietary and undocumented.
 */
import type { BlendMode, DocumentData, Effect, Paint, PrototypeLink, SceneNode, Stroke, TextStyle } from '../types';
import { createNode, defaultText, emptyDocument, uid } from './factory';
import { parsePath } from './svgImport';
import { samplePath } from './boolean';
import { parseVariantName, pathOf } from './components';
import type { ComponentProp } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type FNode = any;

export interface FigmaImportResult {
  doc: DocumentData;
  stats: { pages: number; nodes: number; skipped: number; images: number; warnings: string[] };
}

const hex2 = (v: number) =>
  Math.round(Math.max(0, Math.min(1, v)) * 255)
    .toString(16)
    .padStart(2, '0');
const toHex = (c: { r: number; g: number; b: number }) => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;

const BLEND: Record<string, BlendMode> = {
  PASS_THROUGH: 'normal',
  NORMAL: 'normal',
  DARKEN: 'darken',
  MULTIPLY: 'multiply',
  LINEAR_BURN: 'color-burn',
  COLOR_BURN: 'color-burn',
  LIGHTEN: 'lighten',
  SCREEN: 'screen',
  LINEAR_DODGE: 'color-dodge',
  COLOR_DODGE: 'color-dodge',
  OVERLAY: 'overlay',
  SOFT_LIGHT: 'overlay',
  HARD_LIGHT: 'overlay',
  DIFFERENCE: 'difference',
  EXCLUSION: 'exclusion',
  HUE: 'hue',
  SATURATION: 'saturation',
  COLOR: 'color',
  LUMINOSITY: 'luminosity',
};

export function convertPaint(p: FNode, images: Record<string, string>): Paint | null {
  const base = { id: uid(), visible: p.visible !== false, opacity: p.opacity ?? 1 };
  switch (p.type) {
    case 'SOLID':
      return { ...base, kind: 'solid', color: toHex(p.color), opacity: (p.opacity ?? 1) * (p.color?.a ?? 1) };
    case 'GRADIENT_LINEAR':
    case 'GRADIENT_ANGULAR':
    case 'GRADIENT_DIAMOND':
    case 'GRADIENT_RADIAL': {
      const h = p.gradientHandlePositions ?? [
        { x: 0, y: 0.5 },
        { x: 1, y: 0.5 },
      ];
      const dir = (Math.atan2(h[1].y - h[0].y, h[1].x - h[0].x) * 180) / Math.PI;
      const stops = (p.gradientStops ?? []).map((s: FNode) => ({ offset: s.position, color: toHex(s.color) }));
      return {
        ...base,
        kind: p.type === 'GRADIENT_RADIAL' || p.type === 'GRADIENT_DIAMOND' ? 'radial' : 'linear',
        color: stops[0]?.color ?? '#000000',
        stops: stops.length >= 2 ? stops : [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
        angle: Math.round(dir + 90),
      };
    }
    case 'IMAGE': {
      const src = p.imageRef ? images[p.imageRef] : undefined;
      if (!src) return { ...base, kind: 'solid', color: '#d9d9d9' };
      return { ...base, kind: 'image', color: '#d9d9d9', src };
    }
    default:
      return null;
  }
}

function convertEffects(list: FNode[] = []): Effect[] {
  return list
    .map((e): Effect | null => {
      const kind = e.type === 'DROP_SHADOW' ? 'drop-shadow' : e.type === 'INNER_SHADOW' ? 'inner-shadow' : e.type === 'LAYER_BLUR' ? 'layer-blur' : e.type === 'BACKGROUND_BLUR' ? 'background-blur' : null;
      if (!kind) return null;
      return {
        id: uid(),
        kind,
        x: e.offset?.x ?? 0,
        y: e.offset?.y ?? 0,
        blur: e.radius ?? 0,
        spread: e.spread ?? 0,
        color: e.color ? toHex(e.color) : '#000000',
        opacity: e.color?.a ?? 0.25,
        visible: e.visible !== false,
      };
    })
    .filter((e): e is Effect => !!e);
}

function convertStrokes(n: FNode): Stroke[] {
  const weight = n.strokeWeight ?? 1;
  return (n.strokes ?? [])
    .filter((p: FNode) => p.type === 'SOLID' || p.type?.startsWith('GRADIENT'))
    .map((p: FNode) => {
      const c = p.type === 'SOLID' ? p.color : p.gradientStops?.[0]?.color ?? { r: 0, g: 0, b: 0, a: 1 };
      return {
        color: toHex(c),
        width: weight,
        opacity: (p.opacity ?? 1) * (c.a ?? 1),
        align: n.strokeAlign === 'OUTSIDE' ? 'outside' : n.strokeAlign === 'CENTER' ? 'center' : 'inside',
        dash: n.strokeDashes?.[0] ?? 0,
        cap: n.strokeCap === 'ROUND' ? 'round' : n.strokeCap === 'SQUARE' ? 'square' : 'butt',
        join: n.strokeJoin === 'ROUND' ? 'round' : n.strokeJoin === 'BEVEL' ? 'bevel' : 'miter',
        visible: p.visible !== false,
      } satisfies Stroke;
    });
}

function convertText(n: FNode): TextStyle {
  const s = n.style ?? {};
  const fontSize = s.fontSize ?? 16;
  const lh = s.lineHeightPx ? s.lineHeightPx / fontSize : s.lineHeightPercentFontSize ? s.lineHeightPercentFontSize / 100 : 1.2;
  return {
    ...defaultText(n.characters ?? ''),
    fontFamily: s.fontFamily ?? 'Inter',
    fontSize,
    fontWeight: s.fontWeight ?? 400,
    italic: !!s.italic,
    letterSpacing: s.letterSpacing ?? 0,
    lineHeight: Math.round(lh * 100) / 100,
    align: s.textAlignHorizontal === 'CENTER' ? 'center' : s.textAlignHorizontal === 'RIGHT' ? 'right' : s.textAlignHorizontal === 'JUSTIFIED' ? 'justify' : 'left',
    vAlign: s.textAlignVertical === 'CENTER' ? 'middle' : s.textAlignVertical === 'BOTTOM' ? 'bottom' : 'top',
    underline: s.textDecoration === 'UNDERLINE',
    strike: s.textDecoration === 'STRIKETHROUGH',
    transform: s.textCase === 'UPPER' ? 'uppercase' : s.textCase === 'LOWER' ? 'lowercase' : s.textCase === 'TITLE' ? 'capitalize' : 'none',
    autoResize: n.style?.textAutoResize === 'WIDTH_AND_HEIGHT' ? 'width' : n.style?.textAutoResize === 'HEIGHT' ? 'height' : 'fixed',
  };
}

const EASE: Record<string, PrototypeLink['easing']> = {
  LINEAR: 'linear',
  EASE_IN: 'ease-in',
  EASE_OUT: 'ease-out',
  EASE_IN_AND_OUT: 'ease-in-out',
  EASE_IN_BACK: 'ease-in-back',
  EASE_OUT_BACK: 'ease-out-back',
  EASE_IN_AND_OUT_BACK: 'ease-in-out',
  GENTLE: 'gentle',
  QUICK: 'spring',
  BOUNCY: 'bouncy',
  SLOW: 'gentle',
  CUSTOM_SPRING: 'spring',
  CUSTOM_CUBIC_BEZIER: 'ease-in-out',
};
const ANIM: Record<string, PrototypeLink['animation']> = {
  INSTANT: 'instant',
  DISSOLVE: 'dissolve',
  SMART_ANIMATE: 'smart-animate',
  MOVE_IN: 'move-in',
  MOVE_OUT: 'move-out',
  PUSH: 'push',
  SLIDE_IN: 'slide-in',
  SLIDE_OUT: 'slide-out',
};
const TRIGGER: Record<string, PrototypeLink['trigger']> = {
  ON_CLICK: 'click',
  ON_HOVER: 'hover',
  ON_PRESS: 'press',
  ON_DRAG: 'click',
  AFTER_TIMEOUT: 'after-delay',
  MOUSE_ENTER: 'mouse-enter',
  MOUSE_LEAVE: 'mouse-leave',
  MOUSE_UP: 'click',
  MOUSE_DOWN: 'press',
  ON_KEY_DOWN: 'key',
};

/** Raw prototype interactions keyed by Figma node id; destination ids are remapped later. */
function rawInteractions(n: FNode): PrototypeLink[] {
  const out: PrototypeLink[] = [];
  for (const it of n.interactions ?? []) {
    const trigger = TRIGGER[it.trigger?.type] ?? 'click';
    for (const a of it.actions ?? []) {
      if (!a) continue;
      const t = a.transition;
      const link: PrototypeLink = {
        trigger,
        targetId: '',
        animation: t ? ANIM[t.type] ?? 'dissolve' : 'instant',
        direction: t?.direction ? (t.direction.toLowerCase() as PrototypeLink['direction']) : undefined,
        easing: t?.easing ? EASE[t.easing.type] ?? 'ease-out' : 'ease-out',
        duration: t?.duration ? Math.round(t.duration * 1000) : 300,
        delay: it.trigger?.delay ? Math.round(it.trigger.delay * 1000) : it.trigger?.timeout ? Math.round(it.trigger.timeout * 1000) : undefined,
      };
      if (a.type === 'BACK') out.push({ ...link, action: 'back', targetId: 'back' });
      else if (a.type === 'CLOSE') out.push({ ...link, action: 'close-overlay', targetId: 'back' });
      else if (a.type === 'URL') out.push({ ...link, action: 'url', targetId: 'back', url: a.url });
      else if (a.type === 'NODE' && a.destinationId) {
        const action = a.navigation === 'OVERLAY' ? 'overlay' : a.navigation === 'SWAP' ? 'swap-overlay' : a.navigation === 'SCROLL_TO' ? 'scroll-to' : a.navigation === 'CHANGE_TO' ? 'change-to' : 'navigate';
        out.push({ ...link, action, targetId: a.destinationId, overlay: action === 'overlay' ? { position: 'center', closeOnOutside: true, background: 'rgba(0,0,0,0.4)' } : undefined });
      }
    }
  }
  // legacy single transition
  if (!out.length && n.transitionNodeID) {
    out.push({
      trigger: 'click',
      action: 'navigate',
      targetId: n.transitionNodeID,
      animation: n.transitionDuration ? 'dissolve' : 'instant',
      easing: EASE[n.transitionEasing] ?? 'ease-out',
      duration: n.transitionDuration ?? 300,
    });
  }
  return out;
}

/** Geometry from Figma vector paths into node-local points/rings. */
function vectorGeometry(paths: FNode[] | undefined): Pick<SceneNode, 'points' | 'closed' | 'rings'> | null {
  if (!paths?.length) return null;
  const subs = paths.flatMap((p: FNode) => parsePath(p.path ?? ''));
  if (!subs.length) return null;
  if (subs.length === 1) return { points: subs[0].points, closed: true };
  return { points: [], closed: true, rings: subs.map((s) => samplePath(s.points, true)) };
}

export function convertFigmaFile(file: FNode, images: Record<string, string> = {}): FigmaImportResult {
  const doc = emptyDocument(file.name ?? 'Imported design');
  doc.pages = [];
  const idMap: Record<string, string> = {};
  const links: { id: string; raw: PrototypeLink[] }[] = [];
  const warnings = new Set<string>();
  const styleUsage: Record<string, Paint> = {};
  let skipped = 0;
  let imageCount = 0;
  const instances: { id: string; componentId: string; props: Record<string, { type: string; value: string | boolean }> }[] = [];
  const propDefs: { id: string; defs: Record<string, { type: string; defaultValue: string | boolean }> }[] = [];
  const refs: Record<string, { visible?: string; characters?: string }> = {};

  const conv = (n: FNode, parentId: string | null): string | null => {
    const box = n.absoluteBoundingBox ?? n.absoluteRenderBounds;
    if (!box && n.type !== 'GROUP') {
      skipped++;
      return null;
    }
    let type: SceneNode['type'];
    switch (n.type) {
      case 'FRAME':
      case 'SECTION':
      case 'COMPONENT_SET':
      case 'INSTANCE':
        type = 'frame';
        break;
      case 'COMPONENT':
        type = 'component';
        break;
      case 'GROUP':
        type = 'group';
        break;
      case 'RECTANGLE':
        type = 'rect';
        break;
      case 'ELLIPSE':
        type = n.fillGeometry?.length && n.arcData && (n.arcData.innerRadius > 0 || n.arcData.endingAngle - n.arcData.startingAngle < 6.28) ? 'path' : 'ellipse';
        break;
      case 'TEXT':
        type = 'text';
        break;
      case 'LINE':
      case 'VECTOR':
      case 'STAR':
      case 'REGULAR_POLYGON':
      case 'BOOLEAN_OPERATION':
        type = 'path';
        break;
      case 'SLICE':
      case 'STICKY':
      case 'CONNECTOR':
      case 'SHAPE_WITH_TEXT':
      case 'WIDGET':
      case 'EMBED':
      case 'LINK_UNFURL':
      case 'TABLE':
      default:
        if (n.type !== 'SLICE') warnings.add(`Unsupported layer type ${n.type} skipped`);
        skipped++;
        return null;
    }

    // size + rotation from relativeTransform when available
    const w = n.size?.x ?? box?.width ?? 0;
    const h = n.size?.y ?? box?.height ?? 0;
    let rotation = 0;
    const m = n.relativeTransform;
    if (m && m[0] && m[1]) rotation = Math.round(((Math.atan2(m[1][0], m[0][0]) * 180) / Math.PI) * 100) / 100;
    if (typeof n.rotation === 'number' && !m) rotation = -n.rotation;
    const cx = box ? box.x + box.width / 2 : 0,
      cy = box ? box.y + box.height / 2 : 0;

    const node = createNode(type, {
      name: n.name ?? type,
      x: cx - w / 2,
      y: cy - h / 2,
      w: Math.max(type === 'path' ? 0.01 : 0, w),
      h: Math.max(type === 'path' ? 0.01 : 0, h),
      rotation: type === 'group' ? 0 : rotation,
      opacity: n.opacity ?? 1,
      blend: BLEND[n.blendMode] ?? 'normal',
      visible: n.visible !== false,
      locked: !!n.locked,
      parentId,
      fills: [],
      strokes: [],
      effects: convertEffects(n.effects),
      radius: n.cornerRadius ?? 0,
    });
    if (n.rectangleCornerRadii) node.radii = n.rectangleCornerRadii as [number, number, number, number];
    if (type !== 'group') {
      node.fills = (n.fills ?? []).map((p: FNode) => convertPaint(p, images)).filter(Boolean) as Paint[];
      node.strokes = convertStrokes(n);
      imageCount += (n.fills ?? []).filter((p: FNode) => p.type === 'IMAGE' && images[p.imageRef]).length;
      if ((n.fills ?? []).some((p: FNode) => p.type === 'IMAGE' && !images[p.imageRef])) warnings.add('Some image fills could not be downloaded and were replaced with grey');
    }
    if (n.styles?.fill && node.fills[0] && !styleUsage[n.styles.fill]) styleUsage[n.styles.fill] = node.fills[0];
    if (type === 'frame' || type === 'component') {
      node.clip = n.clipsContent ?? n.type !== 'SECTION';
      if (n.type === 'SECTION') node.radius = node.radius || 8;
      if (n.type === 'INSTANCE') {
        node.name = n.name;
        // linked later if its main component is in this file and it has no overrides we can't represent
        if (n.componentId && !(n.overrides ?? []).length) instances.push({ id: node.id, componentId: n.componentId, props: n.componentProperties ?? {} });
      }
      if (n.type === 'COMPONENT_SET') {
        node.isComponentSet = true;
        node.clip = false;
      }
      if (n.componentPropertyDefinitions) propDefs.push({ id: node.id, defs: n.componentPropertyDefinitions });
      if (n.layoutMode && n.layoutMode !== 'NONE' && n.layoutMode !== 'GRID') {
        node.autoLayout = {
          direction: n.layoutMode === 'HORIZONTAL' ? 'horizontal' : 'vertical',
          gap: n.itemSpacing ?? 0,
          padding: { t: n.paddingTop ?? 0, r: n.paddingRight ?? 0, b: n.paddingBottom ?? 0, l: n.paddingLeft ?? 0 },
          align: n.counterAxisAlignItems === 'CENTER' ? 'center' : n.counterAxisAlignItems === 'MAX' ? 'end' : 'start',
          justify: n.primaryAxisAlignItems === 'CENTER' ? 'center' : n.primaryAxisAlignItems === 'MAX' ? 'end' : n.primaryAxisAlignItems === 'SPACE_BETWEEN' ? 'space-between' : 'start',
          hugW: n.layoutMode === 'HORIZONTAL' ? n.primaryAxisSizingMode === 'AUTO' : n.counterAxisSizingMode === 'AUTO',
          hugH: n.layoutMode === 'VERTICAL' ? n.primaryAxisSizingMode === 'AUTO' : n.counterAxisSizingMode === 'AUTO',
          wrap: n.layoutWrap === 'WRAP',
        };
      }
      if (n.overflowDirection && n.overflowDirection !== 'NONE') node.overflow = n.overflowDirection === 'HORIZONTAL_SCROLLING' ? 'horizontal' : n.overflowDirection === 'VERTICAL_SCROLLING' ? 'vertical' : 'both';
    }
    if (type === 'text') {
      node.text = convertText(n);
    }
    if (type === 'path') {
      const geo = vectorGeometry(n.fillGeometry);
      if (geo) Object.assign(node, geo);
      else {
        const sg = vectorGeometry(n.strokeGeometry);
        if (sg) {
          // stroke outline: draw it filled with the stroke colour
          Object.assign(node, sg);
          node.fills = node.strokes.map((s) => ({ id: uid(), kind: 'solid' as const, color: s.color, opacity: s.opacity, visible: s.visible }));
          node.strokes = [];
        } else if (n.type === 'LINE') {
          node.points = [
            { x: 0, y: 0 },
            { x: w, y: 0 },
          ];
          node.closed = false;
          node.h = 0.01;
        } else {
          warnings.add('Some vectors had no geometry — re-fetch with geometry=paths for exact shapes');
          node.points = [
            { x: 0, y: 0 },
            { x: w, y: 0 },
            { x: w, y: h },
            { x: 0, y: h },
          ];
          node.closed = true;
        }
      }
    }
    if (n.constraints) {
      const H: Record<string, NonNullable<SceneNode['constraints']>['h']> = { LEFT: 'left', RIGHT: 'right', CENTER: 'center', LEFT_RIGHT: 'left-right', SCALE: 'scale' };
      const V: Record<string, NonNullable<SceneNode['constraints']>['v']> = { TOP: 'top', BOTTOM: 'bottom', CENTER: 'center', TOP_BOTTOM: 'top-bottom', SCALE: 'scale' };
      node.constraints = { h: H[n.constraints.horizontal] ?? 'left', v: V[n.constraints.vertical] ?? 'top' };
    }
    if (n.isMask) node.isMask = true;
    if (n.isFixed) node.fixed = true;

    doc.nodes[node.id] = node;
    idMap[n.id] = node.id;
    if (n.componentPropertyReferences) refs[node.id] = n.componentPropertyReferences;
    const raw = rawInteractions(n);
    if (raw.length) links.push({ id: node.id, raw });

    // children (BOOLEAN_OPERATION children are already baked into fillGeometry)
    if (n.children && n.type !== 'BOOLEAN_OPERATION') {
      for (const c of n.children) {
        const cid = conv(c, node.id);
        if (cid) node.children.push(cid);
      }
    }
    if (type === 'group') {
      if (!node.children.length) {
        delete doc.nodes[node.id];
        return null;
      }
      // fit the group to its children
      let x1 = Infinity,
        y1 = Infinity,
        x2 = -Infinity,
        y2 = -Infinity;
      for (const c of node.children) {
        const k = doc.nodes[c];
        x1 = Math.min(x1, k.x);
        y1 = Math.min(y1, k.y);
        x2 = Math.max(x2, k.x + k.w);
        y2 = Math.max(y2, k.y + k.h);
      }
      Object.assign(node, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    }
    return node.id;
  };

  for (const canvas of file.document?.children ?? []) {
    if (canvas.type !== 'CANVAS') continue;
    const page = { id: uid(), name: canvas.name ?? 'Page', children: [] as string[], background: canvas.backgroundColor ? toHex(canvas.backgroundColor) : '#f5f5f5', startFrameId: undefined as string | undefined };
    for (const c of canvas.children ?? []) {
      const id = conv(c, null);
      if (id) page.children.push(id);
    }
    doc.pages.push(page);
    const start = canvas.flowStartingPoints?.[0]?.nodeId ?? canvas.prototypeStartNodeID;
    if (start) (page as { startFrameId?: string }).startFrameId = start; // remapped below
  }
  if (!doc.pages.length) doc.pages.push({ id: uid(), name: 'Page 1', children: [], background: '#f5f5f5' });

  for (const p of doc.pages) if (p.startFrameId) p.startFrameId = idMap[p.startFrameId];
  for (const { id, raw } of links) {
    const mapped = raw
      .map((l) => (l.targetId === 'back' ? l : idMap[l.targetId] ? { ...l, targetId: idMap[l.targetId] } : null))
      .filter((l): l is PrototypeLink => !!l);
    if (mapped.length) doc.nodes[id].prototype = mapped;
  }
  // shared fill styles -> colour styles
  for (const [styleId, meta] of Object.entries<FNode>(file.styles ?? {})) {
    if (meta.styleType === 'FILL' && styleUsage[styleId]) doc.colorStyles.push({ id: uid(), name: meta.name, paint: { ...styleUsage[styleId], id: uid() } });
  }
  // variants: components inside sets carry their property values in their names ("State=Hover, Size=L")
  for (const n of Object.values(doc.nodes)) {
    if (!n.isComponentSet) continue;
    for (const c of n.children) {
      const v = doc.nodes[c];
      if (v?.type === 'component') v.variantProps = parseVariantName(v.name) ?? { Variant: v.name };
    }
  }
  // boolean / text component properties (property id = Figma property key, so instance values map 1:1)
  for (const { id, defs } of propDefs) {
    const owner = doc.nodes[id];
    if (!owner) continue;
    const root = owner.isComponentSet ? owner.children[0] : owner.id;
    if (!root) continue;
    const props: ComponentProp[] = [];
    for (const [key, def] of Object.entries(defs)) {
      if (def.type !== 'BOOLEAN' && def.type !== 'TEXT') continue;
      const field = def.type === 'BOOLEAN' ? 'visible' : 'characters';
      const layerId = [root, ...descendantIds(doc.nodes, root)].find((x) => refs[x]?.[field] === key);
      const layer = layerId ? pathOf(doc.nodes, root, layerId) : null;
      if (layer === null || layer === '') continue;
      props.push({ id: key, name: key.split('#')[0], type: def.type === 'BOOLEAN' ? 'boolean' : 'text', default: def.defaultValue, layer });
    }
    if (props.length) owner.componentProps = props;
  }
  // re-link instances whose main component was imported
  for (const inst of instances) {
    const compId = idMap[inst.componentId];
    const node = doc.nodes[inst.id];
    if (!compId || doc.nodes[compId]?.type !== 'component' || !node) continue;
    for (const c of descendantIds(doc.nodes, inst.id)) delete doc.nodes[c];
    node.children = [];
    node.type = 'instance';
    node.componentId = compId;
    node.fills = [];
    node.strokes = [];
    node.autoLayout = null;
    node.overrides = {};
    const pv: Record<string, string | boolean> = {};
    for (const [k, v] of Object.entries(inst.props)) if (v.type === 'BOOLEAN' || v.type === 'TEXT') pv[k] = v.value;
    if (Object.keys(pv).length) node.propValues = pv;
  }

  // component descriptions
  for (const [fid, meta] of Object.entries<FNode>(file.components ?? {})) {
    const id = idMap[fid];
    if (id && doc.nodes[id] && meta.description) doc.nodes[id].description = meta.description;
  }

  return {
    doc,
    stats: { pages: doc.pages.length, nodes: Object.keys(doc.nodes).length, skipped, images: imageCount, warnings: [...warnings] },
  };
}

/** Extract the file key from a Figma URL (or accept a bare key). */
export function parseFigmaKey(input: string): string | null {
  const s = input.trim();
  const m = s.match(/figma\.com\/(?:file|design|proto|board)\/([a-zA-Z0-9]+)(?:\/branch\/([a-zA-Z0-9]+))?/);
  if (m) return m[2] ?? m[1];
  return /^[a-zA-Z0-9]{10,}$/.test(s) ? s : null;
}

/** All image refs used by IMAGE paints in a file. */
export function collectImageRefs(file: FNode): string[] {
  const refs = new Set<string>();
  const walk = (n: FNode) => {
    for (const p of [...(n.fills ?? []), ...(n.background ?? [])]) if (p?.type === 'IMAGE' && p.imageRef) refs.add(p.imageRef);
    (n.children ?? []).forEach(walk);
  };
  walk(file.document ?? {});
  return [...refs];
}

function descendantIds(nodes: Record<string, SceneNode>, id: string): string[] {
  const out: string[] = [];
  const walk = (i: string) => (nodes[i]?.children ?? []).forEach((c) => (out.push(c), walk(c)));
  walk(id);
  return out;
}
