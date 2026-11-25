import { describe, expect, it } from 'vitest';
import { applyAutoLayout } from '../../src/lib/layout';
import { docWith, frame, rect } from './helpers';

const al = (o: object = {}) => ({ direction: 'horizontal' as const, gap: 10, padding: { t: 10, r: 10, b: 10, l: 10 }, align: 'start' as const, justify: 'start' as const, hugW: false, hugH: false, wrap: false, ...o });

describe('auto layout engine', () => {
  it('fill children share remaining space and stretch on the cross axis', () => {
    const d = docWith(frame({ id: 'f', w: 300, h: 100, autoLayout: al() }), rect({ id: 'a', parentId: 'f', w: 50, h: 20 }), rect({ id: 'b', parentId: 'f', w: 10, h: 20, layoutSizing: { h: 'fill', v: 'fill' } }), rect({ id: 'c', parentId: 'f', w: 10, h: 20, layoutSizing: { h: 'fill' } }));
    applyAutoLayout(d.nodes, 'f');
    // inner 280, fixed 50, gaps 20 -> 210 / 2
    expect(d.nodes.b.w).toBeCloseTo(105);
    expect(d.nodes.c.w).toBeCloseTo(105);
    expect(d.nodes.b.h).toBeCloseTo(80);
    expect(d.nodes.c.x).toBeCloseTo(10 + 50 + 10 + 105 + 10);
  });

  it('wraps onto new rows with counter gap', () => {
    const d = docWith(frame({ id: 'f', w: 130, h: 200, autoLayout: al({ wrap: true, counterGap: 5, hugH: true }) }), ...['a', 'b', 'c'].map((id) => rect({ id, parentId: 'f', w: 50, h: 20 })));
    applyAutoLayout(d.nodes, 'f');
    expect(d.nodes.b.y).toBe(d.nodes.a.y);
    expect(d.nodes.c.x).toBe(10);
    expect(d.nodes.c.y).toBe(10 + 20 + 5);
    expect(d.nodes.f.h).toBe(10 + 20 + 5 + 20 + 10);
  });

  it('absolute children keep their position and are skipped', () => {
    const d = docWith(frame({ id: 'f', w: 300, h: 100, autoLayout: al({ hugW: true }) }), rect({ id: 'a', parentId: 'f', w: 50, h: 20 }), rect({ id: 'z', parentId: 'f', x: 200, y: 70, w: 30, h: 30, layoutAbsolute: true }));
    applyAutoLayout(d.nodes, 'f');
    expect(d.nodes.z.x).toBe(200);
    expect(d.nodes.f.w).toBe(70);
  });

  it('respects min and max on fill children', () => {
    const d = docWith(frame({ id: 'f', w: 400, h: 50, autoLayout: al({ padding: { t: 0, r: 0, b: 0, l: 0 }, gap: 0 }) }), rect({ id: 'a', parentId: 'f', w: 10, h: 20, layoutSizing: { h: 'fill' }, maxW: 120 }));
    applyAutoLayout(d.nodes, 'f');
    expect(d.nodes.a.w).toBe(120);
  });
});
