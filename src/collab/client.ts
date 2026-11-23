/**
 * Real-time collaboration client.
 * Node-level last-writer-wins with server ordering: local patches are applied optimistically,
 * remote patches skip keys that still have unacknowledged local changes, so all clients converge.
 */
import { create } from 'zustand';
import { useEditor, onLocalPatch, markRemote } from '../store/store';
import { applyPatchInPlace, mergePatches, repairDocument, type DocPatch } from '../lib/docops';
import type { DocumentData } from '../types';
import { authToken, serverBase } from './config';

export interface PeerPresence {
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
  presence: PeerPresence;
}

type Status = 'offline' | 'connecting' | 'live' | 'reconnecting' | 'error';

interface CollabState {
  status: Status;
  error: string | null;
  room: string | null;
  base: string | null;
  peers: Record<string, Peer>;
  me: { name: string; color: string };
  following: string | null;
  setMe: (me: Partial<{ name: string; color: string }>) => void;
}

const COLORS = ['#f24822', '#0fa958', '#9747ff', '#ff8a00', '#0d99ff', '#e5258c', '#14b8a6', '#d97706'];
const loadMe = () => {
  try {
    const raw = localStorage.getItem('vectura:me');
    if (raw) return JSON.parse(raw) as { name: string; color: string };
  } catch {
    /* ignore */
  }
  return { name: 'Guest ' + Math.floor(Math.random() * 900 + 100), color: COLORS[Math.floor(Math.random() * COLORS.length)] };
};

export const useCollab = create<CollabState>((set, get) => ({
  status: 'offline',
  error: null,
  room: null,
  base: null,
  peers: {},
  me: loadMe(),
  following: null,
  setMe: (p) => {
    const me = { ...get().me, ...p };
    set({ me });
    try {
      localStorage.setItem('vectura:me', JSON.stringify(me));
    } catch {
      /* ignore */
    }
    client?.sendPresence(true);
  },
}));

class CollabClient {
  private ws: WebSocket | null = null;
  private pending: { id: number; patch: DocPatch }[] = [];
  private outgoing: DocPatch | null = null;
  private seq = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private retry = 0;
  private closed = false;
  private unsubs: (() => void)[] = [];
  private cursor: { x: number; y: number } | null = null;
  private joinedOnce = false;

  constructor(
    private base: string,
    private room: string,
    private seed: DocumentData | null,
  ) {}

  start() {
    this.unsubs.push(
      onLocalPatch((p) => {
        // never send edits from a different file into this room
        if (useEditor.getState().fileId !== this.room) return;
        this.outgoing = mergePatches(this.outgoing, p);
        if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 40);
      }),
    );
    this.unsubs.push(
      useEditor.subscribe((s, prev) => {
        if (s.selection !== prev.selection || s.pageId !== prev.pageId || s.zoom !== prev.zoom || s.panX !== prev.panX || s.panY !== prev.panY) this.sendPresence();
      }),
    );
    this.connect();
  }

  private connect() {
    const st = useCollab.getState();
    useCollab.setState({ status: this.joinedOnce ? 'reconnecting' : 'connecting', error: null, room: this.room, base: this.base });
    const tok = authToken();
    const url = `${this.base.replace(/^http/, 'ws')}/collab${tok ? `?token=${encodeURIComponent(tok)}` : ''}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify({ type: 'hello', room: this.room, user: st.me, doc: this.seed ?? undefined }));
    };
    ws.onmessage = (e) => this.onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      if (this.closed) return;
      useCollab.setState({ status: 'reconnecting', peers: {} });
      const delay = Math.min(10000, 500 * 2 ** this.retry++);
      setTimeout(() => !this.closed && this.connect(), delay);
    };
    ws.onerror = () => {
      /* onclose handles retry */
    };
  }

  private onMessage(msg: { type: string; [k: string]: unknown }) {
    const ed = useEditor.getState();
    switch (msg.type) {
      case 'welcome': {
        const serverDoc = msg.doc as DocumentData;
        // re-apply anything we changed while disconnected on top of the server state
        const local = this.pending.reduce<DocPatch | null>((acc, p) => mergePatches(acc, p.patch), null);
        const unsent = mergePatches(local, this.outgoing);
        this.pending = [];
        this.outgoing = null;
        const keepView = { zoom: ed.zoom, panX: ed.panX, panY: ed.panY, pageId: ed.pageId };
        const sameFile = ed.fileId === this.room;
        markRemote(serverDoc);
        ed.setDoc(serverDoc, { fileId: this.room, filePath: ed.filePath });
        if (sameFile && serverDoc.pages.some((p) => p.id === keepView.pageId)) useEditor.setState(keepView);
        else setTimeout(() => useEditor.getState().zoomToFit(), 0);
        if (unsent) {
          ed.mutate((d) => applyPatchInPlace(d, unsent), false);
          const fixed = repairDocument(useEditor.getState().doc);
          if (fixed !== useEditor.getState().doc) useEditor.setState({ doc: fixed });
        }
        const peers: Record<string, Peer> = {};
        for (const p of msg.peers as Peer[]) peers[p.id] = p;
        useCollab.setState({ status: 'live', peers, error: null });
        this.joinedOnce = true;
        this.seed = null;
        joinedRoom(this.room);
        this.sendPresence(true);
        break;
      }
      case 'patch': {
        const patch = msg.patch as DocPatch;
        const filtered = this.withoutLocalKeys(patch);
        if (filtered) ed.applyRemote(filtered);
        break;
      }
      case 'ack':
        this.pending = this.pending.filter((p) => p.id !== msg.id);
        break;
      case 'peer-join':
      case 'presence': {
        const p = msg.peer as Peer;
        useCollab.setState((s) => ({ peers: { ...s.peers, [p.id]: p } }));
        if (useCollab.getState().following === p.id && p.presence.viewport) followViewport(p);
        break;
      }
      case 'peer-leave':
        useCollab.setState((s) => {
          const peers = { ...s.peers };
          delete peers[msg.id as string];
          return { peers, following: s.following === msg.id ? null : s.following };
        });
        break;
      case 'focus': {
        const ids = (msg.ids as string[]).filter((id) => useEditor.getState().doc.nodes[id]);
        if (ids.length) {
          useEditor.getState().select(ids);
          useEditor.getState().zoomToSelection();
        }
        break;
      }
      case 'error':
        if (msg.message === 'Room not found' && !this.seed) {
          // room vanished (server reset): recreate it from what we have
          this.seed = useEditor.getState().doc;
          this.ws?.send(JSON.stringify({ type: 'hello', room: this.room, user: useCollab.getState().me, doc: this.seed }));
        } else useCollab.setState({ status: 'error', error: String(msg.message) });
        break;
    }
  }

  /** Drop keys that this client changed and the server hasn't confirmed yet (they will win anyway). */
  private withoutLocalKeys(patch: DocPatch): DocPatch | null {
    const mine = this.pending.reduce<DocPatch | null>((acc, p) => mergePatches(acc, p.patch), this.outgoing);
    if (!mine) return patch;
    const out: DocPatch = {};
    if (patch.nodes) {
      const nodes: DocPatch['nodes'] = {};
      for (const [k, v] of Object.entries(patch.nodes)) if (!(mine.nodes && k in mine.nodes)) nodes[k] = v;
      if (Object.keys(nodes).length) out.nodes = nodes;
    }
    if (patch.pages && !mine.pages) out.pages = patch.pages;
    if (patch.meta) {
      const meta: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch.meta)) if (!(mine.meta && k in mine.meta)) meta[k] = v;
      if (Object.keys(meta).length) out.meta = meta as DocPatch['meta'];
    }
    return out.nodes || out.pages || out.meta ? out : null;
  }

  private flush() {
    this.flushTimer = null;
    if (!this.outgoing || !this.ws || this.ws.readyState !== 1 || useCollab.getState().status !== 'live') {
      if (this.outgoing) this.flushTimer = setTimeout(() => this.flush(), 300);
      return;
    }
    const id = ++this.seq;
    this.pending.push({ id, patch: this.outgoing });
    this.ws.send(JSON.stringify({ type: 'patch', id, patch: this.outgoing }));
    this.outgoing = null;
  }

  setCursor(c: { x: number; y: number } | null) {
    this.cursor = c;
    this.sendPresence();
  }

  sendPresence(now = false) {
    const go = () => {
      this.presenceTimer = null;
      if (!this.ws || this.ws.readyState !== 1) return;
      const s = useEditor.getState();
      const { me } = useCollab.getState();
      this.ws.send(
        JSON.stringify({
          type: 'presence',
          presence: { cursor: this.cursor, selection: s.selection, pageId: s.pageId, viewport: { x: s.panX, y: s.panY, zoom: s.zoom }, name: me.name, color: me.color },
        }),
      );
    };
    if (now) return go();
    if (!this.presenceTimer) this.presenceTimer = setTimeout(go, 50);
  }

  stop() {
    this.closed = true;
    this.unsubs.forEach((u) => u());
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.ws?.close();
    useCollab.setState({ status: 'offline', peers: {}, room: null, following: null });
  }
}

let client: CollabClient | null = null;

/** Room of an explicit join (shared link) that hasn't been welcomed yet; auto-connect must not replace it. */
let joining: string | null = null;
export const joinedRoom = (room: string) => {
  if (joining === room) joining = null;
};

export async function goLive(opts: { room?: string; seed?: boolean } = {}): Promise<boolean> {
  if (!opts.room && joining) return false;
  if (opts.room) joining = opts.room;
  const ok = await connectTo(opts);
  if (!ok && opts.room && joining === opts.room) joining = null;
  return ok;
}

async function connectTo(opts: { room?: string; seed?: boolean }): Promise<boolean> {
  const base = await serverBase();
  if (!base) {
    useCollab.setState({ status: 'error', error: 'No Vectura server reachable. Start one with “npm start” or set its address in Share.' });
    return false;
  }
  const ed = useEditor.getState();
  const room = opts.room ?? ed.fileId;
  if (client && useCollab.getState().room === room) return true;
  client?.stop();
  client = new CollabClient(base, room, opts.seed === false ? null : ed.doc);
  if (!opts.room) useEditor.setState({ fileId: room });
  client.start();
  return true;
}

export function leaveLive() {
  client?.stop();
  client = null;
}

export const collabCursor = (c: { x: number; y: number } | null) => client?.setCursor(c);
export const isLive = () => !!client && useCollab.getState().status === 'live';

function followViewport(p: Peer) {
  const v = p.presence.viewport;
  if (!v) return;
  const ed = useEditor.getState();
  if (p.presence.pageId && p.presence.pageId !== ed.pageId && ed.doc.pages.some((pg) => pg.id === p.presence.pageId)) ed.setPage(p.presence.pageId);
  useEditor.setState({ zoom: v.zoom, panX: v.x, panY: v.y });
}

export function follow(peerId: string | null) {
  useCollab.setState({ following: peerId });
  const p = peerId ? useCollab.getState().peers[peerId] : null;
  if (p) followViewport(p);
}

export function shareLink(): string | null {
  const { room, base } = useCollab.getState();
  if (!room) return null;
  const sameOrigin = base && location.origin === base;
  const appUrl = location.protocol.startsWith('http') ? `${location.origin}${location.pathname}` : base ?? '';
  return `${appUrl}?room=${room}${!sameOrigin && base ? `&server=${encodeURIComponent(base)}` : ''}`;
}
