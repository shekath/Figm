/**
 * Import of local `.fig` files.
 *
 * Container: either a zip (canvas.fig + images/<hash> + meta.json) or a bare canvas file:
 *   "fig-kiwi" magic (8 bytes) · uint32 version · [uint32 length · chunk]*
 *   chunk 0 = compressed kiwi schema, chunk 1 = compressed message (deflate-raw or zstd).
 * The message holds `nodeChanges` (the layer tree) and `blobs` (vector path data).
 *
 * The format is private and undocumented, so every field is treated as optional: anything
 * unknown is skipped and reported as a warning instead of producing broken layers.
 */
import { unzipSync, inflateSync } from 'fflate';
import { decompress as zstdDecompress } from 'fzstd';
import type { BlendMode, ComponentProp, Effect, Paint, PrototypeLink, SceneNode, Stroke } from '../types';
import { createNode, defaultText, emptyDocument, uid } from './factory';
import { decodeCommands, decodeMessage, decodeSchema } from './kiwi';
import { parsePath } from './svgImport';
import { samplePath } from './boolean';
import { parseVariantName } from './components';
import type { FigmaImportResult } from './figmaImport';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const MAGICS = ['fig-kiwi', 'fig-jam.', 'fig-deck'];

function decompress(chunk: Uint8Array): Uint8Array {
  if (chunk[0] === 0x28 && chunk[1] === 0xb5 && chunk[2] === 0x2f && chunk[3] === 0xfd) return zstdDecompress(chunk);
  try {
    return inflateSync(chunk);
  } catch {
    return chunk; // already uncompressed
  }
}

export interface FigArchive {
  message: Record<string, Any>;
  images: Record<string, Uint8Array>;
  version: number;
}

export function readFigArchive(data: Uint8Array): FigArchive {
  let canvas = data;
  const images: Record<string, Uint8Array> = {};
  if (data[0] === 0x50 && data[1] === 0x4b) {
    const files = unzipSync(data);
    const name = Object.keys(files).find((f) => /(^|\/)canvas\.fig$/.test(f));
    if (!name) throw new Error('This .fig archive has no canvas.fig inside');
    canvas = files[name];
    for (const [f, bytes] of Object.entries(files)) {
      const m = f.match(/(?:^|\/)images\/([0-9a-f]+)$/i);
      if (m) images[m[1].toLowerCase()] = bytes;
    }
  }
  const magic = new TextDecoder().decode(canvas.subarray(0, 8));
  if (!MAGICS.includes(magic)) throw new Error('Not a Figma .fig file (unrecognised header)');
  const dv = new DataView(canvas.buffer, canvas.byteOffset, canvas.byteLength);
  const version = dv.getUint32(8, true);
  const chunks: Uint8Array[] = [];
  let off = 12;
  while (off + 4 <= canvas.length) {
    const len = dv.getUint32(off, true);
    off += 4;
    if (off + len > canvas.length) throw new Error('The .fig file is truncated');
    chunks.push(canvas.subarray(off, off + len));
    off += len;
  }
  if (chunks.length < 2) throw new Error('The .fig file has no design data');
  const schema = decodeSchema(decompress(chunks[0]));
  const message = decodeMessage(schema, decompress(chunks[1]));
  return { message, images, version };
}

/* ---------- conversion ---------- */

const hex2 = (v: number) =>
  Math.round(Math.max(0, Math.min(1, v ?? 0)) * 255)
    .toString(16)
    .padStart(2, '0');
const toHex = (c: Any) => (c ? `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}` : '#000000');
const guidKey = (g: Any) => (g ? `${g.sessionID ?? 0}:${g.localID ?? 0}` : '');
const hashHex = (h: Any) => (h instanceof Uint8Array || Array.isArray(h) ? Array.from(h as ArrayLike<number>, (b) => b.toString(16).padStart(2, '0')).join('') : typeof h === 'string' ? h.toLowerCase() : '');

const BLEND: Record<string, BlendMode> = { PASS_THROUGH: 'normal', NORMAL: 'normal', DARKEN: 'darken', MULTIPLY: 'multiply', COLOR_BURN: 'color-burn', LINEAR_BURN: 'color-burn', LIGHTEN: 'lighten', SCREEN: 'screen', COLOR_DODGE: 'color-dodge', LINEAR_DODGE: 'color-dodge', OVERLAY: 'overlay', SOFT_LIGHT: 'overlay', HARD_LIGHT: 'overlay', DIFFERENCE: 'difference', EXCLUSION: 'exclusion', HUE: 'hue', SATURATION: 'saturation', COLOR: 'color', LUMINOSITY: 'luminosity' };

function imageDataUrl(bytes: Uint8Array): string {
  const mime = bytes[0] === 0x89 ? 'image/png' : bytes[0] === 0xff ? 'image/jpeg' : bytes[0] === 0x47 ? 'image/gif' : bytes[0] === 0x52 ? 'image/webp' : 'image/png';
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

/** 2×3 affine matrices as [a, b, c, d, e, f] (x' = a x + c y + e, y' = b x + d y + f). */
type M = [number, number, number, number, number, number];
const IDENT: M = [1, 0, 0, 1, 0, 0];
const mul = (p: M, q: M): M => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];
const fromFig = (t: Any): M => (t ? [t.m00 ?? 1, t.m10 ?? 0, t.m01 ?? 0, t.m11 ?? 1, t.m02 ?? 0, t.m12 ?? 0] : IDENT);
const apply = (m: M, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

export function convertFigArchive(arc: FigArchive): FigmaImportResult {
  const warnings = new Set<string>();
  const changes: Any[] = Array.isArray(arc.message.nodeChanges) ? arc.message.nodeChanges : [];
  const blobs: Uint8Array[] = (Array.isArray(arc.message.blobs) ? arc.message.blobs : []).map((b: Any) => b?.bytes ?? new Uint8Array());
  if (!changes.length) throw new Error('The .fig file contains no layers');

  // index by guid and build children lists ordered by fractional position
  const byKey = new Map<string, Any>();
  const kids = new Map<string, Any[]>();
  for (const c of changes) {
    if (!c?.guid || c.phase === 'REMOVED') continue;
    byKey.set(guidKey(c.guid), c);
  }
  for (const c of byKey.values()) {
    const p = guidKey(c.parentIndex?.guid);
    if (!p) continue;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p)!.push(c);
  }
  for (const list of kids.values()) list.sort((a, b) => String(a.parentIndex?.position ?? '').localeCompare(String(b.parentIndex?.position ?? '')));

  const doc = emptyDocument(String(arc.message.name ?? 'Imported .fig'));
  doc.pages = [];
  const idMap = new Map<string, string>(); // fig guid -> figmy id
  const instances: { id: string; c: Any }[] = [];
  const links: { id: string; c: Any }[] = [];
  let skipped = 0,
    imageCount = 0;

  const paints = (list: Any[] | undefined, w: number, h: number): Paint[] =>
    (list ?? [])
      .map((p: Any): Paint | null => {
        const base = { id: uid(), visible: p.visible !== false, opacity: p.opacity ?? 1 };
        switch (p.type) {
          case 'SOLID':
            return { ...base, kind: 'solid', color: toHex(p.color), opacity: (p.opacity ?? 1) * (p.color?.a ?? 1) };
          case 'GRADIENT_LINEAR':
          case 'GRADIENT_RADIAL':
          case 'GRADIENT_ANGULAR':
          case 'GRADIENT_DIAMOND': {
            const stops = (p.stops ?? []).map((s: Any) => ({ offset: s.position ?? 0, color: toHex(s.color) }));
            // gradient transform maps node space → gradient space; derive the direction from it
            const t = p.transform;
            const angle = t ? Math.round((Math.atan2(t.m10 ?? 0, t.m00 ?? 1) * 180) / Math.PI) + 90 : 90;
            return { ...base, kind: p.type === 'GRADIENT_LINEAR' ? 'linear' : 'radial', color: stops[0]?.color ?? '#000000', stops: stops.length >= 2 ? stops : [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }], angle };
          }
          case 'IMAGE': {
            const key = hashHex(p.image?.hash);
            const bytes = key ? arc.images[key] : undefined;
            if (!bytes) {
              warnings.add('Some images were not embedded in the .fig file and were replaced with grey');
              return { ...base, kind: 'solid', color: '#d9d9d9' };
            }
            imageCount++;
            void w;
            void h;
            return { ...base, kind: 'image', color: '#d9d9d9', src: imageDataUrl(bytes) };
          }
          default:
            if (p.type) warnings.add(`Unsupported paint type ${p.type} skipped`);
            return null;
        }
      })
      .filter((p): p is Paint => !!p);

  const strokes = (c: Any): Stroke[] =>
    (c.strokePaints ?? [])
      .filter((p: Any) => p.type === 'SOLID' || String(p.type).startsWith('GRADIENT'))
      .map((p: Any) => {
        const col = p.type === 'SOLID' ? p.color : p.stops?.[0]?.color;
        return {
          color: toHex(col),
          width: c.strokeWeight ?? 1,
          opacity: (p.opacity ?? 1) * (col?.a ?? 1),
          align: c.strokeAlign === 'OUTSIDE' ? 'outside' : c.strokeAlign === 'CENTER' ? 'center' : 'inside',
          dash: Array.isArray(c.dashPattern) && c.dashPattern.length ? c.dashPattern[0] : 0,
          cap: c.strokeCap === 'ROUND' ? 'round' : c.strokeCap === 'SQUARE' ? 'square' : 'butt',
          join: c.strokeJoin === 'ROUND' ? 'round' : c.strokeJoin === 'BEVEL' ? 'bevel' : 'miter',
          visible: p.visible !== false,
        } satisfies Stroke;
      });

  const effects = (list: Any[] | undefined): Effect[] =>
    (list ?? [])
      .map((e: Any): Effect | null => {
        const kind = e.type === 'DROP_SHADOW' ? 'drop-shadow' : e.type === 'INNER_SHADOW' ? 'inner-shadow' : e.type === 'FOREGROUND_BLUR' || e.type === 'LAYER_BLUR' ? 'layer-blur' : e.type === 'BACKGROUND_BLUR' ? 'background-blur' : null;
        if (!kind) return null;
        return { id: uid(), kind, x: e.offset?.x ?? 0, y: e.offset?.y ?? 0, blur: e.radius ?? 0, spread: e.spread ?? 0, color: toHex(e.color), opacity: e.color?.a ?? 0.25, visible: e.visible !== false };
      })
      .filter((e): e is Effect => !!e);

  const geometry = (list: Any[] | undefined): Pick<SceneNode, 'points' | 'closed' | 'rings'> | null => {
    const subs = (list ?? []).flatMap((g: Any) => {
      const blob = typeof g.commandsBlob === 'number' ? blobs[g.commandsBlob] : undefined;
      if (!blob) return [];
      try {
        return parsePath(decodeCommands(blob));
      } catch {
        warnings.add('Some vector paths could not be decoded');
        return [];
      }
    });
    if (!subs.length) return null;
    if (subs.length === 1) return { points: subs[0].points, closed: true };
    return { points: [], closed: true, rings: subs.map((s) => samplePath(s.points, true)) };
  };

  const conv = (c: Any, parentId: string | null, parentAbs: M, depth: number): string | null => {
    if (depth > 200) return null;
    if (c.visible === false && c.type === 'SLICE') return null;
    let type: SceneNode['type'];
    switch (c.type) {
      case 'FRAME':
      case 'SECTION':
        type = 'frame';
        break;
      case 'SYMBOL':
        type = 'component';
        break;
      case 'INSTANCE':
        type = 'frame'; // linked to its component below when possible
        break;
      case 'GROUP':
        type = 'group';
        break;
      case 'RECTANGLE':
      case 'ROUNDED_RECTANGLE':
        type = 'rect';
        break;
      case 'ELLIPSE':
        type = 'ellipse';
        break;
      case 'TEXT':
        type = 'text';
        break;
      case 'VECTOR':
      case 'STAR':
      case 'LINE':
      case 'REGULAR_POLYGON':
      case 'BOOLEAN_OPERATION':
        type = 'path';
        break;
      default:
        if (c.type && c.type !== 'SLICE') warnings.add(`Unsupported layer type ${c.type} skipped`);
        skipped++;
        return null;
    }
    const w = c.size?.x ?? 0,
      h = c.size?.y ?? 0;
    const abs = mul(parentAbs, fromFig(c.transform));
    const center = apply(abs, w / 2, h / 2);
    const rotation = Math.round(((Math.atan2(abs[1], abs[0]) * 180) / Math.PI) * 100) / 100;
    const flip = abs[0] * abs[3] - abs[1] * abs[2] < 0;

    const n = createNode(type, {
      name: String(c.name ?? type),
      x: center.x - w / 2,
      y: center.y - h / 2,
      w: Math.max(type === 'path' ? 0.01 : 0, w),
      h: Math.max(type === 'path' ? 0.01 : 0, h),
      rotation: type === 'group' ? 0 : rotation,
      flipY: flip || undefined,
      opacity: c.opacity ?? 1,
      blend: BLEND[c.blendMode] ?? 'normal',
      visible: c.visible !== false,
      locked: !!c.locked,
      parentId,
      fills: type === 'group' ? [] : paints(c.fillPaints, w, h),
      strokes: type === 'group' ? [] : strokes(c),
      effects: effects(c.effects),
      radius: c.cornerRadius ?? 0,
    });
    if (c.rectangleCornerRadiiIndependent || c.rectangleTopLeftCornerRadius !== undefined)
      n.radii = [c.rectangleTopLeftCornerRadius ?? n.radius, c.rectangleTopRightCornerRadius ?? n.radius, c.rectangleBottomRightCornerRadius ?? n.radius, c.rectangleBottomLeftCornerRadius ?? n.radius];
    if (type === 'frame' || type === 'component') {
      n.clip = c.type === 'SECTION' ? false : !c.frameMaskDisabled;
      if (c.stackMode === 'HORIZONTAL' || c.stackMode === 'VERTICAL') {
        const padH = c.stackHorizontalPadding ?? c.stackPadding ?? 0,
          padV = c.stackVerticalPadding ?? c.stackPadding ?? 0;
        n.autoLayout = {
          direction: c.stackMode === 'HORIZONTAL' ? 'horizontal' : 'vertical',
          gap: c.stackSpacing ?? 0,
          padding: { t: padV, r: c.stackPaddingRight ?? padH, b: c.stackPaddingBottom ?? padV, l: padH },
          align: c.stackCounterAlignItems === 'CENTER' ? 'center' : c.stackCounterAlignItems === 'MAX' ? 'end' : 'start',
          justify: c.stackPrimaryAlignItems === 'CENTER' ? 'center' : c.stackPrimaryAlignItems === 'MAX' ? 'end' : c.stackPrimaryAlignItems === 'SPACE_BETWEEN' || c.stackPrimaryAlignItems === 'SPACE_EVENLY' ? 'space-between' : 'start',
          hugW: c.stackMode === 'HORIZONTAL' ? c.stackPrimarySizing === 'RESIZE_TO_FIT' || c.stackPrimarySizing === 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE' : c.stackCounterSizing === 'RESIZE_TO_FIT' || c.stackCounterSizing === 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE',
          hugH: c.stackMode === 'VERTICAL' ? c.stackPrimarySizing === 'RESIZE_TO_FIT' || c.stackPrimarySizing === 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE' : c.stackCounterSizing === 'RESIZE_TO_FIT' || c.stackCounterSizing === 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE',
          wrap: c.stackWrap === 'WRAP',
        };
      }
      if (c.scrollDirection && c.scrollDirection !== 'NONE') n.overflow = c.scrollDirection === 'HORIZONTAL' ? 'horizontal' : c.scrollDirection === 'VERTICAL' ? 'vertical' : 'both';
    }
    if (type === 'text') {
      const fontSize = c.fontSize ?? 16;
      const lh = c.lineHeight?.units === 'PIXELS' ? c.lineHeight.value / fontSize : c.lineHeight?.units === 'PERCENT' ? c.lineHeight.value / 100 : 1.2;
      const style = String(c.fontName?.style ?? 'Regular');
      const weight = /thin/i.test(style) ? 100 : /extra ?light/i.test(style) ? 200 : /light/i.test(style) ? 300 : /medium/i.test(style) ? 500 : /semi ?bold/i.test(style) ? 600 : /extra ?bold/i.test(style) ? 800 : /black|heavy/i.test(style) ? 900 : /bold/i.test(style) ? 700 : 400;
      n.text = {
        ...defaultText(String(c.textData?.characters ?? '')),
        fontFamily: String(c.fontName?.family ?? 'Inter'),
        fontSize,
        fontWeight: weight,
        italic: /italic/i.test(style),
        lineHeight: Math.round(lh * 100) / 100,
        letterSpacing: c.letterSpacing?.units === 'PERCENT' ? (c.letterSpacing.value / 100) * fontSize : c.letterSpacing?.value ?? 0,
        align: c.textAlignHorizontal === 'CENTER' ? 'center' : c.textAlignHorizontal === 'RIGHT' ? 'right' : c.textAlignHorizontal === 'JUSTIFIED' ? 'justify' : 'left',
        vAlign: c.textAlignVertical === 'CENTER' ? 'middle' : c.textAlignVertical === 'BOTTOM' ? 'bottom' : 'top',
        underline: c.textDecoration === 'UNDERLINE',
        strike: c.textDecoration === 'STRIKETHROUGH',
        transform: c.textCase === 'UPPER' ? 'uppercase' : c.textCase === 'LOWER' ? 'lowercase' : c.textCase === 'TITLE' ? 'capitalize' : 'none',
        autoResize: c.textAutoResize === 'WIDTH_AND_HEIGHT' ? 'width' : c.textAutoResize === 'HEIGHT' ? 'height' : 'fixed',
      };
      if ((c.textData?.styleOverrideTable ?? []).length) warnings.add('Mixed text styles inside one text layer were simplified to the layer’s main style');
    }
    if (type === 'path') {
      const geo = geometry(c.fillGeometry) ?? null;
      if (geo) Object.assign(n, geo);
      else {
        const sg = geometry(c.strokeGeometry);
        if (sg) {
          Object.assign(n, sg);
          n.fills = n.strokes.map((s) => ({ id: uid(), kind: 'solid' as const, color: s.color, opacity: s.opacity, visible: s.visible }));
          n.strokes = [];
        } else if (c.type === 'LINE') {
          n.points = [
            { x: 0, y: 0 },
            { x: w, y: 0 },
          ];
          n.closed = false;
          n.h = 0.01;
        } else {
          warnings.add('Some vectors had no stored geometry and were drawn as their bounding box');
          n.points = [
            { x: 0, y: 0 },
            { x: w, y: 0 },
            { x: w, y: h },
            { x: 0, y: h },
          ];
          n.closed = true;
        }
      }
    }
    if (c.mask) n.isMask = true;

    doc.nodes[n.id] = n;
    idMap.set(guidKey(c.guid), n.id);
    if (c.type === 'INSTANCE') instances.push({ id: n.id, c });
    if (Array.isArray(c.prototypeInteractions) && c.prototypeInteractions.length) links.push({ id: n.id, c });

    for (const k of kids.get(guidKey(c.guid)) ?? []) {
      try {
        const cid = conv(k, n.id, abs, depth + 1);
        if (cid) n.children.push(cid);
      } catch (e) {
        skipped++;
        warnings.add(`A layer could not be converted (${(e as Error).message})`);
      }
    }
    if (type === 'group') {
      if (!n.children.length) {
        delete doc.nodes[n.id];
        return null;
      }
      const ks = n.children.map((id) => doc.nodes[id]);
      const x1 = Math.min(...ks.map((k) => k.x)),
        y1 = Math.min(...ks.map((k) => k.y));
      Object.assign(n, { x: x1, y: y1, w: Math.max(...ks.map((k) => k.x + k.w)) - x1, h: Math.max(...ks.map((k) => k.y + k.h)) - y1 });
    }
    return n.id;
  };

  // pages = CANVAS children of the DOCUMENT
  const docNode = [...byKey.values()].find((c) => c.type === 'DOCUMENT');
  const canvases = (docNode ? kids.get(guidKey(docNode.guid)) ?? [] : [...byKey.values()].filter((c) => c.type === 'CANVAS')).filter((c) => c.type === 'CANVAS');
  for (const cv of canvases) {
    if (cv.internalOnly) continue; // Figma's hidden internal page (e.g. component storage)
    const page = { id: uid(), name: String(cv.name ?? 'Page'), children: [] as string[], background: cv.backgroundColor ? toHex(cv.backgroundColor) : '#f5f5f5' };
    for (const k of kids.get(guidKey(cv.guid)) ?? []) {
      try {
        const id = conv(k, null, IDENT, 0);
        if (id) page.children.push(id);
      } catch (e) {
        skipped++;
        warnings.add(`A layer could not be converted (${(e as Error).message})`);
      }
    }
    doc.pages.push(page);
  }
  // components that live on Figma's internal page are still needed by instances
  for (const cv of canvases.filter((c) => c.internalOnly)) {
    const hidden = { id: uid(), name: 'Imported components', children: [] as string[], background: '#f5f5f5' };
    for (const k of kids.get(guidKey(cv.guid)) ?? []) {
      const id = conv(k, null, IDENT, 0);
      if (id) hidden.children.push(id);
    }
    if (hidden.children.length) doc.pages.push(hidden);
  }
  if (!doc.pages.length) throw new Error('No pages found in the .fig file');

  // component sets: frames whose children are all components named "Prop=Value"
  for (const n of Object.values(doc.nodes)) {
    if (n.type !== 'frame' || !n.children.length) continue;
    const vs = n.children.map((c) => doc.nodes[c]);
    if (vs.every((v) => v.type === 'component' && parseVariantName(v.name))) {
      n.isComponentSet = true;
      for (const v of vs) v.variantProps = parseVariantName(v.name)!;
    }
  }

  // component properties (boolean / text / instance swap) from definitions + layer references
  for (const c of byKey.values()) {
    const owner = idMap.get(guidKey(c.guid));
    const defs: Any[] = c.componentPropDefs ?? [];
    if (!owner || !defs.length) continue;
    const props: ComponentProp[] = [];
    const ownerNode = doc.nodes[owner];
    const root = ownerNode.isComponentSet ? ownerNode.children[0] : owner;
    for (const d of defs) {
      const kind = d.type === 'BOOL' || d.type === 'BOOLEAN' ? 'boolean' : d.type === 'TEXT' ? 'text' : d.type === 'INSTANCE_SWAP' ? 'instance-swap' : null;
      if (!kind || !root) continue;
      const defId = guidKey(d.id);
      // find the layer referencing this property
      let layerPath: string | null = null;
      const walk = (figNode: Any, path: string[]) => {
        for (const r of figNode.componentPropRefs ?? []) if (guidKey(r.defID) === defId) layerPath = path.join('/');
        for (const k of kids.get(guidKey(figNode.guid)) ?? []) if (!layerPath) walk(k, [...path, String(k.name ?? '')]);
      };
      const rootFig = [...byKey.values()].find((x) => idMap.get(guidKey(x.guid)) === root);
      if (rootFig) for (const k of kids.get(guidKey(rootFig.guid)) ?? []) walk(k, [String(k.name ?? '')]);
      if (!layerPath) continue;
      const dv = d.initialValue ?? {};
      const dflt = kind === 'boolean' ? dv.boolValue ?? true : kind === 'text' ? dv.textValue?.characters ?? '' : idMap.get(guidKey(dv.guidValue)) ?? '';
      props.push({ id: defId, name: String(d.name ?? 'Property'), type: kind, default: dflt, layer: layerPath, ...(kind === 'instance-swap' ? { preferred: [String(dflt)] } : {}) });
    }
    if (props.length) ownerNode.componentProps = props;
  }

  // link instances to their components (+ overrides keyed by the nested guid path)
  for (const { id, c } of instances) {
    const node = doc.nodes[id];
    const compId = idMap.get(guidKey(c.symbolData?.symbolID));
    if (!node || !compId || doc.nodes[compId]?.type !== 'component') {
      warnings.add('Some instances’ main components are in another file (library); they were imported as editable frames');
      continue;
    }
    const removeTree = (nid: string) => {
      for (const k of doc.nodes[nid]?.children ?? []) removeTree(k);
      if (nid !== id) delete doc.nodes[nid];
    };
    removeTree(id);
    node.children = [];
    Object.assign(node, { type: 'instance', componentId: compId, fills: [], strokes: [], autoLayout: null, overrides: {} });
    for (const o of c.symbolData?.symbolOverrides ?? []) {
      const path = (o.guidPath?.guids ?? []).map((g: Any) => idMap.get(guidKey(g)));
      if (!path.length || path.some((p: string | undefined) => !p)) continue;
      const patch: Partial<SceneNode> = {};
      const target = doc.nodes[path[path.length - 1]];
      if (o.textData?.characters !== undefined && target?.text) patch.text = { ...target.text, content: String(o.textData.characters) };
      if (o.visible !== undefined) patch.visible = !!o.visible;
      if (o.fillPaints) patch.fills = paints(o.fillPaints, target?.w ?? 0, target?.h ?? 0);
      if (o.overriddenSymbolID) {
        const swap = idMap.get(guidKey(o.overriddenSymbolID));
        if (swap) patch.componentId = swap;
      }
      if (Object.keys(patch).length) node.overrides![path.join('/')] = patch;
    }
    const pv: Record<string, string | boolean> = {};
    for (const a of c.componentPropAssignments ?? []) {
      const v = a.value ?? {};
      pv[guidKey(a.defID)] = v.boolValue ?? v.textValue?.characters ?? idMap.get(guidKey(v.guidValue)) ?? '';
    }
    if (Object.keys(pv).length) node.propValues = pv;
  }

  // prototype links (navigate / overlay / back / change-to)
  for (const { id, c } of links) {
    const out: PrototypeLink[] = [];
    for (const it of c.prototypeInteractions ?? []) {
      const ev = it.event?.interactionType;
      const trigger: PrototypeLink['trigger'] = ev === 'ON_HOVER' ? 'hover' : ev === 'ON_PRESS' ? 'press' : ev === 'AFTER_TIMEOUT' ? 'after-delay' : ev === 'MOUSE_ENTER' ? 'mouse-enter' : ev === 'MOUSE_LEAVE' ? 'mouse-leave' : 'click';
      for (const a of it.actions ?? []) {
        const target = idMap.get(guidKey(a.transitionNodeID));
        const nav = a.navigationType;
        const anim: PrototypeLink['animation'] = a.transitionType === 'SMART_ANIMATE' || a.transitionType === 'MAGIC_MOVE' ? 'smart-animate' : a.transitionType === 'DISSOLVE' ? 'dissolve' : a.transitionType === 'INSTANT_TRANSITION' ? 'instant' : String(a.transitionType ?? '').startsWith('MOVE_FROM') ? 'move-in' : String(a.transitionType ?? '').startsWith('PUSH') ? 'push' : String(a.transitionType ?? '').startsWith('SLIDE_FROM') ? 'slide-in' : 'dissolve';
        const base = { trigger, animation: anim, duration: Math.round((a.transitionDuration ?? 0.3) * 1000), easing: 'ease-out' as const };
        if (a.connectionType === 'BACK') out.push({ ...base, action: 'back', targetId: 'back' });
        else if (a.connectionType === 'URL' && a.connectionURL) out.push({ ...base, action: 'url', targetId: 'back', url: String(a.connectionURL) });
        else if (target) out.push({ ...base, action: nav === 'OVERLAY' ? 'overlay' : nav === 'SWAP' ? 'swap-overlay' : nav === 'SCROLL_TO' ? 'scroll-to' : nav === 'CHANGE_TO' ? 'change-to' : 'navigate', targetId: target });
      }
    }
    if (out.length) doc.nodes[id].prototype = out;
  }

  return { doc, stats: { pages: doc.pages.length, nodes: Object.keys(doc.nodes).length, skipped, images: imageCount, warnings: [...warnings] } };
}

export function importFigFile(bytes: Uint8Array): FigmaImportResult {
  return convertFigArchive(readFigArchive(bytes));
}
