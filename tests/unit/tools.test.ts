import { describe, expect, it } from 'vitest';
import { RoomManager } from '../../server/rooms';
import { callTool, toolList, type ToolContext } from '../../server/tools';

const ctx = (): ToolContext => ({ rooms: new RoomManager(null), publicUrl: 'http://x' });

describe('MCP design tools', () => {
  it('exposes JSON schemas for every tool', () => {
    const list = toolList();
    expect(list.length).toBeGreaterThanOrEqual(20);
    for (const t of list) expect(t.inputSchema.type).toBe('object');
  });

  it('creates a file, builds a screen and edits it', async () => {
    const c = ctx();
    const f = (await callTool('create_file', { name: 'Test' }, c)) as { fileId: string };
    const res = (await callTool('create_nodes', { fileId: f.fileId, nodes: [{ type: 'frame', name: 'Screen', width: 390, height: 844, children: [{ type: 'text', text: 'Hello' }, { type: 'rect', name: 'Btn', x: 20, y: 100, width: 100, height: 40 }] }] }, c)) as { created: { id: string; children: { id: string }[] }[] };
    const screen = res.created[0];
    expect(screen.children).toHaveLength(2);
    const btn = screen.children[1].id;
    await callTool('update_nodes', { fileId: f.fileId, updates: [{ id: btn, x: 0, fill: '#ff0000' }] }, c);
    const out = (await callTool('get_nodes', { fileId: f.fileId, ids: [btn] }, c)) as { nodes: { x: number; fills: string[] }[] };
    expect(out.nodes[0]).toMatchObject({ x: 0, fills: ['#ff0000'] });
    // second top-level node gets placed next to the first, not on top of it
    const second = (await callTool('create_nodes', { fileId: f.fileId, nodes: [{ type: 'frame', width: 100, height: 100 }] }, c)) as { created: { x: number }[] };
    expect(second.created[0].x).toBeGreaterThan(390);
  });

  it('validates arguments and reports helpful errors', async () => {
    const c = ctx();
    await expect(callTool('create_nodes', { nodes: [] }, c)).rejects.toThrow();
    await expect(callTool('get_nodes', { fileId: '../etc', ids: ['a'] }, c)).rejects.toThrow(/Invalid file id/);
    await expect(callTool('nope', {}, c)).rejects.toThrow(/Unknown tool/);
    const f = (await callTool('create_file', { name: 'X' }, c)) as { fileId: string };
    await expect(callTool('add_interaction', { fileId: f.fileId, fromId: 'missing' }, c)).rejects.toThrow(/not found/);
  });

  it('components, instances, groups, delete and export', async () => {
    const c = ctx();
    const f = (await callTool('create_file', { name: 'X' }, c)) as { fileId: string };
    const fileId = f.fileId;
    const r = (await callTool('create_nodes', { fileId, nodes: [{ type: 'frame', name: 'Chip', width: 80, height: 32, children: [{ type: 'text', text: 'Tag' }] }, { type: 'rect' }, { type: 'ellipse' }] }, c)) as { created: { id: string; children?: { id: string }[] }[] };
    const [chip, a, b] = r.created;
    await callTool('create_component', { fileId, id: chip.id }, c);
    const inst = (await callTool('create_instance', { fileId, componentId: chip.id, textOverrides: { [chip.children![0].id]: 'Override' } }, c)) as { id: string };
    const g = (await callTool('group_nodes', { fileId, ids: [a.id, b.id], as: 'auto-layout' }, c)) as { id: string };
    const outline = (await callTool('get_file_outline', { fileId }, c)) as { pages: { children: { id: string; type: string; autoLayout?: unknown }[] }[] };
    const types = outline.pages[0].children.map((n) => n.type);
    expect(types).toEqual(expect.arrayContaining(['component', 'instance', 'frame']));
    expect(outline.pages[0].children.find((n) => n.id === g.id)!.autoLayout).toBeTruthy();
    const html = (await callTool('export_html', { fileId, frameIds: [inst.id], prototype: false }, c)) as { html: string };
    expect(html.html).toContain('Override');
    const del = (await callTool('delete_nodes', { fileId, ids: [g.id, 'missing'] }, c)) as { deleted: number };
    expect(del.deleted).toBe(1);
  });
});

describe('MCP variant tools', () => {
  it('builds an interactive component end to end', async () => {
    const c = ctx();
    const { fileId } = (await callTool('create_file', { name: 'V' }, c)) as { fileId: string };
    const r = (await callTool('create_nodes', { fileId, nodes: [
      { type: 'component', name: 'Off', width: 60, height: 32, fill: '#cccccc', children: [{ type: 'ellipse', name: 'Knob', x: 2, y: 2, width: 28, height: 28 }] },
      { type: 'component', name: 'On', x: 100, width: 60, height: 32, fill: '#22c55e', children: [{ type: 'ellipse', name: 'Knob', x: 30, y: 2, width: 28, height: 28 }] },
    ] }, c)) as { created: { id: string }[] };
    const [off, on] = r.created.map((x) => x.id);
    const set = (await callTool('combine_as_variants', { fileId, ids: [off, on], name: 'Switch', variants: [{ State: 'Off' }, { State: 'On' }] }, c)) as { setId: string; properties: unknown };
    expect(set.properties).toEqual([{ name: 'State', values: ['Off', 'On'] }]);
    await callTool('add_interaction', { fileId, fromId: off, action: 'change-to', targetId: on }, c);
    await callTool('add_interaction', { fileId, fromId: on, action: 'change-to', targetId: off }, c);
    const inst = (await callTool('create_instance', { fileId, componentId: off }, c)) as { id: string };
    const res = (await callTool('set_instance_properties', { fileId, instanceId: inst.id, properties: { State: 'On' } }, c)) as { node: { componentId: string; variant: { current: Record<string, string> } } };
    expect(res.node.componentId).toBe(on);
    expect(res.node.variant.current).toEqual({ State: 'On' });
    const added = (await callTool('add_variant', { fileId, sourceId: on, props: { State: 'Disabled' } }, c)) as { id: string };
    expect(added.id).toBeTruthy();
    await expect(callTool('add_interaction', { fileId, fromId: inst.id, action: 'change-to', targetId: on }, c)).rejects.toThrow(/inside a variant/);
    await expect(callTool('set_instance_properties', { fileId, instanceId: inst.id, properties: { Nope: 'x' } }, c)).rejects.toThrow(/Unknown property/);
    const html = (await callTool('export_html', { fileId, frameIds: [inst.id] }, c)) as { html: string };
    expect(html.html).toContain('data-instance');
  });
});
