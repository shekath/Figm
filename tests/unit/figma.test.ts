import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { collectImageRefs, convertFigmaFile, parseFigmaKey } from '../../src/lib/figmaImport';

const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/figma-file.json', import.meta.url), 'utf8'));

describe('Figma REST import', () => {
  const { doc, stats } = convertFigmaFile(fixture, { abc123: 'data:image/png;base64,AAAA' });
  const byName = (n: string) => Object.values(doc.nodes).find((x) => x.name === n)!;

  it('converts pages, frames and counts', () => {
    expect(stats.pages).toBe(1);
    expect(stats.skipped).toBe(1); // slice
    expect(doc.pages[0].children.length).toBe(2);
    expect(doc.pages[0].background).toBe('#f5f5f5');
  });

  it('maps auto layout, text, gradients and effects', () => {
    const home = byName('Home');
    expect(home.autoLayout).toMatchObject({ direction: 'vertical', gap: 12, align: 'center' });
    const title = byName('Title');
    expect(title.text).toMatchObject({ content: 'Hello', fontSize: 24, fontWeight: 700, align: 'center' });
    expect(title.text!.lineHeight).toBeCloseTo(1.33, 2);
    const btn = byName('Button');
    expect(btn.fills[0].kind).toBe('linear');
    expect(btn.fills[0].angle).toBe(90);
    expect(btn.effects[0]).toMatchObject({ kind: 'drop-shadow', y: 4, blur: 12 });
    expect(btn.radius).toBe(8);
  });

  it('keeps rotation and centre from relativeTransform', () => {
    const e = byName('Rotated');
    expect(e.rotation).toBeCloseTo(45, 1);
    expect(e.x + e.w / 2).toBeCloseTo(650);
    expect(e.y + e.h / 2).toBeCloseTo(150);
  });

  it('converts vector geometry with holes', () => {
    expect(byName('Icon').rings!.length).toBe(2);
  });

  it('remaps prototype links, flow start, styles, components and images', () => {
    const btn = byName('Button');
    const details = byName('Details');
    expect(btn.prototype![0]).toMatchObject({ targetId: details.id, animation: 'smart-animate', duration: 400, easing: 'ease-out' });
    expect(doc.pages[0].startFrameId).toBe(byName('Home').id);
    expect(doc.colorStyles[0].name).toBe('Surface/White');
    expect(details.type).toBe('component');
    expect(details.description).toBe('Detail screen');
    expect(details.fills[0]).toMatchObject({ kind: 'image', src: 'data:image/png;base64,AAAA' });
  });

  it('parses file keys from URLs', () => {
    expect(parseFigmaKey('https://www.figma.com/design/AbCdEf123456/My-File?node-id=1-2')).toBe('AbCdEf123456');
    expect(parseFigmaKey('https://www.figma.com/file/KEY1234567890/x')).toBe('KEY1234567890');
    expect(parseFigmaKey('https://www.figma.com/design/MAINKEY12345/branch/BRANCHKEY123/x')).toBe('BRANCHKEY123');
    expect(parseFigmaKey('not a url')).toBeNull();
    expect(collectImageRefs(fixture)).toEqual(['abc123']);
  });
});
