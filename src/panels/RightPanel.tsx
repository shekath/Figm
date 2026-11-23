import { useState } from 'react';
import { useEditor } from '../store/store';
import { ColorField, IconButton, NumberField, Section, Select } from './controls';
import { Icon } from './icons';
import { PaintPicker } from './ColorPicker';
import { MotionPageProps, MotionProps } from './MotionPanel';
import { FramePresetPanel, FrameTypeHeader } from './FramePresets';
import type { BlendMode, Effect, Paint, SceneNode, Stroke, TextStyle, PrototypeLink, ExportSetting, AutoLayout, LayoutSizing } from '../types';
import { defaultEffect, defaultStroke, solid, uid } from '../lib/factory';
import { FONTS, ensureFont, textBoxSize } from '../lib/text';
import { cssFor, exportNodes, jsxFor } from '../lib/exporter';
import { saveBlob } from '../lib/platform';
import { BindButton, ModeOverrides } from './Variables';
import { ComponentPanel } from './ComponentPanel';
import { setOf, variantsOf } from '../lib/components';
import { EASINGS } from '../lib/proto';

const BLENDS: BlendMode[] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];

export function RightPanel() {
  const st = useEditor();
  const sel = st.selectedNodes();
  return (
    <aside className="panel right">
      {st.mode === 'motion' ? (
        <div className="tabs motion-tabs"><span className="motion-title">Motion</span><span className="beta">Beta</span></div>
      ) : (
      <div className="tabs">
        {(['design', 'prototype', 'dev'] as const).map((m) => (
          <button key={m} className={st.mode === m ? 'active' : ''} onClick={() => st.set({ mode: m })}>
            {m === 'dev' ? 'Inspect' : m[0].toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>
      )}
      <div className="panel-scroll">
        {st.mode === 'design' && (st.tool === 'frame' ? <FramePresetPanel /> : sel.length ? <DesignProps sel={sel} /> : <PageProps />)}
        {st.mode === 'motion' && (sel.length ? <MotionProps sel={sel} /> : <MotionPageProps />)}
        {st.mode === 'prototype' && <PrototypeProps sel={sel} />}
        {st.mode === 'dev' && <DevProps sel={sel} />}
      </div>
    </aside>
  );
}

function PageProps() {
  const st = useEditor();
  const page = st.page();
  return (
    <>
      <Section title="Page">
        <div className="row">
          <ColorField value={page.background} onChange={(c) => st.mutate((d) => (d.pages.find((p) => p.id === page.id)!.background = c))} />
        </div>
      </Section>
      <Section title="Local styles">
        <div className="muted">
          {st.doc.colorStyles.length} colour · {st.doc.textStyles.length} text · {st.doc.effectStyles.length} effect styles
        </div>
        <button className="btn small" onClick={() => st.set({ leftTab: 'assets' })}>
          Open assets
        </button>
      </Section>
      <Section title="Export">
        <button className="btn" onClick={async () => { const ids = page.children; if (ids.length) await saveBlob(await exportNodes(st.doc.nodes, ids, 'png', 2), `${page.name}.png`); }}>
          Export page as PNG
        </button>
      </Section>
    </>
  );
}

function useBatch() {
  const st = useEditor();
  // live updates while scrubbing: first call checkpoints, others don't record
  return (ids: string[], patch: Partial<SceneNode> | ((n: SceneNode) => Partial<SceneNode>), live?: boolean) => {
    if (live) {
      st.mutate((d) => {
        for (const id of ids) {
          const n = d.nodes[id];
          if (n) Object.assign(n, typeof patch === 'function' ? patch(n) : patch);
        }
      }, false);
      st.updateNodes([], {}); // recompute nothing but keep API symmetrical
      st.set({ past: useEditor.getState().past.slice(0, -1) });
    } else st.updateNodes(ids, patch);
  };
}

function mixedValue<T>(sel: SceneNode[], get: (n: SceneNode) => T): { v: T; mixed: boolean } {
  const v = get(sel[0]);
  return { v, mixed: sel.some((n) => get(n) !== v) };
}

function DesignProps({ sel }: { sel: SceneNode[] }) {
  const st = useEditor();
  const ids = sel.map((n) => n.id);
  const n = sel[0];
  const single = sel.length === 1;
  const apply = useBatch();
  const geo = (key: 'x' | 'y' | 'w' | 'h' | 'rotation', v: number, live?: boolean) => {
    if (key === 'rotation') return apply(ids, { rotation: v }, live);
    if (live) {
      // geometry needs tree-aware update
      st.mutate(() => void 0, false);
      st.set({ past: useEditor.getState().past.slice(0, -1) });
    }
    if (n.type === 'text' && (key === 'w' || key === 'h')) {
      st.updateNodes(ids, (x) => ({ [key]: v, text: { ...x.text!, autoResize: 'fixed' } }));
      return;
    }
    if (live) {
      const s = useEditor.getState();
      for (const id of ids) {
        const node = s.doc.nodes[id];
        s.resizeNode(id, { x: key === 'x' ? v : node.x, y: key === 'y' ? v : node.y, w: key === 'w' ? Math.max(0.01, v) : node.w, h: key === 'h' ? Math.max(0, v) : node.h }, false);
      }
      return;
    }
    st.updateNodes(ids, { [key]: key === 'w' || key === 'h' ? Math.max(0.01, v) : v });
  };
  const parent = n.parentId ? st.doc.nodes[n.parentId] : null;

  return (
    <>
      {single && (n.type === 'frame' || n.type === 'component') && !n.isComponentSet && <FrameTypeHeader id={n.id} />}
      {single && <ComponentPanel n={n} />}

      <Section title="Position">
        <div className="sub-label">Alignment</div>
        <div className="row icons align-row">
          <div className="seg-group">
            <IconButton title="Align left (Alt+A)" onClick={() => st.align('left')}><Icon name="alignLeft" /></IconButton>
            <IconButton title="Align horizontal centres (Alt+H)" onClick={() => st.align('hcenter')}><Icon name="alignHCenter" /></IconButton>
            <IconButton title="Align right (Alt+D)" onClick={() => st.align('right')}><Icon name="alignRight" /></IconButton>
          </div>
          <div className="seg-group">
            <IconButton title="Align top (Alt+W)" onClick={() => st.align('top')}><Icon name="alignTop" /></IconButton>
            <IconButton title="Align vertical centres (Alt+V)" onClick={() => st.align('vcenter')}><Icon name="alignVCenter" /></IconButton>
            <IconButton title="Align bottom (Alt+S)" onClick={() => st.align('bottom')}><Icon name="alignBottom" /></IconButton>
          </div>
          {sel.length >= 3 && (
            <div className="seg-group">
              <IconButton title="Distribute horizontally" onClick={() => st.distribute('h')}><Icon name="distH" /></IconButton>
              <IconButton title="Distribute vertically" onClick={() => st.distribute('v')}><Icon name="distV" /></IconButton>
            </div>
          )}
        </div>
        {sel.length >= 2 && (
          <>
            <div className="sub-label">Boolean</div>
            <div className="row icons seg-group boolean-row">
              <IconButton title="Union (Ctrl+Alt+U)" onClick={() => st.booleanOp('union')}><BoolIcon op="union" /></IconButton>
              <IconButton title="Subtract (Ctrl+Alt+S)" onClick={() => st.booleanOp('subtract')}><BoolIcon op="subtract" /></IconButton>
              <IconButton title="Intersect (Ctrl+Alt+I)" onClick={() => st.booleanOp('intersect')}><BoolIcon op="intersect" /></IconButton>
              <IconButton title="Exclude (Ctrl+Alt+X)" onClick={() => st.booleanOp('exclude')}><BoolIcon op="exclude" /></IconButton>
              <IconButton title="Flatten (Ctrl+E)" onClick={() => st.booleanOp('flatten')}><Icon name="vector" /></IconButton>
            </div>
          </>
        )}
        <div className="sub-label">Position</div>
        <div className="grid2">
          <NumberField label="X" {...mv(sel, (x) => (parent && single ? x.x - parent.x : x.x))} onCommitStart={st.checkpoint} onChange={(v, live) => geo('x', single && parent ? v + parent.x : v, live)} />
          <NumberField label="Y" {...mv(sel, (x) => (parent && single ? x.y - parent.y : x.y))} onCommitStart={st.checkpoint} onChange={(v, live) => geo('y', single && parent ? v + parent.y : v, live)} />
        </div>
        <div className="sub-label">Rotation</div>
        <div className="grid2">
          <NumberField label="∟" title="Rotation" suffix="°" {...mv(sel, (x) => x.rotation)} onCommitStart={st.checkpoint} onChange={(v, live) => geo('rotation', v, live)} />
          <div className="row icons seg-group">
            <IconButton title="Rotate 90°" onClick={() => apply(ids, { rotation: ((n.rotation + 90 + 180) % 360) - 180 })}><span className="ico-txt">⟳</span></IconButton>
            <IconButton title="Flip horizontal (Shift+H)" onClick={() => st.flip('x')}><Icon name="flipH" /></IconButton>
            <IconButton title="Flip vertical (Shift+V)" onClick={() => st.flip('y')}><Icon name="flipV" /></IconButton>
          </div>
        </div>
        {single && parent?.autoLayout && (
          <label className="check abs-toggle" title="Ignore the parent's auto layout and position freely">
            <input type="checkbox" checked={!!n.layoutAbsolute} onChange={(e) => st.updateNodes(ids, { layoutAbsolute: e.target.checked || undefined })} /> Absolute position
          </label>
        )}
        {(n.type === 'polygon' || n.type === 'star') && (
          <div className="grid2">
            <NumberField label="▲" title="Count" value={n.sides ?? 5} min={3} max={60} onCommitStart={st.checkpoint} onChange={(v, live) => apply(ids, { sides: Math.round(v) }, live)} />
            {n.type === 'star' && <NumberField label="◎" title="Ratio" suffix="%" value={Math.round((n.innerRatio ?? 0.38) * 100)} min={1} max={100} onCommitStart={st.checkpoint} onChange={(v, live) => apply(ids, { innerRatio: v / 100 }, live)} />}
          </div>
        )}
      </Section>

      {single && (n.type === 'frame' || n.type === 'component') ? (
        <AutoLayoutSection n={n} size={<SizeFields sel={sel} parent={parent} geo={geo} />} />
      ) : (
        <Section title="Layout">
          <div className="sub-label">Dimensions</div>
          <SizeFields sel={sel} parent={parent} geo={geo} />
        </Section>
      )}
      {(n.type === 'frame' || n.type === 'component' || n.type === 'instance' || n.type === 'group') && st.doc.variables.some((c) => c.modes.length > 1) && (
        <Section title="Variable modes" collapsible>
          <ModeOverrides ids={ids} />
        </Section>
      )}

      {single && parent && (parent.type === 'frame' || parent.type === 'component') && !parent.autoLayout && (
        <Section title="Constraints" collapsible>
          <div className="grid2">
            <Select
              value={n.constraints?.h ?? 'left'}
              options={['left', 'right', 'left-right', 'center', 'scale'].map((v) => ({ value: v as 'left', label: cap(v) }))}
              onChange={(v) => st.updateNodes(ids, (x) => ({ constraints: { v: x.constraints?.v ?? 'top', h: v } }))}
            />
            <Select
              value={n.constraints?.v ?? 'top'}
              options={['top', 'bottom', 'top-bottom', 'center', 'scale'].map((v) => ({ value: v as 'top', label: cap(v) }))}
              onChange={(v) => st.updateNodes(ids, (x) => ({ constraints: { h: x.constraints?.h ?? 'left', v } }))}
            />
          </div>
        </Section>
      )}

      <Section title="Appearance">
        <div className="grid2">
          <NumberField label="◐" title="Opacity" suffix="%" {...mv(sel, (x) => Math.round(x.opacity * 100))} min={0} max={100} onCommitStart={st.checkpoint} onChange={(v, live) => apply(ids, { opacity: v / 100 }, live)} />
          {['rect', 'frame', 'component', 'image', 'instance', 'polygon', 'star'].includes(n.type) && (
            <NumberField label="◜" title="Corner radius" {...mv(sel, (x) => x.radius)} min={0} onCommitStart={st.checkpoint} onChange={(v, live) => apply(ids, { radius: v, radii: null }, live)} />
          )}
        </div>
        {single && ['rect', 'frame', 'component', 'image'].includes(n.type) && (
          <details className="radii">
            <summary>Independent corners</summary>
            <div className="grid2">
              {(['TL', 'TR', 'BR', 'BL'] as const).map((k, i) => (
                <NumberField
                  key={k}
                  label={k}
                  value={(n.radii ?? [n.radius, n.radius, n.radius, n.radius])[i]}
                  min={0}
                  onChange={(v) => st.updateNodes(ids, (x) => {
                    const r = [...(x.radii ?? [x.radius, x.radius, x.radius, x.radius])] as [number, number, number, number];
                    r[i] = v;
                    return { radii: r };
                  })}
                />
              ))}
            </div>
          </details>
        )}
        <div className="row gap bind-row">
          <span className="muted">Bind</span> opacity <BindButton ids={ids} prop="opacity" /> radius <BindButton ids={ids} prop="radius" /> visible <BindButton ids={ids} prop="visible" />
        </div>
        <div className="row">
          <Select value={n.blend} options={BLENDS.map((b) => ({ value: b, label: cap(b) }))} onChange={(v) => st.updateNodes(ids, { blend: v })} title="Blend mode" width="100%" />
        </div>
      </Section>

      {n.type === 'text' && n.text && <TextSection sel={sel} />}

      <FillSection sel={sel} />
      {n.type !== 'group' && <StrokeSection sel={sel} />}
      <EffectSection sel={sel} />
      <SelectionColors sel={sel} />
      {single && <ExportSection n={n} />}
    </>
  );
}



function mv(sel: SceneNode[], get: (n: SceneNode) => number) {
  const { v, mixed } = mixedValue(sel, get);
  return { value: v, mixed };
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1).replace(/-/g, ' ');
const typeLabel = (n: SceneNode) => (n.type === 'rect' ? 'Rectangle' : cap(n.type === 'path' ? 'vector' : n.type));

type Axis = 'h' | 'v';
/** Current sizing mode of a node on an axis (Figma: Fixed / Hug contents / Fill container). */
function sizingOf(n: SceneNode, axis: Axis): LayoutSizing {
  if (n.layoutSizing?.[axis] === 'fill') return 'fill';
  if (n.autoLayout && (axis === 'h' ? n.autoLayout.hugW : n.autoLayout.hugH)) return 'hug';
  if (n.text) return n.text.autoResize === 'width' || (axis === 'v' && n.text.autoResize === 'height') ? 'hug' : 'fixed';
  return 'fixed';
}
function sizingPatch(n: SceneNode, axis: Axis, mode: LayoutSizing): Partial<SceneNode> {
  const patch: Partial<SceneNode> = { layoutSizing: { ...n.layoutSizing, [axis]: mode === 'fill' ? 'fill' : undefined } };
  if (n.autoLayout) patch.autoLayout = { ...n.autoLayout, [axis === 'h' ? 'hugW' : 'hugH']: mode === 'hug' };
  if (n.text) {
    const otherHug = sizingOf(n, axis === 'h' ? 'v' : 'h') === 'hug';
    let ar = n.text.autoResize;
    if (axis === 'h') ar = mode === 'hug' ? 'width' : otherHug || ar === 'width' ? 'height' : 'fixed';
    else ar = mode === 'hug' ? (sizingOf(n, 'h') === 'hug' ? 'width' : 'height') : ar === 'width' ? 'fixed' : 'fixed';
    patch.text = { ...n.text, autoResize: ar };
  }
  return patch;
}
const canHug = (n: SceneNode) => !!n.autoLayout || !!n.text;

/** W and H fields with inline Fixed / Hug / Fill sizing, as in Figma's Resizing row. */
function SizeFields({ sel, parent, geo }: { sel: SceneNode[]; parent: SceneNode | null; geo: (k: 'w' | 'h', v: number, live?: boolean) => void }) {
  const st = useEditor();
  const n = sel[0];
  const single = sel.length === 1;
  const inAL = single && !!parent?.autoLayout && !n.layoutAbsolute;
  const showSizing = single && (inAL || canHug(n));
  const opts = (axis: Axis) => [
    { value: 'fixed' as LayoutSizing, label: `Fixed ${axis === 'h' ? 'width' : 'height'}` },
    ...(canHug(n) ? [{ value: 'hug' as LayoutSizing, label: 'Hug contents' }] : []),
    ...(inAL ? [{ value: 'fill' as LayoutSizing, label: 'Fill container' }] : []),
  ];
  const set = (axis: Axis, mode: LayoutSizing) => st.updateNodes(sel.map((x) => x.id), (x) => sizingPatch(x, axis, mode));
  return (
    <>
      <div className="grid2">
        {(['h', 'v'] as Axis[]).map((axis) => {
          const mode = single ? sizingOf(n, axis) : 'fixed';
          return (
            <div key={axis} className={`size-field m-${mode}`}>
              <NumberField label={axis === 'h' ? 'W' : 'H'} {...mv(sel, (x) => (axis === 'h' ? x.w : x.h))} min={0} onCommitStart={st.checkpoint} onChange={(v, live) => geo(axis === 'h' ? 'w' : 'h', v, live)} />
              {showSizing && (
                <label className="size-mode" title={axis === 'h' ? 'Horizontal resizing' : 'Vertical resizing'}>
                  <span>{mode === 'fixed' ? '' : mode === 'hug' ? 'Hug' : 'Fill'}</span>
                  <span className="caret">⌄</span>
                  <select value={mode} onChange={(e) => set(axis, e.target.value as LayoutSizing)} onKeyDown={(e) => e.stopPropagation()}>
                    {opts(axis).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              )}
            </div>
          );
        })}
      </div>
      {inAL && (
        <details className="minmax">
          <summary>Min / max size</summary>
          <div className="grid2">
            {(['minW', 'maxW', 'minH', 'maxH'] as const).map((k) => (
              <NumberField key={k} label={k.replace('W', ' W').replace('H', ' H')} value={n[k] ?? 0} min={0} onChange={(v) => st.updateNodes(sel.map((x) => x.id), { [k]: v || undefined })} />
            ))}
          </div>
        </details>
      )}
    </>
  );
}

/** Figma/Framer-style auto layout: direction & wrap, 3×3 alignment pad, gap (or Auto), padding, sizing. */
function AutoLayoutSection({ n, size }: { n: SceneNode; size: React.ReactNode }) {
  const st = useEditor();
  const al = n.autoLayout;
  const [sides, setSides] = useState(false);
  const set = (patch: Partial<AutoLayout>) => st.setAutoLayout(n.id, patch);
  const horiz = al?.direction === 'horizontal';
  const pad = al?.padding;
  const uniformPad = pad && pad.l === pad.r && pad.t === pad.b;
  const showSides = sides || (pad ? !uniformPad : false);
  const POS: AutoLayout['align'][] = ['start', 'center', 'end'];
  return (
    <Section
      title="Auto layout"
      actions={
        <IconButton title={al ? 'Remove auto layout (Shift+Alt+A)' : 'Add auto layout (Shift+A)'} onClick={() => { st.select([n.id]); st.toggleAutoLayout(); }}>
          <Icon name={al ? 'minus' : 'plus'} />
        </IconButton>
      }
    >
      {!al ? (
        <>
          <div className="sub-label">Dimensions</div>
          {size}
          <label className="check al-clip"><input type="checkbox" checked={!!n.clip} onChange={(e) => st.updateNodes([n.id], { clip: e.target.checked })} /> Clip content</label>
        </>
      ) : (
        <div className="al">
          <div className="sub-label">Flow</div>
          <div className="al-dir seg">
            <button className={!horiz ? 'on' : ''} title="Vertical layout" onClick={() => set({ direction: 'vertical', wrap: false })}>↓</button>
            <button className={horiz && !al.wrap ? 'on' : ''} title="Horizontal layout" onClick={() => set({ direction: 'horizontal', wrap: false })}>→</button>
            <button className={horiz && al.wrap ? 'on' : ''} title="Wrap" onClick={() => set({ direction: 'horizontal', wrap: true, hugW: false })}>↩</button>
          </div>

          <div className="sub-label">Resizing</div>
          {size}
          <div className="sub-label two"><span>Alignment</span><span>Gap</span></div>
          <div className="al-main">
            <div className="al-pad" title="Alignment">
              {POS.map((rowPos) =>
                POS.map((colPos) => {
                  const mainPos = horiz ? colPos : rowPos;
                  const crossPos = horiz ? rowPos : colPos;
                  const auto = al.justify === 'space-between';
                  const on = (auto || al.justify === mainPos) && al.align === crossPos;
                  return (
                    <button
                      key={rowPos + colPos}
                      className={`al-cell ${on ? 'on' : ''} ${auto ? 'auto' : ''}`}
                      title={`${horiz ? 'Horizontal' : 'Vertical'} ${mainPos}, ${horiz ? 'vertical' : 'horizontal'} ${crossPos}`}
                      onClick={() => set(auto ? { align: crossPos } : { justify: mainPos, align: crossPos })}
                      onDoubleClick={() => set({ justify: auto ? mainPos : 'space-between', align: crossPos })}
                    >
                      {on ? <span className={`al-bars ${horiz ? 'h' : 'v'} c-${crossPos}`}><i /><i /><i /></span> : <span className="dot" />}
                    </button>
                  );
                }),
              )}
            </div>
            <div className="al-gaps">
              <label className="al-field" title={horiz ? 'Horizontal gap between items' : 'Vertical gap between items'}>
                <span className="al-ico">{horiz ? '⇿' : '⇳'}</span>
                {al.justify === 'space-between' ? (
                  <span className="al-auto">Auto</span>
                ) : (
                  <NumberField value={al.gap} onCommitStart={st.checkpoint} onChange={(v) => set({ gap: v })} />
                )}
                <select className="al-gapmode" value={al.justify === 'space-between' ? 'auto' : 'fixed'} onChange={(e) => set({ justify: e.target.value === 'auto' ? 'space-between' : 'start' })} title="Gap mode" onKeyDown={(e) => e.stopPropagation()}>
                  <option value="fixed">Fixed</option>
                  <option value="auto">Auto</option>
                </select>
              </label>
              {al.wrap && (
                <label className="al-field" title="Vertical gap between rows">
                  <span className="al-ico">⇳</span>
                  <NumberField value={al.counterGap ?? al.gap} onChange={(v) => set({ counterGap: v })} />
                </label>
              )}
              <BindButton ids={[n.id]} prop="gap" />
            </div>
          </div>

          <div className="sub-label">Padding</div>
          <div className="al-padding">
            {!showSides ? (
              <>
                <label className="al-field" title="Horizontal padding"><span className="al-ico">◫</span><NumberField value={pad!.l} min={0} onCommitStart={st.checkpoint} onChange={(v) => set({ padding: { ...pad!, l: v, r: v } })} /></label>
                <label className="al-field" title="Vertical padding"><span className="al-ico rot">◫</span><NumberField value={pad!.t} min={0} onCommitStart={st.checkpoint} onChange={(v) => set({ padding: { ...pad!, t: v, b: v } })} /></label>
              </>
            ) : (
              (['l', 't', 'r', 'b'] as const).map((k) => (
                <label key={k} className="al-field small" title={{ l: 'Left', t: 'Top', r: 'Right', b: 'Bottom' }[k] + ' padding'}>
                  <span className="al-ico">{{ l: '⇤', t: '⤒', r: '⇥', b: '⤓' }[k]}</span>
                  <NumberField value={pad![k]} min={0} onChange={(v) => set({ padding: { ...pad!, [k]: v } })} />
                </label>
              ))
            )}
            <IconButton title="Individual padding" active={showSides} onClick={() => { if (showSides && !uniformPad) set({ padding: { t: pad!.t, b: pad!.t, l: pad!.l, r: pad!.l } }); setSides(!showSides); }}>
              <Icon name="padSides" size={12} />
            </IconButton>
          </div>

          <div className="al-opts">
            <label className="check"><input type="checkbox" checked={!!n.clip} onChange={(e) => st.updateNodes([n.id], { clip: e.target.checked })} /> Clip content</label>
            <label className="check"><input type="checkbox" checked={!!al.strokesIncluded} onChange={(e) => set({ strokesIncluded: e.target.checked })} /> Include strokes</label>
            <label className="check"><input type="checkbox" checked={!!al.reverseZ} onChange={(e) => set({ reverseZ: e.target.checked })} /> First on top</label>
          </div>
        </div>
      )}
    </Section>
  );
}

/** Every solid colour used in the selection (and inside it); edit one to replace it everywhere. */
function SelectionColors({ sel }: { sel: SceneNode[] }) {
  const st = useEditor();
  const [edit, setEdit] = useState<{ color: string; anchor: DOMRect } | null>(null);
  const [all, setAll] = useState(false);
  const ids: string[] = [];
  const walk = (id: string) => { ids.push(id); for (const c of st.doc.nodes[id]?.children ?? []) walk(c); };
  sel.forEach((n) => walk(n.id));
  const colors = new Map<string, number>();
  for (const id of ids) {
    const n = st.doc.nodes[id];
    if (!n) continue;
    for (const p of n.fills) if (p.kind === 'solid' && p.visible) colors.set(p.color.toLowerCase(), (colors.get(p.color.toLowerCase()) ?? 0) + 1);
    for (const k of n.strokes) if (k.visible) colors.set(k.color.toLowerCase(), (colors.get(k.color.toLowerCase()) ?? 0) + 1);
  }
  const list = [...colors.keys()];
  if (list.length < 2 && !(sel.length === 1 && sel[0].children.length)) return null;
  if (!list.length) return null;
  const shown = all ? list : list.slice(0, 6);
  const replace = (from: string, to: string) =>
    st.updateNodes(ids, (n) => ({
      fills: n.fills.map((p) => (p.kind === 'solid' && p.color.toLowerCase() === from ? { ...p, color: to } : p)),
      strokes: n.strokes.map((k) => (k.color.toLowerCase() === from ? { ...k, color: to } : k)),
    }));
  return (
    <Section title="Selection colors">
      <div className="sel-colors">
        {shown.map((c) => (
          <button key={c} className="swatch" style={{ background: c }} title={`${c.toUpperCase()} · used ${colors.get(c)}×`} onClick={(e) => setEdit({ color: c, anchor: (e.currentTarget.closest('.section') as HTMLElement).getBoundingClientRect() })} />
        ))}
        {list.length > 6 && <button className="more" onClick={() => setAll(!all)}>{all ? 'Less' : `+${list.length - 6}`}</button>}
      </div>
      {edit && (
        <PaintPicker
          solidOnly
          title="Replace colour"
          anchor={edit.anchor}
          paint={{ id: 'sc', kind: 'solid', color: edit.color, opacity: 1, visible: true }}
          onClose={() => setEdit(null)}
          onChange={(p) => { if (p.color !== edit.color) { replace(edit.color, p.color); setEdit({ ...edit, color: p.color }); } }}
        />
      )}
    </Section>
  );
}

function TextSection({ sel }: { sel: SceneNode[] }) {
  const st = useEditor();
  const texts = sel.filter((n) => n.text);
  const ids = texts.map((n) => n.id);
  const t = texts[0].text!;
  const set = (patch: Partial<TextStyle>) => {
    if (patch.fontFamily) ensureFont(patch.fontFamily);
    st.updateNodes(ids, (n) => {
      const text = { ...n.text!, ...patch };
      const size = text.autoResize === 'fixed' ? {} : textBoxSize(text, n.w);
      return { text, ...size };
    });
  };
  return (
    <Section title="Text">
      <div className="row">
        <Select value={FONTS.includes(t.fontFamily) ? t.fontFamily : 'Inter'} options={FONTS.map((f) => ({ value: f, label: f }))} onChange={(v) => set({ fontFamily: v })} width="100%" />
      </div>
      <div className="grid2">
        <Select
          value={t.fontWeight}
          options={[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: w, label: ['Thin', 'Extra Light', 'Light', 'Regular', 'Medium', 'Semi Bold', 'Bold', 'Extra Bold', 'Black'][w / 100 - 1] }))}
          onChange={(v) => set({ fontWeight: v })}
        />
        <NumberField label="Aa" title="Font size" value={t.fontSize} min={1} onChange={(v) => set({ fontSize: v })} />
        <NumberField label="LH" title="Line height (%)" suffix="%" value={Math.round(t.lineHeight * 100)} min={10} onChange={(v) => set({ lineHeight: v / 100 })} />
        <NumberField label="LS" title="Letter spacing" value={t.letterSpacing} step={0.1} onChange={(v) => set({ letterSpacing: v })} />
      </div>
      <div className="row icons">
        {(['left', 'center', 'right', 'justify'] as const).map((a) => (
          <IconButton key={a} title={`Align ${a}`} active={t.align === a} onClick={() => set({ align: a })}>
            <Icon name={a === 'left' ? 'alignLeft' : a === 'center' ? 'alignHCenter' : a === 'right' ? 'alignRight' : 'menu'} />
          </IconButton>
        ))}
        <span className="vsep" />
        {(['top', 'middle', 'bottom'] as const).map((a) => (
          <IconButton key={a} title={`Vertical ${a}`} active={t.vAlign === a} onClick={() => set({ vAlign: a })}>
            <Icon name={a === 'top' ? 'alignTop' : a === 'middle' ? 'alignVCenter' : 'alignBottom'} />
          </IconButton>
        ))}
      </div>
      <div className="row icons">
        <IconButton title="Italic" active={t.italic} onClick={() => set({ italic: !t.italic })}><i>I</i></IconButton>
        <IconButton title="Underline" active={t.underline} onClick={() => set({ underline: !t.underline })}><u>U</u></IconButton>
        <IconButton title="Strikethrough" active={t.strike} onClick={() => set({ strike: !t.strike })}><s>S</s></IconButton>
        <Select
          value={t.transform}
          options={[{ value: 'none', label: 'Aa as typed' }, { value: 'uppercase', label: 'AA upper' }, { value: 'lowercase', label: 'aa lower' }, { value: 'capitalize', label: 'Aa title' }]}
          onChange={(v) => set({ transform: v })}
        />
      </div>
      <div className="row gap bind-row">
        <span className="muted">Bind</span> text <BindButton ids={ids} prop="text" /> size <BindButton ids={ids} prop="fontSize" />
      </div>
      <div className="row">
        <Select
          value={t.autoResize}
          title="Resizing"
          width="100%"
          options={[{ value: 'width', label: 'Auto width' }, { value: 'height', label: 'Auto height' }, { value: 'fixed', label: 'Fixed size' }]}
          onChange={(v) => set({ autoResize: v })}
        />
      </div>
    </Section>
  );
}

function PaintRow({ p, onChange, onRemove }: { p: Paint; onChange: (p: Paint, live?: boolean) => void; onRemove: () => void }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const open = (e: React.MouseEvent) => setAnchor(anchor ? null : (e.currentTarget as HTMLElement).closest('.paint')!.getBoundingClientRect());
  return (
    <div className="paint">
      <div className="row">
        <div className="paint-chip">
          <button className="swatch big checker" onClick={open} title="Edit paint"><i style={{ background: paintCss(p), opacity: p.opacity }} /></button>
          {p.kind === 'solid' ? (
            <ColorField value={p.color} onChange={(c) => onChange({ ...p, color: c })} noSwatch />
          ) : (
            <span className="grow paint-label" onClick={open}>{p.kind === 'image' ? 'Image' : `${cap(p.kind)} gradient`}</span>
          )}
          <NumberField value={Math.round(p.opacity * 100)} suffix="%" min={0} max={100} width={52} onChange={(v, live) => onChange({ ...p, opacity: v / 100 }, live)} />
        </div>
        <IconButton title={p.visible ? 'Hide' : 'Show'} onClick={() => onChange({ ...p, visible: !p.visible })}>
          <Icon name={p.visible ? 'eye' : 'eyeOff'} size={12} />
        </IconButton>
        <IconButton title="Remove" onClick={onRemove}>
          <Icon name="minus" size={12} />
        </IconButton>
      </div>
      {anchor && <PaintPicker paint={p} anchor={anchor} onChange={onChange} onClose={() => setAnchor(null)} title="Fill" />}
    </div>
  );
}

const paintCss = (p: Paint) =>
  p.kind === 'solid'
    ? p.color
    : p.kind === 'image'
      ? `url(${p.src}) center/cover`
      : `${p.kind === 'radial' ? 'radial' : 'linear'}-gradient(${p.kind === 'linear' ? `${p.angle ?? 90}deg,` : ''}${(p.stops ?? []).map((s) => `${s.color} ${s.offset * 100}%`).join(',')})`;

function FillSection({ sel }: { sel: SceneNode[] }) {
  const st = useEditor();
  const ids = sel.map((n) => n.id);
  const n = sel[0];
  const fills = n.fills;
  const mixed = sel.some((x) => JSON.stringify(x.fills) !== JSON.stringify(fills));
  return (
    <Section
      title="Fill"
      actions={
        <>
        <BindButton ids={ids} prop="fill" />
        <IconButton title="Add fill" onClick={() => st.updateNodes(ids, (x) => ({ fills: [...x.fills, solid(x.fills.length ? '#000000' : '#d9d9d9', x.fills.length ? 0.2 : 1)] }))}>
          <Icon name="plus" />
        </IconButton>
        </>
      }
    >
      {mixed ? (
        <div className="muted clickable" onClick={() => st.updateNodes(ids, { fills: structuredClone(fills) })}>
          Mixed fills — click to unify
        </div>
      ) : (
        [...fills].map((p, i) => (
          <PaintRow
            key={p.id}
            p={p}
            onChange={(np) => st.updateNodes(ids, (x) => ({ fills: x.fills.map((f, j) => (j === i ? { ...np, id: f.id } : f)), styleRefs: { ...x.styleRefs, fill: undefined } }))}
            onRemove={() => st.updateNodes(ids, (x) => ({ fills: x.fills.filter((_, j) => j !== i) }))}
          />
        ))
      )}
    </Section>
  );
}

function StrokeSection({ sel }: { sel: SceneNode[] }) {
  const st = useEditor();
  const ids = sel.map((n) => n.id);
  const strokes = sel[0].strokes;
  const upd = (i: number, patch: Partial<Stroke>) => st.updateNodes(ids, (x) => ({ strokes: x.strokes.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  return (
    <Section
      title="Stroke"
      actions={
        <>
          <BindButton ids={ids} prop="stroke" />
          <IconButton title="Add stroke" onClick={() => st.updateNodes(ids, (x) => ({ strokes: [...x.strokes, defaultStroke()] }))}>
            <Icon name="plus" />
          </IconButton>
        </>
      }
    >
      {strokes.map((s, i) => (
        <div key={i} className="paint">
          <div className="row">
            <ColorField value={s.color} opacity={s.opacity} onChange={(c) => upd(i, { color: c })} onOpacity={(o) => upd(i, { opacity: o })} />
            <IconButton title={s.visible ? 'Hide' : 'Show'} onClick={() => upd(i, { visible: !s.visible })}>
              <Icon name={s.visible ? 'eye' : 'eyeOff'} size={12} />
            </IconButton>
            <IconButton title="Remove" onClick={() => st.updateNodes(ids, (x) => ({ strokes: x.strokes.filter((_, j) => j !== i) }))}>
              <Icon name="minus" size={12} />
            </IconButton>
          </div>
          <div className="grid2">
            <Select value={s.align} options={[{ value: 'inside', label: 'Inside' }, { value: 'center', label: 'Center' }, { value: 'outside', label: 'Outside' }]} onChange={(v) => upd(i, { align: v })} />
            <NumberField label="≡" title="Weight" value={s.width} min={0} step={0.5} onChange={(v) => upd(i, { width: v })} />
            <NumberField label="┄" title="Dash" value={s.dash} min={0} onChange={(v) => upd(i, { dash: v })} />
            <Select value={s.cap} options={[{ value: 'butt', label: 'No cap' }, { value: 'round', label: 'Round cap' }, { value: 'square', label: 'Square cap' }]} onChange={(v) => upd(i, { cap: v })} />
          </div>
        </div>
      ))}
    </Section>
  );
}

function EffectSection({ sel }: { sel: SceneNode[] }) {
  const st = useEditor();
  const ids = sel.map((n) => n.id);
  const effects = sel[0].effects;
  const upd = (i: number, patch: Partial<Effect>) => st.updateNodes(ids, (x) => ({ effects: x.effects.map((e, j) => (j === i ? { ...e, ...patch } : e)) }));
  return (
    <Section
      title="Effects"
      actions={
        <IconButton title="Add effect" onClick={() => st.updateNodes(ids, (x) => ({ effects: [...x.effects, defaultEffect()] }))}>
          <Icon name="plus" />
        </IconButton>
      }
    >
      {effects.map((e, i) => (
        <div key={e.id} className="paint">
          <div className="row">
            <Select
              value={e.kind}
              options={[{ value: 'drop-shadow', label: 'Drop shadow' }, { value: 'inner-shadow', label: 'Inner shadow' }, { value: 'layer-blur', label: 'Layer blur' }, { value: 'background-blur', label: 'Background blur' }]}
              onChange={(v) => upd(i, { kind: v })}
              width="100%"
            />
            <IconButton title={e.visible ? 'Hide' : 'Show'} onClick={() => upd(i, { visible: !e.visible })}>
              <Icon name={e.visible ? 'eye' : 'eyeOff'} size={12} />
            </IconButton>
            <IconButton title="Remove" onClick={() => st.updateNodes(ids, (x) => ({ effects: x.effects.filter((_, j) => j !== i) }))}>
              <Icon name="minus" size={12} />
            </IconButton>
          </div>
          {e.kind.includes('shadow') ? (
            <>
              <div className="grid2">
                <NumberField label="X" value={e.x} onChange={(v) => upd(i, { x: v })} />
                <NumberField label="Y" value={e.y} onChange={(v) => upd(i, { y: v })} />
                <NumberField label="Blur" value={e.blur} min={0} onChange={(v) => upd(i, { blur: v })} />
                <NumberField label="Spread" value={e.spread} onChange={(v) => upd(i, { spread: v })} />
              </div>
              <ColorField value={e.color} opacity={e.opacity} onChange={(c) => upd(i, { color: c })} onOpacity={(o) => upd(i, { opacity: o })} />
            </>
          ) : (
            <NumberField label="Blur" value={e.blur} min={0} onChange={(v) => upd(i, { blur: v })} />
          )}
        </div>
      ))}
    </Section>
  );
}

function ExportSection({ n }: { n: SceneNode }) {
  const st = useEditor();
  const exps = n.exports ?? [];
  const upd = (list: ExportSetting[]) => st.updateNodes([n.id], { exports: list });
  return (
    <Section
      title="Export"
      actions={
        <IconButton title="Add export setting" onClick={() => upd([...exps, { id: uid(), format: 'png', scale: exps.length ? exps.length + 1 : 1, suffix: exps.length ? `@${exps.length + 1}x` : '' }])}>
          <Icon name="plus" />
        </IconButton>
      }
    >
      {exps.map((e, i) => (
        <div className="row" key={e.id}>
          <Select value={e.scale} options={[0.5, 0.75, 1, 1.5, 2, 3, 4].map((s) => ({ value: s, label: `${s}x` }))} onChange={(v) => upd(exps.map((x, j) => (j === i ? { ...x, scale: v } : x)))} />
          <input className="text-input small" placeholder="Suffix" value={e.suffix} onChange={(ev) => upd(exps.map((x, j) => (j === i ? { ...x, suffix: ev.target.value } : x)))} onKeyDown={(ev) => ev.stopPropagation()} />
          <Select value={e.format} options={['png', 'jpg', 'svg', 'pdf'].map((f) => ({ value: f as 'png', label: f.toUpperCase() }))} onChange={(v) => upd(exps.map((x, j) => (j === i ? { ...x, format: v } : x)))} />
          <IconButton title="Remove" onClick={() => upd(exps.filter((_, j) => j !== i))}>
            <Icon name="minus" size={12} />
          </IconButton>
        </div>
      ))}
      <button
        className="btn"
        onClick={async () => {
          const list = exps.length ? exps : [{ id: 'x', format: 'png' as const, scale: 1, suffix: '' }];
          for (const e of list) await saveBlob(await exportNodes(useEditor.getState().doc.nodes, [n.id], e.format, e.scale), `${n.name}${e.suffix}.${e.format}`);
        }}
      >
        <Icon name="download" size={13} /> Export {n.name}
      </button>
    </Section>
  );
}

const TRIGGERS: { value: PrototypeLink['trigger']; label: string }[] = [
  { value: 'click', label: 'On click' },
  { value: 'hover', label: 'While hovering' },
  { value: 'press', label: 'While pressing' },
  { value: 'mouse-enter', label: 'Mouse enter' },
  { value: 'mouse-leave', label: 'Mouse leave' },
  { value: 'after-delay', label: 'After delay' },
  { value: 'key', label: 'Key press' },
];
const ACTIONS: { value: NonNullable<PrototypeLink['action']>; label: string }[] = [
  { value: 'navigate', label: 'Navigate to' },
  { value: 'change-to', label: 'Change to (variant)' },
  { value: 'overlay', label: 'Open overlay' },
  { value: 'swap-overlay', label: 'Swap overlay' },
  { value: 'close-overlay', label: 'Close overlay' },
  { value: 'scroll-to', label: 'Scroll to' },
  { value: 'back', label: 'Back' },
  { value: 'url', label: 'Open link' },
];
const ANIMS: { value: PrototypeLink['animation']; label: string }[] = [
  { value: 'instant', label: 'Instant' },
  { value: 'dissolve', label: 'Dissolve' },
  { value: 'smart-animate', label: 'Smart animate' },
  { value: 'move-in', label: 'Move in' },
  { value: 'move-out', label: 'Move out' },
  { value: 'push', label: 'Push' },
  { value: 'slide-in', label: 'Slide in' },
  { value: 'slide-out', label: 'Slide out' },
];
const EASES: { value: NonNullable<PrototypeLink['easing']>; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in', label: 'Ease in' },
  { value: 'ease-out', label: 'Ease out' },
  { value: 'ease-in-out', label: 'Ease in and out' },
  { value: 'ease-in-back', label: 'Ease in back' },
  { value: 'ease-out-back', label: 'Ease out back' },
  { value: 'gentle', label: 'Gentle (spring)' },
  { value: 'spring', label: 'Quick (spring)' },
  { value: 'bouncy', label: 'Bouncy (spring)' },
];

function PrototypeProps({ sel }: { sel: SceneNode[] }) {
  const st = useEditor();
  const page = st.page();
  const frames = page.children.map((id) => st.doc.nodes[id]).filter((n) => n && (n.type === 'frame' || n.type === 'component'));
  if (!sel.length)
    return (
      <Section title="Flow">
        <div className="muted">Starting frame</div>
        <Select
          value={page.startFrameId ?? ''}
          width="100%"
          options={[{ value: '', label: 'First frame' }, ...frames.map((f) => ({ value: f.id, label: f.name }))]}
          onChange={(v) => st.mutate((d) => (d.pages.find((p) => p.id === page.id)!.startFrameId = v || undefined))}
        />
        <p className="muted">Select a layer, then drag the ⊕ handle on its right edge onto a frame to create a click interaction. Use Smart animate between frames whose layers share names.</p>
        <button className="btn primary" onClick={() => st.set({ presenting: true })}>
          <Icon name="play" size={12} /> Present
        </button>
      </Section>
    );
  const n = sel[0];
  const links = n.prototype ?? [];
  const upd = (list: PrototypeLink[]) => st.updateNodes([n.id], { prototype: list });
  const set = (i: number, patch: Partial<PrototypeLink>) => upd(links.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const allNodes = Object.values(st.doc.nodes).filter((x) => x.id !== n.id);
  // interactive components: sibling variants of the component this layer belongs to
  let ownerComp: SceneNode | undefined = n;
  while (ownerComp && ownerComp.type !== 'component') ownerComp = ownerComp.parentId ? st.doc.nodes[ownerComp.parentId] : undefined;
  const ownerSet = ownerComp ? setOf(st.doc.nodes, ownerComp.id) : null;
  const variantTargets = ownerSet ? variantsOf(st.doc.nodes, ownerSet.id).filter((v) => v.id !== ownerComp!.id) : [];
  const parent = n.parentId ? st.doc.nodes[n.parentId] : null;
  return (
    <>
      <Section
        title="Interactions"
        actions={
          <IconButton title="Add interaction" onClick={() => upd([...links, { trigger: 'click', action: 'navigate', targetId: frames.find((f) => f.id !== n.id)?.id ?? 'back', animation: 'dissolve', easing: 'ease-out', duration: 300 }])}>
            <Icon name="plus" />
          </IconButton>
        }
      >
        {links.length === 0 && <div className="muted">No interactions. Drag the ⊕ handle to a frame or click +.</div>}
        {links.map((l, i) => {
          const action = l.action ?? (l.targetId === 'back' ? 'back' : 'navigate');
          const needsTarget = action === 'navigate' || action === 'overlay' || action === 'swap-overlay' || action === 'scroll-to' || action === 'change-to';
          const targets = action === 'scroll-to' ? allNodes : action === 'change-to' ? variantTargets : frames.filter((f) => f.id !== n.id);
          const animated = action !== 'back' && action !== 'url' && action !== 'scroll-to' && action !== 'close-overlay';
          return (
            <div className="paint interaction" key={i}>
              <div className="grid2">
                <Select value={l.trigger} options={TRIGGERS} onChange={(v) => set(i, { trigger: v })} />
                <Select value={action} options={ACTIONS} onChange={(v) => set(i, { action: v, targetId: v === 'back' || v === 'close-overlay' || v === 'url' ? 'back' : v === 'change-to' ? variantTargets[0]?.id ?? 'back' : l.targetId === 'back' || action === 'change-to' ? frames.find((f) => f.id !== n.id)?.id ?? 'back' : l.targetId, animation: v === 'change-to' ? 'smart-animate' : l.animation, overlay: v === 'overlay' || v === 'swap-overlay' ? l.overlay ?? { position: 'center', closeOnOutside: true, background: 'rgba(0,0,0,0.4)' } : l.overlay })} />
                {l.trigger === 'after-delay' && <NumberField label="Delay" suffix="ms" value={l.delay ?? 800} min={0} step={100} onChange={(v) => set(i, { delay: v })} />}
                {l.trigger === 'key' && <input className="text-input" placeholder="Key (e.g. Enter, a)" value={l.key ?? ''} onChange={(e) => set(i, { key: e.target.value })} onKeyDown={(e) => { e.stopPropagation(); if (e.key.length === 1 || ['Enter', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) { e.preventDefault(); set(i, { key: e.key }); } }} />}
              </div>
              {needsTarget && (
                <Select value={l.targetId} width="100%" options={targets.map((f) => ({ value: f.id, label: f.name }))} onChange={(v) => set(i, { targetId: v })} />
              )}
              {action === 'url' && <input className="text-input" placeholder="https://…" value={l.url ?? ''} onChange={(e) => set(i, { url: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />}
              {(action === 'overlay' || action === 'swap-overlay') && (
                <div className="grid2">
                  <Select value={l.overlay?.position ?? 'center'} options={['center', 'top', 'bottom', 'left', 'right'].map((p) => ({ value: p as 'center', label: cap(p) }))} onChange={(v) => set(i, { overlay: { ...(l.overlay ?? { closeOnOutside: true, background: 'rgba(0,0,0,0.4)' }), position: v } })} />
                  <label className="check"><input type="checkbox" checked={l.overlay?.closeOnOutside ?? true} onChange={(e) => set(i, { overlay: { ...(l.overlay ?? { position: 'center', background: 'rgba(0,0,0,0.4)' }), closeOnOutside: e.target.checked } })} /> Close on outside click</label>
                </div>
              )}
              {animated && (
                <>
                  <div className="grid2">
                    <Select value={l.animation} options={ANIMS} onChange={(v) => set(i, { animation: v })} />
                    {['move-in', 'move-out', 'push', 'slide-in', 'slide-out'].includes(l.animation) ? (
                      <Select value={l.direction ?? 'left'} options={[{ value: 'left', label: '← Left' }, { value: 'right', label: '→ Right' }, { value: 'up', label: '↑ Up' }, { value: 'down', label: '↓ Down' }]} onChange={(v) => set(i, { direction: v })} />
                    ) : (
                      <span />
                    )}
                    <Select value={l.easing ?? 'ease-out'} options={EASES} onChange={(v) => set(i, { easing: v })} />
                    <NumberField label="ms" value={l.duration} min={0} step={50} onChange={(v) => set(i, { duration: v })} />
                  </div>
                  <EasingPreview easing={l.easing ?? 'ease-out'} />
                </>
              )}
              <button className="btn small danger" onClick={() => upd(links.filter((_, j) => j !== i))}>Remove</button>
            </div>
          );
        })}
      </Section>
      {(n.type === 'frame' || n.type === 'component') && (
        <Section title="Scroll behaviour">
          <Select
            value={n.overflow ?? 'none'}
            width="100%"
            options={[{ value: 'none', label: 'No scrolling' }, { value: 'vertical', label: 'Vertical scrolling' }, { value: 'horizontal', label: 'Horizontal scrolling' }, { value: 'both', label: 'Horizontal & vertical' }]}
            onChange={(v) => st.updateNodes([n.id], { overflow: v })}
          />
          <p className="muted">Content outside the frame bounds scrolls in presentation mode.</p>
        </Section>
      )}
      {parent && (parent.overflow ?? 'none') !== 'none' && (
        <Section title="Position">
          <label className="check"><input type="checkbox" checked={!!n.fixed} onChange={(e) => st.updateNodes([n.id], { fixed: e.target.checked })} /> Fix position when scrolling</label>
        </Section>
      )}
    </>
  );
}

function EasingPreview({ easing }: { easing: NonNullable<PrototypeLink['easing']> }) {
  const f = EASINGS[easing];
  const pts = Array.from({ length: 41 }, (_, i) => {
    const t = i / 40;
    return `${4 + t * 92},${44 - f(t) * 36}`;
  }).join(' ');
  return (
    <svg className="easing-preview" viewBox="0 0 100 50" width="100%" height={50}>
      <line x1={4} y1={44} x2={96} y2={44} stroke="currentColor" opacity={0.2} />
      <line x1={4} y1={8} x2={96} y2={8} stroke="currentColor" opacity={0.2} strokeDasharray="2 2" />
      <polyline points={pts} fill="none" stroke="var(--proto)" strokeWidth={1.5} />
    </svg>
  );
}

function DevProps({ sel }: { sel: SceneNode[] }) {
  const st = useEditor();
  const [tab, setTab] = useState<'css' | 'jsx'>('css');
  if (!sel.length) return <div className="muted pad">Select a layer to inspect its properties and code.</div>;
  const n = sel[0];
  const parent = n.parentId ? st.doc.nodes[n.parentId] : null;
  const code = tab === 'css' ? `.${n.name.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()} {\n${cssFor(n).split('\n').map((l) => '  ' + l).join('\n')}\n}` : jsxFor(st.doc.nodes, n.id);
  return (
    <>
      <Section title={n.name}>
        <table className="inspect">
          <tbody>
            <tr><td>Type</td><td>{typeLabel(n)}</td></tr>
            <tr><td>Position</td><td>{Math.round(n.x - (parent?.x ?? 0))}, {Math.round(n.y - (parent?.y ?? 0))}</td></tr>
            <tr><td>Size</td><td>{Math.round(n.w)} × {Math.round(n.h)}</td></tr>
            {n.rotation ? <tr><td>Rotation</td><td>{n.rotation}°</td></tr> : null}
            {n.fills.filter((f) => f.visible).map((f, i) => <tr key={i}><td>Fill</td><td><span className="swatch tiny" style={{ background: paintCss(f) }} /> {f.kind === 'solid' ? f.color.toUpperCase() : cap(f.kind)}</td></tr>)}
            {n.text && <tr><td>Typography</td><td>{n.text.fontFamily} {n.text.fontWeight} / {n.text.fontSize}px</td></tr>}
          </tbody>
        </table>
      </Section>
      <Section title="Code">
        <div className="row gap">
          <button className={`chip ${tab === 'css' ? 'active' : ''}`} onClick={() => setTab('css')}>CSS</button>
          <button className={`chip ${tab === 'jsx' ? 'active' : ''}`} onClick={() => setTab('jsx')}>JSX</button>
          <button className="btn small" onClick={() => { navigator.clipboard?.writeText(code); st.notify('Copied'); }}>Copy</button>
        </div>
        <pre className="code">{code}</pre>
      </Section>
      <ExportSection n={n} />
    </>
  );
}

function BoolIcon({ op }: { op: 'union' | 'subtract' | 'intersect' | 'exclude' }) {
  const a = 'M2 2h7v7H2z',
    b = 'M6 6h7v7H6z';
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.2}>
      {op === 'union' && <path d="M2 2h7v4h4v7H6V9H2z" fill="currentColor" fillOpacity={0.35} />}
      {op === 'subtract' && <path d="M2 2h7v4H6v3H2z" fill="currentColor" fillOpacity={0.35} />}
      {op === 'intersect' && <path d="M6 6h3v3H6z" fill="currentColor" fillOpacity={0.6} />}
      {op === 'exclude' && <path d="M2 2h7v4H6v3H2zM9 6h4v7H6V9h3z" fill="currentColor" fillOpacity={0.35} />}
      <path d={a} fill="none" />
      <path d={b} fill="none" />
    </svg>
  );
}
