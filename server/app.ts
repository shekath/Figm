/**
 * Vectura server: real-time collaboration (WebSocket), MCP connector for AI assistants,
 * REST tool API, Figma REST proxy and (optionally) the built web app.
 */
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { RoomManager, send, validRoomId, type Peer, type Presence } from './rooms';
import { callTool, toolList, type ToolContext } from './tools';
import { handleMcpHttp } from './mcp';
import type { DocPatch } from '../src/lib/docops';
import type { DocumentData } from '../src/types';

export interface ServerOptions {
  port?: number;
  host?: string;
  dataDir?: string | null;
  staticDir?: string | null;
  token?: string | null;
  publicUrl?: string;
  log?: (msg: string) => void;
}

export interface RunningServer {
  url: string;
  port: number;
  rooms: RoomManager;
  close: () => Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const MAX_BODY = 50 * 1024 * 1024;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const log = opts.log ?? ((m: string) => console.error(m));
  const rooms = new RoomManager(opts.dataDir ?? null);
  const host = opts.host ?? '127.0.0.1';
  const token = opts.token || null;
  const ctx: ToolContext = { rooms, publicUrl: '' };

  const authorized = (req: IncomingMessage, url: URL) => {
    if (!token) return true;
    const h = req.headers.authorization;
    const bearer = h?.startsWith('Bearer ') ? h.slice(7) : null;
    const q = url.searchParams.get('token');
    return (!!bearer && safeEqual(bearer, token)) || (!!q && safeEqual(q, token));
  };

  const cors = (req: IncomingMessage, res: ServerResponse) => {
    // The API is token-protected when exposed; allow browser clients (web app on another origin, MCP inspectors).
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Figma-Token, Mcp-Session-Id, Mcp-Protocol-Version, Accept');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    cors(req, res);
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    try {
      if (url.pathname === '/api/health') return json(res, 200, { app: 'vectura', version: '1.1.0', auth: !!token, mcp: '/mcp' });

      if (url.pathname.startsWith('/api/') || url.pathname === '/mcp') {
        if (!authorized(req, url)) return json(res, 401, { error: 'Unauthorized: pass Authorization: Bearer <token>' });
      }

      if (url.pathname === '/mcp') {
        const raw = req.method === 'POST' ? await readBody(req) : '';
        let body: unknown;
        try {
          body = raw ? JSON.parse(raw) : undefined;
        } catch {
          return json(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
        }
        return await handleMcpHttp(req, res, body, ctx);
      }

      if (url.pathname === '/api/rooms' && req.method === 'GET') return json(res, 200, { rooms: rooms.list() });
      if (url.pathname === '/api/tools' && req.method === 'GET') return json(res, 200, { tools: toolList() });
      const tm = url.pathname.match(/^\/api\/tools\/([a-z_]+)$/);
      if (tm && req.method === 'POST') {
        const raw = await readBody(req);
        try {
          const result = await callTool(tm[1], raw ? JSON.parse(raw) : {}, ctx);
          return json(res, 200, { result });
        } catch (e) {
          return json(res, 400, { error: (e as Error).message });
        }
      }

      // Figma REST proxy (GET only, token forwarded from the client)
      if (url.pathname.startsWith('/api/figma/v1/') && req.method === 'GET') {
        const ft = req.headers['x-figma-token'];
        if (typeof ft !== 'string' || !ft) return json(res, 400, { error: 'Missing X-Figma-Token' });
        const target = `https://api.figma.com${url.pathname.slice('/api/figma'.length)}${url.search}`;
        const r = await fetch(target, { headers: { 'X-Figma-Token': ft } });
        res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') ?? 'application/json' });
        return res.end(Buffer.from(await r.arrayBuffer()));
      }
      // Image fetch proxy limited to Figma's image CDN hosts (avoids an open proxy)
      if (url.pathname === '/api/fetch-image' && req.method === 'GET') {
        const target = url.searchParams.get('url') ?? '';
        let u: URL;
        try {
          u = new URL(target);
        } catch {
          return json(res, 400, { error: 'Bad url' });
        }
        const okHost = u.protocol === 'https:' && (/\.amazonaws\.com$/.test(u.hostname) || /(^|\.)figma\.com$/.test(u.hostname) || /\.figma\.net$/.test(u.hostname));
        if (!okHost) return json(res, 403, { error: 'Host not allowed' });
        const r = await fetch(u);
        const ct = r.headers.get('content-type') ?? '';
        if (!r.ok || !ct.startsWith('image/')) return json(res, 502, { error: 'Not an image' });
        res.writeHead(200, { 'Content-Type': ct });
        return res.end(Buffer.from(await r.arrayBuffer()));
      }

      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });

      // static web app
      if (opts.staticDir && (req.method === 'GET' || req.method === 'HEAD')) {
        const root = path.resolve(opts.staticDir);
        let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
        if (!file.startsWith(root)) return json(res, 403, { error: 'Forbidden' });
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
        if (!fs.existsSync(file)) return json(res, 404, { error: 'Not found' });
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable' });
        return fs.createReadStream(file).pipe(res);
      }
      json(res, 404, { error: 'Not found' });
    } catch (e) {
      log(`[vectura] ${req.method} ${url.pathname} failed: ${(e as Error).message}`);
      if (!res.headersSent) json(res, 500, { error: 'Internal error' });
      else res.end();
    }
  });

  /* ---------- WebSocket collaboration ---------- */
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/collab' || !authorized(req, url)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws));
  });

  const onConnection = (ws: WebSocket) => {
    let roomId: string | null = null;
    let clientId: string | null = null;
    const alive = { ok: true };
    ws.on('pong', () => (alive.ok = true));
    ws.on('message', (raw) => {
      let msg: { type: string; [k: string]: unknown };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === 'hello') {
        const id = String(msg.room ?? '');
        if (!validRoomId(id)) return send(ws, { type: 'error', message: 'Invalid room id' });
        const seed = msg.doc && typeof msg.doc === 'object' ? (msg.doc as DocumentData) : undefined;
        const room = rooms.get(id, seed);
        if (!room) return send(ws, { type: 'error', message: 'Room not found' });
        const user = (msg.user ?? {}) as { name?: string; color?: string };
        clientId = crypto.randomUUID();
        roomId = id;
        const peer: Peer = { id: clientId, name: String(user.name ?? 'Guest').slice(0, 40), color: /^#[0-9a-f]{6}$/i.test(String(user.color)) ? String(user.color) : '#0d99ff', kind: 'human', presence: {} };
        rooms.join(room, ws, peer);
        log(`[vectura] ${peer.name} joined ${id} (${room.clients.size} online)`);
        return;
      }
      if (!roomId || !clientId) return;
      const room = rooms.get(roomId);
      if (!room) return;
      if (msg.type === 'patch' && msg.patch && typeof msg.patch === 'object') {
        rooms.applyClientPatch(room, clientId, msg.patch as DocPatch);
        send(ws, { type: 'ack', id: msg.id });
      } else if (msg.type === 'presence') rooms.presence(room, clientId, (msg.presence ?? {}) as Presence);
      else if (msg.type === 'replace' && msg.doc) {
        // full document replace (e.g. "restore version") — treated as one big patch
        const doc = msg.doc as DocumentData;
        const patch: DocPatch = { nodes: { ...Object.fromEntries(Object.keys(room.doc.nodes).map((k) => [k, null])), ...doc.nodes }, pages: doc.pages, meta: { name: doc.name, variables: doc.variables, colorStyles: doc.colorStyles, textStyles: doc.textStyles, effectStyles: doc.effectStyles, comments: doc.comments } };
        rooms.applyClientPatch(room, clientId, patch);
        send(ws, { type: 'ack', id: msg.id });
      }
    });
    ws.on('close', () => {
      if (roomId && clientId) {
        const room = rooms.get(roomId);
        if (room) rooms.leave(room, clientId);
      }
    });
    const ping = setInterval(() => {
      if (!alive.ok) return ws.terminate();
      alive.ok = false;
      ws.ping();
    }, 25000);
    ws.on('close', () => clearInterval(ping));
  };

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 4317, host, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : opts.port ?? 4317;
      const shownHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
      const url = `http://${shownHost}:${port}`;
      ctx.publicUrl = (opts.publicUrl ?? url).replace(/\/$/, '');
      resolve({
        url,
        port,
        rooms,
        close: () =>
          new Promise<void>((r) => {
            rooms.flushAll();
            for (const c of wss.clients) c.terminate();
            wss.close();
            server.close(() => r());
          }),
      });
    });
  });
}
