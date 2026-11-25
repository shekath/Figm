import { describe, expect, it } from 'vitest';
import { brushOutline } from '../../src/lib/brush';
import { bendSegment, cutAt, deletePoints, nearestSegment, pointInPolygon, reversePath } from '../../src/lib/pathEdit';
import { docWith, rect } from './helpers';

const line = () => {
  const d = docWith(rect({ id: 'p', type: 'path', w: 200, h: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }], closed: false }));
  return d.nodes.p;
};

describe('brush', () => {
  it('outlines a stroke as a closed ring wider than zero', () => {
    const pts = Array.from({ length: 20 }, (_, i) => ({ x: i * 10, y: 0, p: 0.5, t: i * 16 }));
    for (const style of ['round', 'taper', 'marker', 'ink', 'calligraphy', 'pressure'] as const) {
      const ring = brushOutline(pts, 20, style);
      expect(ring.length).toBeGreaterThan(20);
      const ys = ring.map((p) => p.y);
      expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(2);
    }
    expect(brushOutline([{ x: 5, y: 5 }], 10, 'round')).toHaveLength(16); // a dab
  });
  it('taper is thinner at the ends than the middle', () => {
    const pts = Array.from({ length: 40 }, (_, i) => ({ x: i * 5, y: 0 }));
    const ring = brushOutline(pts, 20, 'taper');
    const half = ring.length / 2;
    const near = (x: number) => Math.max(...ring.slice(0, half).filter((p) => Math.abs(p.x - x) < 6).map((p) => Math.abs(p.y)));
    expect(near(100)).toBeGreaterThan(near(3) * 2);
  });
});

describe('path editing', () => {
  it('finds and bends the nearest segment through the cursor', () => {
    const n = line();
    const near = nearestSegment(n, 50, 4)!;
    expect(near.i).toBe(0);
    bendSegment(n, near.i, 0.5, 50, 30);
    expect(n.points![0].cout!.y).toBeGreaterThan(20);
    expect(n.points![1].cin!.y).toBeGreaterThan(20);
  });
  it('erases points and reports when too few remain', () => {
    const n = line();
    expect(deletePoints(n, [1])).toBe(true);
    expect(n.points).toHaveLength(2);
    expect(deletePoints(n, [0])).toBe(false);
  });
  it('cuts an open path in two and opens a closed one', () => {
    const n = line();
    const second = cutAt(n, 1)!;
    expect(n.points).toHaveLength(2);
    expect(second).toHaveLength(2);
    const c = line();
    c.closed = true;
    expect(cutAt(c, 1)).toBeNull();
    expect(c.closed).toBe(false);
    expect(c.points![0].x).toBe(100);
  });
  it('lasso hit-test and reverse', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toBe(false);
    const n = line();
    reversePath(n);
    expect(n.points![0].x).toBe(200);
  });
});
