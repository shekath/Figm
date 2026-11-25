import { useEffect, useState } from 'react';
import { libraryList, libraryLoad, libraryDelete, type LibraryEntry, isDesktop } from './lib/platform';
import { useEditor } from './store/store';
import { emptyDocument, sampleDocument } from './lib/factory';
import { actions } from './actions';
import { AccountBadge } from './auth/LoginUI';

/** File browser shown on launch: recent local files plus create / open. */
export function Home({ onOpen }: { onOpen: () => void }) {
  const [files, setFiles] = useState<LibraryEntry[] | null>(null);
  const [q, setQ] = useState('');
  const refresh = () => libraryList().then(setFiles);
  useEffect(() => {
    refresh();
  }, []);
  const st = useEditor.getState();

  const open = async (e: LibraryEntry) => {
    const doc = await libraryLoad(e.id);
    if (!doc) return st.notify('File could not be loaded');
    st.setDoc(doc, { fileId: e.id, filePath: e.path ?? null });
    onOpen();
    setTimeout(() => useEditor.getState().zoomToFit(), 0);
  };

  return (
    <div className="home">
      <aside className="home-side">
        <div className="home-brand">
          <img src="./icon.svg" width={28} height={28} alt="" /> <b>Figmy</b>
        </div>
        <nav>
          <a className="active">Recents</a>
        </nav>
        <div className="home-account">
          <AccountBadge />
        </div>
        <div className="home-foot muted">{isDesktop ? 'Desktop app' : 'Web app'} · files are stored locally on this device</div>
      </aside>
      <main className="home-main">
        <header className="home-head">
          <h1>Recents</h1>
          <input className="home-search" placeholder="Search files" value={q} onChange={(e) => setQ(e.target.value)} />
        </header>
        <div className="home-actions">
          <button className="home-card-action" onClick={() => { st.setDoc(emptyDocument('Untitled')); onOpen(); useEditor.getState().set({ zoom: 1, panX: 240, panY: 140 }); }}>
            <span className="big">＋</span>
            <b>New design file</b>
            <small>Start from a blank canvas</small>
          </button>
          <button className="home-card-action" onClick={async () => { await actions.open.run(); onOpen(); }}>
            <span className="big">⤒</span>
            <b>Open file…</b>
            <small>Open a .figmy file from disk</small>
          </button>
          <button className="home-card-action" onClick={() => window.dispatchEvent(new Event('figmy:figma-import'))}>
            <span className="big">◈</span>
            <b>Import from Figma</b>
            <small>Via file link + access token</small>
          </button>
          <button className="home-card-action" onClick={() => { st.setDoc(sampleDocument()); onOpen(); setTimeout(() => useEditor.getState().zoomToFit(), 0); }}>
            <span className="big">✦</span>
            <b>Sample file</b>
            <small>Explore a starter mobile screen</small>
          </button>
        </div>
        <div className="file-grid">
          {files === null && <div className="muted">Loading…</div>}
          {files?.length === 0 && <div className="muted">No files yet. Files you save appear here.</div>}
          {files
            ?.filter((f) => f.name.toLowerCase().includes(q.toLowerCase()))
            .map((f) => (
              <div key={f.id} className="file-card" onClick={() => open(f)}>
                <div className="file-thumb">{f.thumbnail ? <img src={f.thumbnail} alt="" /> : <span>✎</span>}</div>
                <div className="file-meta">
                  <b>{f.name}</b>
                  <small>Edited {timeAgo(f.updatedAt)}</small>
                </div>
                <button
                  className="icon-btn ghost file-del"
                  title="Delete from library"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (confirm(`Delete “${f.name}” from this device?`)) {
                      await libraryDelete(f.id);
                      refresh();
                    }
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
        </div>
      </main>
    </div>
  );
}

function timeAgo(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}
