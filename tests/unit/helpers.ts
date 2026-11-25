import { createNode, emptyDocument } from '../../src/lib/factory';
import type { DocumentData, SceneNode } from '../../src/types';

export function docWith(...nodes: SceneNode[]): DocumentData {
  const d = emptyDocument('Test');
  for (const n of nodes) {
    d.nodes[n.id] = n;
    if (n.parentId) d.nodes[n.parentId].children.push(n.id);
    else d.pages[0].children.push(n.id);
  }
  return d;
}
export const rect = (p: Partial<SceneNode> = {}) => createNode('rect', p);
export const frame = (p: Partial<SceneNode> = {}) => createNode('frame', p);
