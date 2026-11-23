import { useEffect } from 'react';
import { useEditor } from './store/store';
import { actions, toolKeys } from './actions';
import { isTyping } from './canvas/Canvas';

/** Normalise a KeyboardEvent to "Ctrl+Shift+Alt+key" form (Cmd maps to Ctrl). */
function combo(e: KeyboardEvent) {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let k = e.key;
  if (e.code.startsWith('Digit')) k = e.code.slice(5);
  else if (e.code.startsWith('Key')) k = e.code.slice(3);
  else if (k === 'Delete' || k === 'Backspace') k = 'Del';
  else if (e.code === 'BracketLeft') k = '[';
  else if (e.code === 'BracketRight') k = ']';
  else if (e.code === 'Equal') k = '=';
  else if (e.code === 'Minus') k = '-';
  else if (e.code === 'Quote') k = "'";
  else if (e.code === 'Backslash') k = '\\';
  else if (e.code === 'Slash') k = '?';
  parts.push(k.length === 1 ? k.toUpperCase() : k);
  return parts.join('+');
}

const map: Record<string, string> = {};
for (const [id, a] of Object.entries(actions)) {
  if (!a.shortcut) continue;
  const norm = a.shortcut
    .split('+')
    .map((p) => (p.length === 1 ? p.toUpperCase() : p))
    .sort((a, b) => order(a) - order(b))
    .join('+');
  map[norm] = id;
}
function order(p: string) {
  return p === 'Ctrl' ? 0 : p === 'Alt' ? 1 : p === 'Shift' ? 2 : 3;
}

export function useShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const s = useEditor.getState();
      if (s.presenting) return;
      const c = combo(e);
      if (c === 'Ctrl+V' || c === 'Ctrl+Shift+V') return; // handled by paste event
      if (c === 'Ctrl+Shift+=' ) { e.preventDefault(); return actions.zoomIn.run(); }
      const id = map[c];
      if (id) {
        e.preventDefault();
        actions[id].run();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // arrow nudge
      if (e.key.startsWith('Arrow') && s.selection.length) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
        s.moveBy(s.selection, dx, dy);
        return;
      }
      if (e.key === 'Escape') {
        if (s.editingPathId) return s.set({ editingPathId: null });
        if (s.tool !== 'move') return s.set({ tool: 'move' });
        if (s.selection.length) {
          const parent = s.doc.nodes[s.selection[0]]?.parentId;
          return s.set({ selection: parent && s.doc.nodes[parent] ? [parent] : [], focusId: null });
        }
        return;
      }
      if (e.key === 'Enter' && s.selection.length === 1) {
        const n = s.doc.nodes[s.selection[0]];
        if (n?.type === 'text') return s.set({ editingTextId: n.id });
        if (n?.type === 'path') return s.set({ editingPathId: n.id });
        if (n?.children.length) return s.set({ selection: e.shiftKey ? [n.parentId ?? n.id] : [...n.children], focusId: n.id });
      }
      if (e.key === 'Tab' && s.selection.length === 1) {
        e.preventDefault();
        const n = s.doc.nodes[s.selection[0]];
        const sibs = n.parentId ? s.doc.nodes[n.parentId].children : s.page().children;
        const i = sibs.indexOf(n.id);
        const next = sibs[(i + (e.shiftKey ? -1 : 1) + sibs.length) % sibs.length];
        s.select([next]);
        return;
      }
      // opacity number keys: 1 => 10% ... 0 => 100%
      if (/^[0-9]$/.test(e.key) && s.selection.length && !e.shiftKey) {
        const v = e.key === '0' ? 1 : Number(e.key) / 10;
        s.updateNodes(s.selection, { opacity: v });
        return;
      }
      const k = e.key.toLowerCase();
      if (e.shiftKey && k === 'c' && !(e.ctrlKey || e.metaKey)) return s.set({ tool: 'comment' });
      if (e.shiftKey && k === 'p') return s.set({ tool: 'pencil' });
      if (e.shiftKey && k === 'l') return s.set({ tool: 'arrow' });
      if (e.shiftKey) return;
      if (toolKeys[k]) {
        s.set({ tool: toolKeys[k], editingPathId: null });
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
