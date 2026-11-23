import React, { useMemo, useState } from 'react';
import { useEditor } from '../store/store';
import { Icon, typeIcon } from './icons';
import type { SceneNode } from '../types';
import { createElement } from 'react';
import { RenderNode } from '../canvas/render';
import { solid, uid } from '../lib/factory';

export function LeftPanel() {
  const st = useEditor();
  return (
    <aside className="panel left">
      <div className="tabs">
        <button className={st.leftTab === 'layers' ? 'active' : ''} onClick={() => st.set({ leftTab: 'layers' })}>
          Layers
        </button>
        <button className={st.leftTab === 'assets' ? 'active' : ''} onClick={() => st.set({ leftTab: 'assets' })}>
          Assets
        </button>
      </div>
      {st.leftTab === 'layers' ? (
        <>
          <Pages />
          <Layers />
        </>
      ) : (
        <Assets />
      )}
    </aside>
  );
}

function Pages() {
  const st = useEditor();
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="pages">
      <header>
        <span className="clickable" onClick={() => setOpen(!open)}>
          <Icon name={open ? 'chevronDown' : 'chevron'} size={10} /> Pages
        </span>
        <button className="icon-btn" title="Add page" onClick={st.addPage}>
          <Icon name="plus" />
        </button>
      </header>
      {open &&
        st.doc.pages.map((p) => (
          <div
            key={p.id}
            className={`page-row ${p.id === st.pageId ? 'active' : ''}`}
            onClick={() => st.setPage(p.id)}
            onDoubleClick={() => setEditing(p.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              const a = prompt('Page action: rename / duplicate / delete', 'rename');
              if (a === 'rename') setEditing(p.id);
              if (a === 'duplicate') st.duplicatePage(p.id);
              if (a === 'delete' && confirm(`Delete page “${p.name}”?`)) st.deletePage(p.id);
            }}
          >
            {editing === p.id ? (
              <input
                autoFocus
                onFocus={(e) => e.target.select()}
                defaultValue={p.name}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                onBlur={(e) => {
                  st.renamePage(p.id, e.target.value || p.name);
                  setEditing(null);
                }}
              />
            ) : (
              <span>{p.name}</span>
            )}
            {p.id === st.pageId && st.doc.pages.length > 1 && (
              <button className="icon-btn ghost" title="Delete page" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete page “${p.name}”?`)) st.deletePage(p.id); }}>
                <Icon name="trash" size={12} />
              </button>
            )}
          </div>
        ))}
    </div>
  );
}

function Layers() {
  const st = useEditor();
  const page = st.page();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ id: string; pos: 'before' | 'after' | 'inside' } | null>(null);
  const [filter, setFilter] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);

  const rows = useMemo(() => {
    const out: { n: SceneNode; depth: number }[] = [];
    const walk = (ids: string[], depth: number) => {
      for (const id of [...ids].reverse()) {
        const n = st.doc.nodes[id];
        if (!n) continue;
        if (!filter || n.name.toLowerCase().includes(filter.toLowerCase())) out.push({ n, depth });
        if ((!collapsed[id] || filter) && n.children.length) walk(n.children, depth + 1);
      }
    };
    walk(page.children, 0);
    return out;
  }, [st.doc.nodes, page.children, collapsed, filter]);

  const drop = (target: SceneNode, pos: 'before' | 'after' | 'inside') => {
    if (!dragId || dragId === target.id) return;
    const ids = st.selection.includes(dragId) ? st.selection : [dragId];
    if (pos === 'inside') st.reparent(ids, target.id);
    else {
      const parent = target.parentId;
      const sibs = (parent ? st.doc.nodes[parent].children : page.children).filter((c) => !ids.includes(c));
      const idx = sibs.indexOf(target.id);
      // list is displayed reversed: "before" in UI = above = higher index
      st.reparent(ids, parent, pos === 'before' ? idx + 1 : idx);
    }
  };

  return (
    <div className="layers">
      <div className="layer-search">
        <Icon name="search" size={12} />
        <input placeholder="Find layer…" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </div>
      <div className="layer-list">
        {rows.length === 0 && <div className="empty">No layers yet. Pick a tool and draw on the canvas.</div>}
        {rows.map(({ n, depth }) => {
          const selected = st.selection.includes(n.id);
          const hint = dropHint?.id === n.id ? dropHint.pos : null;
          const isComp = n.type === 'component' || n.type === 'instance';
          return (
            <div
              key={n.id}
              className={`layer-row ${selected ? 'selected' : ''} ${st.hoverId === n.id ? 'hover' : ''} ${!n.visible ? 'hidden' : ''} ${hint ? 'drop-' + hint : ''} ${isComp ? 'comp' : ''}`}
              style={{ paddingLeft: 8 + depth * 14 }}
              draggable={renaming !== n.id}
              onDragStart={(e) => {
                setDragId(n.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                e.preventDefault();
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const y = (e.clientY - r.top) / r.height;
                const container = ['frame', 'group', 'component'].includes(n.type);
                setDropHint({ id: n.id, pos: container && y > 0.3 && y < 0.7 ? 'inside' : y < 0.5 ? 'before' : 'after' });
              }}
              onDragLeave={() => setDropHint(null)}
              onDrop={(e) => {
                e.preventDefault();
                if (dropHint) drop(n, dropHint.pos);
                setDropHint(null);
                setDragId(null);
              }}
              onMouseEnter={() => st.set({ hoverId: n.id })}
              onMouseLeave={() => st.set({ hoverId: null })}
              onClick={(e) => {
                if (e.shiftKey && st.selection.length) {
                  // range select within visible rows
                  const ids = rows.map((r) => r.n.id);
                  const a = ids.indexOf(st.selection[st.selection.length - 1]);
                  const b = ids.indexOf(n.id);
                  st.set({ selection: [...new Set([...st.selection, ...ids.slice(Math.min(a, b), Math.max(a, b) + 1)])] });
                } else st.select([n.id], e.ctrlKey || e.metaKey);
              }}
              onDoubleClick={() => setRenaming(n.id)}
            >
              {n.children.length ? (
                <button className="twisty" onClick={(e) => { e.stopPropagation(); setCollapsed({ ...collapsed, [n.id]: !collapsed[n.id] }); }}>
                  <Icon name={collapsed[n.id] ? 'chevron' : 'chevronDown'} size={10} />
                </button>
              ) : (
                <span className="twisty" />
              )}
              <span className="layer-icon">
                <Icon name={n.isMask ? 'mask' : n.autoLayout ? (n.autoLayout.direction === 'horizontal' ? 'autoH' : 'autoV') : n.isComponentSet ? 'component' : typeIcon(n.type)} size={13} />
              </span>
              {renaming === n.id ? (
                <input
                  autoFocus
                  onFocus={(e) => e.target.select()}
                  defaultValue={n.name}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  onBlur={(e) => {
                    if (e.target.value && e.target.value !== n.name) st.rename(n.id, e.target.value);
                    setRenaming(null);
                  }}
                />
              ) : (
                <span className="layer-name">{n.name}</span>
              )}
              <span className="layer-actions">
                <button className={`icon-btn ghost ${n.locked ? 'on' : ''}`} title={n.locked ? 'Unlock' : 'Lock'} onClick={(e) => { e.stopPropagation(); st.toggleLocked([n.id]); }}>
                  <Icon name={n.locked ? 'lock' : 'unlock'} size={12} />
                </button>
                <button className={`icon-btn ghost ${!n.visible ? 'on' : ''}`} title={n.visible ? 'Hide' : 'Show'} onClick={(e) => { e.stopPropagation(); st.toggleVisible([n.id]); }}>
                  <Icon name={n.visible ? 'eye' : 'eyeOff'} size={12} />
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Thumb({ id }: { id: string }) {
  const nodes = useEditor((s) => s.doc.nodes);
  const n = nodes[id];
  if (!n) return null;
  const pad = 4;
  return (
    <svg viewBox={`${n.x - pad} ${n.y - pad} ${n.w + pad * 2} ${n.h + pad * 2}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      {createElement(RenderNode, { id, ctx: { nodes } })}
    </svg>
  );
}

function Assets() {
  const st = useEditor();
  const [q, setQ] = useState('');
  // standalone components + component sets (a set is shown once, placing its first variant)
  const components = Object.values(st.doc.nodes)
    .filter((n) => (n.type === 'component' && !st.doc.nodes[n.parentId ?? '']?.isComponentSet) || n.isComponentSet)
    .filter((n) => n.name.toLowerCase().includes(q.toLowerCase()))
    .map((n) => ({ ...n, placeId: n.isComponentSet ? n.children[0] : n.id }))
    .filter((n) => !!n.placeId && !!st.doc.nodes[n.placeId]);
  const sel = st.selectedNodes();
  return (
    <div className="assets">
      <div className="layer-search">
        <Icon name="search" size={12} />
        <input placeholder="Search assets…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </div>

      <div className="asset-section">
        <header>
          <span>Components</span>
        </header>
        {components.length === 0 && <div className="empty">Select layers and press Ctrl+Alt+K to create a component. Drag components onto the canvas to make instances.</div>}
        <div className="comp-grid">
          {components.map((c) => (
            <div
              key={c.id}
              className="comp-tile"
              draggable
              title={`${c.name} — drag to canvas`}
              onDragStart={(e) => e.dataTransfer.setData('application/x-figmy-component', c.placeId)}
              onDoubleClick={() => {
                const s = useEditor.getState();
                const vp = { x: (innerWidth / 2 - s.panX) / s.zoom, y: (innerHeight / 2 - s.panY) / s.zoom };
                s.createInstance(c.placeId, Math.round(vp.x), Math.round(vp.y));
              }}
            >
              <div className="comp-thumb">
                <Thumb id={c.id} />
              </div>
              <span>{c.name}{c.isComponentSet ? ` · ${c.children.length} variants` : ''}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="asset-section">
        <header>
          <span>Colour styles</span>
          <button
            className="icon-btn"
            title="Create colour style from selection"
            onClick={() => {
              const f = sel[0]?.fills[0] ?? solid('#5b5bf7');
              const name = prompt('Style name', 'Brand/Primary');
              if (name) st.mutate((d) => d.colorStyles.push({ id: uid(), name, paint: structuredClone(f) }));
            }}
          >
            <Icon name="plus" />
          </button>
        </header>
        {st.doc.colorStyles.map((cs) => (
          <div key={cs.id} className="style-row" onClick={() => sel.length && st.updateNodes(st.selection, (n) => ({ fills: [{ ...structuredClone(cs.paint), id: uid() }], styleRefs: { ...n.styleRefs, fill: cs.id } }))} title="Apply to selection">
            <span className="swatch" style={{ background: cs.paint.kind === 'solid' ? cs.paint.color : `linear-gradient(90deg, ${(cs.paint.stops ?? []).map((s) => s.color).join(',')})` }} />
            <span className="grow">{cs.name}</span>
            <button className="icon-btn ghost" title="Delete style" onClick={(e) => { e.stopPropagation(); st.mutate((d) => (d.colorStyles = d.colorStyles.filter((x) => x.id !== cs.id))); }}>
              <Icon name="trash" size={12} />
            </button>
          </div>
        ))}
      </div>

      <div className="asset-section">
        <header>
          <span>Text styles</span>
          <button
            className="icon-btn"
            title="Create text style from selected text"
            onClick={() => {
              const t = sel.find((n) => n.text);
              if (!t) return st.notify('Select a text layer first');
              const name = prompt('Style name', `Heading/${t.text!.fontSize}`);
              if (name) {
                const { content, ...style } = t.text!;
                void content;
                st.mutate((d) => d.textStyles.push({ id: uid(), name, style }));
              }
            }}
          >
            <Icon name="plus" />
          </button>
        </header>
        {st.doc.textStyles.map((ts) => (
          <div key={ts.id} className="style-row" onClick={() => st.updateNodes(st.selection.filter((id) => st.doc.nodes[id]?.text), (n) => ({ text: { ...n.text!, ...ts.style }, styleRefs: { ...n.styleRefs, text: ts.id } }))} title="Apply to selected text">
            <span className="ag">Ag</span>
            <span className="grow">{ts.name}</span>
            <small>{ts.style.fontSize}/{ts.style.fontWeight}</small>
            <button className="icon-btn ghost" title="Delete style" onClick={(e) => { e.stopPropagation(); st.mutate((d) => (d.textStyles = d.textStyles.filter((x) => x.id !== ts.id))); }}>
              <Icon name="trash" size={12} />
            </button>
          </div>
        ))}
      </div>

      <div className="asset-section">
        <header>
          <span>Effect styles</span>
          <button
            className="icon-btn"
            title="Create effect style from selection"
            onClick={() => {
              const n = sel.find((x) => x.effects.length);
              if (!n) return st.notify('Select a layer with effects first');
              const name = prompt('Style name', 'Shadow/Medium');
              if (name) st.mutate((d) => d.effectStyles.push({ id: uid(), name, effects: structuredClone(n.effects) }));
            }}
          >
            <Icon name="plus" />
          </button>
        </header>
        {st.doc.effectStyles.map((es) => (
          <div key={es.id} className="style-row" onClick={() => st.updateNodes(st.selection, () => ({ effects: structuredClone(es.effects).map((e) => ({ ...e, id: uid() })) }))}>
            <span className="fx-dot" />
            <span className="grow">{es.name}</span>
            <button className="icon-btn ghost" title="Delete style" onClick={(e) => { e.stopPropagation(); st.mutate((d) => (d.effectStyles = d.effectStyles.filter((x) => x.id !== es.id))); }}>
              <Icon name="trash" size={12} />
            </button>
          </div>
        ))}
      </div>

      <Variables />
      <History />
    </div>
  );
}

function Variables() {
  const st = useEditor();
  const cols = st.doc.variables;
  return (
    <div className="asset-section">
      <header>
        <span>Variables</span>
        <button className="icon-btn" title="Open variables editor" onClick={() => window.dispatchEvent(new Event('figmy:variables'))}>
          <Icon name="variable" />
        </button>
      </header>
      {cols.length === 0 && (
        <div className="empty">
          Design tokens with modes (e.g. Light / Dark).{' '}
          <a className="clickable" onClick={() => window.dispatchEvent(new Event('figmy:variables'))}>Open the editor</a>
        </div>
      )}
      {cols.map((c) => (
        <div key={c.id} className="style-row" onClick={() => window.dispatchEvent(new Event('figmy:variables'))}>
          <Icon name="variable" size={12} />
          <span className="grow">{c.name} <small className="muted">· {c.variables.length}</small></span>
          {c.modes.length > 1 && (
            <select className="select" value={st.doc.activeModes?.[c.id] ?? c.modes[0].id} onClick={(e) => e.stopPropagation()} onChange={(e) => st.setActiveMode(c.id, e.target.value)} onKeyDown={(e) => e.stopPropagation()}>
              {c.modes.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          )}
        </div>
      ))}
    </div>
  );
}

function History() {
  const st = useEditor();
  return (
    <div className="asset-section">
      <header>
        <span>Version history</span>
        <button className="icon-btn" title="Save version" onClick={() => { const n = prompt('Version name', new Date().toLocaleString()); if (n !== null) st.saveVersion(n); }}>
          <Icon name="plus" />
        </button>
      </header>
      {st.doc.versions.length === 0 && <div className="empty">No saved versions yet.</div>}
      {st.doc.versions.map((v) => (
        <div key={v.id} className="style-row">
          <Icon name="history" size={12} />
          <span className="grow">
            {v.name}
            <br />
            <small>{new Date(v.createdAt).toLocaleString()}</small>
          </span>
          <button className="btn small" onClick={() => confirm(`Restore “${v.name}”? Current state can be undone.`) && st.restoreVersion(v.id)}>
            Restore
          </button>
        </div>
      ))}
    </div>
  );
}

export const _unused = React;
