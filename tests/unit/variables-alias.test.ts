import { describe, expect, it } from 'vitest';
import { aliasCreatesCycle, applyAllBindings, exportTokens, importTokens, inScope, newCollection, variableValue } from '../../src/lib/variables';
import { docWith, frame } from './helpers';

const setup = () => {
  const d = docWith(frame({ id: 'f', bindings: { fill: 'surface' } }));
  const prim = newCollection('Primitives');
  const p = prim.modes[0].id;
  prim.variables.push({ id: 'white', name: 'gray/0', type: 'color', values: { [p]: '#ffffff' } }, { id: 'black', name: 'gray/900', type: 'color', values: { [p]: '#111111' } });
  const sem = newCollection('Semantic');
  const light = sem.modes[0].id;
  sem.modes.push({ id: 'dark', name: 'Dark' });
  sem.variables.push({ id: 'surface', name: 'bg/surface', type: 'color', values: { [light]: { alias: 'white' }, dark: { alias: 'black' } } });
  d.variables.push(prim, sem);
  return { d, sem, light };
};

describe('variable aliases', () => {
  it('resolves aliases per mode across collections', () => {
    const { d, sem } = setup();
    applyAllBindings(d);
    expect(d.nodes.f.fills[0].color).toBe('#ffffff');
    d.activeModes = { [sem.id]: 'dark' };
    applyAllBindings(d);
    expect(d.nodes.f.fills[0].color).toBe('#111111');
  });

  it('detects alias cycles and survives one', () => {
    const { d } = setup();
    expect(aliasCreatesCycle(d, 'white', 'surface')).toBe(true);
    expect(aliasCreatesCycle(d, 'surface', 'black')).toBe(false);
    const w = d.variables[0].variables[0];
    w.values[Object.keys(w.values)[0]] = { alias: 'surface' };
    expect(variableValue(d, 'surface', null)).toBeUndefined();
  });

  it('respects scopes', () => {
    const v = { id: 'x', name: 'x', type: 'color' as const, values: {}, scopes: ['stroke' as const] };
    expect(inScope(v, 'stroke')).toBe(true);
    expect(inScope(v, 'fill')).toBe(false);
    expect(inScope({ ...v, scopes: undefined }, 'fill')).toBe(true);
  });

  it('round-trips design tokens including aliases', () => {
    const { d } = setup();
    const json = exportTokens(d);
    expect((json.Semantic as any).Dark.bg.surface.$value).toBe('{Primitives.gray.900}');
    const d2 = docWith(frame({ id: 'f', bindings: {} }));
    expect(importTokens(d2, json)).toBe(3);
    const surface = d2.variables[1].variables[0];
    expect(surface.name).toBe('bg/surface');
    expect(variableValue(d2, surface.id, null)).toBe('#ffffff');
    d2.activeModes = { [d2.variables[1].id]: d2.variables[1].modes[1].id };
    expect(variableValue(d2, surface.id, null)).toBe('#111111');
  });
});
