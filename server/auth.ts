/**
 * Google sign-in (OpenID Connect ID tokens from "Sign in with Google") + server sessions.
 *
 * The browser obtains a Google-signed ID token; we verify its RS256 signature against Google's
 * published keys, check issuer/audience/expiry/email verification and the optional allow-lists,
 * then issue an opaque session token (HttpOnly cookie for same-origin web, bearer for desktop /
 * cross-origin clients). No client secret is required.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface AuthConfig {
  /** OAuth 2.0 Web client ID from Google Cloud Console. Sign-in is disabled without it. */
  googleClientId: string | null;
  /** Require a signed-in user for the editor's API, collaboration and MCP (static token still works). */
  required: boolean;
  /** Only these email domains may sign in (e.g. ["example.com"]). Empty = any verified Google account. */
  allowedDomains: string[];
  /** Only these exact emails may sign in. Combined with domains as OR. */
  allowedEmails: string[];
  /** Where Google's signing keys come from (overridable for tests / offline). */
  jwksUrl?: string;
  jwksFile?: string;
  sessionDays?: number;
}

export interface User {
  id: string; // Google "sub"
  email: string;
  name: string;
  picture?: string;
  domain?: string;
}

interface Session {
  token: string;
  user: User;
  expiresAt: number;
}

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const COOKIE = 'figmy_session';

export function authConfigFromEnv(env = process.env): AuthConfig {
  const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return {
    googleClientId: env.FIGMY_GOOGLE_CLIENT_ID?.trim() || null,
    required: env.FIGMY_REQUIRE_LOGIN === '1' || env.FIGMY_REQUIRE_LOGIN === 'true',
    allowedDomains: list(env.FIGMY_ALLOWED_DOMAINS),
    allowedEmails: list(env.FIGMY_ALLOWED_EMAILS),
    jwksFile: env.FIGMY_GOOGLE_JWKS_FILE || undefined,
  };
}

const b64urlDecode = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export class Auth {
  private sessions = new Map<string, Session>();
  private handoffs = new Map<string, { session?: Session; expiresAt: number }>();
  private keys: { jwks: Jwk[]; fetchedAt: number; maxAge: number } | null = null;
  private file: string | null;
  onSaved: ((file: string) => void) | null = null;

  constructor(
    public config: AuthConfig,
    dataDir: string | null,
  ) {
    this.file = dataDir ? path.join(dataDir, 'sessions.json') : null;
    if (this.file && fs.existsSync(this.file)) {
      try {
        for (const s of JSON.parse(fs.readFileSync(this.file, 'utf8')) as Session[]) if (s.expiresAt > Date.now()) this.sessions.set(hash(s.token), s);
      } catch {
        /* corrupt file: start fresh */
      }
    }
  }

  get enabled() {
    return !!this.config.googleClientId;
  }

  publicConfig() {
    return { googleClientId: this.config.googleClientId, required: this.enabled && this.config.required, allowedDomains: this.config.allowedDomains };
  }

  /* ---------- Google ID token verification ---------- */

  private async jwks(force = false): Promise<Jwk[]> {
    if (this.config.jwksFile) return JSON.parse(fs.readFileSync(this.config.jwksFile, 'utf8')).keys;
    if (!force && this.keys && Date.now() - this.keys.fetchedAt < this.keys.maxAge) return this.keys.jwks;
    const r = await fetch(this.config.jwksUrl ?? 'https://www.googleapis.com/oauth2/v3/certs');
    if (!r.ok) throw new Error(`Could not fetch Google signing keys (${r.status})`);
    const maxAge = Number(/max-age=(\d+)/.exec(r.headers.get('cache-control') ?? '')?.[1] ?? 3600) * 1000;
    this.keys = { jwks: ((await r.json()) as { keys: Jwk[] }).keys, fetchedAt: Date.now(), maxAge };
    return this.keys.jwks;
  }

  /** Verify a Google ID token and return the user it identifies. Throws with a readable reason. */
  async verifyIdToken(credential: string): Promise<User> {
    if (!this.config.googleClientId) throw new Error('Google sign-in is not configured on this server');
    const parts = credential.split('.');
    if (parts.length !== 3) throw new Error('Malformed ID token');
    const header = JSON.parse(b64urlDecode(parts[0]).toString('utf8')) as { alg: string; kid: string };
    if (header.alg !== 'RS256') throw new Error('Unexpected token algorithm');
    let key = (await this.jwks()).find((k) => k.kid === header.kid);
    if (!key) key = (await this.jwks(true)).find((k) => k.kid === header.kid); // keys rotate
    if (!key) throw new Error('Unknown signing key');
    const pub = crypto.createPublicKey({ key: { kty: key.kty, n: key.n, e: key.e }, format: 'jwk' });
    const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), pub, b64urlDecode(parts[2]));
    if (!ok) throw new Error('Invalid token signature');
    const p = JSON.parse(b64urlDecode(parts[1]).toString('utf8')) as Record<string, unknown>;
    const now = Math.floor(Date.now() / 1000);
    if (!GOOGLE_ISSUERS.includes(String(p.iss))) throw new Error('Token was not issued by Google');
    const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
    if (!aud.includes(this.config.googleClientId)) throw new Error('Token is for a different app');
    if (typeof p.exp !== 'number' || p.exp < now - 60) throw new Error('Token has expired — sign in again');
    if (typeof p.iat === 'number' && p.iat > now + 300) throw new Error('Token issued in the future');
    const email = String(p.email ?? '').toLowerCase();
    if (!email || (p.email_verified !== true && p.email_verified !== 'true')) throw new Error('Google account email is not verified');
    const domain = email.split('@')[1];
    const { allowedDomains, allowedEmails } = this.config;
    if ((allowedDomains.length || allowedEmails.length) && !allowedEmails.includes(email) && !allowedDomains.includes(domain) && !(typeof p.hd === 'string' && allowedDomains.includes(p.hd.toLowerCase())))
      throw new Error(`${email} is not allowed to sign in to this Figmy server`);
    return { id: String(p.sub), email, name: String(p.name ?? email.split('@')[0]), picture: typeof p.picture === 'string' ? p.picture : undefined, domain: typeof p.hd === 'string' ? p.hd : undefined };
  }

  /* ---------- sessions ---------- */

  createSession(user: User): Session {
    const token = crypto.randomBytes(32).toString('base64url');
    const s: Session = { token, user, expiresAt: Date.now() + (this.config.sessionDays ?? 30) * 86400_000 };
    this.sessions.set(hash(token), s);
    this.persist();
    return s;
  }

  session(token: string | null | undefined): Session | null {
    if (!token) return null;
    const s = this.sessions.get(hash(token));
    if (!s) return null;
    if (s.expiresAt < Date.now()) {
      this.sessions.delete(hash(token));
      this.persist();
      return null;
    }
    return s;
  }

  destroy(token: string | null | undefined) {
    if (token && this.sessions.delete(hash(token))) this.persist();
  }

  private persist() {
    if (!this.file) return;
    // tokens are stored as-is so restarts keep people signed in; the file lives in the private data dir
    const list = [...this.sessions.values()].filter((s) => s.expiresAt > Date.now());
    const f = this.file;
    fs.writeFile(f, JSON.stringify(list), { mode: 0o600 }, (e) => !e && this.onSaved?.(f));
  }

  /* ---------- desktop hand-off (sign in in the system browser, pick up in the app) ---------- */

  handoffComplete(id: string, session: Session) {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(id)) return;
    this.handoffs.set(id, { session, expiresAt: Date.now() + 5 * 60_000 });
  }

  /** One-time pickup: returns the session once, then forgets it. */
  takeHandoff(id: string): Session | null {
    for (const [k, v] of this.handoffs) if (v.expiresAt < Date.now()) this.handoffs.delete(k);
    const h = this.handoffs.get(id);
    if (!h?.session) return null;
    this.handoffs.delete(id);
    return h.session;
  }

  /* ---------- request helpers ---------- */

  tokenFrom(headers: { authorization?: string; cookie?: string }, url?: URL): string | null {
    const h = headers.authorization;
    if (h?.startsWith('Bearer ')) return h.slice(7);
    const c = parseCookies(headers.cookie)[COOKIE];
    if (c) return c;
    return url?.searchParams.get('session') ?? url?.searchParams.get('token') ?? null;
  }

  cookie(token: string, secure: boolean, maxAgeSec: number) {
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
  }

  clearCookie(secure: boolean) {
    return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
  }
}

const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Minimal standalone page used by the desktop app: sign in with Google in the system browser. */
export function loginPage(clientId: string, handoff: string | null): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in to Figmy</title>
<style>body{font:15px Inter,system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f5f5f7;color:#1d1d22}
.card{background:#fff;padding:32px 36px;border-radius:14px;box-shadow:0 8px 28px rgba(20,20,40,.12);text-align:center;max-width:360px}
h1{font-size:20px;margin:12px 0 6px} p{color:#6b6b78} .err{color:#e5484d} #btn{display:flex;justify-content:center;margin-top:18px}</style>
<script src="https://accounts.google.com/gsi/client" async defer></script></head>
<body><div class="card"><img src="/icon.svg" width="44" height="44" alt="" onerror="this.remove()"><h1>Sign in to Figmy</h1>
<p id="msg">Continue with your Google account.</p><div id="btn"></div></div>
<script>
var handoff = ${handoff ? `"${esc(handoff)}"` : 'null'};
function done(r){ var m=document.getElementById('msg'); document.getElementById('btn').remove();
  m.textContent = r.error ? r.error : 'Signed in as ' + r.user.email + '. You can close this tab and return to Figmy.'; if(r.error) m.className='err';
  if(!r.error && !handoff) setTimeout(function(){ location.href='/'; }, 800); }
function onCredential(resp){
  fetch('/api/auth/google',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({credential:resp.credential,handoff:handoff})})
   .then(function(r){return r.json();}).then(done).catch(function(e){done({error:String(e)});});
}
window.onload=function(){ google.accounts.id.initialize({client_id:"${esc(clientId)}",callback:onCredential,ux_mode:'popup'});
  google.accounts.id.renderButton(document.getElementById('btn'),{theme:'outline',size:'large',text:'continue_with',shape:'pill'}); };
</script></body></html>`;
}
