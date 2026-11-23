// Figmy Importer — recreates a .figmy document as native Figma layers via the Plugin API.
// Load in Figma desktop: Plugins → Development → Import plugin from manifest… → figma-plugin/manifest.json
/* global figma, __html__ */

figma.showUI(__html__, { width: 360, height: 300 });

const warnings = new Set();
const hexToRgb = (hex) => {
  const h = String(hex || '#000000').replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16) / 255 || 0, g: parseInt(h.slice(2, 4), 16) / 255 || 0, b: parseInt(h.slice(4, 6), 16) / 255 || 0 };
};
const BLEND = { normal: 'NORMAL', multiply: 'MULTIPLY', screen: 'SCREEN', overlay: 'OVERLAY', darken: 'DARKEN', lighten: 'LIGHTEN', 'color-dodge': 'COLOR_DODGE', 'color-burn': 'COLOR_BURN', difference: 'DIFFERENCE', exclusion: 'EXCLUSION', hue: 'HUE', saturation: 'SATURATION', color: 'COLOR', luminosity: 'LUMINOSITY' };
const WEIGHT_STYLE = { 100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semi Bold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black' };

/* ---------- paints / effects ---------- */
function gradientTransform(angleDeg) {
  // Figmy angle: CSS-like (90 = left→right). Figma gradient transform maps node space → gradient space.
  const a = ((angleDeg - 90) * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [[c, s, 0.5 - c / 2 - s / 2], [-s, c, 0.5 + s / 2 - c / 2]];
}
function paints(list) {
  const out = [];
  for (const p of list || []) {
    try {
      if (p.kind === 'solid') out.push({ type: 'SOLID', color: hexToRgb(p.color), opacity: p.opacity == null ? 1 : p.opacity, visible: p.visible !== false });
      else if (p.kind === 'linear' || p.kind === 'radial') {
        out.push({
          type: p.kind === 'linear' ? 'GRADIENT_LINEAR' : 'GRADIENT_RADIAL',
          gradientTransform: p.kind === 'linear' ? gradientTransform(p.angle == null ? 90 : p.angle) : [[1, 0, 0], [0, 1, 0]],
          gradientStops: (p.stops || []).map((s) => Object.assign({ position: Math.max(0, Math.min(1, s.offset)) }, { color: Object.assign(hexToRgb(s.color), { a: 1 }) })),
          opacity: p.opacity == null ? 1 : p.opacity,
          visible: p.visible !== false,
        });
      } else if (p.kind === 'image' && p.src && p.src.startsWith('data:')) {
        const img = figma.createImage(figma.base64Decode(p.src.split(',')[1]));
        out.push({ type: 'IMAGE', imageHash: img.hash, scaleMode: 'FILL', opacity: p.opacity == null ? 1 : p.opacity, visible: p.visible !== false });
      }
    } catch (e) {
      warnings.add('Some fills could not be converted (' + e.message + ')');
    }
  }
  return out;
}
function effects(list) {
  return (list || [])
    .map((e) => {
      const color = Object.assign(hexToRgb(e.color), { a: e.opacity == null ? 0.25 : e.opacity });
      if (e.kind === 'drop-shadow' || e.kind === 'inner-shadow')
        return { type: e.kind === 'drop-shadow' ? 'DROP_SHADOW' : 'INNER_SHADOW', color, offset: { x: e.x || 0, y: e.y || 0 }, radius: e.blur || 0, spread: e.spread || 0, visible: e.visible !== false, blendMode: 'NORMAL' };
      if (e.kind === 'layer-blur') return { type: 'LAYER_BLUR', radius: e.blur || 0, visible: e.visible !== false };
      if (e.kind === 'background-blur') return { type: 'BACKGROUND_BLUR', radius: e.blur || 0, visible: e.visible !== false };
      return null;
    })
    .filter(Boolean);
}

/* ---------- geometry ---------- */
const fmt = (v) => Math.round(v * 1000) / 1000;
function pathString(n) {
  if (n.rings && n.rings.length) return n.rings.filter((r) => r.length > 1).map((r) => 'M ' + r.map((p) => fmt(p.x) + ' ' + fmt(p.y)).join(' L ') + ' Z').join(' ');
  const pts = n.points || [];
  if (!pts.length) return '';
  let d = 'M ' + fmt(pts[0].x) + ' ' + fmt(pts[0].y);
  const seg = (a, b) => (a.cout || b.cin ? ' C ' + [a.cout || a, b.cin || b, b].map((q) => fmt(q.x) + ' ' + fmt(q.y)).join(' ') : ' L ' + fmt(b.x) + ' ' + fmt(b.y));
  for (let i = 1; i < pts.length; i++) d += seg(pts[i - 1], pts[i]);
  if (n.closed && pts.length > 2) d += seg(pts[pts.length - 1], pts[0]) + ' Z';
  return d;
}
function polygonPath(w, h, count, ratio) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    const k = ratio != null && i % 2 ? ratio : 1;
    pts.push(fmt(w / 2 + (Math.cos(a) * w * k) / 2) + ' ' + fmt(h / 2 + (Math.sin(a) * h * k) / 2));
  }
  return 'M ' + pts.join(' L ') + ' Z';
}

/* ---------- import ---------- */
async function loadFont(t) {
  const style = (WEIGHT_STYLE[t.fontWeight] || 'Regular') + (t.italic ? (t.fontWeight === 400 ? '' : ' ') + 'Italic' : '');
  const wanted = { family: t.fontFamily || 'Inter', style: style.replace(/^Regular Italic$/, 'Italic') };
  try {
    await figma.loadFontAsync(wanted);
    return wanted;
  } catch (e) {
    warnings.add('Font “' + wanted.family + ' ' + wanted.style + '” is not available; used Inter instead');
    const fb = { family: 'Inter', style: t.fontWeight >= 600 ? 'Bold' : 'Regular' };
    await figma.loadFontAsync(fb);
    return fb;
  }
}

async function importDoc(doc, newPages) {
  const nodes = doc.nodes || {};
  const made = {}; // figmy id -> figma node
  const instances = [];
  const sets = [];
  const protos = [];

  // nearest non-group ancestor (Figma positions children of groups in the group's parent space)
  const frameOrigin = (id) => {
    let p = nodes[id] && nodes[id].parentId ? nodes[nodes[id].parentId] : null;
    while (p && p.type === 'group') p = p.parentId ? nodes[p.parentId] : null;
    return p ? { x: p.x, y: p.y } : { x: 0, y: 0 };
  };

  function place(f, n) {
    const o = frameOrigin(n.id);
    const w = Math.max(0.01, n.w), h = Math.max(0.01, n.h);
    try {
      if ('resize' in f && f.type !== 'GROUP' && f.type !== 'TEXT') f.resize(w, Math.max(0.01, h));
    } catch (e) {
      /* some nodes can't be resized to 0 */
    }
    const r = ((n.rotation || 0) * Math.PI) / 180;
    const c = Math.cos(r), s = Math.sin(r);
    const cx = n.x - o.x + n.w / 2, cy = n.y - o.y + n.h / 2;
    const tx = cx - (c * n.w) / 2 + (s * n.h) / 2, ty = cy - (s * n.w) / 2 - (c * n.h) / 2;
    f.relativeTransform = [[c, -s, tx], [s, c, ty]];
  }

  function style(f, n) {
    f.name = n.name || f.name;
    f.visible = n.visible !== false;
    f.locked = !!n.locked;
    if ('opacity' in f) f.opacity = n.opacity == null ? 1 : n.opacity;
    if ('blendMode' in f) f.blendMode = n.blend === 'normal' || !n.blend ? 'PASS_THROUGH' : BLEND[n.blend] || 'NORMAL';
    if ('fills' in f && n.type !== 'group' && n.type !== 'instance') f.fills = paints(n.fills);
    if ('strokes' in f && n.strokes && n.strokes.length) {
      const st = n.strokes.find((x) => x.visible !== false) || n.strokes[0];
      f.strokes = n.strokes.map((x) => ({ type: 'SOLID', color: hexToRgb(x.color), opacity: x.opacity == null ? 1 : x.opacity, visible: x.visible !== false }));
      f.strokeWeight = st.width || 1;
      f.strokeAlign = st.align === 'outside' ? 'OUTSIDE' : st.align === 'center' ? 'CENTER' : 'INSIDE';
      if (st.dash) f.dashPattern = [st.dash, st.dash];
      if ('strokeCap' in f && n.type !== 'frame') f.strokeCap = st.cap === 'round' ? 'ROUND' : st.cap === 'square' ? 'SQUARE' : 'NONE';
    }
    if ('effects' in f) f.effects = effects(n.effects);
    if ('cornerRadius' in f && n.type !== 'ellipse') {
      if (n.radii && 'topLeftRadius' in f) {
        f.topLeftRadius = n.radii[0]; f.topRightRadius = n.radii[1]; f.bottomRightRadius = n.radii[2]; f.bottomLeftRadius = n.radii[3];
      } else f.cornerRadius = n.radius || 0;
    }
    if (n.isMask && 'isMask' in f) f.isMask = true;
    if (n.constraints && 'constraints' in f) {
      const H = { left: 'MIN', right: 'MAX', 'left-right': 'STRETCH', center: 'CENTER', scale: 'SCALE' };
      const V = { top: 'MIN', bottom: 'MAX', 'top-bottom': 'STRETCH', center: 'CENTER', scale: 'SCALE' };
      try { f.constraints = { horizontal: H[n.constraints.h] || 'MIN', vertical: V[n.constraints.v] || 'MIN' }; } catch (e) { /* not in a frame */ }
    }
  }

  function autoLayout(f, n) {
    const al = n.autoLayout;
    if (!al) return;
    f.layoutMode = al.direction === 'horizontal' ? 'HORIZONTAL' : 'VERTICAL';
    f.itemSpacing = al.gap || 0;
    f.paddingTop = al.padding.t; f.paddingRight = al.padding.r; f.paddingBottom = al.padding.b; f.paddingLeft = al.padding.l;
    f.primaryAxisAlignItems = al.justify === 'center' ? 'CENTER' : al.justify === 'end' ? 'MAX' : al.justify === 'space-between' ? 'SPACE_BETWEEN' : 'MIN';
    f.counterAxisAlignItems = al.align === 'center' ? 'CENTER' : al.align === 'end' ? 'MAX' : 'MIN';
    const horiz = al.direction === 'horizontal';
    f.primaryAxisSizingMode = (horiz ? al.hugW : al.hugH) ? 'AUTO' : 'FIXED';
    f.counterAxisSizingMode = (horiz ? al.hugH : al.hugW) ? 'AUTO' : 'FIXED';
    if (al.wrap && horiz) f.layoutWrap = 'WRAP';
  }

  async function build(id, parent) {
    const n = nodes[id];
    if (!n) return null;
    let f;
    switch (n.type) {
      case 'frame':
        f = figma.createFrame();
        f.clipsContent = !!n.clip;
        break;
      case 'component':
        f = figma.createComponent();
        f.clipsContent = !!n.clip;
        if (n.description) f.description = n.description;
        break;
      case 'group':
        f = figma.createFrame(); // turned into a real group once its children exist
        f.fills = [];
        break;
      case 'rect':
        f = figma.createRectangle();
        break;
      case 'ellipse':
        f = figma.createEllipse();
        break;
      case 'polygon':
      case 'star':
        f = figma.createVector();
        f.vectorPaths = [{ windingRule: 'NONZERO', data: polygonPath(n.w, n.h, n.type === 'star' ? (n.sides || 5) * 2 : n.sides || 3, n.type === 'star' ? n.innerRatio || 0.38 : null) }];
        break;
      case 'path':
      case 'line': {
        f = figma.createVector();
        const d = pathString(n);
        if (d) f.vectorPaths = [{ windingRule: n.rings ? 'EVENODD' : 'NONZERO', data: d }];
        break;
      }
      case 'image':
        f = figma.createRectangle();
        n.fills = [{ kind: 'image', src: n.src, opacity: 1, visible: true }];
        break;
      case 'text': {
        f = figma.createText();
        const t = n.text || {};
        f.fontName = await loadFont(t);
        f.characters = t.content || '';
        f.fontSize = t.fontSize || 16;
        f.lineHeight = { value: Math.round((t.lineHeight || 1.2) * 100), unit: 'PERCENT' };
        f.letterSpacing = { value: t.letterSpacing || 0, unit: 'PIXELS' };
        f.textAlignHorizontal = t.align === 'center' ? 'CENTER' : t.align === 'right' ? 'RIGHT' : t.align === 'justify' ? 'JUSTIFIED' : 'LEFT';
        f.textAlignVertical = t.vAlign === 'middle' ? 'CENTER' : t.vAlign === 'bottom' ? 'BOTTOM' : 'TOP';
        f.textDecoration = t.underline ? 'UNDERLINE' : t.strike ? 'STRIKETHROUGH' : 'NONE';
        f.textCase = t.transform === 'uppercase' ? 'UPPER' : t.transform === 'lowercase' ? 'LOWER' : t.transform === 'capitalize' ? 'TITLE' : 'ORIGINAL';
        f.textAutoResize = t.autoResize === 'width' ? 'WIDTH_AND_HEIGHT' : t.autoResize === 'height' ? 'HEIGHT' : 'NONE';
        if (t.autoResize !== 'width') f.resize(Math.max(1, n.w), Math.max(1, n.h));
        break;
      }
      case 'instance':
        f = figma.createFrame(); // placeholder, replaced in pass 2
        f.fills = [];
        instances.push({ id, placeholder: f });
        break;
      default:
        warnings.add('Unsupported layer type ' + n.type + ' skipped');
        return null;
    }
    parent.appendChild(f);
    style(f, n);
    if (n.type !== 'text') place(f, n);
    else {
      const o = frameOrigin(id);
      f.x = n.x - o.x; f.y = n.y - o.y; if (n.rotation) f.rotation = -n.rotation;
    }
    made[id] = f;
    if (n.prototype && n.prototype.length) protos.push(id);

    if (n.type !== 'instance') for (const c of n.children || []) await build(c, f);
    if (n.type === 'frame' || n.type === 'component') autoLayout(f, n);
    if (n.isComponentSet) sets.push(id);

    if (n.type === 'group') {
      const kids = f.children.slice();
      if (!kids.length) { f.remove(); delete made[id]; return null; }
      const idx = parent.children.indexOf(f);
      const g = figma.group(kids, parent, idx);
      g.name = n.name || 'Group';
      g.opacity = n.opacity == null ? 1 : n.opacity;
      f.remove();
      made[id] = g;
      return g;
    }
    return f;
  }

  // pages
  const pageMap = {};
  for (const page of doc.pages || []) {
    const target = newPages ? figma.createPage() : figma.currentPage;
    if (newPages) target.name = page.name || 'Page';
    if (newPages && page.background) target.backgrounds = [{ type: 'SOLID', color: hexToRgb(page.background) }];
    if (newPages) await figma.setCurrentPageAsync(target);
    pageMap[page.id] = target;
    for (const id of page.children || []) {
      figma.ui.postMessage({ type: 'progress', text: 'Building “' + (nodes[id] && nodes[id].name) + '”…' });
      try {
        await build(id, target);
      } catch (e) {
        warnings.add('A layer could not be created: ' + e.message);
      }
    }
  }

  // component sets (variants)
  for (const id of sets) {
    const holder = made[id];
    const comps = (nodes[id].children || []).map((c) => made[c]).filter((x) => x && x.type === 'COMPONENT');
    if (!holder || comps.length < 1) continue;
    try {
      const parent = holder.parent;
      const set = figma.combineAsVariants(comps, parent, parent.children.indexOf(holder));
      set.name = nodes[id].name;
      set.x = holder.x; set.y = holder.y;
      set.strokes = holder.strokes; set.dashPattern = holder.dashPattern; set.cornerRadius = holder.cornerRadius;
      if (nodes[id].autoLayout) autoLayout(set, nodes[id]);
      holder.remove();
      made[id] = set;
    } catch (e) {
      warnings.add('Could not combine “' + nodes[id].name + '” as variants: ' + e.message);
    }
  }

  // component properties (boolean / text / instance swap) on components and sets
  const propKeys = {}; // figmy prop id -> figma property key
  const findByPath = (root, path) => {
    let cur = root;
    for (const name of path.split('/')) {
      cur = cur && 'children' in cur ? cur.children.find((c) => c.name === name) : null;
      if (!cur) return null;
    }
    return cur;
  };
  for (const [id, n] of Object.entries(nodes)) {
    if (!n.componentProps || !made[id]) continue;
    const owner = made[id];
    for (const p of n.componentProps) {
      try {
        const type = p.type === 'boolean' ? 'BOOLEAN' : p.type === 'text' ? 'TEXT' : 'INSTANCE_SWAP';
        const dflt = p.type === 'instance-swap' ? (made[p.default] && made[p.default].id) : p.default;
        if (type === 'INSTANCE_SWAP' && !dflt) continue;
        const key = owner.addComponentProperty(p.name, type, dflt);
        propKeys[p.id] = key;
        const roots = owner.type === 'COMPONENT_SET' ? owner.children : [owner];
        for (const r of roots) {
          const layer = findByPath(r, p.layer);
          if (!layer) continue;
          const field = type === 'BOOLEAN' ? 'visible' : type === 'TEXT' ? 'characters' : 'mainComponent';
          layer.componentPropertyReferences = Object.assign({}, layer.componentPropertyReferences, { [field]: key });
        }
      } catch (e) {
        warnings.add('Component property “' + p.name + '” could not be created: ' + e.message);
      }
    }
  }

  // instances (pass 2): real instances in place of placeholders, then overrides
  const indexPath = (rootId, id) => {
    const path = [];
    let cur = nodes[id];
    while (cur && cur.id !== rootId) {
      const parent = nodes[cur.parentId];
      if (!parent) return null;
      path.unshift(parent.children.indexOf(cur.id));
      cur = parent;
    }
    return cur ? path : null;
  };
  const atPath = (root, path) => path.reduce((n, i) => (n && 'children' in n ? n.children[i] : null), root);
  for (const { id, placeholder } of instances) {
    const n = nodes[id];
    const main = made[n.componentId];
    if (!main || main.type !== 'COMPONENT') {
      warnings.add('Instance “' + n.name + '” has no main component in this file; left as a frame');
      continue;
    }
    try {
      const inst = main.createInstance();
      const parent = placeholder.parent;
      parent.insertChild(parent.children.indexOf(placeholder), inst);
      place(inst, n);
      inst.name = n.name;
      inst.opacity = n.opacity == null ? 1 : n.opacity;
      inst.visible = n.visible !== false;
      placeholder.remove();
      made[id] = inst;
      // property values
      const props = {};
      for (const [pid, v] of Object.entries(n.propValues || {})) if (propKeys[pid]) props[propKeys[pid]] = typeof v === 'string' && made[v] ? made[v].id : v;
      if (Object.keys(props).length) inst.setProperties(props);
      // overrides: keys are component layer ids, scoped through nested instances with "/"
      for (const [key, patch] of Object.entries(n.overrides || {})) {
        let compId = n.componentId, target = inst, ok = true;
        for (const seg of key.split('/')) {
          const p = indexPath(compId, seg);
          const next = p ? atPath(target, p) : null;
          if (!next) { ok = false; break; }
          target = next;
          compId = nodes[seg] && nodes[seg].componentId ? (patch.componentId && seg === key.split('/').pop() ? nodes[seg].componentId : nodes[seg].componentId) : compId;
        }
        if (!ok) continue;
        try {
          if (patch.componentId && target.type === 'INSTANCE' && made[patch.componentId]) target.swapComponent(made[patch.componentId]);
          if (patch.visible != null) target.visible = patch.visible;
          if (patch.text && target.type === 'TEXT') { await figma.loadFontAsync(target.fontName); target.characters = patch.text.content; }
          if (patch.fills && 'fills' in target) target.fills = paints(patch.fills);
        } catch (e) {
          warnings.add('An override on “' + n.name + '” could not be applied');
        }
      }
    } catch (e) {
      warnings.add('Instance “' + n.name + '” could not be created: ' + e.message);
    }
  }

  // prototype interactions
  const EASE = { linear: 'LINEAR', 'ease-in': 'EASE_IN', 'ease-out': 'EASE_OUT', 'ease-in-out': 'EASE_IN_AND_OUT', 'ease-in-back': 'EASE_IN_BACK', 'ease-out-back': 'EASE_OUT_BACK', gentle: 'GENTLE', spring: 'QUICK', bouncy: 'BOUNCY' };
  const TRIG = { click: 'ON_CLICK', hover: 'ON_HOVER', press: 'ON_PRESS', 'mouse-enter': 'MOUSE_ENTER', 'mouse-leave': 'MOUSE_LEAVE', 'after-delay': 'AFTER_TIMEOUT' };
  for (const id of protos) {
    const f = made[id];
    if (!f || !('setReactionsAsync' in f)) continue;
    const reactions = [];
    for (const l of nodes[id].prototype) {
      const anim = l.animation === 'smart-animate' ? 'SMART_ANIMATE' : l.animation === 'dissolve' ? 'DISSOLVE' : l.animation === 'move-in' || l.animation === 'slide-left' ? 'MOVE_IN' : l.animation === 'move-out' ? 'MOVE_OUT' : l.animation === 'push' ? 'PUSH' : l.animation === 'slide-in' ? 'SLIDE_IN' : l.animation === 'slide-out' ? 'SLIDE_OUT' : null;
      const transition = anim ? Object.assign({ type: anim, easing: { type: EASE[l.easing] || 'EASE_OUT' }, duration: (l.duration || 300) / 1000 }, ['MOVE_IN', 'MOVE_OUT', 'PUSH', 'SLIDE_IN', 'SLIDE_OUT'].includes(anim) ? { direction: (l.direction || 'left').toUpperCase(), matchLayers: false } : {}) : null;
      const trigger = l.trigger === 'after-delay' ? { type: 'AFTER_TIMEOUT', timeout: (l.delay || 800) / 1000 } : l.trigger === 'key' ? null : { type: TRIG[l.trigger] || 'ON_CLICK' };
      if (!trigger) { warnings.add('Key-press interactions are not converted'); continue; }
      let action = null;
      const dest = made[l.targetId];
      if (l.action === 'back') action = { type: 'BACK' };
      else if (l.action === 'close-overlay') action = { type: 'CLOSE' };
      else if (l.action === 'url' && l.url) action = { type: 'URL', url: l.url };
      else if (dest) action = { type: 'NODE', destinationId: dest.id, navigation: l.action === 'overlay' ? 'OVERLAY' : l.action === 'swap-overlay' ? 'SWAP' : l.action === 'scroll-to' ? 'SCROLL_TO' : l.action === 'change-to' ? 'CHANGE_TO' : 'NAVIGATE', transition, preserveScrollPosition: false };
      if (action) reactions.push({ trigger, actions: [action] });
    }
    try { if (reactions.length) await f.setReactionsAsync(reactions); } catch (e) { warnings.add('Some prototype links could not be converted: ' + e.message); }
  }

  // variables
  try {
    for (const col of doc.variables || []) {
      const vc = figma.variables.createVariableCollection(col.name);
      const modeIds = {};
      col.modes.forEach((m, i) => { if (i === 0) { vc.renameMode(vc.modes[0].modeId, m.name); modeIds[m.id] = vc.modes[0].modeId; } else modeIds[m.id] = vc.addMode(m.name); });
      for (const v of col.variables) {
        const fv = figma.variables.createVariable(v.name, vc, v.type === 'color' ? 'COLOR' : v.type === 'number' ? 'FLOAT' : v.type === 'boolean' ? 'BOOLEAN' : 'STRING');
        for (const [mid, val] of Object.entries(v.values)) if (modeIds[mid]) fv.setValueForMode(modeIds[mid], v.type === 'color' ? Object.assign(hexToRgb(val), { a: 1 }) : val);
      }
    }
  } catch (e) {
    warnings.add('Variables could not be created: ' + e.message);
  }

  const first = Object.values(pageMap)[0];
  if (first) await figma.setCurrentPageAsync(first);
  figma.viewport.scrollAndZoomIntoView(figma.currentPage.children);
  return Object.keys(made).length;
}

figma.ui.onmessage = async (msg) => {
  if (msg.type !== 'import') return;
  warnings.clear();
  try {
    if (!msg.doc || msg.doc.format !== 'figmy' && msg.doc.format !== 'vectura') throw new Error('This is not a Figmy file');
    const count = await importDoc(msg.doc, msg.newPages);
    const w = [...warnings];
    figma.ui.postMessage({ type: 'done', text: 'Imported ' + count + ' layers.' + (w.length ? '\n\nNotes:\n• ' + w.join('\n• ') : '') });
    figma.notify('Figmy import complete: ' + count + ' layers');
  } catch (e) {
    figma.ui.postMessage({ type: 'done', text: 'Import failed: ' + e.message });
  }
};
