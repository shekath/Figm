import { describe, expect, it } from 'vitest';
import { applyBoolean, computeBoolean, nodeGeometry, ringsPath } from '../../src/lib/boolean';
import { createNode } from '../../src/lib/factory';
import { docWith, rect } from './helpers';

const area = (rings: { x: number; y: number }[][]) =>
  rings.reduce((s, r) => s + Math.abs(r.reduce((a, p, i) => a + p.x * r[(i + 1) % r.length].y - r[(i + 1) % r.length].x * p.y, 0) / 2), 0);

describe('boolean operations', () => {
  const setup = () => docWith(rect({ id: 'a', x: 0, y: 0, w: 100, h: 100 }), rect({ id: 'b', x: 50, y: 0, w: 100, h: 100 }));

  it.each([
    ['union', 15000],
    ['subtract', 5000],
    ['intersect', 5000],
  ] as const)('%s produces the right area', (op, expected) => {
    const d = setup();
    const id = applyBoolean(d, d.pages[0].id, ['a', 'b'], op)!;
    expect(area(d.nodes[id].rings!)).toBeCloseTo(expected, 0);
    expect(d.nodes.a).toBeUndefined();
    expect(d.pages[0].children).toEqual([id]);
  });

  it('exclude keeps two separate pieces', () => {
    const d = setup();
    const id = applyBoolean(d, d.pages[0].id, ['a', 'b'], 'exclude')!;
    expect(d.nodes[id].rings!.length).toBe(2);
    expect(area(d.nodes[id].rings!)).toBeCloseTo(10000, 0);
  });

  it('respects rotation when building geometry', () => {
    const d = docWith(rect({ id: 'r', x: 0, y: 0, w: 100, h: 100, rotation: 45 }));
    const g = nodeGeometry(d.nodes, 'r');
    const xs = g[0][0].map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(50 - 70.71, 1);
  });

  it('keeps the result inside the parent at the bottom shape index', () => {
    const f = createNode('frame', { id: 'f', w: 400, h: 400 });
    const d = docWith(f, rect({ id: 'top', parentId: 'f' }), rect({ id: 'a', parentId: 'f' }), rect({ id: 'b', parentId: 'f', x: 20 }));
    const id = applyBoolean(d, d.pages[0].id, ['a', 'b'], 'union')!;
    expect(d.nodes.f.children).toEqual(['top', id]);
    expect(d.nodes[id].parentId).toBe('f');
  });

  it('handles empty inputs and emits path data', () => {
    expect(computeBoolean([], 'union')).toEqual([]);
    expect(ringsPath([[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]])).toBe('M0,0 L1,0 L1,1 Z');
  });
});
