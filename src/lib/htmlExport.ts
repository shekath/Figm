/**
 * Design → HTML. Produces a single self-contained HTML file (inline CSS, embedded images) from frames.
 * Auto-layout frames become flexbox, text stays real text, vectors become inline SVG, and prototype
 * interactions can be compiled into a tiny runtime so the exported page is clickable.
 */
import type { DocumentData, Paint, PrototypeLink, SceneNode } from '../types';
import { exportSvgString } from './exporter';
import { visualBounds } from './geometry';
import { FONT_STACK, transformText } from './text';
import { childOverrides, setOf, variantsOf } from './components';

type Nodes = Record<string, SceneNode>;

export interface HtmlExportOptions {
  /** 'flex' turns auto layout into flexbox; 'absolute' positions everything pixel-perfect */
  layout: 'flex' | 'absolute';
  /** compile prototype links into a navigable page */
  prototype: boolean;
  title?: string;
  /** centre screens and scale down to fit narrow viewports */
  fitToViewport: boolean;
}

export const defaultHtmlOptions: HtmlExportOptions = { layout: 'flex', prototype: true, fitToViewport: true };

const SYSTEM_FONTS = new Set(['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Segoe UI', 'Helvetica']);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const px = (v: number) => `${Math.round(v * 100) / 100}px`;
const rgba = (hex: string, a: number) => {
  if (a >= 1) return hex;
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${Math.round(a * 1000) / 1000})`;
};

function paintCss(p: Paint): string {
  const stops = (p.stops ?? []).map((s) => `${rgba(s.color, p.opacity)} ${Math.round(s.offset * 100)}%`).join(', ');
  switch (p.kind) {
    case 'solid':
      return rgba(p.color, p.opacity);
    case 'linear':
      return `linear-gradient(${p.angle ?? 90}deg, ${stops})`;
    case 'radial':
      return `radial-gradient(circle, ${stops})`;
    case 'image':
      return p.src ? `url("${p.src}") center / cover no-repeat` : '#d9d9d9';
  }
}

/** Background shorthand for a stack of fills (CSS lists topmost first). */
function backgroundCss(fills: Paint[]): string | null {
  const vis = fills.filter((f) => f.visible);
  if (!vis.length) return null;
  const layers = [...vis].reverse().map((p) => {
    const v = paintCss(p);
    // a plain colour can only be the last background layer
    return p.kind === 'solid' ? `linear-gradient(${v}, ${v})` : v;
  });
  return layers.join(', ');
}

/** Pure CSS declarations for a node (no positioning). */
function visualCss(n: SceneNode): string[] {
  const css: string[] = [];
  if (n.type !== 'text' && n.type !== 'group') {
    if (n.type === 'image' && n.src) css.push(`background: url("${n.src}") center / cover no-repeat`);
    else {
      const bg = backgroundCss(n.fills);
      if (bg) css.push(`background: ${bg}`);
    }
  }
  const r = n.type === 'ellipse' ? '50%' : n.radii ? n.radii.map(px).join(' ') : n.radius ? px(n.radius) : null;
  if (r) css.push(`border-radius: ${r}`);
  const shadows: string[] = [];
  for (const s of n.strokes.filter((x) => x.visible && x.width > 0)) {
    const c = rgba(s.color, s.opacity);
    if (s.dash) css.push(`outline: ${px(s.width)} dashed ${c}`, `outline-offset: ${px(s.align === 'inside' ? -s.width : s.align === 'center' ? -s.width / 2 : 0)}`);
    else if (s.align === 'outside') shadows.push(`0 0 0 ${px(s.width)} ${c}`);
    else if (s.align === 'center') shadows.push(`inset 0 0 0 ${px(s.width / 2)} ${c}`, `0 0 0 ${px(s.width / 2)} ${c}`);
    else shadows.push(`inset 0 0 0 ${px(s.width)} ${c}`);
  }
  for (const e of n.effects.filter((x) => x.visible)) {
    if (e.kind === 'drop-shadow' || e.kind === 'inner-shadow') {
      if (n.type === 'text') css.push(`text-shadow: ${px(e.x)} ${px(e.y)} ${px(e.blur)} ${rgba(e.color, e.opacity)}`);
      else shadows.push(`${e.kind === 'inner-shadow' ? 'inset ' : ''}${px(e.x)} ${px(e.y)} ${px(e.blur)} ${px(e.spread)} ${rgba(e.color, e.opacity)}`);
    }
    if (e.kind === 'layer-blur') css.push(`filter: blur(${px(e.blur / 2)})`);
    if (e.kind === 'background-blur') css.push(`backdrop-filter: blur(${px(e.blur / 2)})`, `-webkit-backdrop-filter: blur(${px(e.blur / 2)})`);
  }
  if (shadows.length) css.push(`box-shadow: ${shadows.join(', ')}`);
  if (n.opacity < 1) css.push(`opacity: ${Math.round(n.opacity * 1000) / 1000}`);
  if (n.blend !== 'normal') css.push(`mix-blend-mode: ${n.blend}`);
  const tf: string[] = [];
  if (n.rotation) tf.push(`rotate(${n.rotation}deg)`);
  if (n.flipX || n.flipY) tf.push(`scale(${n.flipX ? -1 : 1}, ${n.flipY ? -1 : 1})`);
  if (tf.length) css.push(`transform: ${tf.join(' ')}`);
  if ((n.type === 'frame' || n.type === 'component') && n.clip) css.push('overflow: hidden');
  if (n.text) {
    const t = n.text;
    css.push(
      `font-family: ${FONT_STACK(t.fontFamily).replace(/"/g, "'")}`,
      `font-size: ${px(t.fontSize)}`,
      `font-weight: ${t.fontWeight}`,
      `line-height: ${t.lineHeight}`,
      `text-align: ${t.align}`,
      `white-space: ${t.autoResize === 'width' ? 'pre' : 'pre-wrap'}`,
      'margin: 0',
    );
    if (t.italic) css.push('font-style: italic');
    if (t.letterSpacing) css.push(`letter-spacing: ${px(t.letterSpacing)}`);
    if (t.transform !== 'none') css.push(`text-transform: ${t.transform}`);
    const deco = [t.underline && 'underline', t.strike && 'line-through'].filter(Boolean).join(' ');
    if (deco) css.push(`text-decoration: ${deco}`);
    if (t.vAlign !== 'top') css.push('display: flex', 'flex-direction: column', `justify-content: ${t.vAlign === 'middle' ? 'center' : 'flex-end'}`);
    const f = n.fills.find((x) => x.visible);
    if (f?.kind === 'solid') css.push(`color: ${rgba(f.color, f.opacity)}`);
    else if (f) css.push(`background: ${paintCss(f)}`, '-webkit-background-clip: text', 'background-clip: text', 'color: transparent');
  }
  return css;
}

const isVector = (n: SceneNode) => ['path', 'line', 'polygon', 'star'].includes(n.type);

interface Ctx {
  nodes: Nodes;
  opts: HtmlExportOptions;
  rules: string[];
  fonts: Set<string>;
  frameIds: Set<string>;
  count: number;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24) || 'layer';

function emit(id: string, ctx: Ctx, parent: SceneNode | null, inFlow: boolean, depth: number, overrides?: Record<string, Partial<SceneNode>>): string {
  const raw = ctx.nodes[id];
  if (!raw) return '';
  const n: SceneNode = overrides?.[id] ? { ...raw, ...overrides[id] } : raw;
  if (!n.visible) return '';
  const cls = `${slug(n.name)}-${(ctx.count++).toString(36)}`;
  const pad = '  '.repeat(depth);
  const css: string[] = [];
  const flexParent = ctx.opts.layout === 'flex' && !!parent?.autoLayout && !raw.layoutAbsolute;
  const positioned = !(flexParent && inFlow);
  if (positioned && parent) css.push('position: absolute', `left: ${px(n.x - parent.x)}`, `top: ${px(n.y - parent.y)}`);
  else if (!parent) css.push('position: relative');
  else css.push('position: relative', 'flex-shrink: 0');

  const hasMask = n.children.some((c) => ctx.nodes[c]?.isMask);
  const vector = isVector(n) || hasMask;
  if (vector) {
    // inline SVG positioned on its visual bounds (rotation baked into the SVG)
    const vb = visualBounds(n);
    const svg = exportSvgString(ctx.nodes, [n.id]).replace(/^<svg /, `<svg class="${cls}" aria-hidden="true" `);
    const box: string[] = positioned && parent ? ['position: absolute', `left: ${px(vb.x - parent.x)}`, `top: ${px(vb.y - parent.y)}`] : ['position: relative', 'flex-shrink: 0'];
    box.push(`width: ${px(vb.w)}`, `height: ${px(vb.h)}`, 'overflow: visible');
    if (n.opacity < 1) box.push(`opacity: ${n.opacity}`);
    ctx.rules.push(`.${cls} { ${box.join('; ')}; }`);
    return `${pad}${svg}\n`;
  }

  // size
  const al = n.autoLayout;
  const flexSelf = ctx.opts.layout === 'flex' && !!al;
  if (n.type === 'text' && n.text?.autoResize === 'width') css.push(`width: max-content`, `min-height: ${px(n.h)}`);
  else if (n.type === 'text' && n.text?.autoResize === 'height') css.push(`width: ${px(n.w)}`);
  else {
    css.push(flexSelf && al!.hugW && parent ? 'width: max-content' : `width: ${px(n.w)}`);
    css.push(flexSelf && al!.hugH && parent ? 'height: max-content' : `height: ${px(n.h)}`);
  }
  if (!parent) css.push('flex-shrink: 0');
  const inFlex = ctx.opts.layout === 'flex' && !!parent?.autoLayout && !n.layoutAbsolute;
  if (inFlex) {
    const ph = parent!.autoLayout!.direction === 'horizontal';
    const main = ph ? n.layoutSizing?.h : n.layoutSizing?.v, cross = ph ? n.layoutSizing?.v : n.layoutSizing?.h;
    if (main === 'fill') css.push('flex: 1 1 0', ph ? 'min-width: 0' : 'min-height: 0');
    else css.push('flex-shrink: 0');
    if (cross === 'fill') css.push('align-self: stretch', ph ? 'height: auto' : 'width: auto');
    if (n.minW) css.push(`min-width: ${px(n.minW)}`);
    if (n.maxW) css.push(`max-width: ${px(n.maxW)}`);
    if (n.minH) css.push(`min-height: ${px(n.minH)}`);
    if (n.maxH) css.push(`max-height: ${px(n.maxH)}`);
  }
  if (flexSelf) {
    css.push(
      'display: flex',
      `flex-direction: ${al!.direction === 'horizontal' ? 'row' : 'column'}`,
      `gap: ${px(al!.gap)}`,
      `padding: ${px(al!.padding.t)} ${px(al!.padding.r)} ${px(al!.padding.b)} ${px(al!.padding.l)}`,
      `align-items: ${al!.align === 'start' ? 'flex-start' : al!.align === 'end' ? 'flex-end' : 'center'}`,
      `justify-content: ${al!.justify === 'start' ? 'flex-start' : al!.justify === 'end' ? 'flex-end' : al!.justify}`,
      'box-sizing: border-box',
    );
    if (al!.wrap) css.push('flex-wrap: wrap', `row-gap: ${px(al!.counterGap ?? al!.gap)}`);
    if (n.children.some((c) => ctx.nodes[c]?.layoutAbsolute)) css.push('position: relative');
  }
  css.push(...visualCss(n));
  if (n.text?.fontFamily && !SYSTEM_FONTS.has(n.text.fontFamily)) ctx.fonts.add(n.text.fontFamily);

  const attrs: string[] = [`class="${cls}"`];
  if (ctx.frameIds.has(n.id) && !parent) attrs.push(`id="s-${n.id}"`);
  const links = ctx.opts.prototype ? (n.prototype ?? []) : [];
  if (links.length) {
    attrs.push(`data-links='${esc(JSON.stringify(links.map(compactLink)))}'`);
    css.push('cursor: pointer');
  }
  if (n.overflow && n.overflow !== 'none' && ctx.opts.prototype) css.push(n.overflow === 'vertical' ? 'overflow-y: auto' : n.overflow === 'horizontal' ? 'overflow-x: auto' : 'overflow: auto');
  ctx.rules.push(`.${cls} { ${css.join('; ')}; }`);

  if (n.type === 'text' && n.text) {
    const tag = n.text.fontSize >= 28 ? 'h2' : 'p';
    return `${pad}<${tag} ${attrs.join(' ')}>${esc(transformText(n.text.content, 'none'))}</${tag}>\n`;
  }
  if (n.type === 'image') return `${pad}<div ${attrs.join(' ')} role="img" aria-label="${esc(n.name)}"></div>\n`;

  if (n.type === 'instance' && n.componentId && ctx.nodes[n.componentId]) {
    const comp = ctx.nodes[n.componentId];
    const set = setOf(ctx.nodes, comp.id);
    // interactive components: emit every variant so "change to" links can switch between them
    const interactive = ctx.opts.prototype && !!set && variantsOf(ctx.nodes, set.id).some((v) => hasChangeTo(ctx.nodes, v.id));
    const list = interactive ? variantsOf(ctx.nodes, set!.id) : [comp];
    const follows = Math.abs(n.w - comp.w) < 0.5 && Math.abs(n.h - comp.h) < 0.5;
    if (interactive) {
      attrs.push('data-instance');
      if (follows) attrs.push('data-follow');
    }
    const inner = list
      .map((v, i) => {
        const vw = follows ? v.w : n.w,
          vh = follows ? v.h : n.h;
        const sx = vw / (v.w || 1),
          sy = vh / (v.h || 1);
        const innerCls = `${cls}-v${i}`;
        const bg = backgroundCss(v.fills);
        ctx.rules.push(
          `.${innerCls} { position: absolute; left: 0; top: 0; width: ${px(v.w)}; height: ${px(v.h)}; transform-origin: 0 0; transform: scale(${Math.round(sx * 1000) / 1000}, ${Math.round(sy * 1000) / 1000});${bg ? ` background: ${bg};` : ''}${v.radius ? ` border-radius: ${px(v.radius)};` : ''}${v.clip ? ' overflow: hidden;' : ''}${interactive && v.id !== comp.id ? ' display: none;' : ''} }`,
        );
        const vAttrs = [`class="${innerCls}${interactive && v.id === comp.id ? ' vx-on' : ''}"`];
        if (interactive) vAttrs.push(`data-variant="v-${v.id}"`, `data-w="${Math.round(vw * 100) / 100}"`, `data-h="${Math.round(vh * 100) / 100}"`);
        const vLinks = ctx.opts.prototype ? v.prototype ?? [] : [];
        if (vLinks.length) vAttrs.push(`data-links='${esc(JSON.stringify(vLinks.map(compactLink)))}'`);
        const kids = v.children.map((c) => emit(c, ctx, v, false, depth + 2, childOverrides(ctx.nodes, { ...n, componentId: v.id }, overrides))).join('');
        return `${pad}  <div ${vAttrs.join(' ')}>\n${kids}${pad}  </div>\n`;
      })
      .join('');
    return `${pad}<div ${attrs.join(' ')}>\n${inner}${pad}</div>\n`;
  }

  const kids = n.children
    .map((c) => {
      const k = ctx.nodes[c];
      const inFlowChild = !!(k && !k.rotation && !k.fixed);
      return emit(c, ctx, n, inFlowChild, depth + 1, overrides);
    })
    .join('');
  const tag = !parent ? 'section' : 'div';
  return `${pad}<${tag} ${attrs.join(' ')}>\n${kids}${pad}</${tag}>\n`;
}

function hasChangeTo(nodes: Nodes, id: string): boolean {
  const n = nodes[id];
  if (!n) return false;
  if (n.prototype?.some((l) => l.action === 'change-to')) return true;
  return n.children.some((c) => hasChangeTo(nodes, c));
}

const compactLink = (l: PrototypeLink) => ({
  t: l.trigger,
  a: l.action ?? (l.targetId === 'back' ? 'back' : 'navigate'),
  to: l.targetId === 'back' ? null : l.action === 'change-to' ? `v-${l.targetId}` : `s-${l.targetId}`,
  anim: l.animation,
  dir: l.direction,
  e: l.easing,
  d: l.duration,
  dl: l.delay,
  k: l.key,
  url: l.url,
  ov: l.overlay,
});

const EASE_CSS: Record<string, string> = {
  linear: 'linear',
  'ease-in': 'cubic-bezier(.42,0,1,1)',
  'ease-out': 'cubic-bezier(0,0,.58,1)',
  'ease-in-out': 'cubic-bezier(.42,0,.58,1)',
  'ease-in-back': 'cubic-bezier(.36,0,.66,-.56)',
  'ease-out-back': 'cubic-bezier(.34,1.56,.64,1)',
  spring: 'cubic-bezier(.3,1.35,.5,1)',
  gentle: 'cubic-bezier(.25,1.15,.5,1)',
  bouncy: 'cubic-bezier(.3,1.7,.45,.9)',
};

/** Prototype runtime embedded in exported HTML (plain ES5-ish JS, no dependencies). */
const RUNTIME = `
(function () {
  var EASE = ${JSON.stringify(EASE_CSS)};
  var screens = Array.prototype.slice.call(document.querySelectorAll('.vx-stage > section'));
  if (!screens.length) return;
  var stage = document.querySelector('.vx-stage');
  var history = [], overlays = [], timers = [];
  var start = document.getElementById(stage.getAttribute('data-start')) || screens[0];
  function show(el) { screens.forEach(function (s) { s.classList.toggle('vx-active', s === el); s.style.transform = ''; s.style.opacity = ''; }); fit(); arm(el); }
  function fit() {
    var cur = current(); if (!cur || !stage.hasAttribute('data-fit')) return;
    var k = Math.min(1, (window.innerWidth - 32) / cur.offsetWidth, (window.innerHeight - 32) / cur.offsetHeight);
    stage.style.transform = 'scale(' + k + ')';
    stage.style.width = cur.offsetWidth + 'px'; stage.style.height = cur.offsetHeight + 'px';
  }
  function current() { return history.length ? history[history.length - 1].el : null; }
  function offset(dir, amt, el) {
    var w = el.offsetWidth, h = el.offsetHeight; dir = dir || 'left';
    return dir === 'left' ? 'translate(' + amt * w + 'px,0)' : dir === 'right' ? 'translate(' + -amt * w + 'px,0)' : dir === 'up' ? 'translate(0,' + amt * h + 'px)' : 'translate(0,' + -amt * h + 'px)';
  }
  function transition(from, to, l, reverse) {
    var anim = l.anim || 'instant', d = l.d || 0, ease = EASE[l.e] || EASE['ease-out'];
    if (anim === 'slide-left') { anim = 'move-in'; l.dir = 'left'; } else if (anim === 'slide-right') { anim = 'move-in'; l.dir = 'right'; } else if (anim === 'slide-up') { anim = 'move-in'; l.dir = 'up'; }
    if (!from || anim === 'instant' || !d) { show(to); return; }
    to.classList.add('vx-active'); from.classList.add('vx-active');
    var a = reverse ? to : from, b = reverse ? from : to;
    var set = function (el, tf, op) { el.style.transform = tf; el.style.opacity = op; };
    var aStart = ['none', 1], aEnd = ['none', 1], bStart = ['none', 1], bEnd = ['none', 1];
    if (anim === 'dissolve' || anim === 'smart-animate') { bStart = ['none', 0]; }
    else if (anim === 'move-in') { bStart = [offset(l.dir, 1, b), 1]; }
    else if (anim === 'move-out') { aEnd = [offset(l.dir, -1, a), 1]; }
    else if (anim === 'push') { aEnd = [offset(l.dir, -1, a), 1]; bStart = [offset(l.dir, 1, b), 1]; }
    else if (anim === 'slide-in') { aEnd = [offset(l.dir, -0.3, a), 0.7]; bStart = [offset(l.dir, 1, b), 1]; }
    else if (anim === 'slide-out') { aEnd = [offset(l.dir, -1, a), 1]; bStart = [offset(l.dir, -0.3, b), 0.7]; }
    var top = (anim === 'move-out' || anim === 'slide-out') ? a : b;
    top.style.zIndex = 2; (top === a ? b : a).style.zIndex = 1;
    var s1 = reverse ? [aEnd, bEnd] : [aStart, bStart], s2 = reverse ? [aStart, bStart] : [aEnd, bEnd];
    [a, b].forEach(function (el) { el.style.transition = 'none'; });
    set(a, s1[0][0], s1[0][1]); set(b, s1[1][0], s1[1][1]);
    void a.offsetWidth;
    [a, b].forEach(function (el) { el.style.transition = 'transform ' + d + 'ms ' + ease + ', opacity ' + d + 'ms ' + ease; });
    set(a, s2[0][0], s2[0][1]); set(b, s2[1][0], s2[1][1]);
    setTimeout(function () { [a, b].forEach(function (el) { el.style.transition = ''; el.style.zIndex = ''; }); show(to); }, d + 20);
  }
  function go(id, l, temp) {
    var to = document.getElementById(id); var from = current();
    if (!to || to === from) return;
    closeAll();
    history.push({ el: to, l: l, temp: temp }); transition(from, to, l, false);
  }
  function back() {
    if (overlays.length) return closeOverlay();
    if (history.length < 2) return;
    var top = history.pop(); transition(top.el, current(), top.l, true);
  }
  function openOverlay(id, l, temp, swap) {
    var src = document.getElementById(id); if (!src) return;
    if (swap) closeOverlay(true);
    var wrap = document.createElement('div'); wrap.className = 'vx-overlay';
    var ov = l.ov || { position: 'center', closeOnOutside: true, background: 'rgba(0,0,0,.4)' };
    wrap.style.background = ov.background; wrap.setAttribute('data-pos', ov.position || 'center');
    var clone = src.cloneNode(true); clone.removeAttribute('id'); clone.classList.add('vx-active');
    wrap.appendChild(clone); stage.appendChild(wrap);
    wrap.addEventListener('click', function (e) { if (e.target === wrap && ov.closeOnOutside !== false) closeOverlay(); });
    bind(clone);
    overlays.push({ el: wrap, temp: temp });
    var d = l.d || 0, ease = EASE[l.e] || EASE['ease-out'];
    wrap.style.opacity = 0; clone.style.transform = (l.anim && l.anim.indexOf('move') === 0) ? offset(l.dir || 'up', 1, clone) : 'none';
    void wrap.offsetWidth;
    wrap.style.transition = 'opacity ' + d + 'ms ' + ease; clone.style.transition = 'transform ' + d + 'ms ' + ease;
    wrap.style.opacity = 1; clone.style.transform = 'none';
    arm(clone);
  }
  function closeOverlay(now) { var o = overlays.pop(); if (!o) return; if (now) return o.el.remove(); o.el.style.opacity = 0; setTimeout(function () { o.el.remove(); }, 200); }
  function closeAll() { while (overlays.length) closeOverlay(true); }
  function changeVariant(el, to, l, temp) {
    var inst = el.closest('[data-instance]'); if (!inst) return;
    var kids = Array.prototype.slice.call(inst.children).filter(function (c) { return c.hasAttribute('data-variant'); });
    var target = kids.filter(function (c) { return c.getAttribute('data-variant') === to; })[0];
    var cur = kids.filter(function (c) { return c.classList.contains('vx-on'); })[0];
    if (!target || target === cur) return;
    if (temp && !inst.__prev) { inst.__prev = cur; inst.__temp = temp; inst.__link = l; }
    var d = (l.anim && l.anim !== 'instant') ? (l.d || 0) : 0, ease = EASE[l.e] || EASE['ease-out'];
    target.style.display = 'block'; target.classList.add('vx-on');
    if (cur) cur.classList.remove('vx-on');
    if (d) {
      target.style.transition = 'none'; target.style.opacity = 0; void target.offsetWidth;
      target.style.transition = 'opacity ' + d + 'ms ' + ease; target.style.opacity = 1;
      if (cur) { cur.style.transition = 'opacity ' + d + 'ms ' + ease; cur.style.opacity = 0; }
      setTimeout(function () { if (cur && !cur.classList.contains('vx-on')) { cur.style.display = 'none'; cur.style.opacity = ''; } }, d);
    } else if (cur) cur.style.display = 'none';
    if (inst.hasAttribute('data-follow')) {
      inst.style.transition = d ? 'width ' + d + 'ms ' + ease + ', height ' + d + 'ms ' + ease : '';
      inst.style.width = target.getAttribute('data-w') + 'px'; inst.style.height = target.getAttribute('data-h') + 'px';
    }
    armVariant(inst, target);
  }
  function revertVariant(inst, kind) {
    if (!inst.__prev || (kind && inst.__temp !== kind)) return;
    var prev = inst.__prev, l = inst.__link; inst.__prev = null;
    changeVariant(prev, prev.getAttribute('data-variant'), l, null);
  }
  function armVariant(inst, variant) {
    (inst.__timers || []).forEach(clearTimeout); inst.__timers = [];
    [variant].concat(Array.prototype.slice.call(variant.querySelectorAll('[data-links]'))).forEach(function (el) {
      linksOf(el).forEach(function (l) { if (l.t === 'after-delay') inst.__timers.push(setTimeout(function () { follow(l, el); }, l.dl || 800)); });
    });
  }
  function follow(l, el, temp) {
    if (l.a === 'change-to') return changeVariant(el, l.to, l, temp ? (l.t === 'press' ? 'press' : 'hover') : null);
    if (l.a === 'back') return back();
    if (l.a === 'close-overlay') return closeOverlay();
    if (l.a === 'url') { if (/^https?:\\/\\//.test(l.url || '')) window.open(l.url, '_blank', 'noopener'); return; }
    if (l.a === 'scroll-to') { var t = document.getElementById(l.to) || document.querySelector('[data-node="' + l.to + '"]'); if (t) t.scrollIntoView({ behavior: 'smooth' }); return; }
    if (l.a === 'overlay' || l.a === 'swap-overlay') return openOverlay(l.to, l, temp ? el : null, l.a === 'swap-overlay');
    if (l.to) go(l.to, l, temp ? el : null);
  }
  function linksOf(el) { try { return JSON.parse(el.getAttribute('data-links')) || []; } catch (e) { return []; } }
  function bind(root) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-links]'), function (el) {
      linksOf(el).forEach(function (l) {
        if (l.t === 'click') el.addEventListener('click', function (e) { e.stopPropagation(); follow(l, el); });
        if (l.t === 'mouse-enter') el.addEventListener('mouseenter', function () { follow(l, el); });
        if (l.t === 'mouse-leave') el.addEventListener('mouseleave', function () { follow(l, el); });
        if (l.t === 'hover' && l.a === 'change-to') {
          el.addEventListener('mouseenter', function () { follow(l, el, true); });
          var hi = el.closest('[data-instance]'); if (hi && !hi.__hoverBound) { hi.__hoverBound = true; hi.addEventListener('mouseleave', function () { revertVariant(hi, 'hover'); }); }
        } else if (l.t === 'hover') { el.addEventListener('mouseenter', function () { follow(l, el, true); }); el.addEventListener('mouseleave', function () { undoTemp(el); }); }
        if (l.t === 'press') { el.addEventListener('pointerdown', function () { follow(l, el, true); }); el.addEventListener('pointerup', function () { undoTemp(el); }); }
      });
    });
  }
  function undoTemp(el) {
    var o = overlays[overlays.length - 1]; if (o && o.temp === el) return closeOverlay();
    var h = history[history.length - 1]; if (h && h.temp === el) back();
  }
  document.addEventListener('pointerup', function () { Array.prototype.forEach.call(document.querySelectorAll('[data-instance]'), function (i) { revertVariant(i, 'press'); }); });
  function arm(screen) {
    timers.forEach(clearTimeout); timers = [];
    Array.prototype.forEach.call(screen.querySelectorAll('[data-instance] > .vx-on'), function (v) { armVariant(v.parentNode, v); });
    var all = [screen].concat(Array.prototype.slice.call(screen.querySelectorAll('[data-links]'))).filter(function (el) { return !el.closest('[data-variant]'); });
    all.forEach(function (el) { linksOf(el).forEach(function (l) { if (l.t === 'after-delay') timers.push(setTimeout(function () { follow(l, el); }, l.dl || 800)); }); });
  }
  document.addEventListener('keydown', function (e) {
    var scope = overlays.length ? overlays[overlays.length - 1].el : current();
    if (!scope) return;
    var hit = false;
    Array.prototype.forEach.call(scope.querySelectorAll('[data-links]'), function (el) {
      linksOf(el).forEach(function (l) { if (!hit && l.t === 'key' && l.k && l.k.toLowerCase() === e.key.toLowerCase()) { hit = true; follow(l, el); } });
    });
    if (!hit && (e.key === 'Escape' || e.key === 'Backspace')) back();
  });
  bind(document);
  history.push({ el: start, l: { anim: 'instant' } }); show(start);
  window.addEventListener('resize', fit);
})();
`;

/** Generate a complete HTML document for the given top-level frames. */
export function generateHtml(doc: Pick<DocumentData, 'nodes' | 'name' | 'pages'>, frameIds: string[], options: Partial<HtmlExportOptions> = {}): string {
  const opts = { ...defaultHtmlOptions, ...options };
  const ctx: Ctx = { nodes: doc.nodes, opts, rules: [], fonts: new Set(), frameIds: new Set(frameIds), count: 0 };
  const ids = frameIds.filter((id) => doc.nodes[id]);
  const body = ids.map((id) => emit(id, ctx, null, false, 2)).join('\n');
  const page = doc.pages.find((p) => ids.some((id) => p.children.includes(id)));
  const multi = opts.prototype && ids.length > 1;
  const startId = page?.startFrameId && ids.includes(page.startFrameId) ? page.startFrameId : ids[0];
  const fontLink = ctx.fonts.size
    ? `  <link rel="preconnect" href="https://fonts.googleapis.com">\n  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?${[...ctx.fonts].map((f) => `family=${encodeURIComponent(f)}:ital,wght@0,100..900;1,100..900`).join('&')}&display=swap">\n`
    : '';
  const base = `
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; }
    body { background: ${page?.background ?? '#f5f5f5'}; font-family: Inter, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
    .vx-stage { position: relative; margin: 0 auto; ${multi ? 'transform-origin: top center;' : 'display: flex; flex-wrap: wrap; gap: 40px; padding: 40px; justify-content: center; align-items: flex-start;'} }
    ${multi ? `.vx-stage > section { position: absolute !important; left: 0; top: 0; display: none; }
    .vx-stage > section.vx-active { display: block; }
    body { display: flex; justify-content: center; padding-top: 16px; overflow-x: hidden; }
    .vx-overlay { position: absolute; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center; }
    .vx-overlay[data-pos=top] { align-items: flex-start; } .vx-overlay[data-pos=bottom] { align-items: flex-end; }
    .vx-overlay[data-pos=left] { justify-content: flex-start; } .vx-overlay[data-pos=right] { justify-content: flex-end; }
    .vx-overlay > section { position: relative !important; left: auto !important; top: auto !important; display: block; }` : ''}
  `;
  // flex screens need display:flex when active; mark them
  const flexScreens = ids.filter((id) => opts.layout === 'flex' && doc.nodes[id].autoLayout);
  let html = body;
  for (const id of flexScreens) html = html.replace(`id="s-${id}"`, `id="s-${id}" data-flex`);
  const flexCss = multi && flexScreens.length ? '.vx-stage > section.vx-active[data-flex] { display: flex; }\n' : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(opts.title ?? doc.name ?? 'Design')}</title>
  <meta name="generator" content="Figmy">
${fontLink}  <style>${base}
${flexCss}${ctx.rules.join('\n')}
  </style>
</head>
<body>
  <main class="vx-stage"${multi ? ` data-start="s-${startId}"${opts.fitToViewport ? ' data-fit' : ''}` : ''}>
${html}  </main>
${multi || (opts.prototype && html.includes('data-links')) ? `  <script>${RUNTIME}</script>\n` : ''}</body>
</html>
`;
}

/** Frames a link graph can reach from the given frames (so prototype exports include destinations). */
export function reachableFrames(doc: Pick<DocumentData, 'nodes' | 'pages'>, start: string[]): string[] {
  const seen = new Set<string>();
  const topOf = (id: string) => {
    let cur = doc.nodes[id];
    while (cur?.parentId) cur = doc.nodes[cur.parentId];
    return cur?.id;
  };
  const queue = [...start];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id) || !doc.nodes[id]) continue;
    seen.add(id);
    const walk = (nid: string) => {
      const n = doc.nodes[nid];
      if (!n) return;
      for (const l of n.prototype ?? []) {
        if (l.targetId === 'back' || !doc.nodes[l.targetId] || l.action === 'scroll-to') continue;
        const top = topOf(l.targetId);
        if (top && !seen.has(top)) queue.push(top);
      }
      n.children.forEach(walk);
    };
    walk(id);
  }
  return [...seen];
}
