// E2E: Google sign-in gate. Starts its own server that requires login and trusts a test signing key
// (FIGMY_GOOGLE_JWKS_FILE), so a real browser session can be created without talking to Google.
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../..');
const port = process.env.E2E_AUTH_PORT || '4392';
const url = `http://127.0.0.1:${port}`;
const CLIENT = 'e2e-client.apps.googleusercontent.com';
const assert = (c, m) => {
  if (!c) {
    console.error('FAIL:', m);
    process.exitCode = 1;
  } else console.log('ok -', m);
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'figmy-e2e-auth-'));
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
fs.writeFileSync(path.join(dir, 'jwks.json'), JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' }] }));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (claims = {}) => {
  const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: 'RS256', kid: 'k1' });
  const p = b64({ iss: 'https://accounts.google.com', aud: CLIENT, sub: '42', email: 'ana@example.com', email_verified: true, name: 'Ana Lima', iat: now, exp: now + 3600, ...claims });
  return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url')}`;
};

const server = spawn(process.execPath, ['server-dist/server.cjs', '--port', port, '--data', path.join(dir, 'data'), '--static', 'dist'], {
  cwd: root,
  stdio: ['ignore', 'ignore', 'inherit'],
  env: { ...process.env, FIGMY_GOOGLE_CLIENT_ID: CLIENT, FIGMY_REQUIRE_LOGIN: '1', FIGMY_GOOGLE_JWKS_FILE: path.join(dir, 'jwks.json'), FIGMY_ALLOWED_DOMAINS: 'example.com' },
});

(async () => {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) break;
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    // the Google script itself isn't needed (or reachable) in CI
    await p.route('https://accounts.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.google={accounts:{id:{initialize(){},renderButton(el){el.innerHTML="<button id=fake-gis>Continue with Google</button>"},disableAutoSelect(){}}}}' }));
    await p.goto(url);
    await p.waitForSelector('text=Sign in to Figmy');
    assert(await p.isVisible('#fake-gis'), 'login screen with Google button is shown when sign-in is required');
    assert(!(await p.isVisible('text=New design file')), 'editor is hidden until signed in');

    // a disallowed domain is rejected by the server
    const denied = await fetch(`${url}/api/auth/google`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: idToken({ email: 'eve@gmail.com' }) }) });
    assert(denied.status === 401 && /not allowed/.test((await denied.json()).error), 'accounts outside the allowed domain are refused');

    // simulate the Google callback in the page (same code path as a real sign-in)
    const result = await p.evaluate(async (cred) => {
      const r = await fetch('/api/auth/google', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: cred }) });
      return r.json();
    }, idToken());
    assert(result.user?.email === 'ana@example.com', 'server verifies the ID token and creates a session');
    await p.reload();
    await p.waitForSelector('text=New design file');
    assert(await p.isVisible('text=Ana Lima'), 'after sign-in the home screen shows the Google account');

    // collaboration uses the Google name
    await p.click('text=New design file');
    await p.waitForSelector('.live-dot.live', { timeout: 8000 });
    const me = await p.evaluate(() => document.querySelector('.avatars .avatar.me')?.getAttribute('title'));
    assert(/Ana Lima/.test(me || ''), `collaboration presence uses the Google name (${me})`);

    // sign out → gate returns
    await p.click('.account.compact .account-btn');
    await p.click('text=Sign out');
    await p.reload();
    await p.waitForSelector('text=Sign in to Figmy');
    assert(true, 'signing out returns to the login screen');
    assert((await fetch(`${url}/api/rooms`)).status === 401, 'API stays locked without a session');
    assert(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  } finally {
    await b.close();
    server.kill();
  }
})().catch((e) => {
  console.error('FAIL', e);
  server.kill();
  process.exit(1);
});
