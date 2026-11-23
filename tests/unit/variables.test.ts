import { describe, expect, it } from 'vitest';
import { applyAllBindings, newCollection, resolveMode, variableValue } from '../../src/lib/variables';
import { docWith, frame, rect } from './helpers';

const setup = () => {
  const d = docWith(frame({ id: 'f', bindings: { fill: 'bg' }, autoLayout: { direction: 'vertical', gap: 0, padding: { t: 0, r: 0, b: 0, l: 0 }, align: 'start', justify: 'start', hugW: false, hugH: false, wrap: false } }), rect({ id: 'r', parentId: 'f', bindings: { radius: 'rad', opacity: 'op' } }), rect({ id: 'r2', parentId: 'f', y: 0 }));
  d.nodes.f.bindings = { fill: 'bg', gap: 'space' };
  const c = newCollection('Theme');
  c.modes.push({ id: 'dark', name: 'Dark' });
  const light = c.modes[0].id;
  c.variables.push(
    { id: 'bg', name: 'bg', type: 'color', values: { [light]: '#ffffff', dark: '#000000' } },
    { id: 'rad', name: 'radius', type: 'number', values: { [light]: 4, dark: 12 } },
    { id: 'op', name: 'op', type: 'number', values: { [light]: 50, dark: 1 } },
    { id: 'space', name: 'space', type: 'number', values: { [light]: 8, dark: 24 } },
  );
  d.variables.push(c);
  return { d, c, light };
};

describe('variables', () => {
  it('applies bound values for the active mode', () => {
    const { d } = setup();
    applyAllBindings(d);
    expect(d.nodes.f.fills[0].color).toBe('#ffffff');
    expect(d.nodes.r.radius).toBe(4);
    expect(d.nodes.r.opacity).toBe(0.5); // percentages are normalised
    expect(d.nodes.f.autoLayout!.gap).toBe(8);
  });

  it('switches modes globally and re-runs auto layout', () => {
    const { d, c } = setup();
    d.activeModes = { [c.id]: 'dark' };
    applyAllBindings(d);
    expect(d.nodes.f.fills[0].color).toBe('#000000');
    expect(d.nodes.r2.y - d.nodes.r.y).toBe(d.nodes.r.h + 24);
  });

  it('per-frame overrides win over the document mode and inherit to children', () => {
    const { d, c, light } = setup();
    d.activeModes = { [c.id]: 'dark' };
    d.nodes.f.modeOverrides = { [c.id]: light };
    expect(resolveMode(d, 'r', c)).toBe(light);
    expect(variableValue(d, 'rad', 'r')).toBe(4);
  });

  it('ignores bindings to deleted variables', () => {
    const { d } = setup();
    d.nodes.r.bindings = { fill: 'missing' };
    expect(() => applyAllBindings(d)).not.toThrow();
  });
});
