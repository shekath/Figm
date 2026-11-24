import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store/store';
import { RESEARCH_TOOLS, toolById, type ResearchRequest, type ResearchResult, type ResearchToolId } from '../lib/research';
import { placeResearch } from '../lib/researchCanvas';
import { serverBase, authToken } from '../collab/config';
import { pickFile } from '../lib/platform';

const KEY_STORE = 'figmy:anthropic-key';
const ENGINE_STORE = 'figmy:rk-engine';
type Engine = 'builtin' | 'claude';
const readEngine = (): Engine => { try { return localStorage.getItem(ENGINE_STORE) === 'claude' ? 'claude' : 'builtin'; } catch { return 'builtin'; } };
const readKey = () => { try { return localStorage.getItem(KEY_STORE) ?? ''; } catch { return ''; } };

/** Where AI requests go: the Figmy server (its ANTHROPIC_API_KEY) or the browser with the user's own key. */
async function aiBackend(): Promise<'server' | 'browser' | null> {
  const base = await serverBase();
  if (base) {
    try {
      const r = await fetch(`${base}/api/ai/status`, { headers: authToken() ? { Authorization: `Bearer ${authToken()}` } : {} });
      if (r.ok && (await r.json()).enabled) return 'server';
    } catch { /* fall through */ }
  }
  return readKey() ? 'browser' : null;
}

async function run(req: ResearchRequest): Promise<ResearchResult> {
  if (readEngine() === 'builtin') {
    const { runLocal } = await import('../lib/researchLocal');
    await new Promise((r) => setTimeout(r, 250)); // let the UI show progress
    return runLocal(req);
  }
  const backend = await aiBackend();
  if (backend === 'server') {
    const base = await serverBase();
    const r = await fetch(`${base}/api/ai/research`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authToken() ? { Authorization: `Bearer ${authToken()}` } : {}) }, body: JSON.stringify(req) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
    return j as ResearchResult;
  }
  if (backend === 'browser') {
    const [{ default: Anthropic }, { runResearch }] = await Promise.all([import('@anthropic-ai/sdk'), import('../lib/research')]);
    const client = new Anthropic({ apiKey: readKey(), dangerouslyAllowBrowser: true });
    try {
      return await runResearch(client, req);
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new Error('Your Anthropic API key was rejected. Check it in Settings.');
      if (e instanceof Anthropic.RateLimitError) throw new Error('Rate limited by the API. Wait a moment and try again.');
      if (e instanceof Anthropic.APIError) throw new Error(`AI error (${e.status ?? 'network'}): ${e.message}`);
      throw e;
    }
  }
  throw new Error('NO_BACKEND');
}

async function readDocument(f: File): Promise<{ name: string; text?: string; pdfBase64?: string }> {
  if (f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf') {
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { name: f.name, pdfBase64: btoa(bin) };
  }
  return { name: f.name, text: await f.text() };
}

/** Readable preview of a structured result. */
function Preview({ value, depth = 0 }: { value: unknown; depth?: number }): JSX.Element {
  if (value == null || value === '') return <></>;
  if (typeof value !== 'object') return <span>{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== 'object')) return <ul className="rk-ul">{value.map((v, i) => <li key={i}>{String(v)}</li>)}</ul>;
    return <div className="rk-items">{value.map((v, i) => <div key={i} className="rk-item"><Preview value={v} depth={depth + 1} /></div>)}</div>;
  }
  return (
    <div className="rk-obj">
      {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
        <div key={k} className={`rk-field d${Math.min(depth, 2)}`}>
          <div className="rk-key">{k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}</div>
          <div className="rk-val"><Preview value={v} depth={depth + 1} /></div>
        </div>
      ))}
    </div>
  );
}

/** Research Kit: AI tools for personas, journeys, IA, synthesis and research planning. */
export function ResearchKit() {
  const st = useEditor();
  const [open, setOpen] = useState(false);
  const [toolId, setToolId] = useState<ResearchToolId>('persona');
  const [inputs, setInputs] = useState<Record<string, Record<string, string>>>({});
  const [doc, setDoc] = useState<{ name: string; text?: string; pdfBase64?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Partial<Record<ResearchToolId, ResearchResult>>>({});
  const [chats, setChats] = useState<Partial<Record<ResearchToolId, { role: 'user' | 'assistant'; content: string }[]>>>({});
  const [draft, setDraft] = useState('');
  const [settings, setSettings] = useState(false);
  const [key, setKey] = useState(readKey());
  const [backend, setBackend] = useState<'server' | 'browser' | null | 'checking'>('checking');
  const [engine, setEngineState] = useState<Engine>(readEngine);
  const setEngine = (e: Engine) => { try { localStorage.setItem(ENGINE_STORE, e); } catch { /* ignore */ } setEngineState(e); setError(null); };
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = (e: Event) => { setOpen(true); const id = (e as CustomEvent).detail?.tool; if (id) setToolId(id); };
    window.addEventListener('figmy:research', t);
    return () => window.removeEventListener('figmy:research', t);
  }, []);
  useEffect(() => { if (open) { setBackend('checking'); aiBackend().then(setBackend); } }, [open, key]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'end' }); }, [chats, busy]);
  if (!open) return null;

  const tool = toolById(toolId);
  const vals = inputs[toolId] ?? {};
  const result = results[toolId];
  const chat = chats[toolId] ?? [];
  const stop = (e: React.KeyboardEvent) => e.stopPropagation();

  const handle = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) {
      const m = (e as Error).message;
      if (m === 'NO_BACKEND') { setSettings(true); setError('Claude is not connected. Add an API key below, or switch back to the built-in engine.'); }
      else setError(m);
    } finally { setBusy(false); }
  };
  const generate = () => handle(async () => {
    const r = await run({ tool: toolId, inputs: vals, document: tool.acceptsDocument ? doc : null });
    setResults({ ...results, [toolId]: r });
  });
  const send = () => {
    if (!draft.trim() || busy) return;
    const history = [...chat, { role: 'user' as const, content: draft.trim() }];
    setChats({ ...chats, [toolId]: history });
    setDraft('');
    handle(async () => {
      try {
        const r = await run({ tool: toolId, inputs: {}, document: doc, messages: history });
        setChats((c) => ({ ...c, [toolId]: [...history, { role: 'assistant', content: r.text ?? '' }] }));
      } catch (e) {
        setChats((c) => ({ ...c, [toolId]: history.slice(0, -1) }));
        setDraft(history[history.length - 1].content);
        throw e;
      }
    });
  };
  const place = (r: ResearchResult, title?: string) => {
    let id = '';
    st.mutate((d) => { id = placeResearch(d, st.pageId, r, title); });
    st.select([id]);
    setTimeout(() => useEditor.getState().zoomToSelection(), 30);
    st.notify('Added to canvas — reopen the Research Kit with Shift+I');
    setOpen(false);
  };
  const attach = async () => {
    const f = await pickFile(engine === 'claude' ? '.txt,.md,.csv,.json,.pdf,text/plain,application/pdf' : '.txt,.md,.csv,.json,text/plain');
    if (f) { if (f.size > 20 * 1024 * 1024) return setError('That file is larger than 20 MB.'); setDoc(await readDocument(f)); }
  };
  const saveKey = () => { try { if (key.trim()) localStorage.setItem(KEY_STORE, key.trim()); else localStorage.removeItem(KEY_STORE); } catch { /* ignore */ } setKey(key.trim()); setSettings(false); setError(null); };

  return (
    <div className="modal-backdrop" onPointerDown={() => !busy && setOpen(false)}>
      <div className="modal rk" onPointerDown={(e) => e.stopPropagation()}>
        <aside className="rk-side">
          <div className="rk-brand"><span className="rk-logo">✦</span> Research Kit</div>
          {RESEARCH_TOOLS.map((t) => (
            <button key={t.id} className={`rk-tool ${t.id === toolId ? 'on' : ''}`} onClick={() => { setToolId(t.id); setError(null); }}>
              <span className="rk-ico">{t.icon}</span>
              <span>{t.label}</span>
              {(results[t.id] || chats[t.id]?.length) && <span className="rk-dot" />}
            </button>
          ))}
          <div className="grow" />
          <button className={`rk-tool ${settings ? 'on' : ''}`} onClick={() => setSettings(!settings)}><span className="rk-ico">⚙︎</span><span>Settings</span></button>
        </aside>

        <main className="rk-main">
          <header className="rk-head">
            <div>
              <h2>{settings ? 'Settings' : `${tool.icon} ${tool.label}`}</h2>
              <p className="muted">{settings ? 'How the Research Kit connects to Claude' : tool.blurb}</p>
            </div>
            {engine === 'builtin' ? (
              <span className="rk-status ok" title="Runs inside Figmy — no internet or API key needed">Built-in engine · offline</span>
            ) : (
              <span className={`rk-status ${backend === 'checking' ? '' : backend ? 'ok' : 'off'}`}>
                {backend === 'checking' ? 'Checking…' : backend === 'server' ? 'Claude via Figmy server' : backend === 'browser' ? 'Claude · your API key' : 'Claude not connected'}
              </span>
            )}
            <button className="icon-btn" title="Close" onClick={() => setOpen(false)}>✕</button>
          </header>

          {settings ? (
            <div className="rk-body">
              <div className="rk-engines">
                <label className={`rk-engine ${engine === 'builtin' ? 'on' : ''}`}>
                  <input type="radio" name="rk-engine" checked={engine === 'builtin'} onChange={() => setEngine('builtin')} />
                  <div><b>Built-in engine</b> <span className="rk-badge">Default · free · offline</span><p className="muted">Runs entirely inside Figmy. No internet, account or API key, and your data never leaves your device. Uses built-in UX knowledge, templates and local text analysis. Reads .txt, .md and .csv documents.</p></div>
                </label>
                <label className={`rk-engine ${engine === 'claude' ? 'on' : ''}`}>
                  <input type="radio" name="rk-engine" checked={engine === 'claude'} onChange={() => setEngine('claude')} />
                  <div><b>Claude</b> <span className="rk-badge alt">Optional</span><p className="muted">Uses Anthropic’s Claude for richer, more tailored results and PDF reading. Needs an internet connection and either a Figmy server with <code>ANTHROPIC_API_KEY</code> or your own key below. Usage is billed to that key.</p></div>
                </label>
              </div>
              {engine === 'claude' && (
                <>
                  <label className="field">
                    <span>Anthropic API key (optional if your Figmy server has one)</span>
                    <input className="text-input" type="password" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={stop} />
                    <small className="muted">Stored only in this browser and sent only to Anthropic. Anyone using this browser profile can use it.</small>
                  </label>
                  <div className="row gap"><button className="btn primary" onClick={saveKey}>Save key</button>{readKey() && <button className="btn" onClick={() => { setKey(''); try { localStorage.removeItem(KEY_STORE); } catch { /* ignore */ } }}>Remove key</button>}</div>
                </>
              )}
              {error && <p className="error-text">{error}</p>}
            </div>
          ) : tool.chat ? (
            <div className="rk-chat">
              <div className="rk-doc-row">
                {doc ? <span className="rk-doc">📎 {doc.name}<button onClick={() => setDoc(null)} title="Remove">✕</button></span> : <button className="btn small" onClick={attach}>📎 Attach document</button>}
                {tool.id === 'docchat' && !doc && <span className="muted">Attach a .txt, .md or .csv file{engine === 'claude' ? ' (or .pdf)' : ''} to chat about it.</span>}
                {chat.length > 0 && <button className="btn small ghost" onClick={() => setChats({ ...chats, [toolId]: [] })}>New chat</button>}
              </div>
              <div className="rk-messages">
                {chat.length === 0 && <div className="rk-empty muted">{tool.id === 'docchat' ? 'Ask about your document: “What are the top 3 pain points?”, “Summarize interview 2”…' : 'Ask anything about UX: “How do I test a navigation redesign?”, “Critique this onboarding flow…”'}</div>}
                {chat.map((m, i) => (
                  <div key={i} className={`rk-msg ${m.role}`}>
                    <div className="rk-bubble">{m.content}</div>
                    {m.role === 'assistant' && <button className="btn small ghost" onClick={() => place({ tool: toolId, text: m.content }, chat[i - 1]?.content.slice(0, 60))}>Add to canvas</button>}
                  </div>
                ))}
                {busy && <div className="rk-msg assistant"><div className="rk-bubble rk-typing">Thinking…</div></div>}
                <div ref={chatEnd} />
              </div>
              {error && <p className="error-text">{error}</p>}
              <div className="rk-compose">
                <textarea className="text-input" rows={2} placeholder="Ask a question…" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { stop(e); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
                <button className="btn primary" disabled={busy || !draft.trim()} onClick={send}>Send</button>
              </div>
            </div>
          ) : (
            <div className="rk-body">
              {tool.fields.map((f) => (
                <label key={f.key} className="field">
                  <span>{f.label}{f.required && !tool.acceptsDocument ? ' *' : ''}</span>
                  {f.multiline ? (
                    <textarea className="text-input" rows={f.key === 'notes' || f.key === 'content' ? 7 : 3} placeholder={f.placeholder} value={vals[f.key] ?? ''} onChange={(e) => setInputs({ ...inputs, [toolId]: { ...vals, [f.key]: e.target.value } })} onKeyDown={stop} />
                  ) : (
                    <input className="text-input" placeholder={f.placeholder} value={vals[f.key] ?? ''} onChange={(e) => setInputs({ ...inputs, [toolId]: { ...vals, [f.key]: e.target.value } })} onKeyDown={(e) => { stop(e); if (e.key === 'Enter') generate(); }} />
                  )}
                </label>
              ))}
              {tool.acceptsDocument && (
                <div className="rk-doc-row">{doc ? <span className="rk-doc">📎 {doc.name}<button onClick={() => setDoc(null)} title="Remove">✕</button></span> : <button className="btn small" onClick={attach}>📎 Attach document (.txt, .md, .csv{engine === 'claude' ? ', .pdf' : ''})</button>}</div>
              )}
              <div className="row gap">
                <button className="btn primary" disabled={busy} onClick={generate}>{busy ? 'Generating…' : result ? 'Regenerate' : 'Generate'}</button>
                {result && <button className="btn" disabled={busy} onClick={() => place(result)}>Place on canvas</button>}
                {result && <button className="btn ghost" onClick={() => { navigator.clipboard?.writeText(JSON.stringify(result.data, null, 2)); st.notify('Copied as JSON'); }}>Copy JSON</button>}
              </div>
              {error && <p className="error-text">{error}</p>}
              {busy && <div className="rk-skeleton"><i /><i /><i /></div>}
              {result && !busy && <div className="rk-preview"><Preview value={result.data} /></div>}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
