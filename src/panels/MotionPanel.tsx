import { useState } from 'react';
import { useEditor } from '../store/store';
import { NumberField, Section, ColorField } from './controls';
import { Icon } from './icons';
import { MOTION_PROPS, PRESETS, currentValue, hasMotion, type MotionProp, type MotionValue, type Vec } from '../lib/motion';
import type { SceneNode } from '../types';

/** Keyframe diamond next to a property: filled when there is a key at the playhead, outlined when animated elsewhere. */
function Diamond({ ids, prop }: { ids: string[]; prop: MotionProp }) {
  const st = useEditor();
  const n = st.doc.nodes[ids[0]];
  const kfs = n?.motion?.tracks[prop];
  const atNow = kfs?.some((k) => Math.abs(k.t - st.motionTime) < 1);
  return (
    <button className={`mp-dia ${atNow ? 'on' : kfs?.length ? 'animated' : ''}`} title={atNow ? 'Remove keyframe at playhead' : 'Add keyframe at playhead'} onClick={() => st.toggleKeyframe(ids, prop)}>
      <svg width="10" height="10" viewBox="0 0 10 10"><path d="M5 .8 9.2 5 5 9.2.8 5Z" /></svg>
    </button>
  );
}

/** Properties panel for Motion mode. Edits record keyframes at the playhead when auto-key is on (or the property is already animated). */
export function MotionProps({ sel }: { sel: SceneNode[] }) {
  const st = useEditor();
  const [presetsOpen, setPresetsOpen] = useState(false);
  const n = sel[0];
  const ids = sel.map((x) => x.id);
  const t = st.motionTime;
  const parent = n.parentId ? st.doc.nodes[n.parentId] : null;
  const val = (p: MotionProp) => currentValue(n, p, t);
  /** Record a keyframe, or edit the design value when not animating this property. */
  const edit = (prop: MotionProp, v: MotionValue | ((x: SceneNode) => MotionValue), designPatch: (x: SceneNode) => Partial<SceneNode>) => {
    const animated = !!n.motion?.tracks[prop]?.length;
    if (st.autoKey || animated) st.setKeyframe(ids, prop, v);
    else st.updateNodes(ids, designPatch);
  };
  const pos = val('position') as Vec;
  const scale = val('scale') as Vec;
  const typeName = n.type === 'rect' ? 'Rectangle' : n.type[0].toUpperCase() + n.type.slice(1);
  const animatedProps = MOTION_PROPS.filter((p) => n.motion?.tracks[p.id]?.length);

  return (
    <>
      <div className="mp-head">
        <b>{sel.length > 1 ? `${sel.length} layers` : typeName}</b>
        <span className={`mp-auto ${st.autoKey ? 'on' : ''}`} title="Auto-key: edits record keyframes at the playhead" onClick={() => st.set({ autoKey: !st.autoKey })}>
          ◆ {st.autoKey ? 'Recording' : 'Auto-key off'}
        </span>
      </div>

      <Section
        title="Animations"
        actions={
          <button className="icon-btn ghost" title="Add an animation preset" onClick={() => setPresetsOpen(!presetsOpen)}><Icon name="plus" size={12} /></button>
        }
      >
        {presetsOpen && (
          <div className="mp-presets">
            {PRESETS.map((p) => (
              <button key={p.id} onClick={() => { st.applyMotionPreset(ids, p.id); setPresetsOpen(false); }} title={p.hint}>
                <span className={`mp-pre-ico p-${p.id}`} />
                <span>{p.label}</span>
              </button>
            ))}
            <small className="muted">Presets start at the playhead. Fine-tune keyframes in the timeline.</small>
          </div>
        )}
        {animatedProps.length ? (
          <div className="mp-anims">
            {animatedProps.map((p) => (
              <div key={p.id} className="mp-anim">
                <span className="mp-anim-dot" />
                <span className="grow">{p.label}</span>
                <small className="muted">{n.motion!.tracks[p.id]!.length} keys</small>
                <button className="icon-btn ghost" title={`Remove ${p.label.toLowerCase()} animation`} onClick={() => st.clearMotion(ids, p.id)}><Icon name="minus" size={12} /></button>
              </div>
            ))}
          </div>
        ) : (
          !presetsOpen && <p className="muted mp-hint">Move the playhead and change a property to add keyframes, or press + for a preset.</p>
        )}
      </Section>

      <Section title="Transform">
        <div className="sub-label">Position</div>
        <div className="mp-row">
          <NumberField label="X→" value={Math.round((parent ? n.x - parent.x : n.x) + pos.x)} onChange={(v) => edit('position', { x: v - (parent ? n.x - parent.x : n.x), y: pos.y }, (x) => ({ x: v + (parent?.x ?? 0) + (x.x - n.x) }))} />
          <NumberField label="Y↓" value={Math.round((parent ? n.y - parent.y : n.y) + pos.y)} onChange={(v) => edit('position', { x: pos.x, y: v - (parent ? n.y - parent.y : n.y) }, (x) => ({ y: v + (parent?.y ?? 0) + (x.y - n.y) }))} />
          <Diamond ids={ids} prop="position" />
        </div>
        <div className="sub-label">Scale</div>
        <div className="mp-row">
          <NumberField label="↔" suffix="%" value={Math.round(scale.x * 100)} onChange={(v) => st.setKeyframe(ids, 'scale', { x: v / 100, y: scale.y })} />
          <NumberField label="↕" suffix="%" value={Math.round(scale.y * 100)} onChange={(v) => st.setKeyframe(ids, 'scale', { x: scale.x, y: v / 100 })} />
          <Diamond ids={ids} prop="scale" />
        </div>
        <div className="sub-label">Rotation</div>
        <div className="mp-row">
          <NumberField label="∟" suffix="°" value={Math.round(val('rotation') as number)} onChange={(v) => edit('rotation', v, () => ({ rotation: v }))} />
          <span />
          <Diamond ids={ids} prop="rotation" />
        </div>
      </Section>

      <Section title="Layout">
        <div className="sub-label">Dimensions</div>
        <div className="mp-row">
          <NumberField label="W" value={Math.round(val('width') as number)} min={0} onChange={(v) => edit('width', v, () => ({ w: v }))} />
          <NumberField label="H" value={Math.round(val('height') as number)} min={0} onChange={(v) => edit('height', v, () => ({ h: v }))} />
          <span className="mp-dias"><Diamond ids={ids} prop="width" /><Diamond ids={ids} prop="height" /></span>
        </div>
      </Section>

      <Section title="Appearance">
        <div className="sub-label two"><span>Opacity</span><span>Corner radius</span></div>
        <div className="mp-row four">
          <NumberField label="◐" suffix="%" value={Math.round((val('opacity') as number) * 100)} min={0} max={100} onChange={(v) => edit('opacity', v / 100, () => ({ opacity: v / 100 }))} />
          <Diamond ids={ids} prop="opacity" />
          <NumberField label="◜" value={Math.round(val('radius') as number)} min={0} onChange={(v) => edit('radius', v, () => ({ radius: v, radii: null }))} />
          <Diamond ids={ids} prop="radius" />
        </div>
      </Section>

      {n.type !== 'group' && n.type !== 'text' && (
        <Section title="Fill">
          <div className="mp-row">
            <div className="mp-fill"><ColorField value={val('fill') as string} onChange={(c) => edit('fill', c, (x) => ({ fills: x.fills.length ? x.fills.map((p, i) => (i === 0 ? { ...p, kind: 'solid', color: c } : p)) : [{ id: 'f', kind: 'solid', color: c, opacity: 1, visible: true }] }))} /></div>
            <span />
            <Diamond ids={ids} prop="fill" />
          </div>
        </Section>
      )}
    </>
  );
}

/** Motion mode with nothing selected: timeline settings and the page's animated layers. */
export function MotionPageProps() {
  const st = useEditor();
  const animated = Object.values(st.doc.nodes).filter(hasMotion);
  return (
    <Section title="Motion">
      <p className="muted mp-hint">Select a layer to animate it. Every change you make while the playhead is on the timeline becomes a keyframe.</p>
      {animated.map((n) => (
        <button key={n.id} className="mp-layer" onClick={() => st.select([n.id])}>
          <span className="mp-anim-dot" /> {n.name}
        </button>
      ))}
    </Section>
  );
}
