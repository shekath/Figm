/**
 * JavaScript injected into the plugin sandbox iframe. It implements a Figma-compatible `figma` global
 * over a local copy of the current page, so plugin calls are synchronous like in Figma. Every change is
 * recorded as an operation and flushed to Figmy (the host) in batches.
 *
 * Kept as a plain JS string so it runs inside a sandboxed, opaque-origin iframe with no app code.
 */
export const SANDBOX_SHIM = String.raw`
(function () {
  'use strict';
  var nodes = {};           // id -> Figmy node (copy)
  var pageId = null, pageName = 'Page', pageChildren = [], selection = [];
  var ops = [], flushQueued = false, uiHandler = null, uiOpen = false, seq = 0, closing = false;
  var host = window.parent;
  function send(m) { host.postMessage(Object.assign({ __figmyPlugin: true }, m), '*'); }
  function queue(op) { ops.push(op); if (!flushQueued) { flushQueued = true; setTimeout(flush, 0); } }
  function flush() { flushQueued = false; if (ops.length) { send({ type: 'ops', ops: ops }); ops = []; } }
  function uid() { return 'p' + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6); }

  /* ---------- colour helpers ---------- */
  function toHex(c) { function h(v) { var s = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16); return s.length < 2 ? '0' + s : s; } return '#' + h(c.r) + h(c.g) + h(c.b); }
  function fromHex(hex) { hex = (hex || '#000000').replace('#', ''); var n = parseInt(hex.slice(0, 6), 16) || 0; return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }; }
  function paintsOut(list) { return (list || []).map(function (p) {
    if (p.kind === 'solid') return { type: 'SOLID', color: fromHex(p.color), opacity: p.opacity, visible: p.visible !== false };
    if (p.kind === 'image') return { type: 'IMAGE', scaleMode: 'FILL', imageHash: null, opacity: p.opacity, visible: p.visible !== false };
    return { type: p.kind === 'radial' ? 'GRADIENT_RADIAL' : 'GRADIENT_LINEAR', gradientStops: (p.stops || []).map(function (s) { var c = fromHex(s.color); c.a = 1; return { position: s.offset, color: c }; }), opacity: p.opacity, visible: p.visible !== false, gradientTransform: [[1, 0, 0], [0, 1, 0]] };
  }); }
  function paintsIn(list) { return (list || []).map(function (p) {
    var base = { id: uid(), opacity: p.opacity == null ? 1 : p.opacity, visible: p.visible !== false, color: '#000000' };
    if (p.type === 'SOLID') { base.kind = 'solid'; base.color = toHex(p.color); return base; }
    if (p.type && p.type.indexOf('GRADIENT') === 0) { base.kind = p.type === 'GRADIENT_RADIAL' ? 'radial' : 'linear'; base.stops = (p.gradientStops || []).map(function (s) { return { offset: s.position, color: toHex(s.color) }; }); base.color = base.stops[0] ? base.stops[0].color : '#000000'; base.angle = 90; return base; }
    base.kind = 'solid'; base.color = '#d9d9d9'; return base;
  }); }

  /* ---------- node wrappers ---------- */
  var TYPE_OUT = { frame: 'FRAME', rect: 'RECTANGLE', ellipse: 'ELLIPSE', text: 'TEXT', group: 'GROUP', component: 'COMPONENT', instance: 'INSTANCE', polygon: 'POLYGON', star: 'STAR', line: 'LINE', path: 'VECTOR', image: 'RECTANGLE' };
  var wrappers = {};
  function wrap(id) { if (!id || !nodes[id]) return null; return wrappers[id] || (wrappers[id] = new SceneNodeApi(id)); }
  function absParent(n) { var p = n.parentId ? nodes[n.parentId] : null; while (p && p.type === 'group') p = p.parentId ? nodes[p.parentId] : null; return p ? { x: p.x, y: p.y } : { x: 0, y: 0 }; }
  function moveTree(id, dx, dy) { var n = nodes[id]; if (!n) return; n.x += dx; n.y += dy; (n.children || []).forEach(function (c) { moveTree(c, dx, dy); }); }
  function patch(id, props) { Object.assign(nodes[id], props); queue({ op: 'update', id: id, props: props }); }
  function siblings(n) { return n.parentId ? nodes[n.parentId].children : pageChildren; }

  function SceneNodeApi(id) { this.id = id; }
  var P = SceneNodeApi.prototype;
  function prop(name, get, set) { Object.defineProperty(P, name, { get: get, set: set, enumerable: true }); }
  function n(self) { var x = nodes[self.id]; if (!x) throw new Error('The node (' + self.id + ') does not exist'); return x; }

  prop('type', function () { return TYPE_OUT[n(this).type] || 'FRAME'; });
  prop('removed', function () { return !nodes[this.id]; });
  prop('name', function () { return n(this).name; }, function (v) { patch(this.id, { name: String(v) }); });
  prop('visible', function () { return n(this).visible; }, function (v) { patch(this.id, { visible: !!v }); });
  prop('locked', function () { return n(this).locked; }, function (v) { patch(this.id, { locked: !!v }); });
  prop('opacity', function () { return n(this).opacity; }, function (v) { patch(this.id, { opacity: Number(v) }); });
  prop('rotation', function () { return -n(this).rotation; }, function (v) { patch(this.id, { rotation: -Number(v) }); });
  prop('x', function () { var x = n(this); return x.x - absParent(x).x; }, function (v) { var x = n(this); var nx = absParent(x).x + Number(v); moveTree(this.id, nx - x.x, 0); queue({ op: 'update', id: this.id, props: { x: nx } }); });
  prop('y', function () { var x = n(this); return x.y - absParent(x).y; }, function (v) { var x = n(this); var ny = absParent(x).y + Number(v); moveTree(this.id, 0, ny - x.y); queue({ op: 'update', id: this.id, props: { y: ny } }); });
  prop('absoluteTransform', function () { var x = n(this); return [[1, 0, x.x], [0, 1, x.y]]; });
  prop('absoluteBoundingBox', function () { var x = n(this); return { x: x.x, y: x.y, width: x.w, height: x.h }; });
  prop('width', function () { return n(this).w; });
  prop('height', function () { return n(this).h; });
  P.resize = function (w, h) { patch(this.id, { w: Math.max(0.01, Number(w)), h: Math.max(0.01, Number(h)) }); };
  P.resizeWithoutConstraints = P.resize;
  prop('fills', function () { return paintsOut(n(this).fills); }, function (v) { patch(this.id, { fills: paintsIn(v) }); });
  prop('strokes', function () { return (n(this).strokes || []).map(function (s) { return { type: 'SOLID', color: fromHex(s.color), opacity: s.opacity, visible: s.visible !== false }; }); },
    function (v) { var w = (n(this).strokes[0] || {}).width || 1; patch(this.id, { strokes: (v || []).map(function (p) { return { color: p.color ? toHex(p.color) : '#000000', width: w, opacity: p.opacity == null ? 1 : p.opacity, align: 'inside', dash: 0, cap: 'butt', join: 'miter', visible: p.visible !== false }; }) }); });
  prop('strokeWeight', function () { return (n(this).strokes[0] || {}).width || 0; }, function (v) { patch(this.id, { strokes: n(this).strokes.map(function (s) { return Object.assign({}, s, { width: Number(v) }); }) }); });
  prop('cornerRadius', function () { return n(this).radius; }, function (v) { patch(this.id, { radius: Number(v), radii: null }); });
  prop('clipsContent', function () { return !!n(this).clip; }, function (v) { patch(this.id, { clip: !!v }); });
  prop('effects', function () { return (n(this).effects || []).map(function (e) { var c = fromHex(e.color); c.a = e.opacity; return { type: e.kind === 'drop-shadow' ? 'DROP_SHADOW' : e.kind === 'inner-shadow' ? 'INNER_SHADOW' : e.kind === 'layer-blur' ? 'LAYER_BLUR' : 'BACKGROUND_BLUR', color: c, offset: { x: e.x, y: e.y }, radius: e.blur, spread: e.spread, visible: e.visible }; }); },
    function (v) { patch(this.id, { effects: (v || []).map(function (e) { return { id: uid(), kind: e.type === 'DROP_SHADOW' ? 'drop-shadow' : e.type === 'INNER_SHADOW' ? 'inner-shadow' : e.type === 'LAYER_BLUR' ? 'layer-blur' : 'background-blur', x: (e.offset || {}).x || 0, y: (e.offset || {}).y || 0, blur: e.radius || 0, spread: e.spread || 0, color: e.color ? toHex(e.color) : '#000000', opacity: e.color && e.color.a != null ? e.color.a : 0.25, visible: e.visible !== false }; }) }); });
  prop('parent', function () { var x = n(this); return x.parentId ? wrap(x.parentId) : figma.currentPage; });
  prop('children', function () { return (n(this).children || []).map(wrap); });
  P.appendChild = function (child) { reparent(child.id, this.id); };
  P.insertChild = function (index, child) { reparent(child.id, this.id, index); };
  P.findAll = function (fn) { var out = []; (function walk(ids) { ids.forEach(function (c) { var w = wrap(c); if (!fn || fn(w)) out.push(w); walk(nodes[c].children || []); }); })(n(this).children || []); return out; };
  P.findOne = function (fn) { return this.findAll(fn)[0] || null; };
  P.findChildren = function (fn) { return this.children.filter(function (c) { return !fn || fn(c); }); };
  P.remove = function () { var x = n(this); var s = siblings(x); s.splice(s.indexOf(this.id), 1); (function del(id) { (nodes[id].children || []).forEach(del); delete nodes[id]; })(this.id); queue({ op: 'remove', id: this.id }); };
  P.clone = function () { var self = n(this); var map = {}; (function copy(id, parentId) { var o = nodes[id]; var c = JSON.parse(JSON.stringify(o)); c.id = uid(); c.parentId = parentId; map[id] = c.id; nodes[c.id] = c; c.children = []; queue({ op: 'create', node: Object.assign({}, c, { children: [] }) }); if (parentId) nodes[parentId].children.push(c.id); (o.children || []).forEach(function (k) { copy(k, c.id); }); })(this.id, self.parentId); var id = map[this.id]; if (!self.parentId) pageChildren.push(id); return wrap(id); };
  P.toString = function () { return '[Node ' + this.id + ']'; };
  P.setPluginData = function (k, v) { var x = n(this); var d = Object.assign({}, x.pluginData || {}); d[k] = String(v); patch(this.id, { pluginData: d }); };
  P.getPluginData = function (k) { return ((n(this).pluginData || {})[k]) || ''; };
  // text
  prop('characters', function () { return (n(this).text || {}).content || ''; }, function (v) { var x = n(this); patch(this.id, { text: Object.assign({}, x.text, { content: String(v) }) }); });
  prop('fontSize', function () { return (n(this).text || {}).fontSize; }, function (v) { var x = n(this); patch(this.id, { text: Object.assign({}, x.text, { fontSize: Number(v) }) }); });
  prop('fontName', function () { var t = n(this).text || {}; return { family: t.fontFamily || 'Inter', style: t.fontWeight >= 700 ? 'Bold' : t.fontWeight >= 600 ? 'Semi Bold' : t.fontWeight >= 500 ? 'Medium' : 'Regular' }; },
    function (v) { var x = n(this); var st = String(v.style || ''); var w = /black/i.test(st) ? 900 : /extra ?bold/i.test(st) ? 800 : /semi ?bold/i.test(st) ? 600 : /bold/i.test(st) ? 700 : /medium/i.test(st) ? 500 : /light/i.test(st) ? 300 : 400; patch(this.id, { text: Object.assign({}, x.text, { fontFamily: v.family, fontWeight: w, italic: /italic/i.test(st) }) }); });
  prop('textAlignHorizontal', function () { var a = (n(this).text || {}).align; return a === 'center' ? 'CENTER' : a === 'right' ? 'RIGHT' : a === 'justify' ? 'JUSTIFIED' : 'LEFT'; }, function (v) { var x = n(this); patch(this.id, { text: Object.assign({}, x.text, { align: v === 'CENTER' ? 'center' : v === 'RIGHT' ? 'right' : v === 'JUSTIFIED' ? 'justify' : 'left' }) }); });
  prop('textAutoResize', function () { var a = (n(this).text || {}).autoResize; return a === 'width' ? 'WIDTH_AND_HEIGHT' : a === 'height' ? 'HEIGHT' : 'NONE'; }, function (v) { var x = n(this); patch(this.id, { text: Object.assign({}, x.text, { autoResize: v === 'WIDTH_AND_HEIGHT' ? 'width' : v === 'HEIGHT' ? 'height' : 'fixed' }) }); });
  // auto layout
  function al(self) { return n(self).autoLayout; }
  function setAl(self, p) { var x = n(self); var cur = x.autoLayout || { direction: 'vertical', gap: 0, padding: { t: 0, r: 0, b: 0, l: 0 }, align: 'start', justify: 'start', hugW: true, hugH: true, wrap: false }; patch(self.id, { autoLayout: Object.assign({}, cur, p, { padding: Object.assign({}, cur.padding, p.padding || {}) }) }); }
  prop('layoutMode', function () { var a = al(this); return a ? (a.direction === 'horizontal' ? 'HORIZONTAL' : 'VERTICAL') : 'NONE'; }, function (v) { if (v === 'NONE') patch(this.id, { autoLayout: null }); else setAl(this, { direction: v === 'HORIZONTAL' ? 'horizontal' : 'vertical' }); });
  prop('itemSpacing', function () { return (al(this) || {}).gap || 0; }, function (v) { setAl(this, { gap: Number(v) }); });
  ['Top', 'Right', 'Bottom', 'Left'].forEach(function (side) { var k = side[0].toLowerCase(); prop('padding' + side, function () { return ((al(this) || {}).padding || {})[k] || 0; }, function (v) { var p = {}; p[k] = Number(v); setAl(this, { padding: p }); }); });
  prop('primaryAxisAlignItems', function () { var j = (al(this) || {}).justify; return j === 'center' ? 'CENTER' : j === 'end' ? 'MAX' : j === 'space-between' ? 'SPACE_BETWEEN' : 'MIN'; }, function (v) { setAl(this, { justify: v === 'CENTER' ? 'center' : v === 'MAX' ? 'end' : v === 'SPACE_BETWEEN' ? 'space-between' : 'start' }); });
  prop('counterAxisAlignItems', function () { var a = (al(this) || {}).align; return a === 'center' ? 'CENTER' : a === 'end' ? 'MAX' : 'MIN'; }, function (v) { setAl(this, { align: v === 'CENTER' ? 'center' : v === 'MAX' ? 'end' : 'start' }); });
  prop('primaryAxisSizingMode', function () { var a = al(this) || {}; return (a.direction === 'horizontal' ? a.hugW : a.hugH) ? 'AUTO' : 'FIXED'; }, function (v) { var a = al(this) || {}; var p = {}; p[a.direction === 'horizontal' ? 'hugW' : 'hugH'] = v === 'AUTO'; setAl(this, p); });
  prop('counterAxisSizingMode', function () { var a = al(this) || {}; return (a.direction === 'horizontal' ? a.hugH : a.hugW) ? 'AUTO' : 'FIXED'; }, function (v) { var a = al(this) || {}; var p = {}; p[a.direction === 'horizontal' ? 'hugH' : 'hugW'] = v === 'AUTO'; setAl(this, p); });
  prop('layoutSizingHorizontal', function () { var x = n(this); return (x.layoutSizing || {}).h === 'fill' ? 'FILL' : x.autoLayout && x.autoLayout.hugW ? 'HUG' : 'FIXED'; }, function (v) { var x = n(this); patch(this.id, { layoutSizing: Object.assign({}, x.layoutSizing, { h: v === 'FILL' ? 'fill' : undefined }) }); if (x.autoLayout) setAl(this, { hugW: v === 'HUG' }); });
  prop('layoutSizingVertical', function () { var x = n(this); return (x.layoutSizing || {}).v === 'fill' ? 'FILL' : x.autoLayout && x.autoLayout.hugH ? 'HUG' : 'FIXED'; }, function (v) { var x = n(this); patch(this.id, { layoutSizing: Object.assign({}, x.layoutSizing, { v: v === 'FILL' ? 'fill' : undefined }) }); if (x.autoLayout) setAl(this, { hugH: v === 'HUG' }); });

  function reparent(id, parentId, index) {
    var x = nodes[id]; if (!x) return;
    var from = siblings(x); var i = from.indexOf(id); if (i >= 0) from.splice(i, 1);
    x.parentId = parentId;
    var to = parentId ? nodes[parentId].children : pageChildren;
    if (index == null || index < 0 || index > to.length) to.push(id); else to.splice(index, 0, id);
    queue({ op: 'reparent', id: id, parentId: parentId, index: index == null ? -1 : index });
  }

  function make(type, props) {
    var id = uid();
    var base = { id: id, type: type, name: props.name, parentId: null, children: [], x: 0, y: 0, w: 100, h: 100, rotation: 0, opacity: 1, blend: 'normal', visible: true, locked: false, fills: [], strokes: [], effects: [], radius: 0, constraints: { h: 'left', v: 'top' } };
    Object.assign(base, props);
    nodes[id] = base; pageChildren.push(id);
    queue({ op: 'create', node: base });
    return wrap(id);
  }
  function solid(hex) { return [{ id: uid(), kind: 'solid', color: hex, opacity: 1, visible: true }]; }

  /* ---------- the figma global ---------- */
  var pageApi = {
    type: 'PAGE',
    get id() { return pageId; },
    get name() { return pageName; },
    get children() { return pageChildren.map(wrap); },
    get selection() { return selection.filter(function (i) { return nodes[i]; }).map(wrap); },
    set selection(v) { selection = (v || []).map(function (w) { return w.id; }); queue({ op: 'select', ids: selection.slice() }); },
    appendChild: function (child) { reparent(child.id, null); },
    insertChild: function (index, child) { reparent(child.id, null, index); },
    findAll: function (fn) { var out = []; (function walk(ids) { ids.forEach(function (c) { var w = wrap(c); if (!fn || fn(w)) out.push(w); walk(nodes[c].children || []); }); })(pageChildren); return out; },
    findOne: function (fn) { return this.findAll(fn)[0] || null; },
    findChildren: function (fn) { return this.children.filter(function (c) { return !fn || fn(c); }); },
    setPluginData: function () {}, getPluginData: function () { return ''; },
  };
  var storagePending = {};
  var figma = {
    apiVersion: '1.0.0',
    editorType: 'figma',
    mode: 'default',
    command: '',
    get currentPage() { return pageApi; },
    set currentPage(v) { /* single page sandbox */ },
    get root() { return { type: 'DOCUMENT', name: 'Document', children: [pageApi] }; },
    createRectangle: function () { return make('rect', { name: 'Rectangle', fills: solid('#d9d9d9') }); },
    createEllipse: function () { return make('ellipse', { name: 'Ellipse', fills: solid('#d9d9d9') }); },
    createFrame: function () { return make('frame', { name: 'Frame', fills: solid('#ffffff'), clip: true }); },
    createComponent: function () { return make('component', { name: 'Component', fills: solid('#ffffff'), clip: true }); },
    createLine: function () { return make('path', { name: 'Line', w: 100, h: 0.01, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], closed: false, strokes: [{ color: '#000000', width: 1, opacity: 1, align: 'center', dash: 0, cap: 'butt', join: 'miter', visible: true }] }); },
    createPolygon: function () { return make('polygon', { name: 'Polygon', sides: 3, fills: solid('#d9d9d9') }); },
    createStar: function () { return make('star', { name: 'Star', sides: 5, innerRatio: 0.38, fills: solid('#d9d9d9') }); },
    createText: function () { return make('text', { name: 'Text', w: 10, h: 18, fills: solid('#000000'), text: { content: '', fontFamily: 'Inter', fontSize: 12, fontWeight: 400, italic: false, lineHeight: 1.2, letterSpacing: 0, align: 'left', vAlign: 'top', underline: false, strike: false, transform: 'none', autoResize: 'width' } }); },
    group: function (list, parent) { if (!list || !list.length) throw new Error('group() needs at least one node'); var g = make('group', { name: 'Group' }); var p = list[0].parent; if (p && p.type !== 'PAGE') reparent(g.id, p.id); list.forEach(function (w) { reparent(w.id, g.id); }); queue({ op: 'fit', id: g.id }); return g; },
    getNodeById: function (id) { return wrap(id); },
    getNodeByIdAsync: function (id) { return Promise.resolve(wrap(id)); },
    loadFontAsync: function () { return Promise.resolve(); },
    listAvailableFontsAsync: function () { return Promise.resolve(['Inter', 'Roboto', 'Arial', 'Georgia'].map(function (f) { return { fontName: { family: f, style: 'Regular' } }; })); },
    notify: function (message, opts) { send({ type: 'notify', message: String(message), error: !!(opts && opts.error) }); return { cancel: function () {} }; },
    closePlugin: function (message) { if (closing) return; closing = true; flush(); send({ type: 'close', message: message ? String(message) : '' }); },
    showUI: function (html, opts) { uiOpen = true; send({ type: 'showUI', html: String(html), opts: opts || {} }); },
    ui: {
      postMessage: function (msg) { send({ type: 'toUI', msg: msg }); },
      set onmessage(fn) { uiHandler = fn; },
      get onmessage() { return uiHandler; },
      on: function (ev, fn) { if (ev === 'message') uiHandler = fn; },
      once: function (ev, fn) { if (ev === 'message') { uiHandler = function (m) { uiHandler = null; fn(m); }; } },
      off: function () { uiHandler = null; },
      show: function () { send({ type: 'uiVisible', visible: true }); },
      hide: function () { send({ type: 'uiVisible', visible: false }); },
      resize: function (w, h) { send({ type: 'uiResize', width: w, height: h }); },
      close: function () { send({ type: 'uiClose' }); },
    },
    viewport: {
      scrollAndZoomIntoView: function (list) { flush(); send({ type: 'zoom', ids: (list || []).map(function (w) { return w.id; }) }); },
      get center() { return { x: 0, y: 0 }; }, zoom: 1,
    },
    clientStorage: {
      getAsync: function (key) { return new Promise(function (res) { var id = uid(); storagePending[id] = res; send({ type: 'storageGet', key: key, reqId: id }); }); },
      setAsync: function (key, value) { send({ type: 'storageSet', key: key, value: value }); return Promise.resolve(); },
      deleteAsync: function (key) { send({ type: 'storageSet', key: key, value: undefined }); return Promise.resolve(); },
    },
    on: function () {}, once: function () {}, off: function () {},
    base64Encode: function (u8) { var s = ''; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); },
    base64Decode: function (b64) { var s = atob(b64); var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; },
    mixed: typeof Symbol === 'function' ? Symbol('mixed') : '__mixed__',
  };
  window.figma = figma;
  window.__html__ = '';

  window.addEventListener('message', function (e) {
    var d = e.data; if (!d || !d.__figmyHost) return;
    if (d.type === 'init') {
      nodes = d.nodes; pageId = d.pageId; pageName = d.pageName; pageChildren = d.pageChildren; selection = d.selection; window.__html__ = d.html || '';
      figma.command = d.command || '';
      try { if (typeof window.__figmyRun === 'function') window.__figmyRun(); } catch (err) { send({ type: 'error', message: String(err && err.message || err) }); }
      flush();
    } else if (d.type === 'fromUI') {
      if (uiHandler) { try { var r = uiHandler(d.msg, { origin: 'figmy' }); if (r && r.catch) r.catch(function (err) { send({ type: 'error', message: String(err && err.message || err) }); }); } catch (err) { send({ type: 'error', message: String(err && err.message || err) }); } }
      flush();
    } else if (d.type === 'storageValue') {
      var res = storagePending[d.reqId]; delete storagePending[d.reqId]; if (res) res(d.value);
    }
  });
  window.addEventListener('error', function (e) { send({ type: 'error', message: String(e.message) }); });
  window.addEventListener('unhandledrejection', function (e) { send({ type: 'error', message: String(e.reason && e.reason.message || e.reason) }); });
  send({ type: 'ready' });
})();
`;
