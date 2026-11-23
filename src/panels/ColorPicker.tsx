import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from '../store/store';
import type { GradientStop, Paint } from '../types';
import { pickFile } from '../lib/platform';
import { blobToDataUrl } from '../lib/exporter';

/* ---------- colour maths ---------- */
export type HSV = { h: number; s: number; v: number };
export function hexToRgb(hex: string) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
export const rgbToHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
export function rgbToHsv(r: number, g: number, b: number): HSV {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}
export function hsvToRgb({ h, s, v }: HSV) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return { r: f(5), g: f(3), b: f(1) };
}
function rgbToHsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  const { h } = rgbToHsv(r * 255, g * 255, b * 255);
  return { h, s, l };
}
function hslToRgb(h: number, s: number, l: number) {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
  };
  return { r: f(0), g: f(8), b: f(4) };
}
const hsvToHex = (c: HSV) => { const { r, g, b } = hsvToRgb(c); return rgbToHex(r, g, b); };
const hexToHsv = (hex: string) => { const { r, g, b } = hexToRgb(hex); return rgbToHsv(r, g, b); };

type Format = 'hex' | 'rgb' | 'hsl' | 'hsb' | 'css';

/** Drag helper for 2D/1D pads. */
function useDrag(onMove: (x: number, y: number) => void, onEnd?: () => void) {
  return (e: React.PointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const move = (ev: PointerEvent | React.PointerEvent) => onMove(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)));
    move(e);
    el.setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent) => move(ev);
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); onEnd?.(); };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
  };
}

/** Solid colour editor: saturation/brightness square, hue + alpha sliders, eyedropper, formats. */
export function ColorEditor({ color, alpha, onChange, onCommit }: { color: string; alpha: number; onChange: (hex: string, alpha: number) => void; onCommit?: () => void }) {
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(color));
  const [fmt, setFmt] = useState<Format>(() => (localStorage.getItem('figmy:color-format') as Format) || 'hex');
  // keep hue when the incoming colour is grey/black (hue undefined)
  useEffect(() => {
    if (hsvToHex(hsv) !== color.toLowerCase()) {
      const n = hexToHsv(color);
      setHsv((p) => ({ h: n.s === 0 || n.v === 0 ? p.h : n.h, s: n.v === 0 ? p.s : n.s, v: n.v }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color]);
  const emit = (c: HSV, a = alpha) => { setHsv(c); onChange(hsvToHex(c), a); };
  const sv = useDrag((x, y) => emit({ ...hsv, s: x, v: 1 - y }), onCommit);
  const hue = useDrag((x) => emit({ ...hsv, h: x * 359.9 }), onCommit);
  const alp = useDrag((x) => onChange(hsvToHex(hsv), Math.round(x * 100) / 100), onCommit);
  const { r, g, b } = hsvToRgb(hsv);
  const pure = hsvToHex({ h: hsv.h, s: 1, v: 1 });
  const hex = hsvToHex(hsv);
  const setFormat = (f: Format) => { setFmt(f); try { localStorage.setItem('figmy:color-format', f); } catch { /* ignore */ } };
  const eyedrop = async () => {
    const ED = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (!ED) return useEditor.getState().notify('Eyedropper is not supported in this browser (try Chrome or the desktop app)');
    try {
      const res = await new ED().open();
      const h = res.sRGBHex.startsWith('#') ? res.sRGBHex : rgbToHex(...(res.sRGBHex.match(/\d+/g)!.map(Number) as [number, number, number]));
      emit(hexToHsv(h));
      onCommit?.();
    } catch { /* cancelled */ }
  };
  const fields: { label: string; value: number | string; set: (v: string) => void; w?: number }[] =
    fmt === 'hex' || fmt === 'css'
      ? [{ label: fmt === 'css' ? 'CSS' : 'Hex', value: fmt === 'css' ? `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})` : hex.slice(1).toUpperCase(), w: 3, set: (v) => {
          const m = v.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
          if (m) emit(hexToHsv('#' + m[1]));
          const c = v.match(/rgba?\(([^)]+)\)/i);
          if (c) { const [rr, gg, bb, aa] = c[1].split(',').map((x) => parseFloat(x)); emit(rgbToHsv(rr, gg, bb), aa ?? alpha); }
        } }]
      : fmt === 'rgb'
        ? (['r', 'g', 'b'] as const).map((k, i) => ({ label: k.toUpperCase(), value: Math.round([r, g, b][i]), set: (v: string) => { const c = { r, g, b, [k]: Math.max(0, Math.min(255, Number(v) || 0)) }; emit(rgbToHsv(c.r, c.g, c.b)); } }))
        : fmt === 'hsl'
          ? (() => { const l = rgbToHsl(r, g, b); return [
              { label: 'H', value: Math.round(hsv.h), set: (v: string) => { const c = hslToRgb(Number(v) % 360, l.s, l.l); emit({ ...rgbToHsv(c.r, c.g, c.b), h: Number(v) % 360 }); } },
              { label: 'S', value: Math.round(l.s * 100), set: (v: string) => { const c = hslToRgb(hsv.h, Math.min(100, Number(v)) / 100, l.l); emit({ ...rgbToHsv(c.r, c.g, c.b), h: hsv.h }); } },
              { label: 'L', value: Math.round(l.l * 100), set: (v: string) => { const c = hslToRgb(hsv.h, l.s, Math.min(100, Number(v)) / 100); emit({ ...rgbToHsv(c.r, c.g, c.b), h: hsv.h }); } },
            ]; })()
          : [
              { label: 'H', value: Math.round(hsv.h), set: (v: string) => emit({ ...hsv, h: (Number(v) || 0) % 360 }) },
              { label: 'S', value: Math.round(hsv.s * 100), set: (v: string) => emit({ ...hsv, s: Math.min(100, Number(v) || 0) / 100 }) },
              { label: 'B', value: Math.round(hsv.v * 100), set: (v: string) => emit({ ...hsv, v: Math.min(100, Number(v) || 0) / 100 }) },
            ];
  return (
    <div className="cp-editor">
      <div className="cp-sv" style={{ background: pure }} onPointerDown={sv}>
        <div className="cp-sv-w" />
        <div className="cp-sv-b" />
        <span className="cp-knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
      </div>
      <div className="cp-sliders-row">
        <button className="cp-eyedrop" title="Pick a colour from the screen (I)" onClick={eyedrop}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M10.5 2.5l3 3-1.5 1.5-3-3zM9 4l3 3-6.5 6.5H2.5V10.5z" /></svg>
        </button>
        <div className="cp-sliders">
          <div className="cp-hue" onPointerDown={hue}><span className="cp-thumb" style={{ left: `${(hsv.h / 360) * 100}%`, background: pure }} /></div>
          <div className="cp-alpha" onPointerDown={alp}>
            <div style={{ background: `linear-gradient(90deg, transparent, ${hex})` }} />
            <span className="cp-thumb" style={{ left: `${alpha * 100}%`, background: hex }} />
          </div>
        </div>
      </div>
      <div className="cp-values">
        <select value={fmt} onChange={(e) => setFormat(e.target.value as Format)} onKeyDown={(e) => e.stopPropagation()}>
          <option value="hex">Hex</option>
          <option value="rgb">RGB</option>
          <option value="hsl">HSL</option>
          <option value="hsb">HSB</option>
          <option value="css">CSS</option>
        </select>
        {fields.map((f) => (
          <ValueInput key={fmt + f.label} value={f.value} onCommit={(v) => { f.set(v); onCommit?.(); }} grow={f.w} title={f.label} />
        ))}
        <ValueInput value={Math.round(alpha * 100) + '%'} onCommit={(v) => { onChange(hex, Math.max(0, Math.min(100, parseFloat(v) || 0)) / 100); onCommit?.(); }} title="Opacity" />
      </div>
    </div>
  );
}

function ValueInput({ value, onCommit, grow = 1, title }: { value: string | number; onCommit: (v: string) => void; grow?: number; title: string }) {
  const [t, setT] = useState(String(value));
  useEffect(() => setT(String(value)), [value]);
  return (
    <input
      className="cp-in"
      style={{ flex: grow }}
      title={title}
      value={t}
      onChange={(e) => setT(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => t !== String(value) && onCommit(t)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const n = parseFloat(t);
          if (Number.isFinite(n)) { e.preventDefault(); const nv = String(n + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1)) + (t.endsWith('%') ? '%' : ''); setT(nv); onCommit(nv); }
        }
      }}
    />
  );
}

/** Colours used in the document plus colour styles, for one-click reuse. */
function useDocColors() {
  const doc = useEditor((s) => s.doc);
  return useMemo(() => {
    const count = new Map<string, number>();
    for (const n of Object.values(doc.nodes)) {
      for (const p of n.fills) if (p.kind === 'solid') count.set(p.color.toLowerCase(), (count.get(p.color.toLowerCase()) ?? 0) + 1);
      for (const s of n.strokes) count.set(s.color.toLowerCase(), (count.get(s.color.toLowerCase()) ?? 0) + 1);
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([c]) => c);
  }, [doc.nodes]);
}

const KINDS: { kind: Paint['kind']; title: string; css: string }[] = [
  { kind: 'solid', title: 'Solid', css: 'currentColor' },
  { kind: 'linear', title: 'Linear', css: 'linear-gradient(180deg, currentColor, transparent)' },
  { kind: 'radial', title: 'Radial', css: 'radial-gradient(currentColor, transparent 70%)' },
  { kind: 'image', title: 'Image', css: '' },
];

const stopsCss = (stops: GradientStop[]) => stops.map((s) => `${s.color} ${s.offset * 100}%`).join(', ');

/** Figma-style paint popover: type tabs, gradient stop bar, colour editor, document colours & styles. */
export function PaintPicker({ paint, onChange, onClose, anchor, solidOnly = false, title }: { paint: Paint; onChange: (p: Paint, live?: boolean) => void; onClose: () => void; anchor: DOMRect; solidOnly?: boolean; title?: string }) {
  const st = useEditor();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.left - 260, top: anchor.top });
  const [tab, setTab] = useState<'custom' | 'library'>('custom');
  const [stopIdx, setStopIdx] = useState(0);
  const docColors = useDocColors();
  const committed = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight, w = el.offsetWidth;
    setPos({ left: Math.max(8, Math.min(anchor.left - w - 12, window.innerWidth - w - 8)), top: Math.max(8, Math.min(anchor.top - 40, window.innerHeight - h - 8)) });
  }, [anchor, paint.kind, tab]);
  useEffect(() => {
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    setTimeout(() => window.addEventListener('pointerdown', down), 0);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', down); window.removeEventListener('keydown', key); };
  }, [onClose]);
  // one undo step per picker session
  const live = (p: Paint) => {
    if (!committed.current) { st.checkpoint(); committed.current = true; }
    onChange(p, true);
  };
  const commit = () => onChange({ ...paint }, true);

  const gradient = paint.kind === 'linear' || paint.kind === 'radial';
  const stops = paint.stops?.length ? paint.stops : [{ offset: 0, color: paint.color }, { offset: 1, color: '#ffffff' }];
  const cur = stops[Math.min(stopIdx, stops.length - 1)];
  const setKind = async (kind: Paint['kind']) => {
    if (kind === 'image') {
      const f = await pickFile('image/*');
      if (f) live({ ...paint, kind, src: await blobToDataUrl(f) });
      return;
    }
    live({ ...paint, kind, stops: kind === 'solid' ? paint.stops : stops, angle: paint.angle ?? 180 });
  };
  const barDrag = (i: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    setStopIdx(i);
    const bar = (e.currentTarget as HTMLElement).parentElement!;
    const r = bar.getBoundingClientRect();
    const mv = (ev: PointerEvent) => {
      const off = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
      live({ ...paint, stops: stops.map((s, j) => (j === i ? { ...s, offset: Math.round(off * 100) / 100 } : s)) });
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  return createPortal(
    <div className="cp" ref={ref} style={pos} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <header className="cp-head">
        <div className="cp-tabs">
          <button className={tab === 'custom' ? 'on' : ''} onClick={() => setTab('custom')}>Custom</button>
          <button className={tab === 'library' ? 'on' : ''} onClick={() => setTab('library')}>Libraries</button>
        </div>
        {title && <span className="muted cp-title">{title}</span>}
        <button className="cp-close" title="Close (Esc)" onClick={onClose}>✕</button>
      </header>

      {tab === 'custom' ? (
        <>
          {!solidOnly && (
            <div className="cp-kinds">
              {KINDS.map((k) => (
                <button key={k.kind} className={paint.kind === k.kind ? 'on' : ''} title={k.title} onClick={() => setKind(k.kind)}>
                  {k.kind === 'image' ? (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="2" y="3" width="12" height="10" rx="1.5" /><circle cx="6" cy="6.5" r="1.2" /><path d="M2.5 12l4-4 3 3 2-2 2.5 2.5" /></svg>
                  ) : (
                    <span className="cp-kind" style={{ background: k.css }} />
                  )}
                </button>
              ))}
              {gradient && (
                <span className="cp-gtools">
                  {paint.kind === 'linear' && (
                    <label title="Angle">∠<input className="cp-in" value={paint.angle ?? 180} onChange={(e) => live({ ...paint, angle: Number(e.target.value) || 0 })} /></label>
                  )}
                  <button title="Flip gradient" onClick={() => live({ ...paint, stops: stops.map((s) => ({ ...s, offset: 1 - s.offset })).reverse() })}>⇄</button>
                  <button title="Rotate 90°" onClick={() => live({ ...paint, angle: ((paint.angle ?? 180) + 90) % 360 })}>↻</button>
                </span>
              )}
            </div>
          )}

          {gradient && (
            <div className="cp-gbar-wrap">
              <div
                className="cp-gbar"
                style={{ background: `linear-gradient(90deg, ${stopsCss(stops)}), repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0 / 8px 8px` }}
                onPointerDown={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  const off = Math.round(((e.clientX - r.left) / r.width) * 100) / 100;
                  const next = [...stops, { offset: off, color: cur.color }].sort((a, b) => a.offset - b.offset);
                  live({ ...paint, stops: next });
                  setStopIdx(next.findIndex((s) => s.offset === off));
                }}
              >
                {stops.map((s, i) => (
                  <span key={i} className={`cp-stop ${i === stopIdx ? 'on' : ''}`} style={{ left: `${s.offset * 100}%` }} onPointerDown={barDrag(i)} onDoubleClick={() => stops.length > 2 && live({ ...paint, stops: stops.filter((_, j) => j !== i) })} title="Drag to move · double-click to remove">
                    <i style={{ background: s.color }} />
                  </span>
                ))}
              </div>
              <div className="cp-stoprow muted">
                Stop {stopIdx + 1} of {stops.length} · {Math.round(cur.offset * 100)}%
                {stops.length > 2 && <button onClick={() => { live({ ...paint, stops: stops.filter((_, j) => j !== stopIdx) }); setStopIdx(0); }}>Remove</button>}
              </div>
            </div>
          )}

          {paint.kind === 'image' ? (
            <div className="cp-image">
              {paint.src && <div className="cp-imgprev" style={{ backgroundImage: `url(${paint.src})` }} />}
              <button className="btn small" onClick={() => setKind('image')}>Choose image…</button>
              <label className="row gap">Opacity <ValueInput value={Math.round(paint.opacity * 100) + '%'} onCommit={(v) => live({ ...paint, opacity: (parseFloat(v) || 0) / 100 })} title="Opacity" /></label>
            </div>
          ) : (
            <ColorEditor
              color={gradient ? cur.color : paint.color}
              alpha={paint.opacity}
              onCommit={commit}
              onChange={(hex, a) => (gradient ? live({ ...paint, opacity: a, stops: stops.map((s, j) => (j === stopIdx ? { ...s, color: hex } : s)) }) : live({ ...paint, color: hex, opacity: a }))}
            />
          )}

          {paint.kind !== 'image' && (
            <div className="cp-swatches">
              <div className="cp-label">On this page</div>
              <div className="cp-grid">
                {docColors.map((c) => (
                  <button key={c} title={c.toUpperCase()} style={{ background: c }} onClick={() => (gradient ? live({ ...paint, stops: stops.map((s, j) => (j === stopIdx ? { ...s, color: c } : s)) }) : live({ ...paint, kind: 'solid', color: c }))} />
                ))}
                {!docColors.length && <span className="muted">No colours yet</span>}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="cp-library">
          {st.doc.colorStyles.length === 0 && !st.doc.variables.some((c) => c.variables.some((v) => v.type === 'color')) && <p className="muted">No colour styles or colour variables in this file yet.</p>}
          {st.doc.colorStyles.length > 0 && <div className="cp-label">Colour styles</div>}
          {st.doc.colorStyles.map((s) => (
            <button key={s.id} className="cp-libitem" onClick={() => live({ ...s.paint, id: paint.id, visible: paint.visible })}>
              <span className="swatch tiny" style={{ background: s.paint.kind === 'solid' ? s.paint.color : `linear-gradient(90deg, ${stopsCss(s.paint.stops ?? [])})` }} />
              {s.name}
            </button>
          ))}
          {st.doc.variables.map((c) => {
            const vars = c.variables.filter((v) => v.type === 'color' && !v.hidden);
            if (!vars.length) return null;
            return (
              <div key={c.id}>
                <div className="cp-label">{c.name}</div>
                <div className="cp-grid">
                  {vars.map((v) => {
                    const val = Object.values(v.values)[0];
                    const col = typeof val === 'string' ? val : '#888888';
                    return <button key={v.id} title={v.name} style={{ background: col.slice(0, 7) }} onClick={() => live({ ...paint, kind: 'solid', color: col.slice(0, 7) })} />;
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>,
    document.body,
  );
}

export const paintBackground = (p: Paint) =>
  p.kind === 'solid'
    ? p.color
    : p.kind === 'image'
      ? `url(${p.src}) center/cover`
      : `${p.kind === 'radial' ? 'radial' : 'linear'}-gradient(${p.kind === 'linear' ? `${p.angle ?? 90}deg,` : ''}${stopsCss(p.stops ?? [])})`;
