import { describe, expect, it } from 'vitest';
import { EASINGS, scrollExtent, smartAnimateFrame } from '../../src/lib/proto';
import { insertSpec } from '../../src/lib/spec';
import { emptyDocument } from '../../src/lib/factory';

describe('prototype animation', () => {
  it('easings start at 0 and settle at 1', () => {
    for (const [name, f] of Object.entries(EASINGS)) {
      expect(f(0), name).toBeCloseTo(0, 2);
      expect(f(1), name).toBeCloseTo(1, 2);
    }
    expect(EASINGS['ease-in'](0.25)).toBeLessThan(0.25);
    expect(EASINGS['ease-out'](0.25)).toBeGreaterThan(0.25);
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => EASINGS.bouncy(i / 50)))).toBeGreaterThan(1); // overshoot
  });

  it('smart animate tweens matching layers and fades others', () => {
    const d = emptyDocument();
    const pg = d.pages[0].id;
    const a = insertSpec(d, pg, { type: 'frame', name: 'A', x: 0, width: 300, height: 300, children: [{ type: 'rect', name: 'Box', x: 0, y: 0, width: 50, height: 50, fill: '#000000' }, { type: 'rect', name: 'Old', x: 100, y: 100 }] }, null);
    const b = insertSpec(d, pg, { type: 'frame', name: 'B', x: 1000, width: 300, height: 300, children: [{ type: 'rect', name: 'Box', x: 100, y: 200, width: 150, height: 50, fill: '#ffffff' }, { type: 'rect', name: 'New', x: 0, y: 0 }] }, null);
    const half = smartAnimateFrame(d.nodes, a, b, 0.5);
    const box = Object.values(half.nodes).find((n) => n.name === 'Box' && n.parentId === b)!;
    expect(box.x - 1000).toBeCloseTo(50);
    expect(box.y).toBeCloseTo(100);
    expect(box.w).toBeCloseTo(100);
    expect(box.fills[0].color).toBe('#808080');
    const fresh = Object.values(half.nodes).find((n) => n.name === 'New')!;
    expect(fresh.opacity).toBeCloseTo(0.5);
    expect(half.leaving.roots.map((id) => d.nodes[id].name)).toEqual(['Old']);
    expect(half.leaving.nodes[half.leaving.roots[0]].x).toBe(1100); // moved into destination space
  });

  it('computes scroll extents', () => {
    const d = emptyDocument();
    const f = insertSpec(d, d.pages[0].id, { type: 'frame', width: 100, height: 100, children: [{ type: 'rect', y: 50, height: 250 }, { type: 'rect', y: 0, height: 900, fixed: true }] }, null);
    expect(scrollExtent(d.nodes, f)).toEqual({ maxX: 0, maxY: 200 });
  });
});
