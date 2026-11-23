import { useEffect, useState } from 'react';
import { useEditor } from '../store/store';
import { Icon } from './icons';
import type { BindableProp, Variable, VariableScope, VariableValue } from '../types';
import { pickFile } from '../lib/platform';
import { BIND_TYPES, aliasCreatesCycle, defaultValue, exportTokens, findVariable, inScope, isAlias, resolveInMode, resolveMode, SCOPES_BY_TYPE, splitName, variableValue } from '../lib/variables';

/** Variables editor: collection switcher, group tree, mode columns, aliases, scopes and code syntax. */
export function VariablesModal() {
  const [open, setOpen] = useState(false);
  const st = useEditor();
  const [colId, setColId] = useState<string | null>(null);
  const [group, setGroup] = useState<string | null>(null); // null = all
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<null | 'create' | 'collection' | { mode: string }>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  useEffect(() => {
    const t = () => setOpen((o) => !o);
    window.addEventListener('figmy:variables', t);
    return () => window.removeEventListener('figmy:variables', t);
  }, []);
  if (!open) return null;
  const cols = st.doc.variables;
  const col = cols.find((c) => c.id === colId) ?? cols[0];
  const stop = (e: React.KeyboardEvent) => e.stopPropagation();

  // group tree
  const groups = new Map<string, number>();
  for (const v of col?.variables ?? []) {
    const parts = v.name.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      const g = parts.slice(0, i).join('/');
      groups.set(g, (groups.get(g) ?? 0) + 1);
    }
  }
  const groupList = [...groups.keys()].sort();
  const q = query.trim().toLowerCase();
  const visible = (col?.variables ?? []).filter((v) => (group == null || v.name.startsWith(group + '/')) && (!q || v.name.toLowerCase().includes(q) || v.description?.toLowerCase().includes(q)));
  const rows: ({ kind: 'group'; name: string } | { kind: 'var'; v: Variable })[] = [];
  let last: string | null = null;
  for (const v of visible) {
    const g = splitName(v.name).group;
    if (g !== last) {
      if (g && g !== group) rows.push({ kind: 'group', name: g });
      last = g;
    }
    rows.push({ kind: 'var', v });
  }
  const editVar = col?.variables.find((v) => v.id === editing) ?? null;

  const create = (type: Variable['type']) => {
    if (!col) return;
    const id = st.addVariable(col.id, type);
    const base = col.variables.length; // name after creation
    const leaf = `${type}-${base + 1}`;
    st.updateVariable(col.id, id, { name: group ? `${group}/${leaf}` : leaf });
    setSel([id]);
    setMenu(null);
  };
  const onRowClick = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey && sel.length) {
      const ids = visible.map((v) => v.id);
      const a = ids.indexOf(sel[sel.length - 1]), b = ids.indexOf(id);
      setSel(ids.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else if (e.metaKey || e.ctrlKey) setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
    else setSel([id]);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return e.stopPropagation();
    e.stopPropagation();
    if (!col) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) { st.deleteVariables(col.id, sel); setSel([]); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && sel.length) { e.preventDefault(); st.duplicateVariables(col.id, sel); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setSel(visible.map((v) => v.id)); }
    if (e.key === 'Escape') { if (editing) setEditing(null); else if (sel.length) setSel([]); else setOpen(false); }
  };
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(exportTokens(st.doc), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${st.doc.name || 'figmy'}-tokens.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importJson = async () => {
    const f = await pickFile('.json');
    if (!f) return;
    try {
      const n = st.importVariableTokens(JSON.parse(await f.text()));
      st.notify(`Imported ${n} new variable${n === 1 ? '' : 's'}`);
    } catch (e) {
      st.notify('Could not read tokens: ' + (e as Error).message);
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={() => setOpen(false)}>
      <div className="modal vx" tabIndex={-1} onKeyDown={onKey} onPointerDown={(e) => { e.stopPropagation(); setMenu(null); }}>
        <header className="vx-head">
          <h2 className="vx-title">{col ? col.name : 'Variables'}{col && group ? <span className="muted"> / {group.split('/').join(' / ')}</span> : null}</h2>
          <div className="grow" />
          <div className="vx-search">
            <Icon name="search" size={12} />
            <input placeholder="Search variables" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={stop} />
          </div>
          <button className="btn small ghost" title="Import design tokens (W3C DTCG JSON)" onClick={importJson}>Import tokens</button>
          <button className="btn small ghost" title="Export design tokens (W3C DTCG JSON)" onClick={exportJson} disabled={!cols.length}>Export tokens</button>
          <button className="icon-btn" title="Close (Esc)" onClick={() => setOpen(false)}><Icon name="close" /></button>
        </header>

        <div className="vx-body">
          <aside className="vx-groups">
            <div className="vx-side-head">
              <span>Collections</span>
              <button className="icon-btn ghost tiny" title="Create collection" onClick={() => { const id = st.addCollection(); setColId(id); setGroup(null); }}><Icon name="plus" size={12} /></button>
            </div>
            {cols.map((c) => (
              <div key={c.id} className={`vx-group vx-colitem ${c.id === col?.id ? 'on' : ''}`} onClick={() => { setColId(c.id); setGroup(null); setSel([]); }} onDoubleClick={() => { const n = prompt('Rename collection', c.name); if (n) st.renameCollection(c.id, n); }} title="Double-click to rename">
                <span>{c.name}</span>
                <small>{c.variables.length}</small>
                <button className="icon-btn ghost tiny vx-coldel" title="Delete collection" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete collection “${c.name}”? Bound layers keep their current values.`)) { st.deleteCollection(c.id); setColId(null); } }}><Icon name="trash" size={11} /></button>
              </div>
            ))}
            {!cols.length && <div className="muted vx-side-empty">No collections yet</div>}
            <div className="vx-side-sep" />
            <div className="vx-side-head"><span>Groups</span></div>
            <button className={`vx-group ${group == null ? 'on' : ''}`} onClick={() => setGroup(null)}>
              <span>All</span><small>{col?.variables.length ?? 0}</small>
            </button>
            {groupList.map((g) => {
              const depth = g.split('/').length - 1;
              return (
                <button
                  key={g}
                  className={`vx-group ${group === g ? 'on' : ''}`}
                  style={{ paddingLeft: 10 + depth * 14 }}
                  onClick={() => setGroup(g)}
                  onDoubleClick={() => { const n = prompt('Rename group', g); if (n != null && col) { st.renameVariableGroup(col.id, g, n); setGroup(n || null); } }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { if (dragId && col) { const v = col.variables.find((x) => x.id === dragId); if (v) st.updateVariable(col.id, v.id, { name: `${g}/${splitName(v.name).leaf}` }); } setDragId(null); }}
                  title="Double-click to rename · drop variables here to move them"
                >
                  <span>{splitName(g).leaf}</span><small>{groups.get(g)}</small>
                </button>
              );
            })}
            {col && sel.length > 0 && (
              <button className="vx-group add" onClick={() => { const n = prompt('New group name for the selected variables', group ?? ''); if (n != null) for (const id of sel) { const v = col.variables.find((x) => x.id === id); if (v) st.updateVariable(col.id, id, { name: (n ? n.replace(/\/+$/, '') + '/' : '') + splitName(v.name).leaf }); } }}>
                + Group selection
              </button>
            )}
          </aside>

          <main className="vx-main">
            {!col ? (
              <div className="vx-empty">
                <h3>Create your first collection</h3>
                <p className="muted">Variables store reusable values: colours, spacing, radii, copy and flags. Group them with “/” in the name, add modes for themes such as Light and Dark, and point variables at other variables to build semantic tokens.</p>
                <button className="btn primary" onClick={() => setColId(st.addCollection())}>Create collection</button>
              </div>
            ) : (
              <div className="vx-scroll">
                <table className="vx-table">
                  <thead>
                    <tr>
                      <th className="vx-namecol">Name</th>
                      {col.modes.map((m) => {
                        const isDefault = (st.doc.activeModes?.[col.id] ?? col.modes[0].id) === m.id;
                        return (
                          <th key={m.id}>
                            <div className="vx-mode">
                              <input value={m.name} onChange={(e) => st.renameMode(col.id, m.id, e.target.value)} onKeyDown={stop} title="Rename mode" />
                              {isDefault && <span className="vx-default" title="Active mode on the canvas">Active</span>}
                              <button className="icon-btn ghost tiny" onPointerDown={(e) => { e.stopPropagation(); setMenu(typeof menu === 'object' && menu?.mode === m.id ? null : { mode: m.id }); }}>⋯</button>
                              {typeof menu === 'object' && menu?.mode === m.id && (
                                <div className="vx-menu right" onPointerDown={(e) => e.stopPropagation()}>
                                  <button disabled={isDefault} onClick={() => { st.setActiveMode(col.id, m.id); setMenu(null); }}>Show this mode on canvas</button>
                                  <button onClick={() => { st.addMode(col.id, `${m.name} copy`); setMenu(null); }}>Duplicate mode</button>
                                  <button className="danger" disabled={col.modes.length < 2} onClick={() => { st.deleteMode(col.id, m.id); setMenu(null); }}>Delete mode</button>
                                </div>
                              )}
                            </div>
                          </th>
                        );
                      })}
                      <th className="vx-addcol">
                        <button className="icon-btn ghost" title="Add mode" onClick={() => st.addMode(col.id)}><Icon name="plus" /></button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) =>
                      r.kind === 'group' ? (
                        <tr key={'g:' + r.name} className="vx-grouprow">
                          <td colSpan={col.modes.length + 2}>{r.name.split('/').join(' / ')}</td>
                        </tr>
                      ) : (
                        <tr
                          key={r.v.id}
                          className={`vx-row ${sel.includes(r.v.id) ? 'sel' : ''} ${dragId === r.v.id ? 'dragging' : ''}`}
                          onClick={(e) => onRowClick(e, r.v.id)}
                          draggable
                          onDragStart={() => setDragId(r.v.id)}
                          onDragEnd={() => setDragId(null)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => { if (dragId && dragId !== r.v.id) st.moveVariable(col.id, dragId, r.v.id); setDragId(null); }}
                        >
                          <td className="vx-namecol">
                            <div className="vx-name">
                              <span className="vx-grip" title="Drag to reorder">⋮⋮</span>
                              <TypeBadge type={r.v.type} />
                              <NameInput value={group && r.v.name.startsWith(group + '/') ? r.v.name.slice(group.length + 1) : r.v.name} onCommit={(n) => st.updateVariable(col.id, r.v.id, { name: group && !n.startsWith(group + '/') ? `${group}/${n}` : n })} display={splitName(r.v.name).leaf} />
                              {r.v.hidden && <span className="vx-tag" title="Hidden from pickers">hidden</span>}
                              <button className="icon-btn ghost vx-edit" title="Edit variable" onClick={(e) => { e.stopPropagation(); setEditing(r.v.id); }}>
                                <Icon name="settings" size={12} />
                              </button>
                            </div>
                          </td>
                          {col.modes.map((m) => (
                            <td key={m.id} onClick={(e) => e.stopPropagation()}>
                              <ValueCell v={r.v} modeId={m.id} onChange={(val) => st.setVariableValue(col.id, r.v.id, m.id, val)} />
                            </td>
                          ))}
                          <td />
                        </tr>
                      ),
                    )}
                    {rows.length === 0 && (
                      <tr><td colSpan={col.modes.length + 2} className="muted vx-none">{q ? 'No variables match your search.' : 'No variables yet.'}</td></tr>
                    )}
                  </tbody>
                </table>
                <div className="vx-create">
                  <button className="vx-createbtn" onPointerDown={(e) => { e.stopPropagation(); setMenu(menu === 'create' ? null : 'create'); }}>
                    <Icon name="plus" size={12} /> Create variable
                  </button>
                  {menu === 'create' && (
                    <div className="vx-menu" onPointerDown={(e) => e.stopPropagation()}>
                      {(['color', 'number', 'string', 'boolean'] as const).map((t) => (
                        <button key={t} onClick={() => create(t)}><TypeBadge type={t} /> {t[0].toUpperCase() + t.slice(1)}</button>
                      ))}
                    </div>
                  )}
                  {sel.length > 1 && <span className="muted">{sel.length} selected · Del to delete · Ctrl+D to duplicate</span>}
                </div>
              </div>
            )}
          </main>

          {col && editVar && <VariableInspector colId={col.id} v={editVar} onClose={() => setEditing(null)} />}
        </div>
      </div>
    </div>
  );
}

function NameInput({ value, display, onCommit }: { value: string; display: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  if (text == null)
    return (
      <span className="vx-leaf" title={value} onDoubleClick={() => setText(value)}>{display}</span>
    );
  return (
    <input
      autoFocus
      className="vx-nameinput"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { if (text.trim() && text !== value) onCommit(text.trim().replace(/\s*\/\s*/g, '/')); setText(null); }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setText(null); }}
    />
  );
}

function VariableInspector({ colId, v, onClose }: { colId: string; v: Variable; onClose: () => void }) {
  const st = useEditor();
  const stop = (e: React.KeyboardEvent) => e.stopPropagation();
  const all = !v.scopes || !v.scopes.length || v.scopes.includes('all');
  const options = SCOPES_BY_TYPE[v.type];
  const setScope = (id: VariableScope, on: boolean) => {
    const cur = all ? options.map((o) => o.id) : v.scopes!.filter((s) => s !== 'all');
    const next = on ? [...new Set([...cur, id])] : cur.filter((s) => s !== id);
    st.updateVariable(colId, v.id, { scopes: next.length === options.length ? undefined : next });
  };
  return (
    <aside className="vx-inspector" onClick={(e) => e.stopPropagation()}>
      <header>
        <TypeBadge type={v.type} />
        <b className="grow">Edit variable</b>
        <button className="icon-btn ghost" onClick={onClose}><Icon name="close" size={12} /></button>
      </header>
      <label className="field">
        <span>Name</span>
        <input className="text-input" value={v.name} onChange={(e) => st.updateVariable(colId, v.id, { name: e.target.value })} onKeyDown={stop} />
        <small className="muted">Use “/” to group, e.g. color/brand/primary</small>
      </label>
      <label className="field">
        <span>Description</span>
        <textarea className="text-input" rows={2} value={v.description ?? ''} onChange={(e) => st.updateVariable(colId, v.id, { description: e.target.value || undefined })} onKeyDown={stop} />
      </label>
      <div className="field">
        <span>Scoping</span>
        <label className="check-row"><input type="checkbox" checked={all} onChange={(e) => st.updateVariable(colId, v.id, { scopes: e.target.checked ? undefined : [] })} /> Show in all supported properties</label>
        {options.map((o) => (
          <label key={o.id} className="check-row indent"><input type="checkbox" checked={all || v.scopes!.includes(o.id)} onChange={(e) => setScope(o.id, e.target.checked)} /> {o.label}</label>
        ))}
      </div>
      <div className="field">
        <span>Code syntax</span>
        {(['web', 'android', 'ios'] as const).map((p) => (
          <label key={p} className="vx-syntax">
            <small>{p === 'ios' ? 'iOS' : p[0].toUpperCase() + p.slice(1)}</small>
            <input
              className="text-input"
              placeholder={p === 'web' ? `var(--${v.name.replace(/\//g, '-')})` : p === 'android' ? `R.${v.type}.${v.name.replace(/\//g, '_')}` : `Theme.${v.name.replace(/\/(\w)/g, (_, c: string) => c.toUpperCase())}`}
              value={v.codeSyntax?.[p] ?? ''}
              onChange={(e) => st.updateVariable(colId, v.id, { codeSyntax: { ...v.codeSyntax, [p]: e.target.value || undefined } })}
              onKeyDown={stop}
            />
          </label>
        ))}
      </div>
      <label className="check-row"><input type="checkbox" checked={!!v.hidden} onChange={(e) => st.updateVariable(colId, v.id, { hidden: e.target.checked || undefined })} /> Hide from pickers</label>
      <div className="row gap" style={{ marginTop: 12 }}>
        <button className="btn small" onClick={() => st.duplicateVariables(colId, [v.id])}>Duplicate</button>
        <button className="btn small danger" onClick={() => { st.deleteVariable(colId, v.id); onClose(); }}>Delete</button>
      </div>
    </aside>
  );
}

function TypeBadge({ type }: { type: Variable['type'] }) {
  const sym = { color: '◐', number: '#', string: 'T', boolean: '⊘' }[type];
  return <span className={`type-badge t-${type}`}>{sym}</span>;
}

/** A value cell: raw editor, or an alias pill. The ⬡ button links to another variable of the same type. */
function ValueCell({ v, modeId, onChange }: { v: Variable; modeId: string; onChange: (val: VariableValue) => void }) {
  const st = useEditor();
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const raw = v.values[modeId];
  const resolved = resolveInMode(st.doc, v, modeId);
  const target = isAlias(raw) ? findVariable(st.doc, raw.alias) : null;
  const candidates = picking
    ? st.doc.variables.flatMap((c) => c.variables.filter((x) => x.type === v.type && x.id !== v.id && !aliasCreatesCycle(st.doc, v.id, x.id) && (!q || x.name.toLowerCase().includes(q.toLowerCase()))).map((x) => ({ c, x })))
    : [];
  return (
    <div className="vx-cell">
      {isAlias(raw) ? (
        <span className="vx-alias" title={target ? `${target.col.name} / ${target.v.name} → ${String(resolved)}` : 'Missing variable'}>
          {v.type === 'color' && <span className="swatch tiny" style={{ background: String(resolved ?? 'transparent') }} />}
          <span>{target ? target.v.name.split('/').slice(-2).join('/') : 'missing'}</span>
          <button title="Detach alias (keep value)" onClick={() => onChange(resolved ?? defaultValue(v.type))}>✕</button>
        </span>
      ) : (
        <ValueEditor v={v} value={raw as string | number | boolean | undefined} onChange={onChange} />
      )}
      <button className="icon-btn ghost vx-link" title="Link to another variable" onClick={() => setPicking(!picking)}>
        <Icon name="variable" size={12} />
      </button>
      {picking && (
        <div className="vx-menu vx-aliaspick" onMouseLeave={() => setPicking(false)} onPointerDown={(e) => e.stopPropagation()}>
          <input autoFocus className="text-input" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') setPicking(false); }} />
          <div className="vx-aliaslist">
            {candidates.length === 0 && <div className="muted pad-s">No other {v.type} variables</div>}
            {candidates.map(({ c, x }) => {
              const val = resolveInMode(st.doc, x, resolveMode(st.doc, null, c));
              return (
                <button key={x.id} onClick={() => { onChange({ alias: x.id }); setPicking(false); }}>
                  {v.type === 'color' && <span className="swatch tiny" style={{ background: String(val) }} />}
                  <span className="grow">{x.name}</span>
                  <small className="muted">{c.name}</small>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ValueEditor({ v, value, onChange }: { v: Variable; value: string | number | boolean | undefined; onChange: (val: string | number | boolean) => void }) {
  const [text, setText] = useState(String(value ?? ''));
  useEffect(() => setText(String(value ?? '')), [value]);
  if (v.type === 'color') {
    const base = String(value ?? '#000000');
    const hex6 = base.slice(0, 7);
    const alpha = base.length === 9 ? parseInt(base.slice(7, 9), 16) / 255 : 1;
    const withAlpha = (h: string, a: number) => (a >= 0.999 ? h.toLowerCase() : h.toLowerCase() + Math.round(a * 255).toString(16).padStart(2, '0'));
    return (
      <div className="var-color">
        <span className="vx-swatch"><i style={{ background: hex6, opacity: alpha }} /><input type="color" value={hex6} onChange={(e) => onChange(withAlpha(e.target.value, alpha))} /></span>
        <input value={text.slice(0, 7).replace('#', '').toUpperCase()} onChange={(e) => setText('#' + e.target.value.replace('#', ''))} onBlur={() => /^#[0-9a-f]{6}$/i.test(text.slice(0, 7)) ? onChange(withAlpha(text.slice(0, 7), alpha)) : setText(base)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        <AlphaInput alpha={alpha} onChange={(a) => onChange(withAlpha(hex6, a))} />
      </div>
    );
  }
  if (v.type === 'boolean')
    return (
      <label className="vx-bool"><input type="checkbox" checked={value === true || value === 'true'} onChange={(e) => onChange(e.target.checked)} /> {value === true || value === 'true' ? 'True' : 'False'}</label>
    );
  return (
    <input
      className="var-input"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (v.type === 'number') {
          const n = Number(text);
          if (Number.isFinite(n)) onChange(n);
          else setText(String(value));
        } else onChange(text);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function AlphaInput({ alpha, onChange }: { alpha: number; onChange: (a: number) => void }) {
  const fmt = (a: number) => `${Math.round(a * 1000) / 10}%`;
  const [t, setT] = useState(fmt(alpha));
  useEffect(() => setT(fmt(alpha)), [alpha]);
  return (
    <label className={`vx-alpha ${alpha < 0.999 ? 'set' : ''}`} title="Opacity">
      <span className="vx-alpha-ico" />
      <input value={t} onChange={(e) => setT(e.target.value)} onFocus={(e) => e.target.select()} onBlur={() => { const n = parseFloat(t); if (Number.isFinite(n)) onChange(Math.max(0, Math.min(100, n)) / 100); else setT(fmt(alpha)); }} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </label>
  );
}

/** Small button next to a property to bind/unbind a variable. */
export function BindButton({ ids, prop }: { ids: string[]; prop: BindableProp }) {
  const st = useEditor();
  const [open, setOpen] = useState(false);
  const n = st.doc.nodes[ids[0]];
  if (!n) return null;
  const bound = n.bindings?.[prop];
  const found = bound ? findVariable(st.doc, bound) : null;
  const type = BIND_TYPES[prop];
  const options = st.doc.variables.flatMap((c) => c.variables.filter((v) => v.type === type && !v.hidden && inScope(v, prop)).map((v) => ({ c, v })));
  return (
    <span className="bind">
      {found ? (
        <span className="bind-chip" title={`Bound to ${found.col.name} / ${found.v.name}`}>
          <span onClick={() => setOpen(!open)}>{found.v.name}</span>
          <button title="Detach variable" onClick={() => st.bindVariable(ids, prop, null)}>✕</button>
        </span>
      ) : (
        <button className="icon-btn ghost bind-btn" title={`Bind ${prop} to a variable`} onClick={() => setOpen(!open)}>
          <Icon name="variable" size={12} />
        </button>
      )}
      {open && (
        <div className="bind-pop" onMouseLeave={() => setOpen(false)}>
          {options.length === 0 && (
            <div className="muted pad-s">
              No {type} variables.{' '}
              <a className="clickable" onClick={() => window.dispatchEvent(new Event('figmy:variables'))}>Create one</a>
            </div>
          )}
          {options.map(({ c, v }) => {
            const val = variableValue(st.doc, v.id, n.id);
            return (
              <button key={v.id} onClick={() => { st.bindVariable(ids, prop, v.id); setOpen(false); }}>
                {type === 'color' && <span className="swatch tiny" style={{ background: String(val) }} />}
                <span>{c.name} / {v.name}</span>
                {type !== 'color' && <small className="muted">{String(val)}</small>}
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}

/** Per-frame mode overrides. */
export function ModeOverrides({ ids }: { ids: string[] }) {
  const st = useEditor();
  const n = st.doc.nodes[ids[0]];
  if (!n || !st.doc.variables.some((c) => c.modes.length > 1)) return null;
  return (
    <div className="mode-overrides">
      {st.doc.variables
        .filter((c) => c.modes.length > 1)
        .map((c) => (
          <label key={c.id} className="row">
            <span className="grow muted">{c.name}</span>
            <select className="select" value={n.modeOverrides?.[c.id] ?? ''} onChange={(e) => st.setNodeMode(ids, c.id, e.target.value || null)} onKeyDown={(e) => e.stopPropagation()}>
              <option value="">Auto (inherit)</option>
              {c.modes.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </label>
        ))}
    </div>
  );
}
