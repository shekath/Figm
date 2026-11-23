import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from './store/store';
import { RenderNode } from './canvas/render';
import { pointInNode } from './lib/geometry';
import type { PrototypeLink, SceneNode } from './types';

/** Full-screen prototype player. */
export function Presenter() {
  const st = useEditor();
  const page = st.page();
  const nodes = st.doc.nodes;
  const frames = page.children.map((id) => nodes[id]).filter((n): n is SceneNode => !!n && (n.type === 'frame' || n.type === 'component') && n.visible);
  const start = (page.startFrameId && nodes[page.startFrameId] ? page.startFrameId : frames[0]?.id) ?? null;
  const [stack, setStack] = useState<string[]>(start ? [start] : []);
  const [anim, setAnim] = useState<{ from: string; kind: PrototypeLink['animation']; dur: number } | null>(null);
  const [hoverFrom, setHoverFrom] = useState<string | null>(null);
  const [showHotspots, setShowHotspots] = useState(false);
  const cur = stack[stack.length - 1];
  const frame = cur ? nodes[cur] : null;
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: innerWidth, h: innerHeight });

  useEffect(() => {
    const r = () => setSize({ w: innerWidth, h: innerHeight });
    window.addEventListener('resize', r);
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') st.set({ presenting: false });
      if (e.key === 'ArrowRight') go(frames[(frames.findIndex((f) => f.id === cur) + 1) % frames.length]?.id, 'slide-left', 250);
      if (e.key === 'ArrowLeft') back();
      if (e.key.toLowerCase() === 'r') setStack(start ? [start] : []);
    };
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('resize', r);
      window.removeEventListener('keydown', k);
    };
  });

  const linked = useMemo(() => {
    if (!frame) return [] as SceneNode[];
    const out: SceneNode[] = [];
    const walk = (ids: string[]) => ids.forEach((id) => { const n = nodes[id]; if (!n || !n.visible) return; if (n.prototype?.length) out.push(n); walk(n.children); });
    if (frame.prototype?.length) out.push(frame);
    walk(frame.children);
    return out;
  }, [frame, nodes]);

  // after-delay interactions
  useEffect(() => {
    const timers = linked.flatMap((n) => (n.prototype ?? []).filter((l) => l.trigger === 'after-delay').map((l) => setTimeout(() => follow(l), l.delay ?? 800)));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur]);

  function go(id: string | undefined, kind: PrototypeLink['animation'] = 'instant', dur = 300) {
    if (!id || id === cur) return;
    setAnim(kind === 'instant' ? null : { from: cur, kind, dur });
    setStack((s) => [...s, id]);
    if (kind !== 'instant') setTimeout(() => setAnim(null), dur);
  }
  function back() {
    if (stack.length > 1) setStack((s) => s.slice(0, -1));
  }
  function follow(l: PrototypeLink) {
    if (l.targetId === 'back') back();
    else go(l.targetId, l.animation, l.duration);
  }

  if (!frame)
    return (
      <div className="presenter">
        <div className="present-empty">
          Add a frame to this page to present it.
          <button className="btn" onClick={() => st.set({ presenting: false })}>Close</button>
        </div>
      </div>
    );

  const scale = Math.min(1, (size.w - 80) / frame.w, (size.h - 120) / frame.h);
  const hoverTarget = hoverFrom ? nodes[hoverFrom]?.prototype?.find((l) => l.trigger === 'hover')?.targetId : null;
  const shown = hoverTarget && nodes[hoverTarget] ? nodes[hoverTarget] : frame;

  const onClick = (e: React.MouseEvent) => {
    const r = box.current!.getBoundingClientRect();
    const x = (e.clientX - r.left) / scale + shown.x,
      y = (e.clientY - r.top) / scale + shown.y;
    // topmost linked node under the pointer
    const hit = [...linked].reverse().find((n) => n.prototype!.some((l) => l.trigger === 'click') && pointInNode(n, x, y));
    if (hit) follow(hit.prototype!.find((l) => l.trigger === 'click')!);
    else {
      setShowHotspots(true);
      setTimeout(() => setShowHotspots(false), 600);
    }
  };
  const onMove = (e: React.MouseEvent) => {
    const r = box.current!.getBoundingClientRect();
    const x = (e.clientX - r.left) / scale + frame.x,
      y = (e.clientY - r.top) / scale + frame.y;
    const hit = linked.find((n) => n.prototype!.some((l) => l.trigger === 'hover') && pointInNode(n, x, y));
    setHoverFrom(hit?.id ?? null);
    box.current!.style.cursor = linked.some((n) => pointInNode(n, x, y)) ? 'pointer' : 'default';
  };

  const animClass = anim ? `anim-${anim.kind}` : '';

  return (
    <div className="presenter">
      <div className="present-bar">
        <span>{frame.name}</span>
        <span className="muted">{stack.length > 1 ? '← to go back · ' : ''}R restart · Esc close</span>
        <select value={cur} onChange={(e) => go(e.target.value)}>
          {frames.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        <button className="btn small" onClick={() => st.set({ presenting: false })}>Close</button>
      </div>
      <div
        ref={box}
        key={cur}
        className={`present-stage ${animClass}`}
        style={{ width: shown.w * scale, height: shown.h * scale, animationDuration: anim ? anim.dur + 'ms' : undefined }}
        onClick={onClick}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverFrom(null)}
      >
        <svg width={shown.w * scale} height={shown.h * scale} viewBox={`${shown.x} ${shown.y} ${shown.w} ${shown.h}`}>
          <RenderNode id={shown.id} ctx={{ nodes }} />
          {showHotspots && linked.map((n) => <rect key={n.id} x={n.x} y={n.y} width={n.w} height={n.h} fill="rgba(151,71,255,0.25)" stroke="#9747ff" />)}
        </svg>
      </div>
    </div>
  );
}
