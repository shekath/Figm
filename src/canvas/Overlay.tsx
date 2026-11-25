import { useDisplayNodes } from './useDisplayNodes';
import { DEFAULT_MOTION, sampleTrack, type Vec } from '../lib/motion';
import { useEditor } from '../store/store';
import { rotatePoint, unionRects, visualBounds } from '../lib/geometry';
import type { SceneNode } from '../types';

const ACCENT = '#0d99ff';
const PROTO = '#9747ff';

/** Screen-space overlay: selection, handles, hover, guides, frame labels, prototype links. */
export function Overlay({ protoDrag, penId, cursor }: { protoDrag: { fromId: string; x: number; y: number } | null; penId: string | null; cursor: { x: number; y: number } | null }) {
  const st = useEditor();
  const { zoom, panX, panY, selection, hoverId, mode, guides, marquee, editingPathId } = st;
  const page = st.page();
  const S = (x: number, y: number) => ({ x: x * zoom + panX, y: y * zoom + panY });
  const nodes = useDisplayNodes();

  const outlineOf = (n: SceneNode, color: string, width = 1, key?: string) => {
    const cx = n.x + n.w / 2,
      cy = n.y + n.h / 2;
    const pts = [
      [n.x, n.y],
      [n.x + n.w, n.y],
      [n.x + n.w, n.y + n.h],
      [n.x, n.y + n.h],
    ].map(([x, y]) => {
      const r = n.rotation ? rotatePoint(x, y, cx, cy, n.rotation) : { x, y };
      const s = S(r.x, r.y);
      return `${s.x},${s.y}`;
    });
    return <polygon key={key ?? n.id} points={pts.join(' ')} fill="none" stroke={color} strokeWidth={width} />;
  };

  const sel = selection.map((id) => nodes[id]).filter(Boolean) as SceneNode[];
  const single = sel.length === 1 ? sel[0] : null;
  const bounds = single ? null : unionRects(sel.map(visualBounds));

  const handles: JSX.Element[] = [];
  // Motion mode: motion path + axis arrows (drag to record position keyframes)
  if (single && mode === 'motion' && !single.locked) {
    const base = st.doc.nodes[single.id];
    const kfs = base?.motion?.tracks.position;
    const dur = { ...DEFAULT_MOTION, ...st.doc.motion }.duration;
    const cxB = base.x + base.w / 2, cyB = base.y + base.h / 2;
    if (kfs && kfs.length > 1) {
      const pts: string[] = [];
      for (let i = 0; i <= 60; i++) {
        const v = sampleTrack(kfs, (i / 60) * dur) as Vec;
        const p = S(cxB + v.x, cyB + v.y);
        pts.push(`${p.x},${p.y}`);
      }
      handles.push(<polyline key="mpath" points={pts.join(' ')} fill="none" stroke={ACCENT} strokeWidth={1.2} strokeDasharray="4 3" opacity={0.8} />);
      for (const k of kfs) {
        const v = k.v as Vec;
        const p = S(cxB + v.x, cyB + v.y);
        handles.push(<path key={'mk' + k.id} d={`M${p.x} ${p.y - 5}L${p.x + 5} ${p.y}L${p.x} ${p.y + 5}L${p.x - 5} ${p.y}Z`} fill="#fff" stroke={ACCENT} strokeWidth={1.2} />);
      }
    }
    const c = S(single.x + single.w / 2, single.y + single.h / 2);
    handles.push(
      <g key="gizmo">
        <line x1={c.x} y1={c.y} x2={c.x} y2={c.y - 44} stroke="#22c55e" strokeWidth={2} />
        <path d={`M${c.x - 6} ${c.y - 40}L${c.x} ${c.y - 50}L${c.x + 6} ${c.y - 40}Z`} fill="#22c55e" />
        <rect data-handle="axis-y" x={c.x - 7} y={c.y - 52} width={14} height={44} fill="transparent" style={{ cursor: 'ns-resize' }} />
        <line x1={c.x} y1={c.y} x2={c.x + 44} y2={c.y} stroke="#ec4899" strokeWidth={2} />
        <path d={`M${c.x + 40} ${c.y - 6}L${c.x + 50} ${c.y}L${c.x + 40} ${c.y + 6}Z`} fill="#ec4899" />
        <rect data-handle="axis-x" x={c.x + 8} y={c.y - 7} width={44} height={14} fill="transparent" style={{ cursor: 'ew-resize' }} />
        <circle cx={c.x} cy={c.y} r={Math.min(30, Math.max(14, Math.min(single.w, single.h) * zoom * 0.3))} fill="none" stroke={ACCENT} strokeWidth={1.2} />
        <path data-handle="axis-xy" d={`M${c.x} ${c.y - 6}L${c.x + 6} ${c.y}L${c.x} ${c.y + 6}L${c.x - 6} ${c.y}Z`} fill="#fff" stroke={ACCENT} strokeWidth={1.4} style={{ cursor: 'move' }} />
      </g>,
    );
  }
  if (sel.length && (mode === 'design' || mode === 'draw') && !st.editingTextId && !editingPathId && !sel.some((n) => n.locked)) {
    const box = single ?? { x: bounds!.x, y: bounds!.y, w: bounds!.w, h: bounds!.h, rotation: 0 };
    const rot = single?.rotation ?? 0;
    const cx = box.x + box.w / 2,
      cy = box.y + box.h / 2;
    const pos: Record<string, [number, number]> = {
      nw: [box.x, box.y],
      n: [cx, box.y],
      ne: [box.x + box.w, box.y],
      e: [box.x + box.w, cy],
      se: [box.x + box.w, box.y + box.h],
      s: [cx, box.y + box.h],
      sw: [box.x, box.y + box.h],
      w: [box.x, cy],
    };
    const cursors: Record<string, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
    const small = box.w * zoom < 24 || box.h * zoom < 24;
    for (const [k, [x, y]] of Object.entries(pos)) {
      if (small && k.length === 1) continue;
      const r = rot ? rotatePoint(x, y, cx, cy, rot) : { x, y };
      const s = S(r.x, r.y);
      // invisible larger edge hit area
      handles.push(<rect key={k} data-handle={k} x={s.x - 4} y={s.y - 4} width={8} height={8} fill="#fff" stroke={ACCENT} strokeWidth={1} style={{ cursor: cursors[k] }} />);
    }
    // rotation handle
    const rh = rotatePoint(cx, box.y, cx, cy, rot);
    const rs = S(rh.x, rh.y);
    const ang = ((rot - 90) * Math.PI) / 180;
    handles.push(<circle key="rot" data-handle="rotate" cx={rs.x + Math.cos(ang) * 22} cy={rs.y + Math.sin(ang) * 22} r={5} fill="#fff" stroke={ACCENT} style={{ cursor: 'grab' }} />);
    // corner radius handle
    if (single && ['rect', 'frame', 'component', 'image'].includes(single.type) && single.w * zoom > 40 && single.h * zoom > 40) {
      const off = Math.max(single.radius, 10 / zoom);
      const p = rotatePoint(single.x + off, single.y + off, cx, cy, rot);
      const s = S(p.x, p.y);
      handles.push(<circle key="rad" data-handle="radius" cx={s.x} cy={s.y} r={4} fill="#fff" stroke={ACCENT} style={{ cursor: 'pointer' }} />);
    }
  }

  // size badge
  let badge: JSX.Element | null = null;
  if (sel.length && !st.editingTextId) {
    const b = unionRects(sel.map(visualBounds))!;
    const s = S(b.x + b.w / 2, b.y + b.h);
    const label = single ? `${round(single.w)} × ${round(single.h)}` : `${round(b.w)} × ${round(b.h)}`;
    badge = (
      <g>
        <rect x={s.x - label.length * 3.4 - 6} y={s.y + 8} width={label.length * 6.8 + 12} height={18} rx={3} fill={mode === 'prototype' ? PROTO : ACCENT} />
        <text x={s.x} y={s.y + 21} fill="#fff" fontSize={11} textAnchor="middle" fontFamily="Inter, system-ui">
          {label}
        </text>
      </g>
    );
  }

  // prototype connections
  const links: JSX.Element[] = [];
  if (mode === 'prototype') {
    const all = Object.values(nodes).filter((n) => n.prototype?.length && isOnPage(nodes, n.id, page.children));
    for (const n of all) {
      for (const l of n.prototype!) {
        const t = nodes[l.targetId];
        if (!t) continue;
        const a = S(n.x + n.w, n.y + n.h / 2);
        const b = S(t.x, t.y + Math.min(t.h / 2, 40));
        const mx = (a.x + b.x) / 2;
        links.push(
          <g key={n.id + l.targetId + l.trigger}>
            <path d={`M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x - 6},${b.y}`} fill="none" stroke={PROTO} strokeWidth={2} />
            <polygon points={`${b.x},${b.y} ${b.x - 8},${b.y - 5} ${b.x - 8},${b.y + 5}`} fill={PROTO} />
            <circle cx={a.x} cy={a.y} r={4} fill={PROTO} />
          </g>,
        );
      }
    }
    if (single) {
      const a = S(single.x + single.w, single.y + single.h / 2);
      links.push(<circle key="proto-handle" data-handle="proto" cx={a.x + 10} cy={a.y} r={7} fill="#fff" stroke={PROTO} strokeWidth={2} style={{ cursor: 'crosshair' }} />);
      links.push(
        <text key="proto-plus" x={a.x + 10} y={a.y + 4} fontSize={12} textAnchor="middle" fill={PROTO} pointerEvents="none">
          +
        </text>,
      );
    }
    if (protoDrag) {
      const from = nodes[protoDrag.fromId];
      if (from) {
        const a = S(from.x + from.w, from.y + from.h / 2);
        const b = S(protoDrag.x, protoDrag.y);
        links.push(<line key="pd" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={PROTO} strokeWidth={2} strokeDasharray="4 3" />);
      }
    }
  }

  // vector edit points
  const pts: JSX.Element[] = [];
  const editN = editingPathId ? nodes[editingPathId] : penId ? nodes[penId] : null;
  if (editN?.points) {
    editN.points.forEach((p, i) => {
      const s = S(editN.x + p.x, editN.y + p.y);
      for (const part of ['cin', 'cout'] as const) {
        const c = p[part];
        if (!c) continue;
        const cs = S(editN.x + c.x, editN.y + c.y);
        pts.push(<line key={`l${i}${part}`} x1={s.x} y1={s.y} x2={cs.x} y2={cs.y} stroke={ACCENT} strokeWidth={1} />);
        pts.push(<circle key={`c${i}${part}`} data-point={i} data-part={part} cx={cs.x} cy={cs.y} r={3.5} fill={ACCENT} style={{ cursor: 'move' }} />);
      }
      const on = editingPathId && st.selectedPoints.includes(i);
      const cur = st.pathTool === 'erase' ? 'not-allowed' : st.pathTool === 'cut' ? 'crosshair' : 'move';
      pts.push(<rect key={`p${i}`} data-point={i} data-part="p" x={s.x - 4} y={s.y - 4} width={8} height={8} rx={on ? 4 : 1} fill={on ? ACCENT : '#fff'} stroke={ACCENT} style={{ cursor: cur }} />);
    });
    if (penId && cursor && editN.points.length) {
      const last = editN.points[editN.points.length - 1];
      const a = S(editN.x + last.x, editN.y + last.y);
      const b = S(cursor.x, cursor.y);
      pts.push(<line key="rubber" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={ACCENT} strokeDasharray="3 3" pointerEvents="none" />);
    }
  }

  const hover = hoverId && !selection.includes(hoverId) && nodes[hoverId] ? outlineOf(nodes[hoverId], mode === 'prototype' ? PROTO : ACCENT, 1.5, 'hover') : null;

  return (
    <svg className="overlay" width="100%" height="100%">
      {/* frame labels for top-level frames */}
      {page.children.map((id) => {
        const n = nodes[id];
        if (!n || !n.visible || (n.type !== 'frame' && n.type !== 'component' && n.type !== 'instance')) return null;
        const s = S(n.x, n.y);
        const selected = selection.includes(id);
        const isComp = n.type === 'component' || n.type === 'instance';
        return (
          <text
            key={id}
            data-frame-label={id}
            x={s.x}
            y={s.y - 6}
            fontSize={11}
            fill={selected ? ACCENT : isComp ? PROTO : '#7a7a7a'}
            fontFamily="Inter, system-ui"
            style={{ cursor: 'default', userSelect: 'none' }}
          >
            {isComp ? '◆ ' : ''}
            {truncate(n.name, Math.max(4, Math.floor((n.w * zoom) / 6.5)))}
          </text>
        );
      })}
      {hover}
      {sel.map((n) => outlineOf(n, mode === 'prototype' ? PROTO : n.type === 'component' || n.type === 'instance' ? PROTO : ACCENT, 1))}
      {bounds && sel.length > 1 && (() => {
        const a = S(bounds.x, bounds.y);
        return <rect x={a.x} y={a.y} width={bounds.w * zoom} height={bounds.h * zoom} fill="none" stroke={ACCENT} strokeWidth={1} />;
      })()}
      {guides.map((g, i) => {
        if (g.axis === 'x') {
          const a = S(g.pos, g.from),
            b = S(g.pos, g.to);
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#f24822" strokeWidth={1} />;
        }
        const a = S(g.from, g.pos),
          b = S(g.to, g.pos);
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#f24822" strokeWidth={1} />;
      })}
      {marquee && (() => {
        const a = S(marquee.x, marquee.y);
        return <rect x={a.x} y={a.y} width={marquee.w * zoom} height={marquee.h * zoom} fill="rgba(13,153,255,0.08)" stroke={ACCENT} />;
      })()}
      {links}
      {handles}
      {pts}
      {badge}
    </svg>
  );
}

const round = (v: number) => Math.round(v * 100) / 100;
const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function isOnPage(nodes: Record<string, SceneNode>, id: string, roots: string[]) {
  let cur: SceneNode | undefined = nodes[id];
  while (cur?.parentId) cur = nodes[cur.parentId];
  return !!cur && roots.includes(cur.id);
}
