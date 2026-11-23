import { describe, expect, it } from 'vitest';
import { describeNode, insertSpec, normColor, updateFromSpec } from '../../src/lib/spec';
import { emptyDocument } from '../../src/lib/factory';

describe('node specs (MCP)', () => {
  it('creates nested trees with relative coordinates and auto layout', () => {
    const d = emptyDocument();
    const pg = d.pages[0].id;
    const id = insertSpec(d, pg, {
      type: 'frame', x: 100, y: 50, width: 300, height: 400,
      autoLayout: { direction: 'vertical', gap: 10, padding: 20 },
      children: [{ type: 'rect', width: 50, height: 40 }, { type: 'text', text: 'Hi', fontSize: 20, color: '#ff0000' }],
    }, null);
    const f = d.nodes[id];
    const [a, b] = f.children.map((c) => d.nodes[c]);
    expect([f.x, f.y]).toEqual([100, 50]);
    expect([a.x, a.y]).toEqual([120, 70]);
    expect(b.y).toBe(a.y + 40 + 10);
    expect(b.fills[0].color).toBe('#ff0000');
    expect(b.text!.autoResize).toBe('width');
    expect(f.fills[0].color).toBe('#ffffff');
  });

  it('updates relative to the parent and moves children with frames', () => {
    const d = emptyDocument();
    const id = insertSpec(d, d.pages[0].id, { type: 'frame', x: 0, y: 0, width: 200, height: 200, children: [{ type: 'rect', x: 10, y: 10 }] }, null);
    const child = d.nodes[id].children[0];
    updateFromSpec(d, id, { x: 500 });
    expect(d.nodes[child].x).toBe(510);
    updateFromSpec(d, child, { x: 0, fill: '#00ff00', shadow: { y: 2, blur: 4 } });
    expect(d.nodes[child].x).toBe(500);
    expect(d.nodes[child].effects[0].kind).toBe('drop-shadow');
    expect(describeNode(d, child)).toMatchObject({ x: 0, y: 10, fills: ['#00ff00'] });
  });

  it('builds paths from SVG data and errors on unknown ids', () => {
    const d = emptyDocument();
    const id = insertSpec(d, d.pages[0].id, { type: 'path', svgPath: 'M0 0 L10 0 L10 10 Z', width: 100, height: 100 }, null);
    expect(d.nodes[id].w).toBeCloseTo(100);
    expect(d.nodes[id].fills.length).toBe(1);
    expect(() => updateFromSpec(d, 'nope', { x: 1 })).toThrow(/not found/);
  });

  it('normalises colours', () => {
    expect(normColor('#abc')).toBe('#aabbcc');
    expect(normColor('FF0000')).toBe('#ff0000');
    expect(normColor('rgb(0, 128, 255)')).toBe('#0080ff');
    expect(normColor('#11223344')).toBe('#112233');
    expect(normColor('white')).toBe('#ffffff');
    expect(normColor('garbage')).toBe('#000000');
  });
});

import { createNode } from '../../src/lib/factory';
describe('factory', () => {
  it('does not let undefined props wipe defaults', () => {
    expect(createNode('rect', { name: undefined }).name).toBe('Rectangle');
  });
});
