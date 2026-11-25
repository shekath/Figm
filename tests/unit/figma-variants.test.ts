import { describe, expect, it } from 'vitest';
import { convertFigmaFile } from '../../src/lib/figmaImport';

const box = (x: number, y: number, w: number, h: number) => ({ absoluteBoundingBox: { x, y, width: w, height: h }, size: { x: w, y: h }, relativeTransform: [[1, 0, x], [0, 1, y]] });
const solid = (r: number, g: number, b: number) => [{ type: 'SOLID', color: { r, g, b, a: 1 } }];

const file = {
  name: 'Variants',
  document: {
    id: '0:0', type: 'DOCUMENT', children: [{
      id: '0:1', type: 'CANVAS', name: 'Page', children: [
        {
          id: '1:1', type: 'COMPONENT_SET', name: 'Toggle', ...box(0, 0, 200, 60),
          componentPropertyDefinitions: { State: { type: 'VARIANT', defaultValue: 'Off' }, 'Show label#9:1': { type: 'BOOLEAN', defaultValue: true }, 'Text#9:2': { type: 'TEXT', defaultValue: 'Wi-Fi' } },
          children: [
            { id: '1:2', type: 'COMPONENT', name: 'State=Off', ...box(0, 0, 80, 40), fills: solid(0.8, 0.8, 0.8),
              interactions: [{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'NODE', destinationId: '1:3', navigation: 'CHANGE_TO', transition: { type: 'SMART_ANIMATE', duration: 0.25, easing: { type: 'GENTLE' } } }] }],
              children: [{ id: '1:4', type: 'TEXT', name: 'Label', characters: 'Wi-Fi', ...box(5, 5, 40, 20), style: { fontSize: 12 }, componentPropertyReferences: { visible: 'Show label#9:1', characters: 'Text#9:2' } }] },
            { id: '1:3', type: 'COMPONENT', name: 'State=On', ...box(100, 0, 80, 40), fills: solid(0.2, 0.8, 0.4),
              children: [{ id: '1:5', type: 'TEXT', name: 'Label', characters: 'Wi-Fi', ...box(105, 5, 40, 20), style: { fontSize: 12 } }] },
          ],
        },
        { id: '2:1', type: 'FRAME', name: 'Screen', ...box(0, 200, 300, 300), fills: solid(1, 1, 1), children: [
          { id: '2:2', type: 'INSTANCE', name: 'Toggle', componentId: '1:2', ...box(20, 220, 80, 40), componentProperties: { State: { type: 'VARIANT', value: 'Off' }, 'Show label#9:1': { type: 'BOOLEAN', value: false }, 'Text#9:2': { type: 'TEXT', value: 'Bluetooth' } }, children: [] },
          { id: '2:3', type: 'INSTANCE', name: 'Overridden', componentId: '1:2', overrides: [{ id: '2:3', overriddenFields: ['fills'] }], ...box(20, 300, 80, 40), fills: solid(1, 0, 0), children: [] },
        ] },
      ],
    }],
  },
};

describe('Figma import: variants and interactive components', () => {
  const { doc } = convertFigmaFile(file);
  const byName = (n: string) => Object.values(doc.nodes).find((x) => x.name === n)!;

  it('keeps component sets and variant properties', () => {
    const set = byName('Toggle');
    expect(set.isComponentSet).toBe(true);
    expect(byName('State=Off').variantProps).toEqual({ State: 'Off' });
    expect(byName('State=On').variantProps).toEqual({ State: 'On' });
  });

  it('maps boolean/text component properties to layer paths', () => {
    const props = byName('Toggle').componentProps!;
    expect(props.map((p) => [p.name, p.type, p.layer])).toEqual([
      ['Show label', 'boolean', 'Label'],
      ['Text', 'text', 'Label'],
    ]);
  });

  it('links instances without overrides and carries property values', () => {
    const inst = Object.values(doc.nodes).find((n) => n.type === 'instance')!;
    expect(inst.componentId).toBe(byName('State=Off').id);
    expect(inst.propValues).toEqual({ 'Show label#9:1': false, 'Text#9:2': 'Bluetooth' });
    expect(byName('Overridden').type).toBe('frame'); // overridden instance stays detached for fidelity
  });

  it('maps CHANGE_TO interactions', () => {
    const l = byName('State=Off').prototype![0];
    expect(l).toMatchObject({ action: 'change-to', targetId: byName('State=On').id, animation: 'smart-animate', easing: 'gentle', duration: 250 });
  });
});
