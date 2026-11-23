import { useEffect, useState } from 'react';
import { useEditor } from '../store/store';
import { follow, goLive, leaveLive, shareLink, useCollab } from './client';
import { resetServerCache, serverBase, setStoredServer, storedServer, authToken } from './config';
import { rotatePoint } from '../lib/geometry';
import { desktop } from '../lib/platform';

/** Collaborators' cursors and selections, drawn in screen space over the canvas. */
export function PeerCursors() {
  const peers = useCollab((s) => s.peers);
  const { zoom, panX, panY, pageId, doc } = useEditor();
  const S = (x: number, y: number) => ({ x: x * zoom + panX, y: y * zoom + panY });
  return (
    <svg className="overlay peers" width="100%" height="100%">
      {Object.values(peers).map((p) => {
        if (p.presence.pageId && p.presence.pageId !== pageId) return null;
        const sel = (p.presence.selection ?? []).map((id) => doc.nodes[id]).filter(Boolean);
        const c = p.presence.cursor ? S(p.presence.cursor.x, p.presence.cursor.y) : null;
        return (
          <g key={p.id}>
            {sel.map((n) => {
              const cx = n.x + n.w / 2,
                cy = n.y + n.h / 2;
              const pts = [
                [n.x, n.y],
                [n.x + n.w, n.y],
                [n.x + n.w, n.y + n.h],
                [n.x, n.y + n.h],
              ]
                .map(([x, y]) => {
                  const r = n.rotation ? rotatePoint(x, y, cx, cy, n.rotation) : { x, y };
                  const s = S(r.x, r.y);
                  return `${s.x},${s.y}`;
                })
                .join(' ');
              return <polygon key={n.id} points={pts} fill="none" stroke={p.color} strokeWidth={1.5} />;
            })}
            {c && (
              <g transform={`translate(${c.x},${c.y})`}>
                <path d="M0 0 L0 16 L4.5 12 L7.5 18.5 L10 17.3 L7 11 L12.5 11 Z" fill={p.color} stroke="#fff" strokeWidth={1.2} />
                <g transform="translate(12,18)">
                  <rect rx={4} height={20} width={p.name.length * 7 + 16} fill={p.color} />
                  <text x={8} y={14} fill="#fff" fontSize={11} fontFamily="Inter, system-ui" fontWeight={600}>
                    {p.kind === 'ai' ? '✦ ' : ''}
                    {p.name}
                  </text>
                </g>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Avatars + live status + Share button for the toolbar. */
export function CollabBar() {
  const { status, peers, me, following } = useCollab();
  const list = Object.values(peers);
  const label = status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting…' : status === 'reconnecting' ? 'Reconnecting…' : status === 'error' ? 'Offline' : 'Local';
  return (
    <div className="collab-bar">
      <span className={`live-dot ${status}`} title={label} />
      {status === 'live' && (
        <div className="avatars">
          <span className="avatar me" style={{ background: me.color }} title={`${me.name} (you)`}>
            {me.name[0]?.toUpperCase()}
          </span>
          {list.slice(0, 5).map((p) => (
            <button key={p.id} className={`avatar ${following === p.id ? 'following' : ''}`} style={{ background: p.color, borderColor: following === p.id ? p.color : undefined }} title={`${p.name}${p.kind === 'ai' ? ' (AI)' : ''} — click to ${following === p.id ? 'stop following' : 'follow'}`} onClick={() => follow(following === p.id ? null : p.id)}>
              {p.kind === 'ai' ? '✦' : p.name[0]?.toUpperCase()}
            </button>
          ))}
          {list.length > 5 && <span className="avatar more">+{list.length - 5}</span>}
        </div>
      )}
      <button className="btn share-btn" onClick={() => window.dispatchEvent(new Event('vectura:share'))}>
        Share
      </button>
    </div>
  );
}

export function ShareDialog() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'share' | 'ai'>('share');
  const collab = useCollab();
  const [server, setServer] = useState(storedServer() ?? '');
  const [token, setToken] = useState(() => {
    try {
      return localStorage.getItem('vectura:token') ?? '';
    } catch {
      return '';
    }
  });
  const [detected, setDetected] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const t = (e: Event) => {
      setOpen(true);
      setTab((e as CustomEvent).detail?.tab ?? 'share');
      serverBase().then(setDetected);
    };
    window.addEventListener('vectura:share', t);
    return () => window.removeEventListener('vectura:share', t);
  }, []);
  if (!open) return null;

  const copy = (text: string, what: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };
  const base = collab.base ?? detected;
  const mcpUrl = base ? `${base}/mcp` : 'http://localhost:4317/mcp';
  const link = shareLink();
  const stop = (e: React.KeyboardEvent) => e.stopPropagation();
  const tok = authToken();
  const desktopCfg = JSON.stringify(
    {
      mcpServers: {
        vectura: base && !base.includes('localhost') && !base.includes('127.0.0.1')
          ? { command: 'npx', args: ['-y', 'mcp-remote', mcpUrl, ...(tok ? ['--header', `Authorization: Bearer ${tok}`] : [])] }
          : { command: 'node', args: ['<path-to-vectura>/server-dist/server.cjs', '--stdio'] },
      },
    },
    null,
    2,
  );

  return (
    <div className="modal-backdrop" onPointerDown={() => setOpen(false)}>
      <div className="modal share-modal" onPointerDown={(e) => e.stopPropagation()}>
        <header>
          <div className="tabs inline">
            <button className={tab === 'share' ? 'active' : ''} onClick={() => setTab('share')}>Share & collaborate</button>
            <button className={tab === 'ai' ? 'active' : ''} onClick={() => setTab('ai')}>Connect AI (MCP)</button>
          </div>
          <button className="btn small" onClick={() => setOpen(false)}>Close</button>
        </header>

        {tab === 'share' ? (
          <>
            <div className="field">
              <span>Your name</span>
              <div className="row gap">
                <input className="text-input" value={collab.me.name} onChange={(e) => collab.setMe({ name: e.target.value })} onKeyDown={stop} />
                <input type="color" value={collab.me.color} onChange={(e) => collab.setMe({ color: e.target.value })} title="Cursor colour" />
              </div>
            </div>
            {collab.status === 'live' && link ? (
              <>
                <p>
                  <span className="live-dot live" /> This file is live. Anyone with the link can edit it in real time.
                </p>
                <div className="row gap">
                  <input className="text-input" readOnly value={link} onFocus={(e) => e.target.select()} />
                  <button className="btn primary" onClick={() => copy(link, 'link')}>{copied === 'link' ? 'Copied' : 'Copy link'}</button>
                </div>
                <p className="muted">{Object.keys(collab.peers).length} other {Object.keys(collab.peers).length === 1 ? 'person' : 'people'} here.</p>
                <button className="btn danger small" onClick={() => leaveLive()}>Stop sharing on this device</button>
              </>
            ) : (
              <>
                <p className="muted">Real-time collaboration and the AI connector run through a Vectura server — the desktop app includes one; for the web run <code>npm start</code> (or host it).</p>
                <div className="field">
                  <span>Server address</span>
                  <input className="text-input" placeholder={detected ?? 'http://localhost:4317'} value={server} onChange={(e) => setServer(e.target.value)} onKeyDown={stop} />
                  <small className="muted">{detected ? `Detected: ${detected}` : 'No server detected yet.'}</small>
                </div>
                <div className="field">
                  <span>Access token (if the server requires one)</span>
                  <input className="text-input" type="password" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={stop} />
                </div>
                <button
                  className="btn primary"
                  onClick={async () => {
                    setStoredServer(server || null);
                    try {
                      if (token) localStorage.setItem('vectura:token', token);
                      else localStorage.removeItem('vectura:token');
                    } catch {
                      /* ignore */
                    }
                    resetServerCache();
                    await goLive();
                  }}
                >
                  Go live
                </button>
                {collab.error && <p className="error-text">{collab.error}</p>}
              </>
            )}
          </>
        ) : (
          <div className="ai-connect">
            <p>
              Let Claude, ChatGPT or any MCP-capable assistant read and edit your designs. Edits appear live in the editor with a <b>✦ AI</b> cursor.
            </p>
            <div className="field">
              <span>MCP server URL (Streamable HTTP)</span>
              <div className="row gap">
                <input className="text-input" readOnly value={mcpUrl} onFocus={(e) => e.target.select()} />
                <button className="btn" onClick={() => copy(mcpUrl, 'mcp')}>{copied === 'mcp' ? 'Copied' : 'Copy'}</button>
              </div>
              {!base && <small className="error-text">No server running — start one with “npm start”{desktop ? ' (the desktop app starts it automatically)' : ''}.</small>}
            </div>
            <h4>Claude Desktop / Claude Code</h4>
            <p className="muted">Add to <code>claude_desktop_config.json</code> (Settings → Developer → Edit config), then restart Claude:</p>
            <pre className="code">{desktopCfg}</pre>
            <button className="btn small" onClick={() => copy(desktopCfg, 'cfg')}>{copied === 'cfg' ? 'Copied' : 'Copy config'}</button>
            <p className="muted">Claude Code: <code>claude mcp add --transport http vectura {mcpUrl}</code></p>
            <h4>Claude.ai (custom connector) and ChatGPT (connectors / developer mode)</h4>
            <p className="muted">
              These run in the cloud, so they need a public HTTPS address: host the server, or expose a local one with a tunnel (e.g. <code>cloudflared tunnel --url http://localhost:4317</code>), start it with <code>--token &lt;secret&gt;</code>, then add <code>https://&lt;your-host&gt;/mcp</code> as a custom connector and supply the token as a Bearer header if your client supports it.
            </p>
            <p className="muted">Try asking: “Design a mobile login screen in my open Vectura file with an email field, password field and a primary button, then link the button to a new Home screen with smart animate.”</p>
          </div>
        )}
      </div>
    </div>
  );
}
