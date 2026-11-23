/**
 * Client side of Google sign-in.
 *  - server mode: the Figmy server verifies Google ID tokens and issues sessions (secure)
 *  - desktop: sign in happens in the system browser; the app picks up the session (Google blocks embedded sign-in)
 *  - static mode (e.g. GitHub Pages, no server): identity only — the token is decoded locally for name/avatar
 */
import { create } from 'zustand';
import { serverBase } from '../collab/config';
import { desktop } from '../lib/platform';

export interface Account {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

type Mode = 'loading' | 'server' | 'static' | 'off';

interface AuthState {
  mode: Mode;
  clientId: string | null;
  required: boolean;
  user: Account | null;
  token: string | null;
  error: string | null;
  busy: boolean;
}

const KEY = 'figmy:session';
const read = (): { token?: string; user?: Account; mode?: Mode } => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
};
const write = (v: { token?: string | null; user?: Account | null; mode?: Mode } | null) => {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
};

export const useAuth = create<AuthState>(() => ({ mode: 'loading', clientId: null, required: false, user: null, token: null, error: null, busy: false }));

/** Session token to send to the Figmy server (also accepted wherever the static server token is). */
export const sessionToken = () => useAuth.getState().token;

const staticClientId = (): string | null => {
  const v = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_GOOGLE_CLIENT_ID;
  return v && v.trim() ? v.trim() : null;
};

export async function initAuth() {
  const saved = read();
  const base = await serverBase();
  if (base) {
    try {
      const cfg = (await (await fetch(`${base}/api/auth/config`)).json()) as { googleClientId: string | null; required: boolean };
      if (cfg.googleClientId) {
        useAuth.setState({ mode: 'server', clientId: cfg.googleClientId, required: cfg.required });
        // restore a session (bearer for desktop / cross-origin, cookie for same-origin)
        const r = await fetch(`${base}/api/auth/me`, { credentials: 'include', headers: saved.token ? { Authorization: `Bearer ${saved.token}` } : {} });
        if (r.ok) {
          const { user } = (await r.json()) as { user: Account };
          useAuth.setState({ user, token: saved.token ?? null });
        } else if (saved.mode === 'server') write(null);
        return;
      }
    } catch {
      /* fall through to static mode */
    }
  }
  const cid = staticClientId();
  if (cid) {
    useAuth.setState({ mode: 'static', clientId: cid, required: false, user: saved.mode === 'static' ? saved.user ?? null : null });
    return;
  }
  useAuth.setState({ mode: 'off' });
}

/* ---------- Google Identity Services ---------- */

interface Gis {
  accounts: { id: { initialize: (o: Record<string, unknown>) => void; renderButton: (el: HTMLElement, o: Record<string, unknown>) => void; disableAutoSelect: () => void } };
}
declare global {
  interface Window {
    google?: Gis;
  }
}

let gisLoading: Promise<Gis> | null = null;
function loadGis(): Promise<Gis> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (!gisLoading)
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => (window.google ? resolve(window.google) : reject(new Error('Google sign-in failed to load')));
      s.onerror = () => {
        gisLoading = null;
        reject(new Error('Could not reach Google sign-in (check your connection or content blockers)'));
      };
      document.head.appendChild(s);
    });
  return gisLoading;
}

/** Decode (not verify) a JWT payload — only used for static mode identity. */
function decodeJwt(token: string): Record<string, unknown> {
  const p = token.split('.')[1] ?? '';
  const json = decodeURIComponent(
    atob(p.replace(/-/g, '+').replace(/_/g, '/'))
      .split('')
      .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join(''),
  );
  return JSON.parse(json);
}

async function onCredential(credential: string) {
  const st = useAuth.getState();
  useAuth.setState({ busy: true, error: null });
  try {
    if (st.mode === 'server') {
      const base = await serverBase();
      const r = await fetch(`${base}/api/auth/google`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential }) });
      const data = (await r.json()) as { user?: Account; token?: string; error?: string };
      if (!r.ok || !data.user) throw new Error(data.error ?? 'Sign-in failed');
      useAuth.setState({ user: data.user, token: data.token ?? null });
      write({ token: data.token, user: data.user, mode: 'server' });
    } else {
      const p = decodeJwt(credential);
      if (p.aud !== st.clientId) throw new Error('Token is for a different app');
      const user: Account = { id: String(p.sub), email: String(p.email), name: String(p.name ?? p.email), picture: typeof p.picture === 'string' ? p.picture : undefined };
      useAuth.setState({ user });
      write({ user, mode: 'static' });
    }
    window.dispatchEvent(new Event('figmy:signed-in'));
  } catch (e) {
    useAuth.setState({ error: (e as Error).message });
  } finally {
    useAuth.setState({ busy: false });
  }
}

/** Render the official "Sign in with Google" button into an element (web). */
export async function renderGoogleButton(el: HTMLElement, theme: 'light' | 'dark') {
  const { clientId } = useAuth.getState();
  if (!clientId) return;
  try {
    const g = await loadGis();
    g.accounts.id.initialize({ client_id: clientId, callback: (r: { credential: string }) => onCredential(r.credential), ux_mode: 'popup', auto_select: false, itp_support: true });
    el.innerHTML = '';
    g.accounts.id.renderButton(el, { theme: theme === 'dark' ? 'filled_black' : 'outline', size: 'large', text: 'continue_with', shape: 'pill', logo_alignment: 'left' });
  } catch (e) {
    useAuth.setState({ error: (e as Error).message });
  }
}

/** Desktop: sign in through the system browser, then pick the session up here. */
export async function desktopSignIn() {
  const base = await serverBase();
  if (!base || !desktop?.openExternal) return;
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const handoff = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  // Google only allows "localhost" (not 127.0.0.1) as a local JavaScript origin
  const loginBase = base.replace('://127.0.0.1', '://localhost');
  await desktop.openExternal(`${loginBase}/login?handoff=${handoff}`);
  useAuth.setState({ busy: true, error: null });
  const until = Date.now() + 5 * 60_000;
  while (Date.now() < until && useAuth.getState().busy) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const r = await fetch(`${base}/api/auth/handoff/${handoff}`);
      if (r.status === 200) {
        const data = (await r.json()) as { user: Account; token: string };
        useAuth.setState({ user: data.user, token: data.token, busy: false });
        write({ token: data.token, user: data.user, mode: 'server' });
        window.dispatchEvent(new Event('figmy:signed-in'));
        return;
      }
    } catch {
      /* keep polling */
    }
  }
  if (useAuth.getState().busy) useAuth.setState({ busy: false, error: 'Sign-in timed out. Try again.' });
}

export const cancelSignIn = () => useAuth.setState({ busy: false });

export async function signOut() {
  const st = useAuth.getState();
  if (st.mode === 'server') {
    const base = await serverBase();
    if (base) await fetch(`${base}/api/auth/logout`, { method: 'POST', credentials: 'include', headers: st.token ? { Authorization: `Bearer ${st.token}` } : {} }).catch(() => undefined);
  }
  window.google?.accounts.id.disableAutoSelect();
  write(null);
  useAuth.setState({ user: null, token: null });
}
