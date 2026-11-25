import { useState } from 'react';
import { useEditor } from '../store/store';
import { createNode } from '../lib/factory';
import { FRAME_PRESETS, matchPreset, type FramePreset } from '../lib/framePresets';

/** Place a new preset frame to the right of the page's existing top-level content. */
export function insertPresetFrame(p: FramePreset, landscape = false) {
  const st = useEditor.getState();
  const w = landscape ? p.h : p.w, h = landscape ? p.w : p.h;
  const tops = st.page().children.map((id) => st.doc.nodes[id]).filter(Boolean);
  const x = tops.length ? Math.max(...tops.map((n) => n.x + n.w)) + 100 : 0;
  const y = tops.length ? Math.min(...tops.map((n) => n.y)) : 0;
  const n = createNode('frame', { x, y, w, h, name: p.name });
  n.clip = true;
  st.checkpoint();
  st.addNode(n, null);
  st.set({ selection: [n.id], tool: 'move' });
  setTimeout(() => useEditor.getState().zoomToSelection(), 0);
}

/** Preset browser shown in the right panel while the Frame tool is active. */
export function FramePresetPanel() {
  const [open, setOpen] = useState<Record<string, boolean>>({ Phone: true, Tablet: true, Desktop: true });
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  return (
    <div className="presets">
      <div className="presets-head">
        <b>Frame</b>
        <span className="muted">Drag on the canvas, or pick a size</span>
      </div>
      <input className="text-input presets-search" placeholder="Search devices…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      {FRAME_PRESETS.map((g) => {
        const items = g.items.filter((p) => !query || p.name.toLowerCase().includes(query) || g.name.toLowerCase().includes(query));
        if (!items.length) return null;
        const isOpen = query ? true : open[g.name];
        return (
          <div key={g.name} className="preset-group">
            <button className="preset-group-head" onClick={() => setOpen({ ...open, [g.name]: !isOpen })}>
              <span className={`caret ${isOpen ? 'open' : ''}`}>▸</span> {g.name}
            </button>
            {isOpen &&
              items.map((p) => (
                <button key={p.name} className="preset" onClick={() => insertPresetFrame(p)} title={`Insert ${p.name} frame`}>
                  <span className="preset-ico-box"><span className="preset-ico" style={p.w > p.h ? { width: 14, height: Math.max(6, (14 * p.h) / p.w) } : { height: 14, width: Math.max(6, (14 * p.w) / p.h) }} /></span>
                  <span className="grow">{p.name}</span>
                  <small className="muted">{p.w}×{p.h}</small>
                </button>
              ))}
          </div>
        );
      })}
    </div>
  );
}

/** "Frame ▾" header for a selected top-level frame: resize to a preset and swap orientation. */
export function FrameTypeHeader({ id }: { id: string }) {
  const st = useEditor();
  const n = st.doc.nodes[id];
  const [open, setOpen] = useState(false);
  if (!n) return null;
  const match = matchPreset(n.w, n.h);
  const resize = (w: number, h: number) => st.updateNodes([id], { w, h });
  return (
    <div className="frame-type">
      <button className="frame-type-btn" onClick={() => setOpen(!open)} title="Resize to a device or format">
        <b>{n.type === 'component' ? 'Component' : 'Frame'}</b>
        <span className="muted">{match ? match.preset.name : 'Custom'}</span>
        <span className="caret">▾</span>
      </button>
      <div className="seg orient">
        <button className={n.h >= n.w ? 'on' : ''} title="Portrait" onClick={() => n.w > n.h && resize(n.h, n.w)}>▯</button>
        <button className={n.w > n.h ? 'on' : ''} title="Landscape" onClick={() => n.h > n.w && resize(n.h, n.w)}>▭</button>
      </div>
      {open && (
        <div className="frame-type-menu" onMouseLeave={() => setOpen(false)}>
          {FRAME_PRESETS.map((g) => (
            <div key={g.name}>
              <div className="cp-label">{g.name}</div>
              {g.items.map((p) => {
                const land = n.w > n.h && p.h > p.w;
                return (
                  <button key={p.name} className={match?.preset === p ? 'on' : ''} onClick={() => { st.checkpoint(); resize(land ? p.h : p.w, land ? p.w : p.h); setOpen(false); }}>
                    <span className="grow">{p.name}</span>
                    <small>{p.w}×{p.h}</small>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
