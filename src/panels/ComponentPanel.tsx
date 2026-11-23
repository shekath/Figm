import { useState } from 'react';
import { useEditor } from '../store/store';
import { Section, IconButton } from './controls';
import { Icon } from './icons';
import type { ComponentProp, SceneNode } from '../types';
import { componentPropsFor, findByPath, findVariant, isSet, nestedLayers, setOf, swapOptions, variantDefs, variantsOf } from '../lib/components';
import { pageOf } from '../lib/docops';

/** Design-panel section for component sets, variants, components, instances and layers inside components. */
export function ComponentPanel({ n }: { n: SceneNode }) {
  const st = useEditor();
  const nodes = st.doc.nodes;
  if (isSet(n)) return <SetSection set={n} />;
  if (n.type === 'component') return <MainComponentSection comp={n} />;
  // a layer inside a main component → offer to expose it as a component property
  let owner: SceneNode | undefined = n.parentId ? nodes[n.parentId] : undefined;
  while (owner && owner.type !== 'component') owner = owner.parentId ? nodes[owner.parentId] : undefined;
  const propSection = owner ? (
    <Section title="Component property">
      <p className="muted">Expose this layer on instances of “{(setOf(nodes, owner.id) ?? owner).name}”.</p>
      <div className="row gap">
        <button className="btn small" onClick={() => st.addComponentProp(n.id, 'boolean')}>+ Visibility toggle</button>
        {n.type === 'text' && <button className="btn small" onClick={() => st.addComponentProp(n.id, 'text')}>+ Text property</button>}
        {n.type === 'instance' && <button className="btn small" onClick={() => st.addComponentProp(n.id, 'instance-swap')}>+ Instance swap</button>}
      </div>
    </Section>
  ) : null;
  if (n.type === 'instance')
    return (
      <>
        <InstanceSection inst={n} />
        {propSection}
      </>
    );
  return propSection;
}

function goTo(id: string) {
  const s = useEditor.getState();
  const page = pageOf(s.doc, id);
  if (page && page !== s.pageId) s.setPage(page);
  setTimeout(() => {
    useEditor.getState().select([id]);
    useEditor.getState().zoomToSelection();
  }, 0);
}

function EditableText({ value, onCommit, className }: { value: string; onCommit: (v: string) => void; className?: string }) {
  const [v, setV] = useState(value);
  const [focus, setFocus] = useState(false);
  return (
    <input
      className={`inline-input ${className ?? ''}`}
      value={focus ? v : value}
      onFocus={() => {
        setV(value);
        setFocus(true);
      }}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        setFocus(false);
        if (v.trim() && v !== value) onCommit(v.trim());
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function SetSection({ set }: { set: SceneNode }) {
  const st = useEditor();
  const defs = variantDefs(st.doc.nodes, set.id);
  return (
    <>
      <Section
        title="Component set"
        actions={
          <IconButton title="Add variant" onClick={() => st.addVariant(set.id)}>
            <Icon name="plus" />
          </IconButton>
        }
      >
        <div className="muted">{set.children.length} variants</div>
        {defs.map((d) => (
          <div key={d.name} className="variant-def">
            <EditableText className="prop-name" value={d.name} onCommit={(v) => st.renameVariantProp(set.id, d.name, v)} />
            <div className="chips">
              {d.values.map((val) => (
                <EditableText key={val} className="chip-input" value={val} onCommit={(v) => st.renameVariantValue(set.id, d.name, val, v)} />
              ))}
            </div>
          </div>
        ))}
        <div className="row gap">
          <button className="btn small" onClick={() => st.addVariant(set.id)}>+ Variant</button>
          <button
            className="btn small"
            onClick={() => {
              const name = prompt('New variant property name', `Property ${defs.length + 1}`);
              if (name) st.addVariantProp(set.id, name);
            }}
          >
            + Property
          </button>
        </div>
      </Section>
      <PropsEditor owner={set} />
    </>
  );
}

function MainComponentSection({ comp }: { comp: SceneNode }) {
  const st = useEditor();
  const set = setOf(st.doc.nodes, comp.id);
  const defs = set ? variantDefs(st.doc.nodes, set.id) : [];
  return (
    <>
      <Section
        title={set ? 'Variant' : 'Main component'}
        actions={
          set ? (
            <IconButton title="Add variant like this one" onClick={() => st.addVariant(comp.id)}>
              <Icon name="plus" />
            </IconButton>
          ) : undefined
        }
      >
        {set ? (
          <>
            <div className="row gap">
              <Icon name="component" size={13} />
              <a className="clickable grow" onClick={() => goTo(set.id)}>{set.name}</a>
            </div>
            {defs.map((d) => (
              <label key={d.name} className="row">
                <span className="grow muted">{d.name}</span>
                <input
                  className="text-input small-w"
                  list={`vals-${set.id}-${d.name}`}
                  defaultValue={comp.variantProps?.[d.name] ?? ''}
                  key={comp.variantProps?.[d.name]}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== comp.variantProps?.[d.name] && st.setVariantValue(comp.id, d.name, e.target.value.trim())}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                />
                <datalist id={`vals-${set.id}-${d.name}`}>
                  {d.values.map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
              </label>
            ))}
          </>
        ) : (
          <>
            <textarea className="desc" placeholder="Component description" defaultValue={comp.description} onBlur={(e) => st.updateNodes([comp.id], { description: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
            <button className="btn small" onClick={() => { st.select([comp.id]); st.combineAsVariants(); }} title="Select two or more components and combine them">
              Combine with other selected components as variants…
            </button>
            <p className="muted">Tip: select several components, then Object → Combine as variants (Ctrl+Alt+Shift+K).</p>
          </>
        )}
      </Section>
      {!set && <PropsEditor owner={comp} />}
    </>
  );
}

function PropsEditor({ owner }: { owner: SceneNode }) {
  const st = useEditor();
  const props = owner.componentProps ?? [];
  const firstVariant = isSet(owner) ? owner.children[0] : owner.id;
  return (
    <Section title="Properties">
      {props.length === 0 && <div className="muted">Select a layer inside the component to add a visibility toggle or a text property.</div>}
      {props.map((p) => {
        const found = firstVariant ? findByPath(st.doc.nodes, firstVariant, p.layer) : null;
        return (
          <div key={p.id} className="comp-prop">
            <span className="type-badge">{p.type === 'boolean' ? '◐' : p.type === 'instance-swap' ? '◇' : 'T'}</span>
            <EditableText className="grow" value={p.name} onCommit={(v) => st.updateComponentProp(owner.id, p.id, { name: v })} />
            {p.type === 'boolean' ? (
              <input type="checkbox" title="Default value" checked={p.default === true} onChange={(e) => st.updateComponentProp(owner.id, p.id, { default: e.target.checked })} />
            ) : p.type === 'instance-swap' ? (
              <ComponentPicker value={String(p.default)} owner={isSet(owner) ? owner.children[0] : owner.id} preferred={p.preferred} onChange={(v) => v && st.updateComponentProp(owner.id, p.id, { default: v })} />
            ) : (
              <EditableText className="small-w" value={String(p.default)} onCommit={(v) => st.updateComponentProp(owner.id, p.id, { default: v })} />
            )}
            <button className="icon-btn ghost" title={found ? `Targets layer “${p.layer}”` : `Layer “${p.layer}” not found`} onClick={() => found && goTo(found)}>
              <Icon name={found ? 'link' : 'close'} size={12} />
            </button>
            <button className="icon-btn ghost" title="Delete property" onClick={() => st.deleteComponentProp(owner.id, p.id)}>
              <Icon name="trash" size={12} />
            </button>
          </div>
        );
      })}
    </Section>
  );
}

/** Component select used for instance swapping (preferred values first, never a component that contains the owner). */
function ComponentPicker({ value, owner, preferred, onChange, allowReset }: { value: string; owner?: string; preferred?: string[]; onChange: (id: string | null) => void; allowReset?: boolean }) {
  const nodes = useEditor((s) => s.doc.nodes);
  const opts = swapOptions(nodes, owner, preferred);
  return (
    <select className="select swap-select" value={value} onChange={(e) => onChange(e.target.value || null)} onKeyDown={(e) => e.stopPropagation()} title="Swap instance">
      {allowReset && <option value="">↺ Default</option>}
      {!opts.some((o) => o.id === value) && value && <option value={value}>{nodes[value]?.name ?? 'Missing'}</option>}
      {opts.map((o) => (
        <option key={o.id} value={o.id}>{o.preferred ? '★ ' : ''}{o.label}</option>
      ))}
    </select>
  );
}

function InstanceSection({ inst }: { inst: SceneNode }) {
  const st = useEditor();
  const nodes = st.doc.nodes;
  const comp = inst.componentId ? nodes[inst.componentId] : undefined;
  const set = setOf(nodes, inst.componentId);
  const defs = set ? variantDefs(nodes, set.id) : [];
  const props: ComponentProp[] = componentPropsFor(nodes, inst.componentId);
  const topComp = set ? set.children[0] : comp?.id;
  const layers = nestedLayers(nodes, inst);
  // layers driven by a property of this instance are edited through the property instead
  const propLayers = new Set(props.map((p) => (comp ? findByPath(nodes, comp.id, p.layer) : null)));
  const texts = layers.filter((e) => e.node.type === 'text' && !propLayers.has(e.key));
  const nested = layers.filter((e) => e.node.type === 'instance');
  const rawOf = (key: string) => nodes[key.split('/').pop()!];
  return (
    <>
      <Section title="Instance">
        <div className="row gap">
          <Icon name="instance" />
          <span className="grow">{(set ?? comp)?.name ?? 'Missing component'}</span>
        </div>
        {defs.map((d) => (
          <label key={d.name} className="row">
            <span className="grow muted">{d.name}</span>
            <select className="select" value={comp?.variantProps?.[d.name] ?? ''} onChange={(e) => st.setInstanceVariant(inst.id, d.name, e.target.value)} onKeyDown={(e) => e.stopPropagation()}>
              {d.values.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </label>
        ))}
        {props.map((p) => {
          const val = inst.propValues?.[p.id] ?? p.default;
          if (p.type === 'boolean')
            return (
              <label key={p.id} className="row">
                <span className="grow muted">{p.name}</span>
                <input type="checkbox" checked={val === true || val === 'true'} onChange={(e) => st.setInstanceProp([inst.id], p.id, e.target.checked)} />
              </label>
            );
          if (p.type === 'instance-swap')
            return (
              <label key={p.id} className="row">
                <span className="grow muted">◇ {p.name}</span>
                <ComponentPicker value={String(val)} owner={topComp} preferred={p.preferred} onChange={(v) => v && st.setInstanceProp([inst.id], p.id, v)} />
              </label>
            );
          return (
            <label key={p.id} className="row">
              <span className="grow muted">{p.name}</span>
              <EditableText className="small-w" value={String(val)} onCommit={(v) => st.setInstanceProp([inst.id], p.id, v)} />
            </label>
          );
        })}
        <div className="row gap">
          <button className="btn small" onClick={() => comp && goTo(comp.id)}>Go to main</button>
          <button className="btn small" onClick={st.detachInstance}>Detach</button>
          <button className="btn small" onClick={() => st.updateNodes([inst.id], { overrides: {}, propValues: {} })}>Reset all</button>
        </div>
      </Section>

      {nested.length > 0 && (
        <Section title="Nested instances" collapsible>
          {nested.map((e) => {
            const raw = rawOf(e.key);
            const nComp = e.node.componentId;
            const nSet = setOf(nodes, nComp);
            const nDefs = nSet ? variantDefs(nodes, nSet.id) : [];
            const nProps = componentPropsFor(nodes, nComp);
            const swapped = !!inst.overrides?.[e.key]?.componentId;
            return (
              <div key={e.key} className="nested-inst" style={{ marginLeft: e.depth * 10 }}>
                <div className="row gap">
                  <Icon name="instance" size={12} />
                  <span className="grow" title={e.path}>{e.path.split('/').pop()}</span>
                  {swapped && <span className="badge">swapped</span>}
                  <button className="icon-btn ghost" title="Reset this nested instance" onClick={() => st.setNestedOverride(inst.id, e.key, null)}>
                    <Icon name="undo" size={12} />
                  </button>
                </div>
                <ComponentPicker value={nComp ?? ''} owner={topComp} preferred={raw?.componentId ? [raw.componentId, ...(setOf(nodes, raw.componentId) ? variantsOf(nodes, setOf(nodes, raw.componentId)!.id).map((v) => v.id) : [])] : []} allowReset={swapped} onChange={(v) => st.swapNested(inst.id, e.key, v)} />
                {nDefs.map((d) => (
                  <label key={d.name} className="row">
                    <span className="grow muted">{d.name}</span>
                    <select
                      className="select"
                      value={nodes[nComp!]?.variantProps?.[d.name] ?? ''}
                      onChange={(ev) => {
                        const target = findVariant(nodes, nSet!.id, { ...(nodes[nComp!]?.variantProps ?? {}), [d.name]: ev.target.value });
                        if (target) st.swapNested(inst.id, e.key, target);
                      }}
                      onKeyDown={(ev) => ev.stopPropagation()}
                    >
                      {d.values.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                ))}
                {nProps.map((p) => {
                  const val = e.node.propValues?.[p.id] ?? p.default;
                  const setVal = (v: string | boolean) => st.setNestedOverride(inst.id, e.key, { propValues: { ...(inst.overrides?.[e.key]?.propValues ?? raw?.propValues ?? {}), [p.id]: v } });
                  return p.type === 'boolean' ? (
                    <label key={p.id} className="row">
                      <span className="grow muted">{p.name}</span>
                      <input type="checkbox" checked={val === true || val === 'true'} onChange={(ev) => setVal(ev.target.checked)} />
                    </label>
                  ) : p.type === 'instance-swap' ? (
                    <label key={p.id} className="row">
                      <span className="grow muted">◇ {p.name}</span>
                      <ComponentPicker value={String(val)} owner={nComp} preferred={p.preferred} onChange={(v) => v && setVal(v)} />
                    </label>
                  ) : (
                    <label key={p.id} className="row">
                      <span className="grow muted">{p.name}</span>
                      <EditableText className="small-w" value={String(val)} onCommit={(v) => setVal(v)} />
                    </label>
                  );
                })}
                <label className="row">
                  <span className="grow muted">Visible</span>
                  <input type="checkbox" checked={e.node.visible} onChange={(ev) => st.setNestedOverride(inst.id, e.key, { visible: ev.target.checked })} />
                </label>
              </div>
            );
          })}
        </Section>
      )}

      {texts.length > 0 && (
        <Section title="Text overrides" collapsible>
          {texts.map((e) => (
            <label key={e.key} className="text-override">
              <small className="muted">{e.path}</small>
              <EditableText
                className="text-input"
                value={e.node.text!.content}
                onCommit={(val) => st.setNestedOverride(inst.id, e.key, { text: { ...e.node.text!, content: val } })}
              />
            </label>
          ))}
        </Section>
      )}
    </>
  );
}
