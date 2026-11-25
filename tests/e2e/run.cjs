// Starts a throwaway Figmy server (data in the OS temp folder) and runs every end-to-end suite against it.
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const port = process.env.E2E_PORT || '4390';
const url = `http://127.0.0.1:${port}`;
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'figmy-e2e-'));
const server = spawn(process.execPath, ['server-dist/server.cjs', '--port', port, '--data', data, '--static', 'dist'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
const env = { ...process.env, FIGMY_URL: url };

(async () => {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  let failed = false;
  for (const suite of ['tests/e2e/ui.cjs', 'tests/e2e/variants.cjs', 'tests/e2e/collab-mcp.cjs', 'tests/e2e/stdio.mjs', 'tests/e2e/auth.cjs']) {
    console.log(`\n▶ ${suite}`);
    const r = spawnSync(process.execPath, [suite], { cwd: root, env, stdio: 'inherit', timeout: 180000 });
    if (r.status !== 0) failed = true;
  }
  server.kill();
  console.log(failed ? '\nE2E FAILED' : '\nE2E PASSED');
  process.exit(failed ? 1 : 0);
})();
