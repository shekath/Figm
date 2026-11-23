import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { applyPatch, diffDocs, mergePatches, repairDocument } from '../../src/lib/docops';
import { docWith, frame, rect } from './helpers';

describe('docops', () => {
  it('diffs only changed nodes (structural sharing)', () => {
    const a = docWith(rect({ id: 'r1' }), rect({ id: 'r2' }));
    const b = produce(a, (d) => {
      d.nodes.r1.x = 50;
    });
    const p = diffDocs(a, b)!;
    expect(Object.keys(p.nodes!)).toEqual(['r1']);
    expect(p.pages).toBeUndefined();
    expect(applyPatch(a, p).nodes.r1.x).toBe(50);
  });

  it('records deletions as null and round-trips', () => {
    const a = docWith(rect({ id: 'r1' }), rect({ id: 'r2' }));
    const b = produce(a, (d) => {
      delete d.nodes.r2;
      d.pages[0].children = ['r1'];
    });
    const p = diffDocs(a, b)!;
    expect(p.nodes!.r2).toBeNull();
    expect(applyPatch(a, p)).toEqual(b);
  });

  it('merges patches with later values winning', () => {
    const m = mergePatches({ nodes: { a: null } }, { nodes: { b: null }, meta: { name: 'x' } })!;
    expect(Object.keys(m.nodes!)).toEqual(['a', 'b']);
    expect(m.meta!.name).toBe('x');
  });

  it('repairs dangling parents, duplicate children and orphans', () => {
    const f = frame({ id: 'f' });
    const r = rect({ id: 'r', parentId: 'f' });
    const d = docWith(f, r);
    d.nodes.f.children.push('r', 'ghost'); // duplicate + missing
    d.nodes.x = rect({ id: 'x', parentId: 'nope' }); // dangling parent, not on any page
    const fixed = repairDocument(d);
    expect(fixed.nodes.f.children).toEqual(['r']);
    expect(fixed.nodes.x.parentId).toBeNull();
    expect(fixed.pages[0].children).toContain('x');
  });

  it('breaks parent cycles', () => {
    const d = docWith(frame({ id: 'a' }));
    d.nodes.b = frame({ id: 'b', parentId: 'a' });
    d.nodes.a = { ...d.nodes.a, parentId: 'b' };
    const fixed = repairDocument(d);
    const parents = [fixed.nodes.a.parentId, fixed.nodes.b.parentId];
    expect(parents).toContain(null);
  });

  it('returns the same object when nothing needs fixing', () => {
    const d = docWith(frame({ id: 'f' }), rect({ id: 'r', parentId: 'f' }));
    expect(repairDocument(d)).toBe(d);
  });
});
