import { useEffect, useRef } from 'react';
import { useEditor } from '../store/store';
import { FONT_STACK, textBoxSize } from '../lib/text';

/** Inline textarea overlay used while editing a text layer. */
export function TextEditor({ id, onDone }: { id: string; onDone: (id: string) => void }) {
  const st = useEditor();
  const n = st.doc.nodes[id];
  const ref = useRef<HTMLTextAreaElement>(null);
  const started = useRef(false);
  const mountedAt = useRef(Date.now());

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // focus after the browser's own mousedown focus handling has run
    const t = setTimeout(() => {
      el.focus();
      el.select();
    }, 30);
    return () => {
      clearTimeout(t);
      onDone(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!n?.text) return null;
  const t = n.text;
  const { zoom, panX, panY } = st;
  const fill = n.fills.find((f) => f.visible);
  const style: React.CSSProperties = {
    left: n.x * zoom + panX,
    top: n.y * zoom + panY,
    width: (t.autoResize === 'width' ? Math.max(n.w, 20) + 40 : n.w) * zoom,
    height: Math.max(n.h, t.fontSize * t.lineHeight) * zoom,
    fontFamily: FONT_STACK(t.fontFamily),
    fontSize: t.fontSize * zoom,
    fontWeight: t.fontWeight,
    fontStyle: t.italic ? 'italic' : 'normal',
    lineHeight: t.lineHeight,
    letterSpacing: t.letterSpacing * zoom,
    textAlign: t.align,
    textTransform: t.transform,
    color: fill?.kind === 'solid' ? fill.color : '#000',
    transform: n.rotation ? `rotate(${n.rotation}deg)` : undefined,
    whiteSpace: t.autoResize === 'width' ? 'pre' : 'pre-wrap',
  };

  return (
    <textarea
      ref={ref}
      className="text-editor"
      style={style}
      value={t.content}
      spellCheck={false}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        const s = useEditor.getState();
        if (!started.current) {
          s.checkpoint();
          started.current = true;
        }
        const content = e.target.value;
        s.mutate((d) => {
          const node = d.nodes[id];
          node.text = { ...node.text!, content };
          if (node.text.autoResize !== 'fixed') Object.assign(node, textBoxSize(node.text, node.w));
        }, false);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          useEditor.getState().set({ editingTextId: null, selection: [id] });
        }
      }}
      onBlur={() => {
        if (Date.now() - mountedAt.current > 250) useEditor.getState().set({ editingTextId: null });
      }}
    />
  );
}
