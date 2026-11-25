import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Auth } from '../../server/auth';
import { startServer, type RunningServer } from '../../server/app';

/** A throwaway RSA key standing in for Google's signing key. */
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const kid = 'test-key';
const jwk = { ...(publicKey.export({ format: 'jwk' }) as Record<string, string>), kid, alg: 'RS256', use: 'sig' };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'figmy-auth-'));
const jwksFile = path.join(dir, 'jwks.json');
fs.writeFileSync(jwksFile, JSON.stringify({ keys: [jwk] }));
const CLIENT = 'test-client.apps.googleusercontent.com';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function idToken(claims: Record<string, unknown>, key: crypto.KeyObject = privateKey, headerKid = kid) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: 'https://accounts.google.com', aud: CLIENT, sub: '1234', email: 'ana@example.com', email_verified: true, name: 'Ana', iat: now, exp: now + 3600, ...claims };
  const head = b64({ alg: 'RS256', kid: headerKid, typ: 'JWT' });
  const body = b64(payload);
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url');
  return `${head}.${body}.${sig}`;
}

const auth = (extra: Partial<ConstructorParameters<typeof Auth>[0]> = {}) => new Auth({ googleClientId: CLIENT, required: false, allowedDomains: [], allowedEmails: [], jwksFile, ...extra }, null);

describe('Google ID token verification', () => {
  it('accepts a valid token', async () => {
    const u = await auth().verifyIdToken(idToken({}));
    expect(u).toMatchObject({ id: '1234', email: 'ana@example.com', name: 'Ana' });
  });

  it.each([
    ['wrong audience', { aud: 'someone-else' }, /different app/],
    ['wrong issuer', { iss: 'https://evil.example' }, /not issued by Google/],
    ['expired', { exp: Math.floor(Date.now() / 1000) - 3600 }, /expired/],
    ['unverified email', { email_verified: false }, /not verified/],
  ])('rejects %s', async (_n, claims, err) => {
    await expect(auth().verifyIdToken(idToken(claims))).rejects.toThrow(err);
  });

  it('rejects forged signatures and unknown keys', async () => {
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    await expect(auth().verifyIdToken(idToken({}, other))).rejects.toThrow(/signature/);
    await expect(auth().verifyIdToken(idToken({}, privateKey, 'nope'))).rejects.toThrow(/signing key/);
    const t = idToken({}).split('.');
    const tampered = [t[0], b64({ ...JSON.parse(Buffer.from(t[1], 'base64url').toString()), email: 'admin@example.com' }), t[2]].join('.');
    await expect(auth().verifyIdToken(tampered)).rejects.toThrow(/signature/);
    await expect(auth().verifyIdToken('not.a.jwt.at.all')).rejects.toThrow();
  });

  it('enforces allowed domains / emails', async () => {
    const a = auth({ allowedDomains: ['corp.com'], allowedEmails: ['ana@example.com'] });
    await expect(a.verifyIdToken(idToken({}))).resolves.toBeTruthy();
    await expect(a.verifyIdToken(idToken({ email: 'bob@corp.com' }))).resolves.toBeTruthy();
    await expect(a.verifyIdToken(idToken({ email: 'eve@gmail.com' }))).rejects.toThrow(/not allowed/);
  });

  it('issues, looks up and destroys sessions; hand-offs are one-time', () => {
    const a = auth();
    const s = a.createSession({ id: '1', email: 'a@b.c', name: 'A' });
    expect(a.session(s.token)?.user.email).toBe('a@b.c');
    a.handoffComplete('h'.repeat(32), s);
    expect(a.takeHandoff('h'.repeat(32))?.token).toBe(s.token);
    expect(a.takeHandoff('h'.repeat(32))).toBeNull();
    a.destroy(s.token);
    expect(a.session(s.token)).toBeNull();
  });
});

describe('server sign-in endpoints', () => {
  let srv: RunningServer;
  beforeAll(async () => {
    srv = await startServer({ port: 0, dataDir: dir, auth: { googleClientId: CLIENT, required: true, allowedDomains: [], allowedEmails: [], jwksFile }, log: () => undefined });
  });
  afterAll(() => srv.close());

  it('gates the API when login is required and lets a signed-in session through', async () => {
    const cfg = await (await fetch(`${srv.url}/api/auth/config`)).json();
    expect(cfg).toEqual({ googleClientId: CLIENT, required: true, allowedDomains: [] });
    expect((await fetch(`${srv.url}/api/rooms`)).status).toBe(401);
    expect((await fetch(`${srv.url}/mcp`, { method: 'POST', body: '{}' })).status).toBe(401);

    const bad = await fetch(`${srv.url}/api/auth/google`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: idToken({ aud: 'x' }) }) });
    expect(bad.status).toBe(401);

    const r = await fetch(`${srv.url}/api/auth/google`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: idToken({}), handoff: 'k'.repeat(32) }) });
    expect(r.status).toBe(200);
    const cookie = r.headers.get('set-cookie')!;
    expect(cookie).toMatch(/figmy_session=.+HttpOnly; SameSite=Lax/);
    const { token, user } = await r.json();
    expect(user.email).toBe('ana@example.com');

    // bearer and cookie both work
    expect((await fetch(`${srv.url}/api/rooms`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
    const me = await fetch(`${srv.url}/api/auth/me`, { headers: { Cookie: cookie.split(';')[0] } });
    expect((await me.json()).user.name).toBe('Ana');

    // desktop hand-off pickup, once
    const h1 = await fetch(`${srv.url}/api/auth/handoff/${'k'.repeat(32)}`);
    expect(h1.status).toBe(200);
    expect((await h1.json()).token).toBe(token);
    expect((await fetch(`${srv.url}/api/auth/handoff/${'k'.repeat(32)}`)).status).toBe(202);

    // login page for the system-browser flow
    const page = await (await fetch(`${srv.url}/login?handoff=${'k'.repeat(32)}`)).text();
    expect(page).toContain(CLIENT);
    expect(page).toContain('accounts.google.com/gsi/client');

    // sign out
    await fetch(`${srv.url}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    expect((await fetch(`${srv.url}/api/rooms`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
  });

  it('sessions survive a server restart', async () => {
    const r = await fetch(`${srv.url}/api/auth/google`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: idToken({ sub: '99', email: 'kept@example.com' }) }) });
    const { token } = await r.json();
    await new Promise((res) => setTimeout(res, 100)); // async write of sessions.json
    const again = new Auth({ googleClientId: CLIENT, required: true, allowedDomains: [], allowedEmails: [], jwksFile }, dir);
    expect(again.session(token)?.user.email).toBe('kept@example.com');
  });
});
