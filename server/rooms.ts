import fs from 'node:fs';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { produce, setAutoFreeze } from 'immer';
import type { DocumentData } from '../src/types';
import { applyPatch, diffDocs, repairDocument, type DocPatch } from '../src/lib/docops';
import { emptyDocument } from '../src/lib/factory';

setAutoFreeze(false);

export interface Presence {
  cursor?: { x: number; y: number } | null;
  selection?: string[];
  pageId?: string;
  viewport?: { x: number; y: number; zoom: number };
}

export interface Peer {
  id: string;
  name: string;
  color: string;
  kind: 'human' | 'ai';
  presence: Presence;
}

interface Client {
  ws: WebSocket;
  peer: Peer;
}

export interface Room {
  id: string;
  doc: DocumentData;
  clients: Map<string, Client>;
  aiPeer: Peer | null;
  saveTimer: NodeJS.Timeout | null;
  updatedAt: number;
}

const ROOM_ID = /^[a-zA-Z0-9_-]{1,64}$/;
export const validRoomId = (id: string) => ROOM_ID.test(id);

export class RoomManager {
  rooms = new Map<string, Room>();
  constructor(private dataDir: string | null) {
    if (dataDir) fs.mkdirSync(path.join(dataDir, 'rooms'), { recursive: true });
  }

  private file(id: string) {
    return this.dataDir ? path.join(this.dataDir, 'rooms', `${id}.json`) : null;
  }

  /** Get a room, loading it from disk if needed. `seed` creates it when missing. */
  get(id: string, seed?: DocumentData): Room | null {
    if (!validRoomId(id)) return null;
    let room = this.rooms.get(id);
    if (room) return room;
    let doc: DocumentData | null = null;
    const f = this.file(id);
    if (f && fs.existsSync(f)) {
      try {
        doc = JSON.parse(fs.readFileSync(f, 'utf8'));
      } catch {
        doc = null;
      }
    }
    if (!doc && seed) doc = seed;
    if (!doc) return null;
    room = { id, doc: repairDocument(doc), clients: new Map(), aiPeer: null, saveTimer: null, updatedAt: Date.now() };
    this.rooms.set(id, room);
    if (!f || !fs.existsSync(f)) this.scheduleSave(room);
    return room;
  }

  create(id: string, name: string): Room {
    const doc = emptyDocument(name);
    return this.get(id, doc)!;
  }

  list(): { id: string; name: string; pages: number; nodes: number; online: number; updatedAt: number }[] {
    const ids = new Set(this.rooms.keys());
    const dir = this.dataDir ? path.join(this.dataDir, 'rooms') : null;
    if (dir && fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) ids.add(f.slice(0, -5));
    const out = [];
    for (const id of ids) {
      const r = this.get(id);
      if (!r) continue;
      out.push({ id, name: r.doc.name, pages: r.doc.pages.length, nodes: Object.keys(r.doc.nodes).length, online: r.clients.size, updatedAt: r.updatedAt });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private scheduleSave(room: Room) {
    const f = this.file(room.id);
    if (!f) return;
    if (room.saveTimer) clearTimeout(room.saveTimer);
    room.saveTimer = setTimeout(() => {
      room.saveTimer = null;
      const tmp = f + '.tmp';
      fs.writeFile(tmp, JSON.stringify(room.doc), (err) => {
        if (!err) fs.rename(tmp, f, () => undefined);
      });
    }, 800);
  }

  flushAll() {
    for (const room of this.rooms.values()) {
      const f = this.file(room.id);
      if (room.saveTimer && f) {
        clearTimeout(room.saveTimer);
        fs.writeFileSync(f, JSON.stringify(room.doc));
      }
    }
  }

  /** Apply a patch from a client and fan it out to everyone else. */
  applyClientPatch(room: Room, fromId: string, patch: DocPatch) {
    room.doc = repairDocument(applyPatch(room.doc, patch));
    room.updatedAt = Date.now();
    this.broadcast(room, { type: 'patch', patch, from: fromId }, fromId);
    this.scheduleSave(room);
  }

  /**
   * Server-side edit (MCP tools). Runs `fn` on an immer draft, broadcasts the resulting patch
   * to every client and returns whatever `fn` returned.
   */
  edit<T>(room: Room, fn: (d: DocumentData) => T): T {
    let result!: T;
    const next = produce(room.doc, (d) => {
      result = fn(d as DocumentData);
    });
    const fixed = repairDocument(next);
    const patch = diffDocs(room.doc, fixed);
    room.doc = fixed;
    room.updatedAt = Date.now();
    if (patch) {
      this.broadcast(room, { type: 'patch', patch, from: 'ai' });
      this.scheduleSave(room);
    }
    return result;
  }

  /** Show the AI as a collaborator with a cursor/selection on what it just touched. */
  aiPresence(room: Room, presence: Presence, name = 'AI assistant') {
    room.aiPeer = { id: 'ai', name, color: '#9747ff', kind: 'ai', presence: { ...(room.aiPeer?.presence ?? {}), ...presence } };
    this.broadcast(room, { type: 'presence', peer: room.aiPeer });
  }

  join(room: Room, ws: WebSocket, peer: Peer) {
    room.clients.set(peer.id, { ws, peer });
    const peers = [...room.clients.values()].filter((c) => c.peer.id !== peer.id).map((c) => c.peer);
    if (room.aiPeer) peers.push(room.aiPeer);
    send(ws, { type: 'welcome', clientId: peer.id, doc: room.doc, peers });
    this.broadcast(room, { type: 'peer-join', peer }, peer.id);
  }

  leave(room: Room, id: string) {
    room.clients.delete(id);
    this.broadcast(room, { type: 'peer-leave', id });
  }

  presence(room: Room, id: string, presence: Presence) {
    const c = room.clients.get(id);
    if (!c) return;
    const p = presence as Presence & { name?: string; color?: string };
    if (typeof p.name === 'string' && p.name.trim()) c.peer.name = p.name.slice(0, 40);
    if (typeof p.color === 'string' && /^#[0-9a-f]{6}$/i.test(p.color)) c.peer.color = p.color;
    c.peer.presence = { cursor: p.cursor ?? null, selection: Array.isArray(p.selection) ? p.selection.slice(0, 500) : [], pageId: p.pageId, viewport: p.viewport };
    this.broadcast(room, { type: 'presence', peer: c.peer }, id);
  }

  broadcast(room: Room, msg: unknown, exceptId?: string) {
    const data = JSON.stringify(msg);
    for (const [id, c] of room.clients) if (id !== exceptId && c.ws.readyState === 1) c.ws.send(data);
  }
}

export function send(ws: WebSocket, msg: unknown) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
