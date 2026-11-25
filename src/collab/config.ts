/** Locates the Figmy server (collaboration + MCP + Figma proxy). */
import { desktop } from '../lib/platform';
import { sessionToken } from '../auth/auth';

const KEY = 'figmy:server';
let cached: string | null | undefined;

export function storedServer(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function setStoredServer(url: string | null) {
  try {
    if (url) localStorage.setItem(KEY, url.replace(/\/$/, ''));
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  cached = undefined;
}

/** http(s) base URL of the server, or null when no server is reachable. */
export async function serverBase(): Promise<string | null> {
  if (cached !== undefined) return cached;
  const params = new URLSearchParams(location.search);
  const candidates = [
    params.get('server'),
    storedServer(),
    desktop ? await desktop.serverUrl?.() : null,
    // set at build time for static hosting (e.g. Cloudflare Pages) that talks to a separate Figmy server
    ((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_FIGMY_SERVER_URL || null),
    location.protocol.startsWith('http') ? location.origin : null,
  ].filter((x): x is string => !!x);
  for (const c of candidates) {
    const base = c.replace(/\/$/, '').replace(/^ws/, 'http');
    try {
      const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok && (await r.json()).app === 'figmy') {
        cached = base;
        return base;
      }
    } catch {
      /* try next */
    }
  }
  cached = null;
  return null;
}

export function resetServerCache() {
  cached = undefined;
}

export function authToken(): string | null {
  const session = sessionToken();
  if (session) return session;
  try {
    return new URLSearchParams(location.search).get('token') ?? localStorage.getItem('figmy:token');
  } catch {
    return null;
  }
}
