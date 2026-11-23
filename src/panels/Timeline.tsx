import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditor } from '../store/store';
import { DEFAULT_MOTION, EASES, ease as easeSample, MOTION_PROPS, currentValue, fmtTime, hasMotion, type MotionEase, type MotionProp, type MotionValue } from '../lib/motion';
import { Icon } from './icons';
import type { SceneNode } from '../types';

const LEFT = 280;
type KeyRef = { nodeId: string; prop: MotionProp; id: string };

const showValue = (v: MotionValue, prop: MotionProp) =>
  typeof v === 'object'
    ? prop === 'scale' ? `${Math.round(v.x * 100)}%, ${Math.round(v.y * 100)}%` : `${Math.round(v.x)}, ${Math.round(v.y)}`
    : typeof v === 'number'
      ? prop === 'opacity' ? `${Math.round(v * 100)}%` : prop === 'rotation' ? `${Math.round(v)}°` : String(Math.round(v * 10) / 10)
      : v.toUpperCase();

/** Position keyframes are offsets from the design; show them as coordinates relative to the parent. */
function absPos(n: SceneNode, v: { x: number; y: number }) {
  const p = n.parentId ? useEditor.getState().doc.nodes[n.parentId] : null;
  return { x: n.x - (p?.x ?? 0) + v.x, y: n.y - (p?.y ?? 0) + v.y };
}

/** Playback loop: advances the playhead while playing. */
function usePlayback() {
  const playing = useEditor((s) => s.motionPlaying);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const s = useEditor.getState();
      const dm = { ...DEFAULT_MOTION, ...s.doc.motion };
      let t = s.motionTime + (now - last);
      last = now;
      if (t >= dm.duration) {
        if (dm.loop) t = t % dm.duration;
        else { s.set({ motionTime: dm.duration, motionPlaying: false }); return; }
      }
      s.set({ motionTime: t });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}

/** Motion mode timeline: playhead, per-property keyframe tracks, easing and auto-key. */
export function Timeline() {
  const st = useEditor();
  usePlayback();
  const [zoom, setZoom] = useState(1);
  const [height, setHeight] = useState(220);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [easeMenu, setEaseMenu] = useState<{ key: KeyRef; x: number; y: number } | null>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const [laneW, setLaneW] = useState(800);
  const [scrollX, setScrollX] = useState(0);
  const dm = { ...DEFAULT_MOTION, ...st.doc.motion };
  useLayoutEffect(() => {
    const el = laneRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLaneW(el.clientWidth));
    ro.observe(el);
    setLaneW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const width = Math.max(200, (laneW - 24) * zoom);
  const px = (t: number) => 12 + (t / dm.duration) * width;
  const toT = (clientX: number) => {
    const r = laneRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(dm.duration, ((clientX - r.left + laneRef.current!.scrollLeft - 12) / width) * dm.duration));
  };

  // rows: selected layers, else every animated layer on the page
  const page = st.page();
  const onPage = (id: string) => { let cur: SceneNode | undefined = st.doc.nodes[id]; while (cur?.parentId) cur = st.doc.nodes[cur.parentId]; return !!cur && page.children.includes(cur.id); };
  const rowsNodes = (st.selection.length ? st.selection.map((id) => st.doc.nodes[id]) : Object.values(st.doc.nodes).filter((n) => hasMotion(n) && onPage(n.id))).filter(Boolean) as SceneNode[];

  // ticks
  const step = [50, 100, 200, 250, 500, 1000, 2000, 5000].find((s) => (s / dm.duration) * width >= 70) ?? 5000;
  const ticks: number[] = [];
  for (let t = 0; t <= dm.duration + 0.5; t += step) ticks.push(t);
  const tickLabel = (t: number) => (t % 1000 === 0 ? `${t / 1000}s` : t > 1000 ? `${Math.round(t / 100) / 10}s` : `${t}ms`);

  const scrub = (e: React.PointerEvent) => {
    st.set({ motionTime: Math.round(toT(e.clientX)), motionPlaying: false });
    const mv = (ev: PointerEvent) => useEditor.getState().set({ motionTime: Math.round(toT(ev.clientX)) });
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };
  const isSel = (k: KeyRef) => st.selectedKeys.some((s) => s.id === k.id && s.nodeId === k.nodeId);
  const dragKey = (k: KeyRef, t0: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    const s = useEditor.getState();
    let sel = s.selectedKeys;
    if (e.shiftKey) sel = isSel(k) ? sel.filter((x) => x.id !== k.id) : [...sel, k];
    else if (!isSel(k)) sel = [k];
    s.set({ selectedKeys: sel, motionTime: t0, motionPlaying: false });
    const startX = e.clientX;
    const orig = new Map(sel.map((x) => [x.id, s.doc.nodes[x.nodeId]?.motion?.tracks[x.prop]?.find((kk) => kk.id === x.id)?.t ?? 0]));
    let moved = false;
    const mv = (ev: PointerEvent) => {
      const dt = ((ev.clientX - startX) / width) * dm.duration;
      if (!moved && Math.abs(ev.clientX - startX) < 3) return;
      if (!moved) { useEditor.getState().checkpoint(); moved = true; }
      const snap = ev.shiftKey ? 100 : 10;
      useEditor.getState().updateKeyframes(sel, (kk) => ({ t: Math.max(0, Math.min(dm.duration, Math.round(((orig.get(kk.id) ?? kk.t) + dt) / snap) * snap)) }));
      useEditor.getState().set({ motionTime: Math.max(0, Math.min(dm.duration, Math.round((t0 + dt) / snap) * snap)) });
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };
  const resize = (e: React.PointerEvent) => {
    const y0 = e.clientY, h0 = height;
    const mv = (ev: PointerEvent) => setHeight(Math.max(120, Math.min(window.innerHeight * 0.6, h0 - (ev.clientY - y0))));
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    e.stopPropagation();
    if ((e.key === 'Delete' || e.key === 'Backspace') && st.selectedKeys.length) st.deleteKeyframes(st.selectedKeys);
    if (e.key === ' ') { e.preventDefault(); st.set({ motionPlaying: !st.motionPlaying }); }
  };

  return (
    <section className="timeline" style={{ height }} tabIndex={-1} onKeyDown={onKey}>
      <div className="tl-resize" onPointerDown={resize} title="Drag to resize" />
      <div className="tl-head">
        <div className="tl-controls" style={{ width: LEFT }}>
          <button className="tl-btn" title="Go to start" onClick={() => st.set({ motionTime: 0 })}>⏮</button>
          <button className={`tl-btn play ${st.motionPlaying ? 'on' : ''}`} title={st.motionPlaying ? 'Pause' : 'Play'} onClick={() => st.set({ motionPlaying: !st.motionPlaying, motionTime: !st.motionPlaying && st.motionTime >= dm.duration ? 0 : st.motionTime })}>
            {st.motionPlaying ? '❚❚' : '▶'}
          </button>
          <button className={`tl-btn rec ${st.autoKey ? 'on' : ''}`} title={st.autoKey ? 'Auto-key on: edits record keyframes at the playhead' : 'Auto-key off: edits change the design'} onClick={() => st.set({ autoKey: !st.autoKey })}>◆</button>
          <span className="tl-time">{fmtTime(st.motionTime)} <small>ms</small></span>
          <label className="tl-dur" title="Timeline length (ms)">
            <span>/</span>
            <input value={dm.duration} onChange={(e) => { const v = Number(e.target.value); if (v >= 100) st.setMotion({ duration: Math.round(v) }); }} onKeyDown={(e) => e.stopPropagation()} />
          </label>
          <button className={`tl-btn ${dm.loop ? 'on' : ''}`} title="Loop playback" onClick={() => st.setMotion({ loop: !dm.loop })}>⟲</button>
        </div>
        <div className="tl-ruler" onPointerDown={scrub}>
          <div className="tl-ruler-inner" style={{ width: width + 24, transform: `translateX(${-scrollX}px)` }}>
            {ticks.map((t) => (
              <span key={t} className="tl-tick" style={{ left: px(t) }}>{tickLabel(t)}</span>
            ))}
            <span className="tl-head-handle" style={{ left: px(st.motionTime) }} />
          </div>
        </div>
      </div>

      <div className="tl-body">
        <div className="tl-names" style={{ width: LEFT }}>
          {rowsNodes.length === 0 && <div className="tl-empty muted">Select a layer, then change a property or pick an animation preset to add keyframes.</div>}
          {rowsNodes.map((n) => {
            const tracks = MOTION_PROPS.filter((p) => n.motion?.tracks[p.id]?.length);
            return (
              <div key={n.id}>
                <div className={`tl-layer ${st.selection.includes(n.id) ? 'sel' : ''}`} onClick={() => st.select([n.id])}>
                  <button className="tl-caret" onClick={(e) => { e.stopPropagation(); setCollapsed({ ...collapsed, [n.id]: !collapsed[n.id] }); }}>{collapsed[n.id] ? '▸' : '▾'}</button>
                  <Icon name={n.type === 'text' ? 'text' : n.type === 'ellipse' ? 'ellipse' : n.type === 'frame' ? 'frame' : 'rect'} size={12} />
                  <span className="grow">{n.name}</span>
                  {tracks.length > 0 && <button className="tl-clear" title="Remove all animation from this layer" onClick={(e) => { e.stopPropagation(); st.clearMotion([n.id]); }}>✕</button>}
                </div>
                {!collapsed[n.id] &&
                  tracks.map((p) => {
                    const onKeyNow = n.motion!.tracks[p.id]!.some((k) => Math.abs(k.t - st.motionTime) < 1);
                    return (
                      <div key={p.id} className="tl-prop">
                        <span className="grow">{p.label}</span>
                        <button className={`tl-dia ${onKeyNow ? 'on' : ''}`} title={onKeyNow ? 'Remove keyframe at playhead' : 'Add keyframe at playhead'} onClick={() => st.toggleKeyframe([n.id], p.id)}>◆</button>
                        <span className="tl-val">{showValue(p.id === 'position' ? absPos(n, currentValue(n, p.id, st.motionTime) as { x: number; y: number }) : currentValue(n, p.id, st.motionTime), p.id)}</span>
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>
        <div className="tl-lanes" ref={laneRef} onPointerDown={scrub} onScroll={(e) => setScrollX(e.currentTarget.scrollLeft)}>
          <div className="tl-lanes-inner" style={{ width: width + 24 }}>
            {ticks.map((t) => <span key={t} className="tl-grid" style={{ left: px(t) }} />)}
            {rowsNodes.map((n) => {
              const tracks = MOTION_PROPS.filter((p) => n.motion?.tracks[p.id]?.length);
              const all = tracks.flatMap((p) => n.motion!.tracks[p.id]!.map((k) => k.t));
              return (
                <div key={n.id}>
                  <div className="tl-lane layer">
                    {all.length > 1 && <span className="tl-span" style={{ left: px(Math.min(...all)), width: px(Math.max(...all)) - px(Math.min(...all)) }} />}
                  </div>
                  {!collapsed[n.id] &&
                    tracks.map((p) => {
                      const kfs = n.motion!.tracks[p.id]!;
                      return (
                        <div key={p.id} className="tl-lane">
                          {kfs.slice(0, -1).map((k, i) => (
                            <span key={'s' + k.id} className={`tl-seg e-${k.ease ?? 'ease-in-out'}`} style={{ left: px(k.t), width: px(kfs[i + 1].t) - px(k.t) }} title={`${EASES.find((e) => e.id === (k.ease ?? 'ease-in-out'))?.label} — right-click a keyframe to change`} />
                          ))}
                          {kfs.map((k) => {
                            const ref: KeyRef = { nodeId: n.id, prop: p.id, id: k.id };
                            return (
                              <span
                                key={k.id}
                                className={`tl-key ${isSel(ref) ? 'sel' : ''}`}
                                style={{ left: px(k.t) }}
                                title={`${fmtTime(k.t)} · ${showValue(p.id === 'position' ? absPos(n, k.v as { x: number; y: number }) : k.v, p.id)}`}
                                onPointerDown={dragKey(ref, k.t)}
                                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setEaseMenu({ key: ref, x: e.clientX, y: e.clientY }); }}
                                onDoubleClick={(e) => { e.stopPropagation(); setEaseMenu({ key: ref, x: e.clientX, y: e.clientY }); }}
                              />
                            );
                          })}
                        </div>
                      );
                    })}
                </div>
              );
            })}
            <span className="tl-playhead" style={{ left: px(st.motionTime) }} />
          </div>
        </div>
      </div>
      <div className="tl-zoom">
        <button className="icon-btn" title="Zoom out" onClick={() => setZoom(Math.max(0.5, zoom / 1.5))}><Icon name="minus" size={12} /></button>
        <button className="icon-btn" title="Zoom in" onClick={() => setZoom(Math.min(12, zoom * 1.5))}><Icon name="plus" size={12} /></button>
      </div>
      {easeMenu && (
        <div className="tl-ease-menu" style={{ left: easeMenu.x, top: easeMenu.y }} onMouseLeave={() => setEaseMenu(null)}>
          <div className="cp-label">Easing to next keyframe</div>
          {EASES.map((e) => (
            <button key={e.id} onClick={() => { st.updateKeyframes([easeMenu.key], { ease: e.id as MotionEase }); setEaseMenu(null); }}>
              <EaseCurve e={e.id} /> {e.label}
            </button>
          ))}
          <hr />
          <button className="danger" onClick={() => { st.deleteKeyframes([easeMenu.key]); setEaseMenu(null); }}>Delete keyframe</button>
        </div>
      )}
    </section>
  );
}

function EaseCurve({ e }: { e: MotionEase }) {
  const pts: string[] = [];
  for (let i = 0; i <= 20; i++) {
    const p = i / 20;
    pts.push(`${2 + p * 16},${16 - easeSample(e, p) * 12}`);
  }
  return <svg width="20" height="18" viewBox="0 0 20 18"><polyline points={pts.join(' ')} fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>;
}
