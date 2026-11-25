import { useMemo } from 'react';
import { useEditor } from '../store/store';
import { sampleNodes } from '../lib/motion';

/** Nodes as they appear on the canvas: the animated state at the playhead in Motion mode, the design otherwise. */
export function useDisplayNodes() {
  const nodes = useEditor((s) => s.doc.nodes);
  const mode = useEditor((s) => s.mode);
  const t = useEditor((s) => s.motionTime);
  return useMemo(() => (mode === 'motion' ? sampleNodes(nodes, t) : nodes), [nodes, mode, t]);
}
