import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store/store';
import { Icon } from './icons';
import type { BindableProp, Variable } from '../types';
import { BIND_TYPES, findVariable, variableValue } from '../lib/variables';

/** Full variables editor: collections, modes (columns) and typed variables (rows). */
export function VariablesModal() {
  const [open, setOpen] = useState(false);
  const st = useEditor();
  const [colId, setColId] = useState<string | null>(null);
  useEffect(() => {
    const t = () => setOpen((o) => !o);
    window.addEventListener('figmy:variables', t);
    return () => window.removeEventListener('figmy:variables', t);
  }, []);
  if (!open) return null;
  const cols = st.doc.variables;
  const col = cols.find((c) => c.id === colId) ?? cols[0];
  const stop = (e: React.KeyboardEvent) => e.stopPropagation();

  return (
    <div className="modal-backdrop" onPointerDown={() => setOpen(false)}>
      <div className="modal variables-modal" onPointerDown={(e) => e.stopPropagation()}>
        <header>
          <h2>Local variables</h2>
          <button className="btn small" onClick={() => setOpen(false)}>Close</button>
        </header>
        <div className="vars-layout">
          <aside className="vars-cols">
            <div className="muted small-caps">Collections</div>
            {cols.map((c) => (
              <div key={c.id} className={`vars-col ${c.id === col?.id ? 'active' : ''}`} onClick={() => setColId(c.id)}>
                <input value={c.name} onChange={(e) => st.renameCollection(c.id, e.target.value)} onKeyDown={stop} />
                <button className="icon-btn ghost" title="Delete collection" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete collection “${c.name}” and unbind its variables?`)) st.deleteCollection(c.id); }}>
                  <Icon name="trash" size={12} />
                </button>
              </div>
            ))}
            <button className="btn small" onClick={() => setColId(st.addCollection())}>+ Collection</button>
          </aside>
          <main className="vars-table-wrap">
            {!col ? (
              <div className="empty">Create a collection to start defining design tokens such as colours, spacing and typography sizes. Add modes for themes like Light / Dark or Mobile / Desktop.</div>
            ) : (
              <table className="vars-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    {col.modes.map((m) => (
                      <th key={m.id}>
                        <div className="mode-head">
                          <input value={m.name} onChange={(e) => st.renameMode(col.id, m.id, e.target.value)} onKeyDown={stop} />
                          <input type="radio" title="Active mode" checked={(st.doc.activeModes?.[col.id] ?? col.modes[0].id) === m.id} onChange={() => st.setActiveMode(col.id, m.id)} />
                          {col.modes.length > 1 && (
                            <button className="icon-btn ghost" title="Delete mode" onClick={() => st.deleteMode(col.id, m.id)}>
                              <Icon name="close" size={10} />
                            </button>
                          )}
                        </div>
                      </th>
                    ))}
                    <th>
                      <button className="icon-btn" title="Add mode" onClick={() => st.addMode(col.id)}>
                        <Icon name="plus" />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {col.variables.map((v) => (
                    <tr key={v.id}>
                      <td>
                        <div className="var-name">
                          <TypeBadge type={v.type} />
                          <input value={v.name} onChange={(e) => st.updateVariable(col.id, v.id, { name: e.target.value })} onKeyDown={stop} />
                        </div>
                      </td>
                      {col.modes.map((m) => (
                        <td key={m.id}>
                          <ValueEditor v={v} value={v.values[m.id]} onChange={(val) => st.setVariableValue(col.id, v.id, m.id, val)} />
                        </td>
                      ))}
                      <td>
                        <button className="icon-btn ghost" title="Delete variable" onClick={() => st.deleteVariable(col.id, v.id)}>
                          <Icon name="trash" size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {col && (
              <div className="row gap" style={{ marginTop: 10 }}>
                {(['color', 'number', 'string', 'boolean'] as const).map((t) => (
                  <button key={t} className="btn small" onClick={() => st.addVariable(col.id, t)}>
                    + {t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function TypeBadge({ type }: { type: Variable['type'] }) {
  const sym = { color: '◐', number: '#', string: 'T', boolean: '⊘' }[type];
  return <span className={`type-badge t-${type}`}>{sym}</span>;
}

function ValueEditor({ v, value, onChange }: { v: Variable; value: string | number | boolean | undefined; onChange: (val: string | number | boolean) => void }) {
  const [text, setText] = useState(String(value ?? ''));
  useEffect(() => setText(String(value ?? '')), [value]);
  const ref = useRef<HTMLInputElement>(null);
  if (v.type === 'color')
    return (
      <div className="var-color">
        <input type="color" value={String(value ?? '#000000').slice(0, 7)} onChange={(e) => onChange(e.target.value)} />
        <input value={text} onChange={(e) => setText(e.target.value)} onBlur={() => /^#[0-9a-f]{6}$/i.test(text) ? onChange(text.toLowerCase()) : setText(String(value))} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      </div>
    );
  if (v.type === 'boolean') return <input type="checkbox" checked={value === true || value === 'true'} onChange={(e) => onChange(e.target.checked)} />;
  return (
    <input
      ref={ref}
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

/** Small button next to a property to bind/unbind a variable. */
export function BindButton({ ids, prop }: { ids: string[]; prop: BindableProp }) {
  const st = useEditor();
  const [open, setOpen] = useState(false);
  const n = st.doc.nodes[ids[0]];
  if (!n) return null;
  const bound = n.bindings?.[prop];
  const found = bound ? findVariable(st.doc, bound) : null;
  const type = BIND_TYPES[prop];
  const options = st.doc.variables.flatMap((c) => c.variables.filter((v) => v.type === type).map((v) => ({ c, v })));
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
