import { describe, expect, it } from 'vitest';
import * as C from '../../src/lib/components';
import { emptyDocument, createNode } from '../../src/lib/factory';
import { insertSpec } from '../../src/lib/spec';
import { generateHtml } from '../../src/lib/htmlExport';
import type { DocumentData } from '../../src/types';

/** Button component set with Default/Hover variants, an icon and a label. */
function buttonSet() {
  const d = emptyDocument();
  const pg = d.pages[0].id;
  const mk = (name: string, x: number, color: string) =>
    insertSpec(d, pg, { type: 'component', name, x, y: 0, width: 120, height: 40, fill: color, children: [{ type: 'ellipse', name: 'Icon', x: 8, y: 12, width: 16, height: 16 }, { type: 'text', name: 'Label', x: 32, y: 10, text: 'Buy' }] }, null);
  const a = mk('State=Default', 0, '#5b5bf7');
  const b = mk('State=Hover', 200, '#3b3bd7');
  const setId = C.combineAsVariants(d, [a, b], 'Button');
  return { d, pg, a, b, setId };
}

const instOf = (d: DocumentData, compId: string, parentId: string | null = null) => {
  const c = d.nodes[compId];
  const i = createNode('instance', { componentId: compId, w: c.w, h: c.h, x: 0, y: 500, fills: [], parentId, overrides: {} });
  d.nodes[i.id] = i;
  (parentId ? d.nodes[parentId].children : d.pages[0].children).push(i.id);
  return i.id;
};

describe('variant names', () => {
  it('parses and formats', () => {
    expect(C.parseVariantName('State=Hover, Size = L')).toEqual({ State: 'Hover', Size: 'L' });
    expect(C.parseVariantName('Just a name')).toBeNull();
    expect(C.variantName({ A: '1', B: '2' })).toBe('A=1, B=2');
  });
});

describe('component sets', () => {
  it('combines components into a set with variant properties', () => {
    const { d, setId, a, b } = buttonSet();
    const set = d.nodes[setId];
    expect(set.isComponentSet).toBe(true);
    expect(set.children).toEqual([a, b]);
    expect(C.variantDefs(d.nodes, setId)).toEqual([{ name: 'State', values: ['Default', 'Hover'] }]);
    expect(d.nodes[b].x).toBeGreaterThan(d.nodes[a].x + d.nodes[a].w); // laid out side by side
    expect(C.setOf(d.nodes, a)?.id).toBe(setId);
  });

  it('names plain components when combining', () => {
    const d = emptyDocument();
    const x = insertSpec(d, d.pages[0].id, { type: 'component', name: 'Primary' }, null);
    const y = insertSpec(d, d.pages[0].id, { type: 'component', name: 'Secondary', x: 200 }, null);
    const s = C.combineAsVariants(d, [x, y]);
    expect(d.nodes[x].name).toBe('Property 1=Primary');
    expect(C.variantDefs(d.nodes, s)[0].values).toEqual(['Primary', 'Secondary']);
  });

  it('adds variants with unique values and renames props/values everywhere', () => {
    const { d, setId, b } = buttonSet();
    const c = C.addVariant(d, b, 'State', 'Pressed');
    expect(d.nodes[c].name).toBe('State=Pressed');
    expect(d.nodes[setId].children).toHaveLength(3);
    const auto = C.addVariant(d, setId);
    expect(d.nodes[auto].variantProps!.State).toMatch(/^Variant/);
    C.addVariantProp(d, setId, 'Size', 'M');
    expect(d.nodes[c].name).toBe('State=Pressed, Size=M');
    C.renameVariantProp(d, setId, 'State', 'Status');
    C.renameVariantValue(d, setId, 'Status', 'Pressed', 'Active');
    expect(d.nodes[c].name).toBe('Status=Active, Size=M');
  });
});

describe('instances', () => {
  it('switch variants by property and keep overrides by layer path', () => {
    const { d, a, b, setId } = buttonSet();
    const inst = instOf(d, a);
    const labelA = C.findByPath(d.nodes, a, 'Label')!;
    d.nodes[inst].overrides = { [labelA]: { text: { ...d.nodes[labelA].text!, content: 'Checkout' } } };
    expect(C.setInstanceVariant(d, inst, 'State', 'Hover')).toBe(b);
    const labelB = C.findByPath(d.nodes, b, 'Label')!;
    expect(d.nodes[inst].componentId).toBe(b);
    expect(d.nodes[inst].overrides![labelB].text!.content).toBe('Checkout');
    expect(d.nodes[inst].name).toBe(d.nodes[setId].name);
  });

  it('finds the closest variant when no exact match exists', () => {
    const { d, setId, b } = buttonSet();
    C.addVariantProp(d, setId, 'Size', 'M');
    expect(C.findVariant(d.nodes, setId, { State: 'Hover', Size: 'XL' })).toBe(b);
  });

  it('applies boolean and text component properties across variants', () => {
    const { d, a, b, setId } = buttonSet();
    const icon = C.findByPath(d.nodes, a, 'Icon')!;
    const label = C.findByPath(d.nodes, a, 'Label')!;
    const pShow = C.addComponentProp(d, icon, 'boolean');
    const pText = C.addComponentProp(d, label, 'text', 'Label');
    expect(d.nodes[setId].componentProps).toHaveLength(2); // stored on the set
    expect(pShow.layer).toBe('Icon');
    const inst = instOf(d, b);
    d.nodes[inst].propValues = { [pShow.id]: false, [pText.id]: 'Pay now' };
    const ov = C.instanceOverrides(d.nodes, d.nodes[inst]);
    expect(ov[C.findByPath(d.nodes, b, 'Icon')!].visible).toBe(false);
    expect(ov[C.findByPath(d.nodes, b, 'Label')!].text!.content).toBe('Pay now');
    expect(() => C.addComponentProp(d, d.pages[0].children[0], 'boolean')).toThrow();
  });
});

describe('interactive components in HTML export', () => {
  it('emits all variants and a change-to runtime', () => {
    const { d, pg, a, b } = buttonSet();
    d.nodes[a].prototype = [{ trigger: 'hover', action: 'change-to', targetId: b, animation: 'smart-animate', duration: 200 }];
    const screen = insertSpec(d, pg, { type: 'frame', name: 'Screen', x: 0, y: 300, width: 300, height: 200 }, null);
    instOf(d, a, screen);
    const html = generateHtml(d, [screen], { prototype: true });
    expect(html).toContain('data-instance');
    expect(html).toContain(`data-variant="v-${a}"`);
    expect(html).toContain(`data-variant="v-${b}"`);
    expect(html).toContain('&quot;a&quot;:&quot;change-to&quot;'); // JSON is attribute-escaped
    expect(html).toContain('changeVariant');
    // static export keeps only the current variant
    const flat = generateHtml(d, [screen], { prototype: false });
    expect(flat).not.toContain('data-variant');
  });
});
