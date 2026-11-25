import { describe, expect, it } from 'vitest';
import * as C from '../../src/lib/components';
import { emptyDocument, createNode } from '../../src/lib/factory';
import { insertSpec } from '../../src/lib/spec';
import { exportSvgString } from '../../src/lib/exporter';
import { generateHtml } from '../../src/lib/htmlExport';
import { convertFigmaFile } from '../../src/lib/figmaImport';
import { useEditor } from '../../src/store/store';
import { RoomManager } from '../../server/rooms';
import { callTool } from '../../server/tools';
import type { DocumentData, SceneNode } from '../../src/types';

const place = (d: DocumentData, compId: string, x: number, y: number, parentId: string | null = null) => {
  const c = d.nodes[compId];
  const i = createNode('instance', { componentId: compId, name: c.name, x, y, w: c.w, h: c.h, fills: [], parentId, overrides: {} });
  d.nodes[i.id] = i;
  (parentId ? d.nodes[parentId].children : d.pages[0].children).push(i.id);
  return i.id;
};

/** Icon components (Star, Heart), a Button component with a nested Icon instance + Label, and a Card with two Buttons. */
function library() {
  const d = emptyDocument();
  const pg = d.pages[0].id;
  const star = insertSpec(d, pg, { type: 'component', name: 'Icon/Star', x: 0, y: 0, width: 16, height: 16, fill: '#ffcc00' }, null);
  const heart = insertSpec(d, pg, { type: 'component', name: 'Icon/Heart', x: 40, y: 0, width: 16, height: 16, fill: '#ff3366' }, null);
  const button = insertSpec(d, pg, { type: 'component', name: 'Button', x: 0, y: 100, width: 120, height: 40, fill: '#5b5bf7', children: [{ type: 'text', name: 'Label', x: 36, y: 10, text: 'Go', color: '#ffffff' }] }, null);
  const icon = place(d, star, 10, 112, button);
  d.nodes[icon].name = 'Icon';
  const card = insertSpec(d, pg, { type: 'component', name: 'Card', x: 0, y: 300, width: 300, height: 120, fill: '#ffffff' }, null);
  const b1 = place(d, button, 10, 340, card);
  const b2 = place(d, button, 160, 340, card);
  d.nodes[b1].name = 'Primary';
  d.nodes[b2].name = 'Secondary';
  const label = d.nodes[button].children.find((c) => d.nodes[c].name === 'Label')!;
  return { d, pg, star, heart, button, icon, card, b1, b2, label };
}

describe('nested instance overrides', () => {
  it('overrides each nested copy independently via scoped keys (render + HTML)', () => {
    const { d, card, b1, b2, label } = library();
    const inst = place(d, card, 0, 600);
    d.nodes[inst].overrides = {
      [`${b1}/${label}`]: { text: { ...d.nodes[label].text!, content: 'Buy now' } },
      [`${b2}/${label}`]: { text: { ...d.nodes[label].text!, content: 'Later' } },
    };
    const svg = exportSvgString(d.nodes, [inst]);
    expect(svg).toContain('Buy now');
    expect(svg).toContain('Later');
    expect(svg).not.toContain('>Go<');
    const html = generateHtml(d, [inst], { prototype: false });
    expect(html).toContain('Buy now');
    expect(html).toContain('Later');
  });

  it('swaps a nested instance two levels deep without touching its sibling', () => {
    const { d, card, b1, b2, icon, heart } = library();
    const inst = place(d, card, 0, 600);
    d.nodes[inst].overrides = { [`${b1}/${icon}`]: C.swapPatch(d.nodes, d.nodes[icon], heart) };
    const r1 = C.resolveNested(d.nodes, d.nodes[inst], [b1, icon])!;
    const r2 = C.resolveNested(d.nodes, d.nodes[inst], [b2, icon])!;
    expect(r1.node.componentId).toBe(heart);
    expect(r2.node.componentId).not.toBe(heart);
    const svg = exportSvgString(d.nodes, [inst]);
    expect(svg).toContain('#ff3366');
    expect(svg).toContain('#ffcc00');
  });

  it('lists nested layers with keys and resolves name paths', () => {
    const { d, card, b1, icon, label } = library();
    const inst = place(d, card, 0, 600);
    const layers = C.nestedLayers(d.nodes, d.nodes[inst]);
    expect(layers.map((e) => e.path)).toEqual(expect.arrayContaining(['Primary', 'Primary/Label', 'Primary/Icon', 'Secondary/Icon']));
    expect(C.keyForNamePath(d.nodes, d.nodes[inst], 'Primary/Label')).toBe(`${b1}/${label}`);
    expect(C.keyForNamePath(d.nodes, d.nodes[inst], 'Primary/Icon')).toBe(`${b1}/${icon}`);
    expect(C.keyForNamePath(d.nodes, d.nodes[inst], 'Nope')).toBeNull();
  });

  it('outer overrides win over inner instance overrides for the same layer', () => {
    const { d, card, b1, label } = library();
    d.nodes[b1].overrides = { [label]: { text: { ...d.nodes[label].text!, content: 'Inner' }, visible: true } };
    const inst = place(d, card, 0, 600);
    d.nodes[inst].overrides = { [`${b1}/${label}`]: { text: { ...d.nodes[label].text!, content: 'Outer' } } };
    const lvl = C.childOverrides(d.nodes, d.nodes[b1], C.childOverrides(d.nodes, d.nodes[inst]));
    expect(lvl[label].text!.content).toBe('Outer');
    expect(lvl[label].visible).toBe(true);
  });
});

describe('instance swap properties', () => {
  it('drives a nested instance from a property, with explicit overrides still winning', () => {
    const { d, button, icon, heart, star } = library();
    const prop = C.addComponentProp(d, icon, 'instance-swap', 'Icon');
    expect(prop).toMatchObject({ type: 'instance-swap', default: star, layer: 'Icon' });
    const inst = place(d, button, 0, 600);
    d.nodes[inst].propValues = { [prop.id]: heart };
    expect(C.instanceOverrides(d.nodes, d.nodes[inst])[icon].componentId).toBe(heart);
    expect(exportSvgString(d.nodes, [inst])).toContain('#ff3366');
    d.nodes[inst].overrides = { [icon]: { componentId: star } };
    expect(C.instanceOverrides(d.nodes, d.nodes[inst])[icon].componentId).toBe(star);
    expect(() => C.addComponentProp(d, d.nodes[button].children.find((c) => d.nodes[c].type === 'text')!, 'instance-swap')).toThrow(/nested instance/);
  });

  it('never offers swaps that would make a component contain itself', () => {
    const { d, button, card, star } = library();
    expect(C.usesComponent(d.nodes, card, button)).toBe(true);
    const opts = C.swapOptions(d.nodes, button).map((o) => o.id);
    expect(opts).toContain(star);
    expect(opts).not.toContain(card); // card contains button
    expect(opts).not.toContain(button);
  });
});

describe('editing with nested overrides', () => {
  it('detach keeps nested overrides on the still-linked nested instances', () => {
    const { d, card, b1, label } = library();
    const s = useEditor.getState();
    s.setDoc(d);
    const inst = place(useEditor.getState().doc as DocumentData, card, 0, 600);
    useEditor.getState().setDoc({ ...useEditor.getState().doc });
    void inst;
    const st = useEditor.getState();
    const instId = Object.values(st.doc.nodes).find((n) => n.type === 'instance' && n.componentId === card)!.id;
    st.setNestedOverride(instId, `${b1}/${label}`, { text: { ...st.doc.nodes[label].text!, content: 'Kept' } });
    st.select([instId]);
    st.detachInstance();
    const frame = useEditor.getState().doc.nodes[useEditor.getState().selection[0]];
    expect(frame.type).toBe('frame');
    const primary = frame.children.map((c) => useEditor.getState().doc.nodes[c]).find((n) => n.name === 'Primary')!;
    expect(primary.type).toBe('instance');
    expect(Object.values(primary.overrides!)[0].text!.content).toBe('Kept');
  });

  it('swapNested clears overrides below the swapped instance and reset restores', () => {
    const { d, card, b1, icon, heart, label } = library();
    const s = useEditor.getState();
    s.setDoc(d);
    const st = useEditor.getState();
    st.createInstance(card, 0, 600);
    const instId = useEditor.getState().selection[0];
    st.setNestedOverride(instId, `${b1}/${label}`, { visible: false });
    st.swapNested(instId, b1, Object.values(useEditor.getState().doc.nodes).find((n) => n.name === 'Icon/Heart')!.id);
    let ov = useEditor.getState().doc.nodes[instId].overrides!;
    expect(ov[b1].componentId).toBe(heart);
    expect(ov[`${b1}/${label}`]).toBeUndefined();
    st.setNestedOverride(instId, b1, null);
    ov = useEditor.getState().doc.nodes[instId].overrides!;
    expect(Object.keys(ov)).toHaveLength(0);
    void icon;
  });

  it('variant swaps carry scoped nested overrides by layer name', () => {
    const d = emptyDocument();
    const pg = d.pages[0].id;
    const star = insertSpec(d, pg, { type: 'component', name: 'Star', width: 16, height: 16 }, null);
    const mk = (name: string, x: number) => {
      const c = insertSpec(d, pg, { type: 'component', name, x, y: 100, width: 100, height: 40 }, null);
      const i = place(d, star, x + 5, 105, c);
      d.nodes[i].name = 'Icon';
      return { c, i };
    };
    const a = mk('State=Default', 0);
    const b = mk('State=Hover', 200);
    C.combineAsVariants(d, [a.c, b.c]);
    const inst = place(d, a.c, 0, 400);
    d.nodes[inst].overrides = { [`${a.i}/x`]: { visible: false } };
    C.setInstanceVariant(d, inst, 'State', 'Hover');
    expect(Object.keys(d.nodes[inst].overrides!)).toEqual([`${b.i}/x`]);
  });

  it('renders a placeholder instead of recursing forever on a cyclic instance', () => {
    const d = emptyDocument();
    const comp = insertSpec(d, d.pages[0].id, { type: 'component', name: 'Loop', width: 50, height: 50 }, null);
    place(d, comp, 0, 0, comp); // component containing an instance of itself
    expect(() => exportSvgString(d.nodes, [comp])).not.toThrow();
  });
});

describe('MCP + Figma for nested instances', () => {
  it('set_instance_properties overrides nested texts and swaps by path', async () => {
    const { d } = library();
    const rooms = new RoomManager(null);
    rooms.get('lib', d);
    const ctx = { rooms, publicUrl: 'http://x' };
    const card = Object.values(d.nodes).find((n) => n.name === 'Card')!.id;
    const { id } = (await callTool('create_instance', { fileId: 'lib', componentId: card }, ctx)) as { id: string };
    const res = (await callTool('set_instance_properties', { fileId: 'lib', instanceId: id, nested: [{ path: 'Primary/Label', text: 'Buy' }, { path: 'Secondary/Icon', swapTo: 'Icon/Heart' }, { path: 'Secondary', visible: false }] }, ctx)) as { node: { nestedLayers: { path: string; overridden?: boolean }[] } };
    const overridden = res.node.nestedLayers.filter((l) => l.overridden).map((l) => l.path);
    expect(overridden).toEqual(expect.arrayContaining(['Primary/Label', 'Secondary', 'Secondary/Icon']));
    const svg = exportSvgString(rooms.get('lib')!.doc.nodes, [id]);
    expect(svg).toContain('Buy');
    await expect(callTool('set_instance_properties', { fileId: 'lib', instanceId: id, nested: [{ path: 'Primary/Label', swapTo: 'Icon/Heart' }] }, ctx)).rejects.toThrow(/not an instance/);
    await expect(callTool('set_instance_properties', { fileId: 'lib', instanceId: id, nested: [{ path: 'Primary/Icon', swapTo: 'Card' }] }, ctx)).rejects.toThrow(/contain itself/);
  });

  it('imports INSTANCE_SWAP properties from Figma', () => {
    const box = (x: number, y: number, w: number, h: number) => ({ absoluteBoundingBox: { x, y, width: w, height: h }, size: { x: w, y: h }, relativeTransform: [[1, 0, x], [0, 1, y]] });
    const file = {
      name: 'Swap',
      document: { id: '0:0', type: 'DOCUMENT', children: [{ id: '0:1', type: 'CANVAS', name: 'P', children: [
        { id: '1:1', type: 'COMPONENT', name: 'Star', ...box(0, 0, 16, 16), children: [] },
        { id: '1:2', type: 'COMPONENT', name: 'Heart', ...box(40, 0, 16, 16), children: [] },
        { id: '2:1', type: 'COMPONENT', name: 'Button', ...box(0, 100, 120, 40), componentPropertyDefinitions: { 'Icon#5:1': { type: 'INSTANCE_SWAP', defaultValue: '1:1' } },
          children: [{ id: '2:2', type: 'INSTANCE', name: 'Icon', componentId: '1:1', ...box(10, 112, 16, 16), componentPropertyReferences: { mainComponent: 'Icon#5:1' }, children: [] }] },
        { id: '3:1', type: 'INSTANCE', name: 'Btn', componentId: '2:1', ...box(0, 300, 120, 40), componentProperties: { 'Icon#5:1': { type: 'INSTANCE_SWAP', value: '1:2' } }, children: [] },
      ] }] },
    };
    const { doc } = convertFigmaFile(file);
    const byName = (n: string) => Object.values(doc.nodes).find((x: SceneNode) => x.name === n)!;
    expect(byName('Button').componentProps![0]).toMatchObject({ type: 'instance-swap', default: byName('Star').id, layer: 'Icon' });
    expect(byName('Btn').propValues).toEqual({ 'Icon#5:1': byName('Heart').id });
  });
});
