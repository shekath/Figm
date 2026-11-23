import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../store/store';
import { actions } from '../actions';
import { Icon, type IconName } from './icons';
import { unionRects, visualBounds } from '../lib/geometry';

/** Ctrl+K / Ctrl+/ command search over every editor action. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const toggle = () => {
      setOpen((o) => !o);
      setQ('');
      setI(0);
    };
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === '/')) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('figmy:palette', toggle);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('figmy:palette', toggle);
      window.removeEventListener('keydown', key);
    };
  }, []);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0);
  }, [open]);

  const items = useMemo(() => {
    const all = Object.entries(actions).map(([id, a]) => ({ id, ...a }));
    const t = q.trim().toLowerCase();
    if (!t) return all.slice(0, 40);
    const words = t.split(/\s+/);
    return all
      .map((a) => ({ a, score: words.every((w) => a.label.toLowerCase().includes(w) || a.id.toLowerCase().includes(w)) ? (a.label.toLowerCase().startsWith(t) ? 2 : 1) : 0 }))
      .filter((x) => x.score)
      .sort((x, y) => y.score - x.score)
      .map((x) => x.a)
      .slice(0, 40);
  }, [q]);

  if (!open) return null;
  const run = (id: string) => {
    setOpen(false);
    actions[id].run();
  };
  return (
    <div className="modal-backdrop palette-backdrop" onPointerDown={() => setOpen(false)}>
      <div className="palette" onPointerDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Icon name="search" />
          <input
            ref={input}
            autoFocus
            value={q}
            placeholder="Search actions… (e.g. union, auto layout, export)"
            onChange={(e) => {
              setQ(e.target.value);
              setI(0);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') setOpen(false);
              if (e.key === 'ArrowDown') setI((x) => Math.min(items.length - 1, x + 1));
              if (e.key === 'ArrowUp') setI((x) => Math.max(0, x - 1));
              if (e.key === 'Enter' && items[i]) run(items[i].id);
            }}
          />
        </div>
        <div className="palette-list">
          {items.length === 0 && <div className="muted pad">No matching action</div>}
          {items.map((a, k) => (
            <button key={a.id} className={k === i ? 'active' : ''} onMouseEnter={() => setI(k)} onClick={() => run(a.id)}>
              <span>{a.label}</span>
              <kbd>{a.shortcut}</kbd>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const CTX: { id: string; icon: IconName; when: (n: number, types: string[]) => boolean }[] = [
  { id: 'alignLeft', icon: 'alignLeft', when: (n) => n >= 1 },
  { id: 'alignHCenter', icon: 'alignHCenter', when: (n) => n >= 1 },
  { id: 'alignTop', icon: 'alignTop', when: (n) => n >= 1 },
  { id: 'alignVCenter', icon: 'alignVCenter', when: (n) => n >= 1 },
  { id: 'autoLayout', icon: 'autoH', when: (n) => n >= 1 },
  { id: 'group', icon: 'group', when: (n) => n >= 2 },
  { id: 'union', icon: 'boolean', when: (n) => n >= 2 },
  { id: 'mask', icon: 'mask', when: (n) => n >= 2 },
  { id: 'component', icon: 'component', when: (n, t) => n >= 1 && !t.every((x) => x === 'component') },
  { id: 'combineVariants', icon: 'instance', when: (n, t) => n >= 2 && t.every((x) => x === 'component') },
  { id: 'detach', icon: 'instance', when: (n, t) => t.includes('instance') },
  { id: 'export', icon: 'download', when: (n) => n >= 1 },
];

/** Small floating action bar above the current selection. */
export function ContextBar() {
  const st = useEditor();
  const sel = st.selectedNodes();
  if (!sel.length || (st.mode !== 'design' && st.mode !== 'draw') || st.editingTextId || st.editingPathId || st.presenting) return null;
  const b = unionRects(sel.map(visualBounds));
  if (!b) return null;
  const types = sel.map((n) => n.type);
  const items = CTX.filter((c) => c.when(sel.length, types));
  const x = (b.x + b.w / 2) * st.zoom + st.panX;
  const y = b.y * st.zoom + st.panY - 56;
  return (
    <div className="context-bar" style={{ left: x, top: Math.max(8, y) }} onPointerDown={(e) => e.stopPropagation()}>
      {items.map((c) => (
        <button key={c.id} className="tool" title={`${actions[c.id].label}${actions[c.id].shortcut ? ` (${actions[c.id].shortcut})` : ''}`} onClick={() => actions[c.id].run()}>
          <Icon name={c.icon} size={15} />
        </button>
      ))}
    </div>
  );
}
