import { describe, expect, it } from 'vitest';
import { ease, presetTracks, putKeyframe, sampleNodes, sampleTrack } from '../../src/lib/motion';
import { generateHtml } from '../../src/lib/htmlExport';
import { docWith, frame, rect } from './helpers';

describe('motion', () => {
  it('interpolates numbers, vectors and colours with easing', () => {
    const k = [{ id: 'a', t: 0, v: 0, ease: 'linear' as const }, { id: 'b', t: 1000, v: 100 }];
    expect(sampleTrack(k, 250)).toBe(25);
    expect(sampleTrack(k, -5)).toBe(0);
    expect(sampleTrack(k, 5000)).toBe(100);
    expect(sampleTrack([{ id: 'a', t: 0, v: { x: 0, y: 0 }, ease: 'linear' }, { id: 'b', t: 100, v: { x: 10, y: -20 } }], 50)).toEqual({ x: 5, y: -10 });
    expect(sampleTrack([{ id: 'a', t: 0, v: '#000000', ease: 'linear' }, { id: 'b', t: 100, v: '#ffffff' }], 50)).toBe('#808080');
    expect(ease('hold', 0.9)).toBe(0);
    expect(ease('spring', 1)).toBe(1);
    expect(ease('ease-out-back', 0.6)).toBeGreaterThan(1);
  });

  it('samples layers and moves children with their animated parent', () => {
    const d = docWith(frame({ id: 'f', x: 0, y: 0, w: 100, h: 100 }), rect({ id: 'r', parentId: 'f', x: 10, y: 10, w: 20, h: 20 }));
    putKeyframe(d.nodes.f, 'position', 0, { x: 0, y: 0 });
    putKeyframe(d.nodes.f, 'position', 1000, { x: 100, y: 0 });
    d.nodes.f.motion!.tracks.position![0].ease = 'linear';
    putKeyframe(d.nodes.r, 'opacity', 1000, 0.2);
    const s = sampleNodes(d.nodes, 500);
    expect(s.f.x).toBe(50);
    expect(s.r.x).toBe(60);
    expect(s.r.opacity).toBeLessThan(1);
    expect(d.nodes.f.x).toBe(0); // design untouched
  });

  it('first keyframe after zero anchors the design value at zero', () => {
    const d = docWith(rect({ id: 'r', opacity: 1 }));
    putKeyframe(d.nodes.r, 'opacity', 600, 0);
    expect(d.nodes.r.motion!.tracks.opacity!.map((k) => [k.t, k.v])).toEqual([[0, 1], [600, 0]]);
  });

  it('presets produce tracks and HTML export emits CSS keyframes', () => {
    const d = docWith(frame({ id: 'f', w: 200, h: 200 }), rect({ id: 'r', parentId: 'f' }));
    d.nodes.r.motion = { tracks: presetTracks(d.nodes.r, 'slide-up', 0, 600) };
    expect(d.nodes.r.motion.tracks.position?.length).toBe(2);
    const html = generateHtml({ ...d, motion: { duration: 1000, loop: false } }, ['f']);
    expect(html).toMatch(/@keyframes m-/);
    expect(html).toMatch(/animation: m-[^;]+ 1000ms linear 1 forwards/);
  });
});
