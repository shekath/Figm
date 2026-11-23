import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from './store/store';
import { RenderNode } from './canvas/render';
import { DEFAULT_MOTION, hasMotion, sampleNodes } from './lib/motion';
import { EASINGS, lerp, scrollExtent, smartAnimateFrame } from './lib/proto';
import { descendants } from './lib/layout';
import { childOverrides, resolveNested, swapPatch } from './lib/components';
import type { Animation, PrototypeLink, SceneNode } from './types';

type Nodes = Record<string, SceneNode>;
type Scroll = Record<string, { x: number; y: number }>;
interface Screen {
  id: string;
  via?: PrototypeLink;
  temp?: string; // node key that triggered a temporary (hover/press) navigation
}
interface Overlay {
  id: string;
  link: PrototypeLink;
  temp?: string;
}
interface Anim {
  kind: 'screen' | 'overlay-in' | 'overlay-out';
  from?: string;
  to: string;
  link: PrototypeLink;
  reverse: boolean;
  start: number;
}
/** Running variant change on an instance (interactive components). */
interface VariantAnim {
  from: string;
  to: string;
  link: PrototypeLink;
  start: number;
}
/** A hit-tested layer and the instance it lives in (for layers inside components). */
interface Hit {
  id: string;
  inst: string | null;
}

const normAnim = (a: Animation): { kind: Animation; dir?: PrototypeLink['direction'] } =>
  a === 'slide-left' ? { kind: 'move-in', dir: 'left' } : a === 'slide-right' ? { kind: 'move-in', dir: 'right' } : a === 'slide-up' ? { kind: 'move-in', dir: 'up' } : { kind: a };

const keyOf = (h: Hit) => `${h.inst ?? ''}:${h.id}`;

/** Full-screen prototype player with Smart Animate, interactive components, overlays, scrolling and all trigger types. */
export function Presenter() {
  const st = useEditor();
  const page = st.page();
  const nodes = st.doc.nodes;
  const frames = page.children.map((id) => nodes[id]).filter((n): n is SceneNode => !!n && (n.type === 'frame' || n.type === 'component') && n.visible && !n.isComponentSet);
  const start = (page.startFrameId && nodes[page.startFrameId] ? page.startFrameId : frames[0]?.id) ?? null;

  const [screens, setScreens] = useState<Screen[]>(start ? [{ id: start }] : []);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [scroll, setScroll] = useState<Scroll>({});
  const [anim, setAnim] = useState<Anim | null>(null);
  const [t, setT] = useState(1);
  const [variants, setVariants] = useState<Record<string, string>>({}); // instance id -> current variant component id
  const [variantAnims, setVariantAnims] = useState<Record<string, VariantAnim>>({});
  const [now, setNow] = useState(0);
  const [hints, setHints] = useState(false);
  const [size, setSize] = useState({ w: innerWidth, h: innerHeight });
  const stageRef = useRef<HTMLDivElement>(null);
  const hoverPath = useRef<Hit[]>([]);
  const pressed = useRef<string | null>(null);
  /** temporary variant changes (while hovering / pressing): instance id -> variant to restore */
  const tempVariant = useRef<Record<string, { prev: string; link: PrototypeLink; trigger: 'hover' | 'press' }>>({});

  const cur = screens[screens.length - 1]?.id;
  const frame = cur ? nodes[cur] : null;

  /* ---------- render nodes: document + interactive component state ---------- */
  const rn: Nodes = useMemo(() => {
    const ids = Object.keys(variants);
    if (!ids.length) return nodes;
    let out: Nodes = { ...nodes };
    for (const instId of ids) {
      if (instId.includes('/')) {
        // nested instance: express the variant as a scoped override on the outermost instance
        const [head, ...rest] = instId.split('/');
        const top = out[head];
        const nested = top ? resolveNested(out, top, rest) : null;
        if (!top || !nested || !nodes[variants[instId]]) continue;
        const key = rest.join('/');
        out[head] = { ...top, overrides: { ...(top.overrides ?? {}), [key]: { ...(top.overrides?.[key] ?? {}), ...swapPatch(nodes, nested.node, variants[instId]) } } };
        out = animateVariant(out, instId);
        continue;
      }
      const inst = nodes[instId];
      const compId = variants[instId];
      const comp = nodes[compId];
      const orig = inst?.componentId ? nodes[inst.componentId] : undefined;
      if (!inst || !comp) continue;
      // follow the variant's size unless the instance was resized
      const follows = orig && Math.abs(inst.w - orig.w) < 0.5 && Math.abs(inst.h - orig.h) < 0.5;
      out[instId] = { ...inst, componentId: compId, w: follows ? comp.w : inst.w, h: follows ? comp.h : inst.h };
      out = animateVariant(out, instId);
      const va = variantAnims[instId];
      if (va && nodes[va.from] && follows && normAnim(va.link.animation).kind !== 'instant') {
        const e = EASINGS[va.link.easing ?? 'ease-out'](Math.min(1, (now - va.start) / Math.max(1, va.link.duration)));
        const from = nodes[va.from];
        out[instId] = { ...out[instId], w: lerp(from.w, comp.w, e), h: lerp(from.h, comp.h, e) };
      }
    }
    return out;

    /** Tween the destination variant's layers from the source variant (shared by top-level and nested instances). */
    function animateVariant(base: Nodes, key: string): Nodes {
      const va = variantAnims[key];
      if (!va || !nodes[va.from] || !nodes[va.to]) return base;
      const e = EASINGS[va.link.easing ?? 'ease-out'](Math.min(1, (now - va.start) / Math.max(1, va.link.duration)));
      const { kind } = normAnim(va.link.animation);
      if (kind === 'instant') return base;
      const sa = smartAnimateFrame(base, va.from, va.to, kind === 'smart-animate' ? e : 1);
      const next = { ...base };
      for (const id of [va.to, ...descendants(nodes, va.to)]) next[id] = sa.nodes[id];
      if (kind === 'dissolve') for (const c of nodes[va.to].children) next[c] = { ...next[c], opacity: next[c].opacity * e };
      return next;
    }
  }, [nodes, variants, variantAnims, now]);

  /* ---------- animation loops ---------- */
  useEffect(() => {
    if (!anim) return;
    let raf = 0;
    const dur = Math.max(1, anim.link.duration);
    const tick = () => {
      const p = Math.min(1, (performance.now() - anim.start) / dur);
      setT(p);
      if (p < 1) raf = requestAnimationFrame(tick);
      else {
        if (anim.kind === 'overlay-out') setOverlays((o) => o.slice(0, -1));
        setAnim(null);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [anim]);

  useEffect(() => {
    if (!Object.keys(variantAnims).length) return;
    let raf = 0;
    const tick = () => {
      const time = performance.now();
      setNow(time);
      const done = Object.entries(variantAnims).filter(([, a]) => time - a.start >= a.link.duration).map(([k]) => k);
      if (done.length)
        setVariantAnims((v) => {
          const n = { ...v };
          for (const k of done) delete n[k];
          return n;
        });
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [variantAnims]);

  const animate = (a: Omit<Anim, 'start'>) => {
    const { kind } = normAnim(a.link.animation);
    if (kind === 'instant' || a.link.duration <= 0) {
      if (a.kind === 'overlay-out') setOverlays((o) => o.slice(0, -1));
      setAnim(null);
      setT(1);
      return;
    }
    setT(0);
    setAnim({ ...a, start: performance.now() });
  };

  /* ---------- interactive components ---------- */
  const currentVariant = (instPath: string) => {
    if (variants[instPath]) return variants[instPath];
    const [head, ...rest] = instPath.split('/');
    if (!rest.length) return nodes[head]?.componentId ?? '';
    return (rn[head] && resolveNested(rn, rn[head], rest)?.node.componentId) || '';
  };

  const changeVariant = (instId: string, to: string, link: PrototypeLink, temp?: 'hover' | 'press') => {
    const from = currentVariant(instId);
    if (!nodes[to] || !from || from === to) return;
    if (temp && !tempVariant.current[instId]) tempVariant.current[instId] = { prev: from, link, trigger: temp };
    setVariants((v) => ({ ...v, [instId]: to }));
    const start = performance.now();
    setNow(start);
    if (normAnim(link.animation).kind !== 'instant' && link.duration > 0) setVariantAnims((v) => ({ ...v, [instId]: { from, to, link, start } }));
  };

  const revertTemp = (instId: string) => {
    const tv = tempVariant.current[instId];
    if (!tv) return;
    delete tempVariant.current[instId];
    changeVariant(instId, tv.prev, tv.link);
  };

  /* ---------- navigation ---------- */
  const go = useCallback(
    (targetId: string, link: PrototypeLink, temp?: string) => {
      if (!nodes[targetId] || targetId === cur) return;
      setOverlays([]);
      setScroll((s) => ({ ...s, [targetId]: { x: 0, y: 0 } }));
      setScreens((s) => [...s, { id: targetId, via: link, temp }]);
      animate({ kind: 'screen', from: cur, to: targetId, link, reverse: false });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cur, nodes],
  );

  const back = useCallback(() => {
    if (overlays.length) return closeOverlay();
    if (screens.length < 2) return;
    const top = screens[screens.length - 1];
    const prev = screens[screens.length - 2];
    setScreens((s) => s.slice(0, -1));
    animate({ kind: 'screen', from: top.id, to: prev.id, link: top.via ?? { trigger: 'click', targetId: 'back', animation: 'instant', duration: 0 }, reverse: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screens, overlays]);

  const openOverlay = (id: string, link: PrototypeLink, temp?: string, swap = false) => {
    if (!nodes[id]) return;
    setOverlays((o) => [...(swap ? o.slice(0, -1) : o), { id, link, temp }]);
    animate({ kind: 'overlay-in', to: id, link, reverse: false });
  };
  const closeOverlay = () => {
    const top = overlays[overlays.length - 1];
    if (!top) return;
    animate({ kind: 'overlay-out', to: top.id, link: top.link, reverse: true });
  };

  const scrollTo = (targetId: string, link: PrototypeLink) => {
    const target = nodes[targetId];
    if (!target || !frame) return;
    const ext = scrollExtent(nodes, frame.id);
    const y = Math.max(0, Math.min(ext.maxY, target.y - frame.y));
    const x = Math.max(0, Math.min(ext.maxX, target.x - frame.x));
    const from = scroll[frame.id] ?? { x: 0, y: 0 };
    const t0 = performance.now();
    const ease = EASINGS[link.easing ?? 'ease-out'];
    const step = () => {
      const p = Math.min(1, (performance.now() - t0) / Math.max(1, link.duration));
      const e = ease(p);
      setScroll((s) => ({ ...s, [frame.id]: { x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e } }));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const follow = (l: PrototypeLink, source?: Hit, temp?: 'hover' | 'press') => {
    const action = l.action ?? (l.targetId === 'back' ? 'back' : 'navigate');
    const tempKey = temp && source ? keyOf(source) : undefined;
    switch (action) {
      case 'change-to':
        if (source?.inst) changeVariant(source.inst, l.targetId, l, temp);
        return;
      case 'back':
        return back();
      case 'close-overlay':
        return closeOverlay();
      case 'url':
        if (l.url && /^https?:\/\//.test(l.url)) window.open(l.url, '_blank', 'noopener,noreferrer');
        return;
      case 'scroll-to':
        return scrollTo(l.targetId, l);
      case 'overlay':
        return openOverlay(l.targetId, l, tempKey);
      case 'swap-overlay':
        return openOverlay(l.targetId, l, undefined, true);
      default:
        return go(l.targetId, l, tempKey);
    }
  };

  /* ---------- timers & keys ---------- */
  const activeFrames = useMemo(() => [cur, ...overlays.map((o) => o.id)].filter(Boolean) as string[], [cur, overlays]);

  /** Layers with interactions in a frame, including layers inside (the current variant of) instances. */
  const linkedIn = useCallback(
    (frameId: string): (Hit & { n: SceneNode })[] => {
      const out: (Hit & { n: SceneNode })[] = [];
      const walk = (id: string, inst: string | null, level: Record<string, Partial<SceneNode>> | undefined, depth: number) => {
        const raw = rn[id];
        if (!raw || depth > 20) return;
        const n = level?.[id] ? { ...raw, ...level[id] } : raw;
        if (!n.visible) return;
        if (n.prototype?.length) out.push({ id, inst, n });
        if (n.type === 'instance' && n.componentId && rn[n.componentId]) {
          const comp = rn[n.componentId];
          const path = inst ? `${inst}/${id}` : id;
          if (comp.prototype?.length) out.push({ id: comp.id, inst: path, n: comp });
          const lv = childOverrides(rn, n, level);
          comp.children.forEach((c) => walk(c, path, lv, depth + 1));
          return;
        }
        raw.children.forEach((c) => walk(c, inst, level, depth + 1));
      };
      walk(frameId, null, undefined, 0);
      return out;
    },
    [rn],
  );

  // after-delay interactions: screens/overlays, and variants (re-armed whenever a variant changes)
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const top = activeFrames[activeFrames.length - 1];
    if (top)
      for (const h of linkedIn(top))
        for (const l of h.n.prototype!) if (l.trigger === 'after-delay') timers.push(setTimeout(() => follow(l, h), l.delay ?? 800));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFrames.join('|'), JSON.stringify(variants)]);

  useEffect(() => {
    const r = () => setSize({ w: innerWidth, h: innerHeight });
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return st.set({ presenting: false });
      const top = activeFrames[activeFrames.length - 1];
      const keyed = top ? linkedIn(top).flatMap((h) => h.n.prototype!.filter((l) => l.trigger === 'key' && l.key && l.key.toLowerCase() === e.key.toLowerCase()).map((l) => ({ h, l }))) : [];
      if (keyed.length) {
        e.preventDefault();
        return follow(keyed[0].l, keyed[0].h);
      }
      if (e.key === 'ArrowLeft' || e.key === 'Backspace') back();
      if (e.key === 'ArrowRight') {
        const i = frames.findIndex((f) => f.id === cur);
        const next = frames[(i + 1) % frames.length];
        if (next) go(next.id, { trigger: 'click', targetId: next.id, animation: 'move-in', direction: 'left', easing: 'ease-out', duration: 300 });
      }
      if (e.key.toLowerCase() === 'r') {
        setScreens(start ? [{ id: start }] : []);
        setOverlays([]);
        setScroll({});
        setVariants({});
        setVariantAnims({});
        tempVariant.current = {};
      }
    };
    window.addEventListener('resize', r);
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('resize', r);
      window.removeEventListener('keydown', k);
    };
  });

  if (!frame)
    return (
      <div className="presenter">
        <div className="present-empty">
          Add a frame to this page to present it.
          <button className="btn" onClick={() => st.set({ presenting: false })}>Close</button>
        </div>
      </div>
    );

  /* ---------- geometry ---------- */
  const scale = Math.min(1, (size.w - 80) / frame.w, (size.h - 120) / frame.h);
  const overlayRect = (o: Overlay) => {
    const n = nodes[o.id];
    const pos = o.link.overlay?.position ?? 'center';
    const x = pos === 'left' ? 0 : pos === 'right' ? frame.w - n.w : (frame.w - n.w) / 2;
    const y = pos === 'top' ? 0 : pos === 'bottom' ? frame.h - n.h : (frame.h - n.h) / 2;
    return { x, y, w: n.w, h: n.h };
  };

  /**
   * Path of layers under a point (frame-local coords), honouring scroll offsets, fixed layers,
   * and descending into instances (mapped into the current variant's coordinate space).
   */
  const pathAt = (rootId: string, lx: number, ly: number): Hit[] => {
    const root = rn[rootId];
    let best: Hit[] = [];
    const walk = (id: string, px: number, py: number, path: Hit[], inst: string | null, level: Record<string, Partial<SceneNode>> | undefined, depth: number) => {
      const raw = rn[id];
      if (!raw || depth > 30) return;
      const n = level?.[id] ? { ...raw, ...level[id] } : raw;
      if (!n.visible) return;
      const inside = px >= n.x && px <= n.x + n.w && py >= n.y && py <= n.y + n.h;
      if (!inside && (n.clip || n.type !== 'group')) return;
      const p = inside ? [...path, { id, inst }] : path;
      if (inside && p.length > best.length) best = p;
      if (n.type === 'instance' && n.componentId && rn[n.componentId]) {
        const comp = rn[n.componentId];
        const instPath = inst ? `${inst}/${id}` : id;
        const cx = comp.x + ((px - n.x) * comp.w) / (n.w || 1);
        const cy = comp.y + ((py - n.y) * comp.h) / (n.h || 1);
        const pc = [...p, { id: comp.id, inst: instPath }];
        if (pc.length > best.length) best = pc;
        const lv = childOverrides(rn, n, level);
        for (const c of comp.children) walk(c, cx, cy, pc, instPath, lv, depth + 1);
        return;
      }
      const s = scroll[id];
      for (const c of raw.children) {
        const k = rn[c];
        walk(c, px + (s && !k?.fixed ? s.x : 0), py + (s && !k?.fixed ? s.y : 0), p, inst, level, depth + 1);
      }
    };
    walk(rootId, root.x + lx, root.y + ly, [], null, undefined, 0);
    return best;
  };

  const toLocal = (e: { clientX: number; clientY: number }) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  /** Which frame (overlay or screen) receives a pointer event and the local coords inside it. */
  const target = (e: { clientX: number; clientY: number }) => {
    const p = toLocal(e);
    for (let i = overlays.length - 1; i >= 0; i--) {
      const o = overlays[i];
      const r = overlayRect(o);
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return { frameId: o.id, x: p.x - r.x, y: p.y - r.y, outside: false };
      return { frameId: o.id, x: 0, y: 0, outside: true, overlay: o };
    }
    return { frameId: frame.id, x: p.x, y: p.y, outside: false };
  };

  /** Innermost layer on the path with an interaction for one of the triggers. */
  const linkFor = (path: Hit[], triggers: PrototypeLink['trigger'][]) => {
    for (let i = path.length - 1; i >= 0; i--) {
      const n = rn[path[i].id];
      const l = n?.prototype?.find((x) => triggers.includes(x.trigger));
      if (l) return { h: path[i], l };
    }
    return null;
  };

  const onClick = (e: React.MouseEvent) => {
    if (anim) return;
    const tg = target(e);
    if (tg.outside) {
      if (tg.overlay?.link.overlay?.closeOnOutside !== false) closeOverlay();
      return;
    }
    const hit = linkFor(pathAt(tg.frameId, tg.x, tg.y), ['click']);
    if (hit) follow(hit.l, hit.h);
    else {
      setHints(true);
      setTimeout(() => setHints(false), 500);
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const tg = target(e);
    if (tg.outside) return;
    const hit = linkFor(pathAt(tg.frameId, tg.x, tg.y), ['press']);
    if (hit) {
      pressed.current = keyOf(hit.h);
      follow(hit.l, hit.h, 'press');
    }
  };
  const onPointerUp = () => {
    for (const [instId, tv] of Object.entries(tempVariant.current)) if (tv.trigger === 'press') revertTemp(instId);
    if (!pressed.current) return;
    const key = pressed.current;
    pressed.current = null;
    if (screens[screens.length - 1]?.temp === key) back();
    else if (overlays[overlays.length - 1]?.temp === key) closeOverlay();
  };

  const onMove = (e: React.PointerEvent) => {
    const tg = target(e);
    const path = tg.outside ? [] : pathAt(tg.frameId, tg.x, tg.y);
    const prev = hoverPath.current;
    hoverPath.current = path;
    const keys = new Set(path.map(keyOf));
    const prevKeys = new Set(prev.map(keyOf));
    const entered = path.filter((h) => !prevKeys.has(keyOf(h)));
    const left = prev.filter((h) => !keys.has(keyOf(h)));
    // instances under the pointer (for "while hovering" variant changes, tracked per instance so swaps don't flicker)
    const instUnder = new Set(path.flatMap((h) => [h.inst, rn[h.id]?.type === 'instance' ? (h.inst ? `${h.inst}/${h.id}` : h.id) : null]).filter(Boolean) as string[]);
    for (const [instId, tv] of Object.entries(tempVariant.current)) if (tv.trigger === 'hover' && !instUnder.has(instId)) revertTemp(instId);
    for (const h of left) {
      const n = rn[h.id];
      for (const l of n?.prototype ?? []) if (l.trigger === 'mouse-leave') follow(l, h);
      if (n?.prototype?.some((l) => l.trigger === 'hover' && l.action !== 'change-to')) {
        const key = keyOf(h);
        if (screens[screens.length - 1]?.temp === key) back();
        else if (overlays[overlays.length - 1]?.temp === key) closeOverlay();
      }
    }
    if (!anim)
      for (const h of entered) {
        const n = rn[h.id];
        for (const l of n?.prototype ?? []) {
          if (l.trigger === 'mouse-enter') follow(l, h);
          if (l.trigger === 'hover' && !(l.action === 'change-to' && h.inst && tempVariant.current[h.inst])) follow(l, h, 'hover');
        }
      }
    const interactive = path.some((h) => rn[h.id]?.prototype?.length);
    stageRef.current!.style.cursor = interactive ? 'pointer' : 'default';
  };

  const onWheel = (e: React.WheelEvent) => {
    const tg = target(e);
    if (tg.outside) return;
    const path = pathAt(tg.frameId, tg.x, tg.y).filter((h) => !h.inst);
    const candidates = [...path].reverse().filter((h) => {
      const n = rn[h.id];
      return n && (n.type === 'frame' || n.type === 'component') && (n.overflow ?? 'none') !== 'none';
    });
    const id = candidates[0]?.id ?? (rn[tg.frameId].overflow && rn[tg.frameId].overflow !== 'none' ? tg.frameId : null);
    if (!id) return;
    const n = rn[id];
    const ext = scrollExtent(rn, id);
    setScroll((s) => {
      const c = s[id] ?? { x: 0, y: 0 };
      const canX = n.overflow === 'horizontal' || n.overflow === 'both';
      const canY = n.overflow === 'vertical' || n.overflow === 'both';
      return {
        ...s,
        [id]: {
          x: canX ? Math.max(0, Math.min(ext.maxX, c.x + (e.shiftKey ? e.deltaY : e.deltaX))) : 0,
          y: canY ? Math.max(0, Math.min(ext.maxY, c.y + (e.shiftKey ? 0 : e.deltaY))) : 0,
        },
      };
    });
  };

  /* ---------- keyframe animation (Motion mode) plays from the moment a screen appears ---------- */
  const animated = useMemo(() => Object.values(nodes).some(hasMotion), [nodes]);
  const [motionT, setMotionT] = useState(0);
  const screenKey = screens.length ? screens[screens.length - 1].id + ':' + screens.length : '';
  useEffect(() => {
    if (!animated) return;
    const dm = { ...DEFAULT_MOTION, ...useEditor.getState().doc.motion };
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = now - t0;
      setMotionT(dm.loop ? t % dm.duration : Math.min(t, dm.duration));
      if (dm.loop || t < dm.duration) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animated, screenKey]);

  /* ---------- rendering ---------- */
  const svgFor = (id: string, n0: Nodes, extra?: React.ReactNode, style?: React.CSSProperties) => {
    const n = animated ? sampleNodes(n0, motionT) : n0;
    const f = n0[id];
    return (
      <svg key={id + (style ? 'a' : '')} className="present-layer" style={style} width={f.w * scale} height={f.h * scale} viewBox={`${f.x} ${f.y} ${f.w} ${f.h}`}>
        <RenderNode id={id} ctx={{ nodes: n, scroll }} />
        {extra}
      </svg>
    );
  };

  const eased = (link: PrototypeLink, p: number) => EASINGS[link.easing ?? 'ease-out'](p);

  const offsetFor = (dir: PrototypeLink['direction'], amount: number, w: number, h: number) => {
    const d = dir ?? 'left';
    return d === 'left' ? { x: amount * w, y: 0 } : d === 'right' ? { x: -amount * w, y: 0 } : d === 'up' ? { x: 0, y: amount * h } : { x: 0, y: -amount * h };
  };

  let layers: React.ReactNode;
  if (anim?.kind === 'screen' && anim.from && rn[anim.from]) {
    const forwardFrom = anim.reverse ? anim.to : anim.from;
    const forwardTo = anim.reverse ? anim.from : anim.to;
    const e = eased(anim.link, anim.reverse ? 1 - t : t);
    const { kind, dir } = normAnim(anim.link.animation);
    const direction = dir ?? anim.link.direction;
    const W = frame.w * scale,
      H = frame.h * scale;
    const tf = (o: { x: number; y: number }, opacity = 1): React.CSSProperties => ({ transform: `translate(${o.x}px, ${o.y}px)`, opacity });
    if (kind === 'smart-animate') {
      const sa = smartAnimateFrame(rn, forwardFrom, forwardTo, e);
      const dest = rn[forwardTo];
      layers = svgFor(
        forwardTo,
        sa.nodes,
        <g>
          <defs>
            <clipPath id="sa-clip">
              <rect x={dest.x} y={dest.y} width={dest.w} height={dest.h} />
            </clipPath>
          </defs>
          <g clipPath="url(#sa-clip)">
            {sa.leaving.roots.map((r) => (
              <RenderNode key={r} id={r} ctx={{ nodes: sa.leaving.nodes, prefix: 'leave' }} />
            ))}
          </g>
        </g>,
      );
    } else if (kind === 'dissolve') {
      layers = (
        <>
          {svgFor(forwardFrom, rn, null, tf({ x: 0, y: 0 }))}
          {svgFor(forwardTo, rn, null, tf({ x: 0, y: 0 }, e))}
        </>
      );
    } else if (kind === 'move-in') {
      layers = (
        <>
          {svgFor(forwardFrom, rn, null, tf({ x: 0, y: 0 }))}
          {svgFor(forwardTo, rn, null, tf(offsetFor(direction, 1 - e, W, H)))}
        </>
      );
    } else if (kind === 'move-out') {
      layers = (
        <>
          {svgFor(forwardTo, rn, null, tf({ x: 0, y: 0 }))}
          {svgFor(forwardFrom, rn, null, tf(offsetFor(direction, -e, W, H)))}
        </>
      );
    } else if (kind === 'push') {
      layers = (
        <>
          {svgFor(forwardFrom, rn, null, tf(offsetFor(direction, -e, W, H)))}
          {svgFor(forwardTo, rn, null, tf(offsetFor(direction, 1 - e, W, H)))}
        </>
      );
    } else if (kind === 'slide-in') {
      layers = (
        <>
          {svgFor(forwardFrom, rn, null, tf(offsetFor(direction, -0.3 * e, W, H), 1 - 0.3 * e))}
          {svgFor(forwardTo, rn, null, tf(offsetFor(direction, 1 - e, W, H)))}
        </>
      );
    } else if (kind === 'slide-out') {
      layers = (
        <>
          {svgFor(forwardTo, rn, null, tf(offsetFor(direction, 0.3 * (e - 1), W, H)))}
          {svgFor(forwardFrom, rn, null, tf(offsetFor(direction, -e, W, H)))}
        </>
      );
    } else layers = svgFor(cur!, rn);
  } else layers = svgFor(cur!, rn);

  const linked = activeFrames.flatMap((id) => linkedIn(id)).filter((h) => !h.inst);

  return (
    <div className="presenter">
      <div className="present-bar">
        <span>{frame.name}</span>
        <span className="muted">
          {screens.length > 1 || overlays.length ? '← back · ' : ''}→ next · R restart · Esc close
        </span>
        <select value={cur} onChange={(e) => go(e.target.value, { trigger: 'click', targetId: e.target.value, animation: 'instant', duration: 0 })}>
          {frames.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        <button className="btn small" onClick={() => st.set({ presenting: false })}>Close</button>
      </div>
      <div
        ref={stageRef}
        className="present-stage"
        style={{ width: frame.w * scale, height: frame.h * scale }}
        onClick={onClick}
        onPointerMove={onMove}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={() => onMove({ clientX: -1e6, clientY: -1e6 } as React.PointerEvent)}
        onWheel={onWheel}
      >
        {layers}
        {overlays.map((o, i) => {
          const r = overlayRect(o);
          const isTop = i === overlays.length - 1;
          const animating = isTop && anim && (anim.kind === 'overlay-in' || anim.kind === 'overlay-out');
          const p = animating ? eased(o.link, anim!.kind === 'overlay-out' ? 1 - t : t) : 1;
          const { kind, dir } = normAnim(o.link.animation);
          const off = kind === 'move-in' || kind === 'slide-in' || kind === 'push' ? offsetFor(dir ?? o.link.direction ?? 'up', 1 - p, r.w * scale, r.h * scale) : { x: 0, y: 0 };
          const opacity = kind === 'dissolve' || kind === 'smart-animate' ? p : 1;
          return (
            <div key={o.id + i} className="present-overlay" style={{ background: o.link.overlay?.background ?? 'rgba(0,0,0,0.4)', opacity: animating ? Math.min(1, p * 1.5) : 1 }}>
              <div style={{ position: 'absolute', left: r.x * scale, top: r.y * scale, transform: `translate(${off.x}px, ${off.y}px)`, opacity }}>{svgFor(o.id, rn)}</div>
            </div>
          );
        })}
        {hints && (
          <svg className="present-hints" width={frame.w * scale} height={frame.h * scale} viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}>
            {linked.map((h) => (
              <rect key={h.id} x={h.n.x - (scroll[frame.id]?.x ?? 0)} y={h.n.y - (scroll[frame.id]?.y ?? 0)} width={h.n.w} height={h.n.h} fill="rgba(151,71,255,0.22)" stroke="#9747ff" />
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}
