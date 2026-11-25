#!/usr/bin/env node
/**
 * Figmy server CLI.
 *   figmy-server [--port 4317] [--host 127.0.0.1] [--data ~/.figmy] [--static ./dist] [--token SECRET] [--public-url URL]
 *   figmy-server --stdio   MCP over stdio (for Claude Desktop & co). Forwards to a running server,
 *                            or starts one in the background if none is reachable.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { startServer } from './app';
import { runStdioBridge } from './stdio';
import { Backup, backupConfigFromEnv } from './backup';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.split('=').slice(1).join('=') : fallback;
}

/** Load KEY=value lines from a .env file in the working directory (variables already set win). */
function loadDotEnv(file = path.resolve(process.cwd(), '.env')) {
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || m[1] in process.env) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    process.env[m[1]] = v;
  }
}

async function main() {
  loadDotEnv();
  const port = Number(arg('port', process.env.PORT ?? '4317'));
  const host = arg('host', process.env.HOST ?? '127.0.0.1')!;
  const dataDir = arg('data', process.env.FIGMY_DATA ?? path.join(os.homedir(), '.figmy'))!;
  const token = arg('token', process.env.FIGMY_TOKEN) ?? null;
  const publicUrl = arg('public-url', process.env.PUBLIC_URL);
  let staticDir = arg('static', process.env.FIGMY_STATIC);
  if (!staticDir) {
    const guess = path.resolve(path.dirname(process.argv[1] ?? '.'), '..', 'dist');
    if (fs.existsSync(path.join(guess, 'index.html'))) staticDir = guess;
  }

  if (process.argv.includes('--stdio')) {
    await runStdioBridge({ url: process.env.FIGMY_URL ?? `http://127.0.0.1:${port}`, token, start: { port, host: '127.0.0.1', dataDir, staticDir: staticDir ?? null, token } });
    return;
  }

  if (host !== '127.0.0.1' && host !== 'localhost' && !token) {
    console.error('[figmy] WARNING: listening on a public interface without --token. Anyone who can reach this port can edit your files.');
  }
  // off-machine backup (e.g. Cloudflare R2) for hosts with ephemeral disks
  const bcfg = backupConfigFromEnv();
  let backup: Backup | null = null;
  if (bcfg) {
    backup = new Backup(bcfg, dataDir, (m) => console.error(m));
    fs.mkdirSync(dataDir, { recursive: true });
    try {
      const n = await backup.restore();
      console.error(`[figmy] restored ${n} file(s) from backup bucket ${bcfg.bucket}`);
    } catch (e) {
      console.error(`[figmy] backup restore failed: ${(e as Error).message}`);
      if (process.env.FIGMY_BACKUP_REQUIRED === '1') process.exit(1);
    }
  }
  const s = await startServer({ port, host, dataDir, staticDir: staticDir ?? null, token, publicUrl, onFileSaved: backup ? (f) => backup!.schedule(f) : undefined });
  console.error(`[figmy] server running at ${s.url}`);
  console.error(`[figmy]   editor:        ${s.url}${staticDir ? '' : '  (web app not bundled: run "npm run build" first)'}`);
  console.error(`[figmy]   MCP endpoint:  ${s.url}/mcp${token ? '  (Authorization: Bearer <token>)' : ''}`);
  console.error(`[figmy]   files stored in ${dataDir}`);
  console.error(token ? '[figmy]   access token:  required (FIGMY_TOKEN is set)' : '[figmy]   access token:  NOT set — do not expose this server through a tunnel without FIGMY_TOKEN');
  const stop = async () => {
    await s.close();
    await backup?.flush();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e: NodeJS.ErrnoException) => {
  if (e?.code === 'EADDRINUSE') {
    const port = arg('port', process.env.PORT ?? '4317');
    console.error(`\n[figmy] Port ${port} is already in use, probably by the Figmy desktop app or another Figmy server.`);
    console.error('[figmy] Close the desktop app (also check the system tray), or start on another port:  npm start -- --port 4318');
    console.error('[figmy] (If you change the port, update the Cloudflare tunnel service to http://localhost:<new port>.)\n');
  } else console.error('[figmy] failed to start:', e);
  process.exit(1);
});
