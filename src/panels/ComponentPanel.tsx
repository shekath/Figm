import { useState } from 'react';
import { useEditor } from '../store/store';
import { Section, IconButton } from './controls';
import { Icon } from './icons';
import type { ComponentProp, SceneNode } from '../types';
import { componentPropsFor, findByPath, isSet, setOf, variantDefs } from '../lib/components';
import { pageOf } from '../lib/docops';

/** Design-panel section for component sets, variants, components, instances and layers inside components. */
export function ComponentPanel({ n }: { n: SceneNode }) {
  const st = useEditor();
  const nodes = st.doc.nodes;
  if (isSet(n)) return <SetSection set={n} />;
  if (n.type === 'component') return <MainComponentSection comp={n} />;
  if (n.type === 'instance') return <InstanceSection inst={n} />;
  // a layer inside a main component → offer to expose it as a component property
  let owner: SceneNode | undefined = n.parentId ? nodes[n.parentId] : undefined;
  while (owner && owner.type !== 'component') owner = owner.parentId ? nodes[owner.parentId] : undefined;
  if (!owner) return null;
  return (
    <Section title="Component property">
      <p className="muted">Expose this layer on instances of “{(setOf(nodes, owner.id) ?? owner).name}”.</p>
      <div className="row gap">
        <button className="btn small" onClick={() => st.addComponentProp(n.id, 'boolean')}>+ Visibility toggle</button>
        {n.type === 'text' && <button className="btn small" onClick={() => st.addComponentProp(n.id, 'text')}>+ Text property</button>}
      </div>
    </Section>
  );
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
            <span className="type-badge">{p.type === 'boolean' ? '◐' : 'T'}</span>
            <EditableText className="grow" value={p.name} onCommit={(v) => st.updateComponentProp(owner.id, p.id, { name: v })} />
            {p.type === 'boolean' ? (
              <input type="checkbox" title="Default value" checked={p.default === true} onChange={(e) => st.updateComponentProp(owner.id, p.id, { default: e.target.checked })} />
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

function InstanceSection({ inst }: { inst: SceneNode }) {
  const st = useEditor();
  const nodes = st.doc.nodes;
  const comp = inst.componentId ? nodes[inst.componentId] : undefined;
  const set = setOf(nodes, inst.componentId);
  const defs = set ? variantDefs(nodes, set.id) : [];
  const props: ComponentProp[] = componentPropsFor(nodes, inst.componentId);
  // plain text layers (not driven by a text property) can still be overridden directly
  const propLayers = new Set(props.map((p) => (comp ? findByPath(nodes, comp.id, p.layer) : null)));
  const texts: SceneNode[] = [];
  const walk = (ids: string[]) =>
    ids.forEach((id) => {
      const c = nodes[id];
      if (!c) return;
      if (c.type === 'text' && !propLayers.has(c.id)) texts.push(c);
      walk(c.children);
    });
  if (comp) walk(comp.children);
  return (
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
        return p.type === 'boolean' ? (
          <label key={p.id} className="row">
            <span className="grow muted">{p.name}</span>
            <input type="checkbox" checked={val === true || val === 'true'} onChange={(e) => st.setInstanceProp([inst.id], p.id, e.target.checked)} />
          </label>
        ) : (
          <label key={p.id} className="row">
            <span className="grow muted">{p.name}</span>
            <EditableText className="small-w" value={String(val)} onCommit={(v) => st.setInstanceProp([inst.id], p.id, v)} />
          </label>
        );
      })}
      {texts.length > 0 && (
        <div className="overrides">
          <div className="muted">Text overrides</div>
          {texts.map((t) => {
            const v = inst.overrides?.[t.id]?.text?.content ?? t.text!.content;
            return (
              <EditableText
                key={t.id + v}
                className="text-input"
                value={v}
                onCommit={(val) => st.updateNodes([inst.id], (x) => ({ overrides: { ...(x.overrides ?? {}), [t.id]: { ...(x.overrides?.[t.id] ?? {}), text: { ...t.text!, content: val } } } }))}
              />
            );
          })}
        </div>
      )}
      <div className="row gap">
        <button className="btn small" onClick={() => comp && goTo(comp.id)}>Go to main</button>
        <button className="btn small" onClick={st.detachInstance}>Detach</button>
        <button className="btn small" onClick={() => st.updateNodes([inst.id], { overrides: {}, propValues: {} })}>Reset</button>
      </div>
    </Section>
  );
}
