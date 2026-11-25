import { useState } from 'react';
import { useEditor } from '../store/store';
import { PaintPicker } from './ColorPicker';
import { BRUSH_STYLES, brushPreviewPath } from '../lib/brush';
import { reversePath, sharpenAnchors, smoothAnchors } from '../lib/pathEdit';
import type { Tool } from '../types';

/* ---------- illustrated tools (drawn here, original artwork) ---------- */
function PenArt() {
  return (
    <svg width="34" height="46" viewBox="0 0 34 46">
      <defs><linearGradient id="dt-pen" x1="0" x2="1"><stop offset="0" stopColor="#d9d9de" /><stop offset=".5" stopColor="#fff" /><stop offset="1" stopColor="#bdbdc4" /></linearGradient></defs>
      <path d="M17 3 L26 20 L23 30 L11 30 L8 20 Z" fill="url(#dt-pen)" stroke="#1e1e24" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M17 6 V18" stroke="#1e1e24" strokeWidth="1.2" />
      <circle cx="17" cy="19.5" r="2.6" fill="#1e1e24" />
      <rect x="10" y="30" width="14" height="16" rx="2" fill="#26262c" />
      <rect x="10" y="30" width="14" height="3" fill="#3a3a42" />
    </svg>
  );
}
function BrushArt() {
  return (
    <svg width="34" height="46" viewBox="0 0 34 46">
      <defs><linearGradient id="dt-br" x1="0" x2="1"><stop offset="0" stopColor="#e6e6ea" /><stop offset=".5" stopColor="#fff" /><stop offset="1" stopColor="#c8c8ce" /></linearGradient></defs>
      <path d="M9 18 C9 8 12 3 17 3 C22 3 25 8 25 18 Z" fill="#1e1e24" />
      <path d="M12 6 V17 M15 4.5 V17 M19 4.5 V17 M22 6 V17" stroke="#55555e" strokeWidth=".8" />
      <rect x="8.5" y="17" width="17" height="11" rx="1.5" fill="url(#dt-br)" stroke="#9a9aa2" strokeWidth=".8" />
      <path d="M8.5 21 H25.5 M8.5 24 H25.5" stroke="#a8a8b0" strokeWidth=".8" />
      <rect x="10" y="28" width="14" height="18" rx="2" fill="#26262c" />
    </svg>
  );
}
function PencilArt() {
  return (
    <svg width="34" height="46" viewBox="0 0 34 46">
      <path d="M17 2 L24 20 L10 20 Z" fill="#f2e3c9" stroke="#1e1e24" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M17 2 L19.6 8.6 L14.4 8.6 Z" fill="#1e1e24" />
      <rect x="10" y="20" width="14" height="26" fill="#26262c" />
      <path d="M14.6 20 V46 M19.4 20 V46" stroke="#3c3c44" strokeWidth="1" />
    </svg>
  );
}

const DRAW_TOOLS: { tool: Tool; label: string; key: string; Art: () => JSX.Element }[] = [
  { tool: 'pen', label: 'Pen', key: 'P', Art: PenArt },
  { tool: 'brush', label: 'Brush', key: 'B', Art: BrushArt },
  { tool: 'pencil', label: 'Pencil', key: 'Shift+P', Art: PencilArt },
];

/** Pen / Brush / Pencil shown as physical tools that rise when selected. */
export function DrawToolButtons() {
  const st = useEditor();
  return (
    <div className="draw-tools">
      {DRAW_TOOLS.map(({ tool, label, key, Art }) => (
        <button key={tool} className={`draw-tool ${st.tool === tool ? 'on' : ''}`} title={`${label} (${key})`} onClick={() => st.set({ tool, editingPathId: null })}>
          <Art />
        </button>
      ))}
    </div>
  );
}

function Swatch({ color, onChange }: { color: string; onChange: (c: string) => void }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return (
    <>
      <button className="db-swatch" style={{ background: color }} title="Colour" onClick={(e) => setAnchor(anchor ? null : (e.currentTarget.closest('.draw-bar') as HTMLElement).getBoundingClientRect())} />
      {anchor && (
        <PaintPicker solidOnly placement="below" anchor={new DOMRect(anchor.left, anchor.top - 420, anchor.width, 0)} paint={{ id: 'draw', kind: 'solid', color, opacity: 1, visible: true }} onClose={() => setAnchor(null)} onChange={(p) => onChange(p.color)} />
      )}
    </>
  );
}

function SizeControl({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="db-size">
      <input className="db-num" value={value} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v))); }} onKeyDown={(e) => e.stopPropagation()} />
      <input className="db-range" type="range" min={min} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ ['--p' as string]: `${((value - min) / (max - min)) * 100}%` }} />
    </div>
  );
}

/** Settings bar above the dock for the active drawing tool. */
export function DrawBar() {
  const st = useEditor();
  const [tipHidden, setTipHidden] = useState(() => { try { return localStorage.getItem('figmy:draw-tip') === '1'; } catch { return false; } });
  const [styleOpen, setStyleOpen] = useState(false);
  if (!['pen', 'pencil', 'brush'].includes(st.tool) || st.editingPathId || st.mode === 'dev' || st.mode === 'prototype') return null;
  const hideTip = () => { setTipHidden(true); try { localStorage.setItem('figmy:draw-tip', '1'); } catch { /* ignore */ } };
  const close = () => st.set({ tool: 'move' });
  return (
    <div className="draw-bar" onPointerDown={(e) => e.stopPropagation()}>
      {st.tool !== 'pen' && !tipHidden && (
        <div className="db-tip">
          <span className="db-tip-ico">⌖</span> Ctrl+click a stroke to sample its properties
          <button onClick={hideTip} title="Dismiss">✕</button>
        </div>
      )}
      <div className="db-row">
        {st.tool === 'pen' && (
          <>
            <Swatch color={st.draw.pen.color} onChange={(color) => st.setDraw('pen', { color })} />
            <SizeControl value={st.draw.pen.width} min={1} max={50} onChange={(width) => st.setDraw('pen', { width })} />
          </>
        )}
        {st.tool === 'pencil' && (
          <>
            <Swatch color={st.draw.pencil.color} onChange={(color) => st.setDraw('pencil', { color })} />
            <SizeControl value={st.draw.pencil.width} min={1} max={50} onChange={(width) => st.setDraw('pencil', { width })} />
          </>
        )}
        {st.tool === 'brush' && (
          <>
            <Swatch color={st.draw.brush.color} onChange={(color) => st.setDraw('brush', { color })} />
            <SizeControl value={st.draw.brush.size} min={1} max={120} onChange={(size) => st.setDraw('brush', { size })} />
            <div className="db-style">
              <button className="db-style-btn" onClick={() => setStyleOpen(!styleOpen)} title={`Brush: ${st.draw.brush.style}`}>
                <svg width="120" height="22" viewBox="0 0 160 22"><path d={brushPreviewPath(st.draw.brush.style)} fill="currentColor" /></svg>
                <span className="caret">⌄</span>
              </button>
              {styleOpen && (
                <div className="db-style-menu" onMouseLeave={() => setStyleOpen(false)}>
                  {BRUSH_STYLES.map((b) => (
                    <button key={b.id} className={st.draw.brush.style === b.id ? 'on' : ''} onClick={() => { st.setDraw('brush', { style: b.id }); setStyleOpen(false); }}>
                      <svg width="120" height="22" viewBox="0 0 160 22"><path d={brushPreviewPath(b.id)} fill="currentColor" /></svg>
                      <span>{b.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        <button className="db-close" title="Close (Esc)" onClick={close}>✕</button>
      </div>
    </div>
  );
}

const PATH_TOOLS: { id: 'move' | 'lasso' | 'paint' | 'bend' | 'cut' | 'erase'; label: string; icon: JSX.Element; hint: string }[] = [
  { id: 'move', label: 'Move', hint: 'Drag points and handles (Shift-click to select several)', icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M3 12c2-6 4-8 10-9" /><circle cx="3" cy="12" r="1.6" fill="currentColor" /><circle cx="13" cy="3" r="1.6" /><path d="M8 7.5l3.5 5 1-2.2 2.2-.6z" fill="currentColor" /></svg> },
  { id: 'lasso', label: 'Lasso', hint: 'Draw around points to select them', icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.6"><ellipse cx="8" cy="7" rx="6" ry="4.5" /></svg> },
  { id: 'paint', label: 'Paint', hint: 'Click to fill or unfill the shape', icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M3 8l5-5 5 5-5 5z" /><path d="M13.5 10.5c0 1-.6 2-1.2 2s-1.2-1-1.2-2l1.2-1.6z" fill="currentColor" /></svg> },
  { id: 'bend', label: 'Bend', hint: 'Drag a segment to curve it', icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M3 13C3 6 8 3 13 3" /><circle cx="3" cy="13" r="1.4" /><circle cx="13" cy="3" r="1.4" /></svg> },
  { id: 'cut', label: 'Cut', hint: 'Click a point or segment to split the path', icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2"><circle cx="4.5" cy="11.5" r="2" /><circle cx="11.5" cy="11.5" r="2" /><path d="M5.8 10 12 2.5M10.2 10 4 2.5" /></svg> },
  { id: 'erase', label: 'Erase', hint: 'Click or drag over points to remove them', icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M6 13l-3.5-3.5 6.5-6.5 4.5 4.5-6 6z" /><path d="M6 13h7M5 6.5l4.5 4.5" /></svg> },
];

/** Toolbar shown while editing a vector path. */
export function PathEditBar() {
  const st = useEditor();
  const [more, setMore] = useState(false);
  if (!st.editingPathId) return null;
  const id = st.editingPathId;
  const n = st.doc.nodes[id];
  if (!n?.points) return null;
  const sel = st.selectedPoints;
  const run = (fn: (x: typeof n) => void) => { st.mutate((d) => fn(d.nodes[id])); setMore(false); };
  return (
    <div className="path-bar" onPointerDown={(e) => e.stopPropagation()}>
      {PATH_TOOLS.map((t, i) => (
        <span key={t.id} className="pb-wrap">
          {(i === 2) && <span className="pb-sep" />}
          <button className={`pb-btn ${st.pathTool === t.id ? 'on' : ''}`} title={t.hint} onClick={() => st.set({ pathTool: t.id })}>
            {t.icon}<span>{t.label}</span>
          </button>
        </span>
      ))}
      <span className="pb-sep" />
      <div className="pb-more">
        <button className="pb-btn" onClick={() => setMore(!more)}>More <span className="caret">⌄</span></button>
        {more && (
          <div className="pb-menu" onMouseLeave={() => setMore(false)}>
            <button onClick={() => run((x) => smoothAnchors(x, sel))}>Smooth {sel.length ? 'selected points' : 'all points'}</button>
            <button onClick={() => run((x) => sharpenAnchors(x, sel))}>Sharpen {sel.length ? 'selected points' : 'all points'}</button>
            <button onClick={() => run((x) => { x.closed = !x.closed; })}>{n.closed ? 'Open path' : 'Close path'}</button>
            <button onClick={() => run(reversePath)}>Reverse direction</button>
            <button onClick={() => { st.set({ selectedPoints: n.points!.map((_, i) => i) }); setMore(false); }}>Select all points</button>
          </div>
        )}
      </div>
      <span className="pb-sep" />
      <button className="pb-btn icon" title="Done (Esc)" onClick={() => st.set({ editingPathId: null, pathTool: 'move', selectedPoints: [] })}>✕</button>
    </div>
  );
}
