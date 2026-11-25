import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor, onLocalPatch } from '../../src/store/store';
import { emptyDocument, createNode } from '../../src/lib/factory';

const S = () => useEditor.getState();
const add = (type: 'rect' | 'ellipse' | 'frame', p = {}) => {
  const n = createNode(type, p);
  S().addNode(n);
  return n.id;
};

describe('editor store', () => {
  beforeEach(() => S().setDoc(emptyDocument('t')));

  it('groups, ungroups and undoes', () => {
    const a = add('rect', { x: 0, y: 0 });
    const b = add('rect', { x: 200, y: 100 });
    S().select([a, b]);
    S().group();
    const g = S().selection[0];
    expect(S().doc.nodes[g]).toMatchObject({ type: 'group', x: 0, y: 0, w: 300, h: 200 });
    S().ungroup();
    expect(S().doc.nodes[g]).toBeUndefined();
    S().undo();
    expect(S().doc.nodes[g].children).toEqual([a, b]);
    S().redo();
    expect(S().page().children).toEqual([a, b]);
  });

  it('keeps unchanged nodes by reference (structural sharing)', () => {
    const a = add('rect');
    const b = add('rect');
    const before = S().doc.nodes[b];
    S().updateNodes([a], { x: 99 });
    expect(S().doc.nodes[b]).toBe(before);
  });

  it('emits local patches but not for remote changes', () => {
    const seen: string[][] = [];
    const off = onLocalPatch((p) => seen.push(Object.keys(p.nodes ?? {})));
    const a = add('rect');
    S().applyRemote({ nodes: { remote1: { ...S().doc.nodes[a], id: 'remote1' } } });
    off();
    expect(seen).toEqual([[a]]);
    expect(S().page().children).toContain('remote1'); // repair attached the orphan root
  });

  it('local undo never reverts collaborators’ edits', () => {
    const a = add('rect', { x: 0 });
    S().updateNodes([a], { x: 10 });
    S().applyRemote({ nodes: { [a]: { ...S().doc.nodes[a], name: 'Renamed by Ben' } } });
    S().undo(); // undoes my x change, but Ben's version of the node wins for that node
    expect(S().doc.nodes[a].name).toBe('Renamed by Ben');
  });

  it('runs boolean operations and variable bindings', () => {
    const a = add('rect', { x: 0, y: 0, w: 100, h: 100 });
    const b = add('ellipse', { x: 50, y: 50, w: 100, h: 100 });
    S().select([a, b]);
    S().booleanOp('union');
    const u = S().selection[0];
    expect(S().doc.nodes[u].rings!.length).toBe(1);
    const col = S().addCollection('Theme');
    const v = S().addVariable(col, 'color', 'brand');
    const mode = S().doc.variables[0].modes[0].id;
    S().setVariableValue(col, v, mode, '#123456');
    S().bindVariable([u], 'fill', v);
    expect(S().doc.nodes[u].fills[0].color).toBe('#123456');
    S().setVariableValue(col, v, mode, '#654321');
    expect(S().doc.nodes[u].fills[0].color).toBe('#654321');
  });

  it('auto layout reorders and hugs', () => {
    const f = add('frame', { x: 0, y: 0, w: 500, h: 500 });
    const kids = [0, 1, 2].map((i) => {
      const n = createNode('rect', { x: i * 120, y: 0, w: 100, h: 50 });
      S().addNode(n, f);
      return n.id;
    });
    S().select([f]);
    S().toggleAutoLayout();
    const fr = S().doc.nodes[f];
    expect(fr.autoLayout!.direction).toBe('horizontal');
    expect(fr.w).toBe(10 + 100 * 3 + 10 * 2 + 10);
    expect(S().doc.nodes[kids[1]].x - S().doc.nodes[kids[0]].x).toBe(110);
  });
});
