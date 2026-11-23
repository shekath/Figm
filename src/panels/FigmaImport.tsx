import { useEffect, useState } from 'react';
import { useEditor } from '../store/store';
import { collectImageRefs, convertFigmaFile, parseFigmaKey, type FigmaImportResult } from '../lib/figmaImport';
import { pickFile } from '../lib/platform';
import { serverBase, authToken } from '../collab/config';
import { blobToDataUrl } from '../lib/exporter';

/** Fetch through the Figmy server when the browser can't reach Figma directly (CORS / desktop). */
async function figmaGet(path: string, token: string): Promise<unknown> {
  try {
    const r = await fetch(`https://api.figma.com${path}`, { headers: { 'X-Figma-Token': token } });
    if (r.ok) return r.json();
    if (r.status === 403 || r.status === 404) throw new Error(`Figma API: ${r.status} ${(await r.text()).slice(0, 200)}`);
  } catch (e) {
    if ((e as Error).message.startsWith('Figma API')) throw e;
  }
  const base = await serverBase();
  if (!base) throw new Error('Could not reach the Figma API from this browser. Start the Figmy server (npm start) or use the desktop app.');
  const r = await fetch(`${base}/api/figma${path}`, { headers: { 'X-Figma-Token': token, ...(authToken() ? { Authorization: `Bearer ${authToken()}` } : {}) } });
  if (!r.ok) throw new Error(`Figma API: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function fetchImage(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (r.ok) return blobToDataUrl(await r.blob());
  } catch {
    /* fall back to proxy */
  }
  const base = await serverBase();
  if (!base) return null;
  try {
    const r = await fetch(`${base}/api/fetch-image?url=${encodeURIComponent(url)}`, { headers: authToken() ? { Authorization: `Bearer ${authToken()}` } : {} });
    return r.ok ? blobToDataUrl(await r.blob()) : null;
  } catch {
    return null;
  }
}

export function FigmaImportDialog() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState(() => {
    try {
      return sessionStorage.getItem('figmy:figma-token') ?? '';
    } catch {
      return '';
    }
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FigmaImportResult | null>(null);

  useEffect(() => {
    const t = () => {
      setOpen(true);
      setError(null);
      setResult(null);
    };
    window.addEventListener('figmy:figma-import', t);
    return () => window.removeEventListener('figmy:figma-import', t);
  }, []);
  if (!open) return null;

  const finish = (r: FigmaImportResult) => {
    const st = useEditor.getState();
    st.setDoc(r.doc);
    setResult(r);
    window.dispatchEvent(new Event('figmy:open-editor'));
    setTimeout(() => useEditor.getState().zoomToFit(), 50);
  };

  const importFromApi = async () => {
    const key = parseFigmaKey(url);
    if (!key) return setError('Paste a figma.com/design/… link or a file key.');
    if (!token.trim()) return setError('A Figma personal access token is required (Figma → Settings → Security → Personal access tokens, scope “file content: read”).');
    try {
      sessionStorage.setItem('figmy:figma-token', token.trim());
    } catch {
      /* ignore */
    }
    setError(null);
    try {
      setBusy('Downloading file…');
      const file = (await figmaGet(`/v1/files/${key}?geometry=paths`, token.trim())) as Record<string, unknown>;
      const refs = collectImageRefs(file);
      const images: Record<string, string> = {};
      if (refs.length) {
        setBusy(`Downloading ${refs.length} image${refs.length > 1 ? 's' : ''}…`);
        const meta = (await figmaGet(`/v1/files/${key}/images`, token.trim()).catch(() => null)) as { meta?: { images?: Record<string, string> } } | null;
        const urls = meta?.meta?.images ?? {};
        let done = 0;
        await Promise.all(
          refs.map(async (ref) => {
            if (urls[ref]) {
              const d = await fetchImage(urls[ref]);
              if (d) images[ref] = d;
            }
            setBusy(`Downloading images ${++done}/${refs.length}…`);
          }),
        );
      }
      setBusy('Converting…');
      finish(convertFigmaFile(file, images));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const importFromJson = async () => {
    const f = await pickFile('.json,.fig');
    if (!f) return;
    if (f.name.toLowerCase().endsWith('.fig')) {
      try {
        setBusy('Reading .fig file…');
        const { importFigFile } = await import('../lib/figFile');
        finish(importFigFile(new Uint8Array(await f.arrayBuffer())));
      } catch (e) {
        setError(`Could not import this .fig file: ${(e as Error).message}. Tip: importing with a file link + access token uses Figma’s official API and is the most faithful option.`);
      } finally {
        setBusy(null);
      }
      return;
    }
    try {
      setBusy('Converting…');
      const json = JSON.parse(await f.text());
      if (!json.document) throw new Error('This JSON is not a Figma REST API file response (missing "document").');
      finish(convertFigmaFile(json));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const stop = (e: React.KeyboardEvent) => e.stopPropagation();
  return (
    <div className="modal-backdrop" onPointerDown={() => !busy && setOpen(false)}>
      <div className="modal import-modal" onPointerDown={(e) => e.stopPropagation()}>
        <header>
          <h2>Import from Figma</h2>
          <button className="btn small" disabled={!!busy} onClick={() => setOpen(false)}>Close</button>
        </header>
        {result ? (
          <div className="import-result">
            <p>
              Imported <b>{result.stats.nodes}</b> layers on <b>{result.stats.pages}</b> page{result.stats.pages > 1 ? 's' : ''}
              {result.stats.images ? <>, {result.stats.images} image fills</> : null}.
            </p>
            {result.stats.warnings.length > 0 && (
              <ul className="warn-list">
                {result.stats.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            <p className="muted">Components arrive as main components; instances are imported as editable frames so they look exactly like the source.</p>
            <button className="btn primary" onClick={() => setOpen(false)}>Open design</button>
          </div>
        ) : (
          <>
            <label className="field">
              <span>Figma file link</span>
              <input className="text-input" placeholder="https://www.figma.com/design/AbC123…/My-file" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={stop} />
            </label>
            <label className="field">
              <span>Personal access token</span>
              <input className="text-input" type="password" placeholder="figd_…" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={stop} />
              <small className="muted">Kept for this browser session only and sent only to Figma (or your own Figmy server as a proxy).</small>
            </label>
            <div className="row gap">
              <button className="btn primary" disabled={!!busy} onClick={importFromApi}>Import</button>
              <button className="btn" disabled={!!busy} onClick={importFromJson}>Import .fig or REST JSON file…</button>
            </div>
            {busy && <p className="muted">{busy}</p>}
            {error && <p className="error-text">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
