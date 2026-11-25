import { useState } from 'react';
import { useEditor } from '../store/store';

export function CommentPins() {
  const st = useEditor();
  const [reply, setReply] = useState('');
  const { zoom, panX, panY, doc, pageId, activeCommentId } = st;
  const list = doc.comments.filter((c) => c.pageId === pageId && (!c.resolved || c.id === activeCommentId));
  if (st.mode === 'dev' && !list.length) return null;
  return (
    <>
      {list.map((c, i) => {
        const x = c.x * zoom + panX,
          y = c.y * zoom + panY;
        const open = c.id === activeCommentId;
        return (
          <div key={c.id} className="comment-pin-wrap" style={{ left: x, top: y }} onPointerDown={(e) => e.stopPropagation()}>
            <button className={'comment-pin' + (c.resolved ? ' resolved' : '')} onClick={() => st.set({ activeCommentId: open ? null : c.id })} title={c.text}>
              {c.author.slice(0, 1).toUpperCase() || i + 1}
            </button>
            {open && (
              <div className="comment-card">
                <div className="comment-head">
                  <b>{c.author}</b>
                  <span>{new Date(c.createdAt).toLocaleString()}</span>
                </div>
                <p>{c.text}</p>
                {c.replies.map((r) => (
                  <div key={r.id} className="comment-reply">
                    <b>{r.author}</b> {r.text}
                  </div>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (reply.trim()) st.replyComment(c.id, reply.trim());
                    setReply('');
                  }}
                >
                  <input value={reply} placeholder="Reply…" onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
                </form>
                <div className="row gap">
                  <button className="btn small" onClick={() => st.resolveComment(c.id)}>{c.resolved ? 'Reopen' : 'Resolve'}</button>
                  <button className="btn small danger" onClick={() => { st.deleteComment(c.id); st.set({ activeCommentId: null }); }}>Delete</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
