/**
 * Design tools exposed to AI assistants (via MCP) and scripts (via REST /api/tools/:name).
 * Every edit goes through RoomManager.edit, so connected editors see changes live.
 */
import { z } from 'zod';
import type { DocumentData, PrototypeLink, SceneNode } from '../src/types';
import { RoomManager, type Room, validRoomId } from './rooms';
import { describeNode, insertSpec, updateFromSpec, type NodeSpec } from '../src/lib/spec';
import { applyBoolean, type BooleanOp } from '../src/lib/boolean';
import { applyAllBindings, newCollection, defaultValue } from '../src/lib/variables';
import { relayoutAncestors, descendants, translateTree, fitGroup } from '../src/lib/layout';
import { createNode, uid } from '../src/lib/factory';
import { generateHtml, reachableFrames } from '../src/lib/htmlExport';
import { exportSvgString } from '../src/lib/exporter';
import { unionRects, visualBounds } from '../src/lib/geometry';
import { pageOf } from '../src/lib/docops';

export interface ToolContext {
  rooms: RoomManager;
  publicUrl: string;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  schema: z.ZodRawShape;
  readOnly?: boolean;
  run: (args: Record<string, unknown>, ctx: ToolContext) => unknown | Promise<unknown>;
}

const fileId = z.string().optional().describe('File id (from list_files). Optional when exactly one file is open in an editor.');

const nodeSpecDoc = `Node spec object: { type: "frame"|"component"|"group"|"rect"|"ellipse"|"polygon"|"star"|"line"|"text"|"image"|"path", name?, x?, y? (relative to parent), width?, height?, rotation?, opacity? (0-1),
fill? ("#hex" | {type:"linear"|"radial", angle?, stops:[{offset 0-1, color}]} | {type:"image", src:"data:… or https://…"} | null), stroke? "#hex", strokeWidth?, strokeAlign? "inside"|"center"|"outside", radius?, clip? (frames),
shadow? {x,y,blur,spread,color,opacity,inner?}, blur?, backgroundBlur?,
text? (string, for text nodes), fontSize?, fontWeight? (100-900), fontFamily? (Google font name), color? (text colour), textAlign?, lineHeight? (multiplier), letterSpacing?, textCase?, autoResize? "width"|"height"|"fixed",
autoLayout? {direction:"horizontal"|"vertical", gap, padding (number | {top,right,bottom,left}), align:"start"|"center"|"end", justify:"start"|"center"|"end"|"space-between", hugWidth?, hugHeight?, wrap?},
svgPath? (SVG path "d" for type "path"), sides? (polygon/star), overflow? ("vertical" etc. for prototype scrolling), children? [node specs] }.`;

const nodeSpec = z.record(z.string(), z.any()).describe(nodeSpecDoc);

function resolveRoom(ctx: ToolContext, id?: unknown): Room {
  if (typeof id === 'string' && id) {
    if (!validRoomId(id)) throw new Error(`Invalid file id "${id}"`);
    const r = ctx.rooms.get(id);
    if (!r) throw new Error(`File "${id}" not found. Call list_files to see available files.`);
    return r;
  }
  const online = [...ctx.rooms.rooms.values()].filter((r) => r.clients.size > 0);
  if (online.length === 1) return online[0];
  const all = ctx.rooms.list();
  if (all.length === 1) return ctx.rooms.get(all[0].id)!;
  throw new Error(online.length > 1 ? 'Several files are open — pass fileId (see list_files).' : 'No file is open. Call list_files or create_file first.');
}

function pageFor(d: DocumentData, pageId?: unknown, parentId?: unknown): string {
  if (typeof parentId === 'string' && parentId) {
    const p = pageOf(d, parentId);
    if (p) return p;
  }
  if (typeof pageId === 'string' && d.pages.some((p) => p.id === pageId)) return pageId;
  if (typeof pageId === 'string') {
    const byName = d.pages.find((p) => p.name.toLowerCase() === pageId.toLowerCase());
    if (byName) return byName.id;
  }
  return d.pages[0].id;
}

function requireNode(d: DocumentData, id: string): SceneNode {
  const n = d.nodes[id];
  if (!n) throw new Error(`Node "${id}" not found`);
  return n;
}

function removeTree(d: DocumentData, id: string) {
  const n = d.nodes[id];
  if (!n) return;
  for (const c of descendants(d.nodes, id)) delete d.nodes[c];
  const owner = n.parentId ? d.nodes[n.parentId]?.children : d.pages.find((p) => p.children.includes(id))?.children;
  if (owner) owner.splice(owner.indexOf(id), 1);
  delete d.nodes[id];
  for (const x of Object.values(d.nodes)) if (x.prototype?.some((l) => l.targetId === id)) x.prototype = x.prototype.filter((l) => l.targetId !== id);
}

/** Free spot to the right of existing top-level content on a page. */
function freeSpot(d: DocumentData, pageId: string) {
  const page = d.pages.find((p) => p.id === pageId)!;
  const b = unionRects(page.children.map((id) => d.nodes[id]).filter(Boolean).map(visualBounds));
  return b ? { x: Math.round(b.x + b.w + 100), y: Math.round(b.y) } : { x: 0, y: 0 };
}

const focusIds = (ctx: ToolContext, room: Room, ids: string[]) => {
  const d = room.doc;
  const b = unionRects(ids.map((id) => d.nodes[id]).filter(Boolean).map(visualBounds));
  ctx.rooms.aiPresence(room, { selection: ids, cursor: b ? { x: b.x + b.w, y: b.y + b.h } : null, pageId: ids[0] ? pageOf(d, ids[0]) : undefined });
};

export const tools: ToolDef[] = [
  {
    name: 'get_started',
    title: 'How to design with Figmy',
    description: 'Read this first. Explains the coordinate system, node specs and a recommended workflow for designing in Figmy.',
    schema: {},
    readOnly: true,
    run: (_a, ctx) => ({
      guide: [
        'Figmy is a vector design tool; files contain pages, pages contain top-level frames (screens/artboards), frames contain layers.',
        'Workflow: list_files → get_file_outline → create_nodes / update_nodes → (optional) add_interaction for prototypes → export_html.',
        'Coordinates in tool arguments are relative to the parent node (top-level nodes are relative to the page). Units are CSS pixels.',
        'Prefer one create_nodes call with a nested spec tree (a frame with children) over many small calls.',
        'Use autoLayout on frames for stacks, buttons and lists — children positions are then computed automatically.',
        'Common screen sizes: mobile 390×844, tablet 834×1194, desktop 1440×1024. Use 8px spacing steps and a clear type scale (e.g. 12/14/16/20/24/32/48).',
        'Text nodes: set "text", "fontSize", "fontWeight", "color". Omit width for single-line labels (auto width); set width for paragraphs (auto height).',
        'Every change appears live in all open editors. Use get_selection to act on what the user selected.',
        nodeSpecDoc,
      ],
      openFiles: ctx.rooms.list().filter((r) => r.online > 0).map((r) => ({ id: r.id, name: r.name })),
    }),
  },
  {
    name: 'list_files',
    title: 'List files',
    description: 'List design files on this Figmy server with page/layer counts and how many people have them open.',
    schema: {},
    readOnly: true,
    run: (_a, ctx) => ({ files: ctx.rooms.list().map((r) => ({ ...r, url: `${ctx.publicUrl}/?room=${r.id}` })) }),
  },
  {
    name: 'create_file',
    title: 'Create file',
    description: 'Create a new empty design file and return its id and the URL to open it in the editor.',
    schema: { name: z.string().describe('File name') },
    run: (a, ctx) => {
      const id = uid();
      const r = ctx.rooms.create(id, String(a.name || 'Untitled'));
      return { fileId: r.id, pageId: r.doc.pages[0].id, url: `${ctx.publicUrl}/?room=${r.id}` };
    },
  },
  {
    name: 'get_file_outline',
    title: 'Get file outline',
    description: 'Pages and layer tree of a file (ids, types, names, positions relative to parent, sizes, key styles). Use this to understand the current design before editing.',
    schema: { fileId, pageId: z.string().optional().describe('Limit to one page (id or name)'), maxDepth: z.number().int().min(0).max(12).optional().describe('Tree depth (default 3)') },
    readOnly: true,
    run: (a, ctx) => {
      const room = resolveRoom(ctx, a.fileId);
      const d = room.doc;
      const pages = typeof a.pageId === 'string' ? d.pages.filter((p) => p.id === a.pageId || p.name.toLowerCase() === String(a.pageId).toLowerCase()) : d.pages;
      return {
        fileId: room.id,
        name: d.name,
        pages: pages.map((p) => ({ id: p.id, name: p.name, background: p.background, children: p.children.map((c) => describeNode(d, c, 0, typeof a.maxDepth === 'number' ? a.maxDepth : 3)) })),
        components: Object.values(d.nodes).filter((n) => n.type === 'component').map((n) => ({ id: n.id, name: n.name })),
        variables: d.variables.map((c) => ({ id: c.id, name: c.name, modes: c.modes.map((m) => m.name), variables: c.variables.map((v) => ({ id: v.id, name: v.name, type: v.type })) })),
        colorStyles: d.colorStyles.map((s) => ({ name: s.name, color: s.paint.color })),
      };
    },
  },
  {
    name: 'get_nodes',
    title: 'Get nodes',
    description: 'Detailed properties of specific layers (and optionally their subtrees).',
    schema: { fileId, ids: z.array(z.string()).min(1), depth: z.number().int().min(0).max(10).optional() },
    readOnly: true,
    run: (a, ctx) => {
      const room = resolveRoom(ctx, a.fileId);
      return { nodes: (a.ids as string[]).map((id) => describeNode(room.doc, id, 0, typeof a.depth === 'number' ? a.depth : 1) ?? { id, error: 'not found' }) };
    },
  },
  {
    name: 'get_selection',
    title: 'Get selection',
    description: 'What each person currently has selected in the editor (so you can act on "this", "the selected button", etc.).',
    schema: { fileId },
    readOnly: true,
    run: (a, ctx) => {
      const room = resolveRoom(ctx, a.fileId);
      return {
        users: [...room.clients.values()].map((c) => ({
          name: c.peer.name,
          pageId: c.peer.presence.pageId,
          selection: (c.peer.presence.selection ?? []).map((id) => describeNode(room.doc, id, 0, 1)).filter(Boolean),
        })),
      };
    },
  },
  {
    name: 'create_nodes',
    title: 'Create layers',
    description: 'Create one or more layers from node specs (nested children supported). Top-level specs without x/y on a page are placed in free space. Returns the created ids.',
    schema: {
      fileId,
      nodes: z.array(nodeSpec).min(1).describe('Node specs to create'),
      parentId: z.string().optional().describe('Parent frame/group id. Omit to create on a page.'),
      pageId: z.string().optional().describe('Page id or name when parentId is omitted'),
      index: z.number().int().optional().describe('Insert position among siblings (0 = bottom)'),
    },
    run: (a, ctx) => {
      const room = resolveRoom(ctx, a.fileId);
      const ids = ctx.rooms.edit(room, (d) => {
        const parentId = typeof a.parentId === 'string' ? a.parentId : null;
        if (parentId) requireNode(d, parentId);
        const pageId = pageFor(d, a.pageId, parentId);
        const out: string[] = [];
        let spot = freeSpot(d, pageId);
        for (const raw of a.nodes as NodeSpec[]) {
          const spec = { ...raw };
          if (!parentId && spec.x === undefined && spec.y === undefined) {
            spec.x = spot.x;
            spec.y = spot.y;
          }
          const id = insertSpec(d, pageId, spec, parentId, typeof a.index === 'number' ? a.index : undefined);
          out.push(id);
          if (!parentId) spot = freeSpot(d, pageId);
        }
        relayoutAncestors(d.nodes, parentId);
        return out;
      });
      focusIds(ctx, room, ids);
      return { created: ids.map((id) => describeNode(room.doc, id, 0, 2)) };
    },
  },
  {
    name: 'update_nodes',
    title: 'Update layers',
    description: 'Change properties of existing layers using partial node specs (same keys as create_nodes, plus optional parentId/index to move a layer into another parent).',
    schema: { fileId, updates: z.array(z.record(z.string(), z.any()).describe('{ id, ...partial node spec, parentId?, index? }')).min(1) },
    run: (a, ctx) => {
      const room = resolveRoom(ctx, a.fileId);
      const ids: string[] = [];
      ctx.rooms.edit(room, (d) => {
        for (const u of a.updates as (Partial<NodeSpec> & { id: string; parentId?: string | null; index?: number })[]) {
          requireNode(d, u.id);
          const { id, parentId, index, ...rest } = u;
          if (parentId !== undefined) {
            const n = d.nodes[id];
            const pageId = pageOf(d, id) ?? d.pages[0].id;
            if (parentId && (parentId === id || descendants(d.nodes, id).includes(parentId))) throw new Error('Cannot move a layer into itself');
            const old = n.parentId;
            const owner = old ? d.nodes[old].children : d.pages.find((p) => p.id === pageId)!.children;
            owner.splice(owner.indexOf(id), 1);
            n.parentId = parentId;
            const list = parentId ? requireNode(d, parentId).children : d.pages.find((p) => p.id === pageId)!.children;
            list.splice(index === undefined ? list.length : Math.max(0, Math.min(index, list.length)), 0, id);
            relayoutAncestors(d.nodes, old);
            relayoutAncestors(d.nodes, parentId);
          } else if (index !== undefined) {
            const n = d.nodes[id];
            const list = n.parentId ? d.nodes[n.parentId].children : d.pages.find((p) => p.children.includes(id))!.children;
            list.splice(list.indexOf(id), 1);
            list.splice(Math.max(0, Math.min(index, list.length)), 0, id);
            relayoutAncestors(d.nodes, n.parentId);
          }
          if (Object.keys(rest).length) updateFromSpec(d, id, rest);
          ids.push(id);
        }
        applyAllBindings(d);
      });
      focusIds(ctx, room, ids);
      return { updated: ids.map((id) => describeNode(room.doc, id, 0, 0)) };
    },
  },
  {
    name: 'delete_nodes',
    title: 'Delete layers',
    description: 'Delete layers (and everything inside them).',
    schema: { fileId, ids: z.array(z.string()).min(1) },
    run: (a, ctx) => {
      const room = resolveRoom(ctx, a.fileId);
      const n = ctx.rooms.edit(room, (d) => {
        let count = 0;
        for (const id of a.ids as string[]) {
          if (!d.nodes[id]) continue;
          const parent = d.nodes[id].parentId;
          removeTree(d, id);
          relayoutAncestors(d.nodes, parent);
          count++;
        }
        return count;
      });
      return { deleted: n };
    },
  },
  {
    name: 'duplicate_nodes',
    title: 'Duplicate layers',
    description: 'Duplicate layers with an optional offset. Returns the new ids.',
    schema: { fileId, ids: z.array(z.string()).min(1), offsetX: z.number().optional(), offsetY: z.number().optional() },
    run: (a, ctx) => {
      const room = resolveRoom(ctx, a.fileId);
      const out = ctx.rooms.edit(room, (d) => {
        const created: string[] = [];
        for (const id of a.ids as string[]) {
          const src = requireNode(d, id);
          const map: Record<string, string> = {};
          const walk = (oid: string, parent: string | null) => {
            const o = d.nodes[oid];
            const nid = uid();
            map[oid] = nid;
            d.nodes[nid] = { ...JSON.parse(JSON.stringify(o)), id: nid, parentId: parent, children: [] };
            for (const c of o.children) {
              walk(c, nid);
              d.nodes[nid].children.push(map[c]);
            }
          };
          walk(id, src.parentId);
          const list = src.parentId ? d.nodes[src.parentId].children : d.pages.find((p) => p.children.includes(id))!.children;
          list.splice(list.indexOf(id) + 1, 0, map[id]);
          translateTree(d.nodes, map[id], Number(a.offsetX ?? 20), Number(a.offsetY ?? 20));
          relayoutAncestors(d.nodes, src.parentId);
          created.push(map[id]);
        }
        return created;
      });
      focusIds(ctx, room, out);
      return { created: out };
    },
  },
  {
    name: 'group_nodes',
    title: 'Group or frame layers',
    description: 'Wrap layers in a group, a frame, or an auto-layout frame.',
    schema: {
      fileId,
      ids: z.array(z.string()).min(1),
      as: z.enum(['group', 'frame', 'auto-layout']).optional().describe('Default "group"'),
      name: z.string().optional(),
      direction: z.enum(['horizontal', 'vertical']).optional(),
      gap: z.number().optional(),
    },
    run: (a, ctx) => {
      const room = resolveRoom(ctx, a.fileId);
      const id = ctx.rooms.edit(room, (d) => {
        const ids = (a.ids as string[]).filter((x) => d.nodes[x]);
        if (!ids.length) throw new Error('No valid ids');
        const first = d.nodes[ids[0]];
        const parentId = first.parentId;
        const list = parentId ? d.nodes[parentId].children : d.pages.find((p) => p.children.includes(first.id))!.children;
        const ordered = [...ids].sort((x, y) => list.indexOf(x) - list.indexOf(y));
        const b = unionRects(ordered.map((x) => visualBounds(d.nodes[x])))!;
        const kind = (a.as as string) ?? 'group';
        const g = createNode(kind === 'group' ? 'group' : 'frame', { ...b, fills: [], parentId, name: (a.name as string) ?? (kind === 'group' ? 'Group' : 'Frame') });
        d.nodes[g.id] = g;
        list.splice(list.indexOf(ordered[ordered.length - 1]) + 1, 0, g.id);
        for (const x of ordered) {
          const owner = d.nodes[x].parentId ? d.nodes[d.nodes[x].parentId!].children : list;
          owner.splice(owner.indexOf(x), 1);
          d.nodes[x].parentId = g.id;
          g.children.push(x);
        }
        if (kind === 'auto-layout') {
          const horizontal = (a.direction as string) ? a.direction === 'horizontal' : b.w >= b.h;
          g.children.sort((p, q) => (horizontal ? d.nodes[p].x - d.nodes[q].x : d.nodes[p].y - d.nodes[q].y));
          g.autoLayout = { direction: horizontal ? 'horizontal' : 'vertical', gap: Number(a.gap ?? 8), padding: { t: 0, r: 0, b: 0, l: 0 }, align: 'start', justify: 'start', hugW: true, hugH: true, wrap: false };
        }
        if (kind === 'group') fitGroup(d.nodes, g.id);
        relayoutAncestors(d.nodes, g.id);
        return g.id;
      });
      focusIds(ctx, room, [id]);
      return { id };
    },
  },
  {
    name: 'boolean_operation',
    title: 'Boolean operation',
    description: 'Combine shapes: union, subtract (bottom-most minus the rest), intersect, exclude, or flatten into one vector.',
    schema: { fileId, ids: z.array(z.string()).min(1), operation: z.enum(['union', 'subtract', 'intersect', 'exclude', 'flatten']) },
    run: (a, ctx) => {
      const room = resolveRoom(ctx, a.fileId);
      const id = ctx.rooms.edit(room, (d) => {
        const ids = (a.ids as string[]).filter((x) => d.nodes[x]);
        const first = requireNode(d, ids[0]);
        const list = first.parentId ? d.nodes[first.parentId].children : d.pages.find((p) => p.children.includes(first.id))!.children;
        ids.sort((x, y) => list.indexOf(x) - list.indexOf(y));
        const pageId = pageOf(d, ids[0]) ?? d.pages[0].id;
        const parent = first.parentId;
        const res = applyBoolean(d, pageId, ids, a.operation as BooleanOp);
        relayoutAncestors(d.nodes, parent);
        return res;
      });
      if (id) focusIds(ctx, room, [id]);
      return { id };
    },
  },
  {
    name: 'create_component',
    title: 'Create component',
    description: 'Turn a frame or group into a reusable main component.',
    schema: { fileId, id: z.string(), name: z.string().optional(), description: z.string().optional() },
    run: (a, ctx) => {
      const room = resolveRoom(ctx, a.fileId);
      ctx.rooms.edit(room, (d) => {
        const n = requireNode(d, String(a.id));
        if (n.type !== 'frame' && n.type !== 'group' && n.type !== 'component') throw new Error('Only frames and groups can become components');
        n.type = 'component';
        if (a.name) n.name = String(a.name);
        if (a.description) n.description = String(a.description);
      });
      return { id: a.id };
    },
  },
  {
    name: 'create_instance',
    title: 'Create instance',
    description: 'Place an instance of a component. Instances stay in sync with the main component; text can be overridden by component child id.',
    schema: {
      fileId,
      componentId: z.string(),
      parentId: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      textOverrides: z.record(z.string(), z.string()).optional().describe('{ componentTextLayerId: "new text" }'),
    },
    run: (a, ctx) => {
      const room = resolveRoom(ctx, a.fileId);
      const id = ctx.rooms.edit(room, (d) => {
        const comp = requireNode(d, String(a.componentId));
        if (comp.type !== 'component') throw new Error('componentId must reference a component');
        const parentId = typeof a.parentId === 'string' ? a.parentId : null;
        const parent = parentId ? requireNode(d, parentId) : null;
        const pageId = pageFor(d, undefined, parentId);
        const spot = parent ? { x: 0, y: 0 } : freeSpot(d, pageId);
        const inst = createNode('instance', {
          name: comp.name,
          componentId: comp.id,
          x: (parent?.x ?? 0) + Number(a.x ?? spot.x),
          y: (parent?.y ?? 0) + Number(a.y ?? spot.y),
          w: Number(a.width ?? comp.w),
          h: Number(a.height ?? comp.h),
          fills: [],
          radius: comp.radius,
          parentId,
          overrides: {},
        });
        for (const [cid, text] of Object.entries((a.textOverrides as Record<string, string>) ?? {})) {
          const t = d.nodes[cid];
          if (t?.text) inst.overrides![cid] = { text: { ...t.text, content: text } };
        }
        d.nodes[inst.id] = inst;
        (parentId ? d.nodes[parentId].children : d.pages.find((p) => p.id === pageId)!.children).push(inst.id);
        relayoutAncestors(d.nodes, parentId);
        return inst.id;
      });
      focusIds(ctx, room, [id]);
      return { id };
    },
  },
  {
    name: 'create_page',
    title: 'Create page',
    description: 'Add a page to a file.',
    schema: { fileId, name: z.string() },
    run: (a, ctx) => {
      const room = resolveRoom(ctx, a.fileId);
      const id = uid();
      ctx.rooms.edit(room, (d) => {
        d.pages.push({ id, name: String(a.name), children: [], background: '#f5f5f5' });
      });
      return { pageId: id };
    },
  },
  {
    name: 'set_variables',
    title: 'Define variables',
    description: 'Create or update a variable collection (design tokens) with modes, e.g. Light/Dark. Existing variables with the same name are updated; bound layers refresh automatically.',
    schema: {
      fileId,
      collection: z.string().describe('Collection name, e.g. "Theme"'),
      modes: z.array(z.string()).min(1).describe('Mode names, e.g. ["Light","Dark"]'),
      variables: z.array(z.object({ name: z.string(), type: z.enum(['color', 'number', 'string', 'boolean']), values: z.record(z.string(), z.any()).describe('{ modeName: value }') })),
    },
    run: (a, ctx) => {
      const room = resolveRoom(ctx, a.fileId);
      return ctx.rooms.edit(room, (d) => {
        let col = d.variables.find((c) => c.name.toLowerCase() === String(a.collection).toLowerCase());
        if (!col) {
          col = newCollection(String(a.collection));
          col.modes = [];
          d.variables.push(col);
          col = d.variables[d.variables.length - 1];
        }
        for (const m of a.modes as string[]) if (!col.modes.some((x) => x.name === m)) col.modes.push({ id: uid(), name: m });
        const out: { name: string; id: string }[] = [];
        for (const v of a.variables as { name: string; type: 'color' | 'number' | 'string' | 'boolean'; values: Record<string, unknown> }[]) {
          let ex = col.variables.find((x) => x.name === v.name);
          if (!ex) {
            ex = { id: uid(), name: v.name, type: v.type, values: {} };
            col.variables.push(ex);
            ex = col.variables[col.variables.length - 1];
          }
          ex.type = v.type;
          for (const m of col.modes) {
            const raw = v.values[m.name] ?? v.values[m.id] ?? ex.values[m.id] ?? Object.values(v.values)[0] ?? defaultValue(v.type);
            ex.values[m.id] = v.type === 'number' ? Number(raw) : v.type === 'boolean' ? raw === true || raw === 'true' : String(raw);
          }
          out.push({ name: ex.name, id: ex.id });
        }
        applyAllBindings(d);
        return { collectionId: col.id, modes: col.modes, variables: out };
      });
    },
  },
  {
    name: 'bind_variable',
    title: 'Bind variable',
    description: 'Bind a layer property to a variable so it follows the token and its modes. Properties: fill, stroke, strokeWidth, radius, opacity, gap, padding, width, height, text, fontSize, visible. Pass variable: null to unbind.',
    schema: {
      fileId,
      nodeIds: z.array(z.string()).min(1),
      property: z.enum(['fill', 'stroke', 'strokeWidth', 'radius', 'opacity', 'gap', 'padding', 'width', 'height', 'text', 'fontSize', 'visible']),
      variable: z.string().nullable().describe('Variable id or name (optionally "Collection/name")'),
    },
    run: (a, ctx) => {
      const room = resolveRoom(ctx, a.fileId);
      ctx.rooms.edit(room, (d) => {
        let varId: string | null = null;
        if (a.variable) {
          const q = String(a.variable);
          for (const c of d.variables)
            for (const v of c.variables) if (v.id === q || v.name === q || `${c.name}/${v.name}` === q) varId = v.id;
          if (!varId) throw new Error(`Variable "${q}" not found`);
        }
        for (const id of a.nodeIds as string[]) {
          const n = requireNode(d, id);
          n.bindings = { ...(n.bindings ?? {}) };
          if (varId) n.bindings[a.property as 'fill'] = varId;
          else delete n.bindings[a.property as 'fill'];
        }
        applyAllBindings(d);
      });
      return { ok: true };
    },
  },
  {
    name: 'set_variable_mode',
    title: 'Switch variable mode',
    description: 'Switch a collection to a mode for the whole file, or only inside one frame (nodeId).',
    schema: { fileId, collection: z.string(), mode: z.string(), nodeId: z.string().optional() },
    run: (a, ctx) => {
      const room = resolveRoom(ctx, a.fileId);
      ctx.rooms.edit(room, (d) => {
        const col = d.variables.find((c) => c.id === a.collection || c.name.toLowerCase() === String(a.collection).toLowerCase());
        if (!col) throw new Error('Collection not found');
        const mode = col.modes.find((m) => m.id === a.mode || m.name.toLowerCase() === String(a.mode).toLowerCase());
        if (!mode) throw new Error('Mode not found');
        if (a.nodeId) {
          const n = requireNode(d, String(a.nodeId));
          n.modeOverrides = { ...(n.modeOverrides ?? {}), [col.id]: mode.id };
        } else d.activeModes = { ...(d.activeModes ?? {}), [col.id]: mode.id };
        applyAllBindings(d);
      });
      return { ok: true };
    },
  },
  {
    name: 'add_interaction',
    title: 'Add prototype interaction',
    description: 'Add a prototype interaction to a layer, e.g. on click navigate to another frame with smart animate.',
    schema: {
      fileId,
      fromId: z.string().describe('Layer that triggers the interaction'),
      trigger: z.enum(['click', 'hover', 'press', 'mouse-enter', 'mouse-leave', 'after-delay', 'key']).optional(),
      action: z.enum(['navigate', 'overlay', 'swap-overlay', 'close-overlay', 'scroll-to', 'back', 'url']).optional(),
      targetId: z.string().optional().describe('Destination frame (or layer for scroll-to)'),
      animation: z.enum(['instant', 'dissolve', 'smart-animate', 'move-in', 'move-out', 'push', 'slide-in', 'slide-out']).optional(),
      direction: z.enum(['left', 'right', 'up', 'down']).optional(),
      easing: z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out', 'ease-in-back', 'ease-out-back', 'gentle', 'spring', 'bouncy']).optional(),
      duration: z.number().optional().describe('Milliseconds (default 300)'),
      delay: z.number().optional().describe('For after-delay, milliseconds'),
      key: z.string().optional(),
      url: z.string().optional(),
      overlayPosition: z.enum(['center', 'top', 'bottom', 'left', 'right']).optional(),
      replace: z.boolean().optional().describe('Replace existing interactions on the layer'),
    },
    run: (a, ctx) => {
      const room = resolveRoom(ctx, a.fileId);
      ctx.rooms.edit(room, (d) => {
        const n = requireNode(d, String(a.fromId));
        const action = (a.action as PrototypeLink['action']) ?? 'navigate';
        const needsTarget = ['navigate', 'overlay', 'swap-overlay', 'scroll-to'].includes(action!);
        if (needsTarget) requireNode(d, String(a.targetId));
        if (action === 'url' && !/^https?:\/\//.test(String(a.url ?? ''))) throw new Error('url must start with http(s)://');
        const link: PrototypeLink = {
          trigger: (a.trigger as PrototypeLink['trigger']) ?? 'click',
          action,
          targetId: needsTarget ? String(a.targetId) : 'back',
          animation: (a.animation as PrototypeLink['animation']) ?? 'dissolve',
          direction: a.direction as PrototypeLink['direction'],
          easing: (a.easing as PrototypeLink['easing']) ?? 'ease-out',
          duration: Number(a.duration ?? 300),
          delay: a.delay !== undefined ? Number(a.delay) : undefined,
          key: a.key as string | undefined,
          url: a.url as string | undefined,
          overlay: action === 'overlay' || action === 'swap-overlay' ? { position: (a.overlayPosition as 'center') ?? 'center', closeOnOutside: true, background: 'rgba(0,0,0,0.4)' } : undefined,
        };
        n.prototype = [...(a.replace ? [] : n.prototype ?? []), link];
      });
      return { ok: true };
    },
  },
  {
    name: 'export_html',
    title: 'Export to HTML',
    description: 'Generate a self-contained HTML page (inline CSS, flexbox for auto layout, optional prototype navigation) from frames. Returns the HTML source.',
    schema: {
      fileId,
      frameIds: z.array(z.string()).optional().describe('Top-level frames; default: all frames on the first page'),
      layout: z.enum(['flex', 'absolute']).optional(),
      prototype: z.boolean().optional().describe('Include clickable prototype navigation (default true)'),
    },
    readOnly: true,
    run: (a, ctx) => {
      const room = resolveRoom(ctx, a.fileId);
      const d = room.doc;
      let ids = (a.frameIds as string[] | undefined)?.filter((id) => d.nodes[id]);
      if (!ids?.length) ids = d.pages[0].children.filter((id) => ['frame', 'component', 'instance'].includes(d.nodes[id]?.type));
      if (a.prototype !== false) ids = reachableFrames(d, ids);
      return { html: generateHtml(d, ids, { layout: (a.layout as 'flex') ?? 'flex', prototype: a.prototype !== false, fitToViewport: true }) };
    },
  },
  {
    name: 'export_svg',
    title: 'Export to SVG',
    description: 'SVG markup for layers — useful to check what a design looks like.',
    schema: { fileId, ids: z.array(z.string()).min(1) },
    readOnly: true,
    run: (a, ctx) => {
      const room = resolveRoom(ctx, a.fileId);
      const ids = (a.ids as string[]).filter((id) => room.doc.nodes[id]);
      if (!ids.length) throw new Error('No valid ids');
      return { svg: exportSvgString(room.doc.nodes, ids) };
    },
  },
  {
    name: 'focus_nodes',
    title: 'Show layers to the user',
    description: 'Select and zoom to layers in everyone’s editor, e.g. after creating something.',
    schema: { fileId, ids: z.array(z.string()).min(1) },
    run: (a, ctx) => {
      const room = resolveRoom(ctx, a.fileId);
      const ids = (a.ids as string[]).filter((id) => room.doc.nodes[id]);
      ctx.rooms.broadcast(room, { type: 'focus', ids });
      focusIds(ctx, room, ids);
      return { ok: true };
    },
  },
];

export const toolMap = new Map(tools.map((t) => [t.name, t]));

/** Validate + run a tool by name. */
export async function callTool(name: string, args: unknown, ctx: ToolContext) {
  const t = toolMap.get(name);
  if (!t) throw new Error(`Unknown tool ${name}`);
  const parsed = z.object(t.schema).parse(args ?? {});
  return t.run(parsed as Record<string, unknown>, ctx);
}

/** JSON Schemas for REST discovery / the stdio bridge. */
export function toolList() {
  return tools.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: z.toJSONSchema(z.object(t.schema)), readOnly: !!t.readOnly }));
}
