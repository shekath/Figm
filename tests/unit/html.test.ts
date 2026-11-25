import { describe, expect, it } from 'vitest';
import { generateHtml, reachableFrames } from '../../src/lib/htmlExport';
import { insertSpec } from '../../src/lib/spec';
import { emptyDocument } from '../../src/lib/factory';

const build = () => {
  const d = emptyDocument('Site');
  const pg = d.pages[0].id;
  const home = insertSpec(d, pg, { type: 'frame', name: 'Home', width: 390, height: 600, autoLayout: { direction: 'vertical', gap: 12, padding: 24 }, children: [
    { type: 'text', text: '<script>alert(1)</script> & co', fontSize: 32, fontFamily: 'Poppins' },
    { type: 'rect', name: 'Card', width: 300, height: 80, radius: 12, fill: { type: 'linear', angle: 45, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] }, shadow: { y: 4, blur: 10 } },
    { type: 'path', svgPath: 'M0 0 L10 0 L5 10 Z' },
  ] }, null);
  const about = insertSpec(d, pg, { type: 'frame', name: 'About', x: 500, width: 390, height: 600 }, null);
  insertSpec(d, pg, { type: 'frame', name: 'Unlinked', x: 1000, width: 100, height: 100 }, null);
  const card = d.nodes[home].children[1];
  d.nodes[card].prototype = [{ trigger: 'click', action: 'navigate', targetId: about, animation: 'push', direction: 'left', duration: 300 }];
  return { d, home, about };
};

describe('design to HTML', () => {
  it('produces a self-contained document with flexbox auto layout', () => {
    const { d, home } = build();
    const html = generateHtml(d, [home], { prototype: false });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('display: flex');
    expect(html).toContain('flex-direction: column');
    expect(html).toContain('gap: 12px');
    expect(html).toContain('linear-gradient(45deg');
    expect(html).toContain('box-shadow');
    expect(html).toContain('<svg');
    expect(html).toContain('family=Poppins');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
    expect(html).not.toContain('data-links');
  });

  it('absolute layout positions children', () => {
    const { d, home } = build();
    const html = generateHtml(d, [home], { layout: 'absolute', prototype: false });
    expect(html).not.toContain('flex-direction: column');
    expect(html).not.toContain('gap: 12px');
    expect(html).toContain('position: absolute');
  });

  it('compiles prototype links into a runtime and follows reachable screens', () => {
    const { d, home, about } = build();
    const ids = reachableFrames(d, [home]);
    expect(ids.sort()).toEqual([home, about].sort());
    const html = generateHtml(d, ids, { prototype: true });
    expect(html).toContain('data-links');
    expect(html).toContain(`s-${about}`);
    expect(html).toContain('<script>');
    expect((html.match(/<section /g) ?? []).length).toBe(2);
  });
});
