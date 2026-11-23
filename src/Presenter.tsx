import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from './store/store';
import { RenderNode } from './canvas/render';
import { EASINGS, scrollExtent, smartAnimateFrame } from './lib/proto';
import type { Animation, PrototypeLink, SceneNode } from './types';

type Nodes = Record<string, SceneNode>;
type Scroll = Record<string, { x: number; y: number }>;
interface Screen {
  id: string;
  via?: PrototypeLink;
  temp?: string; // node id that triggered a temporary (hover/press) navigation
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

const normAnim = (a: Animation): { kind: Animation; dir?: PrototypeLink['direction'] } =>
  a === 'slide-left' ? { kind: 'move-in', dir: 'left' } : a === 'slide-right' ? { kind: 'move-in', dir: 'right' } : a === 'slide-up' ? { kind: 'move-in', dir: 'up' } : { kind: a };

/** Full-screen prototype player with Smart Animate, overlays, scrolling and all trigger types. */
export function Presenter() {
  const st = useEditor();
  const page = st.page();
  const nodes = st.doc.nodes;
  const frames = page.children.map((id) => nodes[id]).filter((n): n is SceneNode => !!n && (n.type === 'frame' || n.type === 'component') && n.visible);
  const start = (page.startFrameId && nodes[page.startFrameId] ? page.startFrameId : frames[0]?.id) ?? null;

  const [screens, setScreens] = useState<Screen[]>(start ? [{ id: start }] : []);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [scroll, setScroll] = useState<Scroll>({});
  const [anim, setAnim] = useState<Anim | null>(null);
  const [t, setT] = useState(1);
  const [hints, setHints] = useState(false);
  const [size, setSize] = useState({ w: innerWidth, h: innerHeight });
  const stageRef = useRef<HTMLDivElement>(null);
  const hoverPath = useRef<string[]>([]);
  const pressed = useRef<string | null>(null);

  const cur = screens[screens.length - 1]?.id;
  const frame = cur ? nodes[cur] : null;

  /* ---------- animation loop ---------- */
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

  const follow = (l: PrototypeLink, sourceId?: string, temp = false) => {
    const action = l.action ?? (l.targetId === 'back' ? 'back' : 'navigate');
    switch (action) {
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
        return openOverlay(l.targetId, l, temp ? sourceId : undefined);
      case 'swap-overlay':
        return openOverlay(l.targetId, l, undefined, true);
      default:
        return go(l.targetId, l, temp ? sourceId : undefined);
    }
  };

  /* ---------- timers & keys ---------- */
  const activeFrames = useMemo(() => [cur, ...overlays.map((o) => o.id)].filter(Boolean) as string[], [cur, overlays]);
  const linkedIn = useCallback(
    (frameId: string) => {
      const out: SceneNode[] = [];
      const walk = (id: string) => {
        const n = nodes[id];
        if (!n || !n.visible) return;
        if (n.prototype?.length) out.push(n);
        n.children.forEach(walk);
      };
      walk(frameId);
      return out;
    },
    [nodes],
  );

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const top = activeFrames[activeFrames.length - 1];
    if (top)
      for (const n of linkedIn(top))
        for (const l of n.prototype!) if (l.trigger === 'after-delay') timers.push(setTimeout(() => follow(l, n.id), l.delay ?? 800));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFrames.join('|')]);

  useEffect(() => {
    const r = () => setSize({ w: innerWidth, h: innerHeight });
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return st.set({ presenting: false });
      const top = activeFrames[activeFrames.length - 1];
      const keyed = top ? linkedIn(top).flatMap((n) => n.prototype!.filter((l) => l.trigger === 'key' && l.key && l.key.toLowerCase() === e.key.toLowerCase()).map((l) => ({ n, l }))) : [];
      if (keyed.length) {
        e.preventDefault();
        return follow(keyed[0].l, keyed[0].n.id);
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

  /** Path of node ids under a point (frame-local coords), honouring scroll offsets and fixed layers. */
  const pathAt = (rootId: string, lx: number, ly: number): string[] => {
    const root = nodes[rootId];
    const px = root.x + lx,
      py = root.y + ly;
    let best: string[] = [];
    const walk = (id: string, ox: number, oy: number, path: string[]) => {
      const n = nodes[id];
      if (!n || !n.visible) return;
      const inside = px >= n.x - ox && px <= n.x - ox + n.w && py >= n.y - oy && py <= n.y - oy + n.h;
      if (!inside && (n.clip || n.type !== 'group')) return;
      const p = inside ? [...path, id] : path;
      if (inside && p.length > best.length) best = p;
      const s = scroll[id];
      for (const c of n.children) {
        const k = nodes[c];
        const cox = ox + (s && !k?.fixed ? s.x : 0),
          coy = oy + (s && !k?.fixed ? s.y : 0);
        walk(c, cox, coy, p);
      }
    };
    walk(rootId, 0, 0, []);
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

  const linkFor = (path: string[], triggers: PrototypeLink['trigger'][]) => {
    for (let i = path.length - 1; i >= 0; i--) {
      const n = nodes[path[i]];
      const l = n?.prototype?.find((x) => triggers.includes(x.trigger));
      if (l) return { n, l };
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
    if (hit) follow(hit.l, hit.n.id);
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
      pressed.current = hit.n.id;
      follow(hit.l, hit.n.id, true);
    }
  };
  const onPointerUp = () => {
    if (!pressed.current) return;
    const id = pressed.current;
    pressed.current = null;
    if (screens[screens.length - 1]?.temp === id) back();
    else if (overlays[overlays.length - 1]?.temp === id) closeOverlay();
  };

  const onMove = (e: React.PointerEvent) => {
    const tg = target(e);
    const path = tg.outside ? [] : pathAt(tg.frameId, tg.x, tg.y);
    const prev = hoverPath.current;
    hoverPath.current = path;
    const entered = path.filter((id) => !prev.includes(id));
    const left = prev.filter((id) => !path.includes(id));
    for (const id of left) {
      const n = nodes[id];
      for (const l of n?.prototype ?? []) if (l.trigger === 'mouse-leave') follow(l, id);
      if (n?.prototype?.some((l) => l.trigger === 'hover')) {
        if (screens[screens.length - 1]?.temp === id) back();
        else if (overlays[overlays.length - 1]?.temp === id) closeOverlay();
      }
    }
    if (!anim)
      for (const id of entered) {
        const n = nodes[id];
        for (const l of n?.prototype ?? []) {
          if (l.trigger === 'mouse-enter') follow(l, id);
          if (l.trigger === 'hover') follow(l, id, true);
        }
      }
    const interactive = path.some((id) => nodes[id]?.prototype?.length);
    stageRef.current!.style.cursor = interactive ? 'pointer' : 'default';
  };

  const onWheel = (e: React.WheelEvent) => {
    const tg = target(e);
    if (tg.outside) return;
    const path = pathAt(tg.frameId, tg.x, tg.y);
    // deepest scrollable container under the pointer, else the frame itself
    const candidates = [...path].reverse().filter((id) => {
      const n = nodes[id];
      return n && (n.type === 'frame' || n.type === 'component') && (n.overflow ?? 'none') !== 'none';
    });
    const id = candidates[0] ?? (nodes[tg.frameId].overflow && nodes[tg.frameId].overflow !== 'none' ? tg.frameId : null);
    if (!id) return;
    const n = nodes[id];
    const ext = scrollExtent(nodes, id);
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

  /* ---------- rendering ---------- */
  const svgFor = (id: string, n: Nodes, extra?: React.ReactNode, style?: React.CSSProperties) => {
    const f = n[id];
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
  if (anim?.kind === 'screen' && anim.from && nodes[anim.from]) {
    const forwardFrom = anim.reverse ? anim.to : anim.from;
    const forwardTo = anim.reverse ? anim.from : anim.to;
    const e = eased(anim.link, anim.reverse ? 1 - t : t);
    const { kind, dir } = normAnim(anim.link.animation);
    const direction = dir ?? anim.link.direction;
    const W = frame.w * scale,
      H = frame.h * scale;
    const tf = (o: { x: number; y: number }, opacity = 1): React.CSSProperties => ({ transform: `translate(${o.x}px, ${o.y}px)`, opacity });
    if (kind === 'smart-animate') {
      const sa = smartAnimateFrame(nodes, forwardFrom, forwardTo, e);
      const dest = nodes[forwardTo];
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
          {svgFor(forwardFrom, nodes, null, tf({ x: 0, y: 0 }))}
          {svgFor(forwardTo, nodes, null, tf({ x: 0, y: 0 }, e))}
        </>
      );
    } else if (kind === 'move-in') {
      layers = (
        <>
          {svgFor(forwardFrom, nodes, null, tf({ x: 0, y: 0 }))}
          {svgFor(forwardTo, nodes, null, tf(offsetFor(direction, 1 - e, W, H)))}
        </>
      );
    } else if (kind === 'move-out') {
      layers = (
        <>
          {svgFor(forwardTo, nodes, null, tf({ x: 0, y: 0 }))}
          {svgFor(forwardFrom, nodes, null, tf(offsetFor(direction, -e, W, H)))}
        </>
      );
    } else if (kind === 'push') {
      layers = (
        <>
          {svgFor(forwardFrom, nodes, null, tf(offsetFor(direction, -e, W, H)))}
          {svgFor(forwardTo, nodes, null, tf(offsetFor(direction, 1 - e, W, H)))}
        </>
      );
    } else if (kind === 'slide-in') {
      layers = (
        <>
          {svgFor(forwardFrom, nodes, null, tf(offsetFor(direction, -0.3 * e, W, H), 1 - 0.3 * e))}
          {svgFor(forwardTo, nodes, null, tf(offsetFor(direction, 1 - e, W, H)))}
        </>
      );
    } else if (kind === 'slide-out') {
      layers = (
        <>
          {svgFor(forwardTo, nodes, null, tf(offsetFor(direction, 0.3 * (e - 1), W, H)))}
          {svgFor(forwardFrom, nodes, null, tf(offsetFor(direction, -e, W, H)))}
        </>
      );
    } else layers = svgFor(cur!, nodes);
  } else layers = svgFor(cur!, nodes);

  const linked = activeFrames.flatMap((id) => linkedIn(id));

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
              <div style={{ position: 'absolute', left: r.x * scale, top: r.y * scale, transform: `translate(${off.x}px, ${off.y}px)`, opacity }}>{svgFor(o.id, nodes)}</div>
            </div>
          );
        })}
        {hints && (
          <svg className="present-hints" width={frame.w * scale} height={frame.h * scale} viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}>
            {linked.map((n) => (
              <rect key={n.id} x={n.x - (scroll[frame.id]?.x ?? 0)} y={n.y - (scroll[frame.id]?.y ?? 0)} width={n.w} height={n.h} fill="rgba(151,71,255,0.22)" stroke="#9747ff" />
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}
