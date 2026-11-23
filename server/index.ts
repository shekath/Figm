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

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.split('=').slice(1).join('=') : fallback;
}

async function main() {
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
  const s = await startServer({ port, host, dataDir, staticDir: staticDir ?? null, token, publicUrl });
  console.error(`[figmy] server running at ${s.url}`);
  console.error(`[figmy]   editor:        ${s.url}${staticDir ? '' : '  (web app not bundled: run "npm run build" first)'}`);
  console.error(`[figmy]   MCP endpoint:  ${s.url}/mcp${token ? '  (Authorization: Bearer <token>)' : ''}`);
  console.error(`[figmy]   files stored in ${dataDir}`);
  const stop = async () => {
    await s.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => {
  console.error('[figmy] failed to start:', e);
  process.exit(1);
});
