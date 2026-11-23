import { useEffect, useState } from 'react';
import { useEditor } from './store/store';
import { actions } from './actions';

const CTX_ITEMS: (string | '-')[] = ['copy', 'cut', 'paste', 'duplicate', 'delete', '-', 'bringFront', 'bringForward', 'sendBackward', 'sendBack', '-', 'group', 'ungroup', 'frameSelection', 'autoLayout', '-', 'component', 'combineVariants', 'detach', 'mask', '-', 'union', 'subtract', 'intersect', 'exclude', 'flatten', '-', 'flipH', 'flipV', 'toggleVisible', 'toggleLock', '-', 'export', 'exportHtml', 'exportSelection', 'exportSvg'];
const CTX_EMPTY: (string | '-')[] = ['paste', 'selectAll', '-', 'zoomFit', 'toggleRulers', 'toggleGrid', 'toggleOutlines'];

export function ContextMenu() {
  const [pos, setPos] = useState<{ x: number; y: number; wx: number; wy: number } | null>(null);
  const sel = useEditor((s) => s.selection);
  useEffect(() => {
    const open = (e: Event) => setPos((e as CustomEvent).detail);
    const close = () => setPos(null);
    window.addEventListener('figmy:context', open);
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('figmy:context', open);
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
    };
  }, []);
  if (!pos) return null;
  const items = sel.length ? CTX_ITEMS : CTX_EMPTY;
  const top = Math.min(pos.y, innerHeight - items.length * 26 - 20);
  return (
    <div className="context-menu" style={{ left: Math.min(pos.x, innerWidth - 240), top: Math.max(8, top) }} onPointerDown={(e) => e.stopPropagation()}>
      {items.map((id, i) =>
        id === '-' ? (
          <hr key={i} />
        ) : (
          <button
            key={id}
            onClick={() => {
              setPos(null);
              if (id === 'paste') useEditor.getState().paste({ x: pos.wx, y: pos.wy });
              else actions[id].run();
            }}
          >
            <span>{actions[id].label}</span>
            <kbd>{actions[id].shortcut}</kbd>
          </button>
        ),
      )}
    </div>
  );
}

export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = () => setOpen((o) => !o);
    window.addEventListener('figmy:shortcuts', t);
    return () => window.removeEventListener('figmy:shortcuts', t);
  }, []);
  if (!open) return null;
  const tools = [
    ['Move', 'V'], ['Frame', 'F'], ['Section', 'S'], ['Rectangle', 'R'], ['Ellipse', 'O'], ['Line', 'L'], ['Arrow', 'Shift+L'], ['Pen', 'P'], ['Pencil', 'Shift+P'], ['Text', 'T'], ['Hand', 'H / Space'], ['Comment', 'C'],
    ['Nudge', 'Arrows (Shift ×10)'], ['Opacity', '1…0'], ['Select child / parent', 'Enter / Shift+Enter'], ['Deep select', 'Ctrl+Click'], ['Duplicate while dragging', 'Alt+Drag'], ['Edit vector', 'Enter on path / double-click'],
  ];
  return (
    <div className="modal-backdrop" onPointerDown={() => setOpen(false)}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <header>
          <h2>Keyboard shortcuts</h2>
          <button className="btn small" onClick={() => setOpen(false)}>Close</button>
        </header>
        <div className="shortcut-grid">
          {tools.map(([l, k]) => (
            <div key={l}><span>{l}</span><kbd>{k}</kbd></div>
          ))}
          {Object.values(actions).filter((a) => a.shortcut).map((a) => (
            <div key={a.label}><span>{a.label}</span><kbd>{a.shortcut}</kbd></div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Toast() {
  const t = useEditor((s) => s.toast);
  return t ? <div className="toast">{t}</div> : null;
}
