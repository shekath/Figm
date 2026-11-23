import { nanoid } from 'nanoid';
import type { DocumentData, Effect, NodeType, Paint, SceneNode, Stroke, TextStyle } from '../types';

export const uid = () => nanoid(10);

export const solid = (color: string, opacity = 1): Paint => ({
  id: uid(),
  kind: 'solid',
  color,
  opacity,
  visible: true,
  stops: [
    { offset: 0, color },
    { offset: 1, color: '#ffffff' },
  ],
  angle: 90,
});

export const defaultStroke = (color = '#000000', width = 1): Stroke => ({
  color,
  width,
  opacity: 1,
  align: 'inside',
  dash: 0,
  cap: 'butt',
  join: 'miter',
  visible: true,
});

export const defaultEffect = (kind: Effect['kind'] = 'drop-shadow'): Effect => ({
  id: uid(),
  kind,
  x: 0,
  y: 4,
  blur: kind.includes('blur') ? 8 : 12,
  spread: 0,
  color: '#000000',
  opacity: 0.25,
  visible: true,
});

export const defaultText = (content = 'Text'): TextStyle => ({
  content,
  fontFamily: 'Inter',
  fontSize: 16,
  fontWeight: 400,
  italic: false,
  underline: false,
  strike: false,
  lineHeight: 1.3,
  letterSpacing: 0,
  align: 'left',
  vAlign: 'top',
  autoResize: 'width',
  transform: 'none',
});

const typeNames: Record<NodeType, string> = {
  frame: 'Frame',
  group: 'Group',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  polygon: 'Polygon',
  star: 'Star',
  line: 'Line',
  path: 'Vector',
  text: 'Text',
  image: 'Image',
  component: 'Component',
  instance: 'Instance',
};

export function createNode(type: NodeType, props: Partial<SceneNode> = {}): SceneNode {
  const base: SceneNode = {
    id: uid(),
    type,
    name: typeNames[type],
    parentId: null,
    children: [],
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    rotation: 0,
    opacity: 1,
    blend: 'normal',
    visible: true,
    locked: false,
    fills: [],
    strokes: [],
    effects: [],
    radius: 0,
    constraints: { h: 'left', v: 'top' },
  };
  switch (type) {
    case 'frame':
    case 'component':
      base.fills = [solid('#ffffff')];
      base.clip = true;
      break;
    case 'rect':
    case 'ellipse':
    case 'polygon':
    case 'star':
      base.fills = [solid('#d9d9d9')];
      if (type === 'polygon') base.sides = 3;
      if (type === 'star') {
        base.sides = 5;
        base.innerRatio = 0.38;
      }
      break;
    case 'line':
      base.strokes = [defaultStroke('#000000', 1)];
      base.h = 0;
      break;
    case 'path':
      base.strokes = [defaultStroke('#000000', 1)];
      break;
    case 'text':
      base.fills = [solid('#000000')];
      base.text = defaultText();
      break;
  }
  // ignore explicitly-undefined props so they never wipe defaults (e.g. name)
  const clean = Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined)) as Partial<SceneNode>;
  return { ...base, ...clean };
}

export function emptyDocument(name = 'Untitled'): DocumentData {
  const pageId = uid();
  return {
    format: 'vectura',
    version: 1,
    name,
    pages: [{ id: pageId, name: 'Page 1', children: [], background: '#f5f5f5' }],
    nodes: {},
    comments: [],
    colorStyles: [],
    textStyles: [],
    effectStyles: [],
    variables: [],
    versions: [],
  };
}

/** A small starter document so a first-time visitor sees something on the canvas. */
export function sampleDocument(): DocumentData {
  const doc = emptyDocument('Welcome to Vectura');
  const page = doc.pages[0];
  const add = (n: SceneNode, parent?: SceneNode) => {
    doc.nodes[n.id] = n;
    if (parent) {
      n.parentId = parent.id;
      parent.children.push(n.id);
    } else page.children.push(n.id);
    return n;
  };
  const frame = add(createNode('frame', { name: 'Mobile — Home', x: 80, y: 80, w: 375, h: 720, radius: 24 }));
  add(
    createNode('rect', {
      name: 'Header',
      x: 80,
      y: 80,
      w: 375,
      h: 220,
      fills: [
        {
          ...solid('#5b5bf7'),
          kind: 'linear',
          angle: 135,
          stops: [
            { offset: 0, color: '#5b5bf7' },
            { offset: 1, color: '#b44cf0' },
          ],
        },
      ],
    }),
    frame,
  );
  const title = add(
    createNode('text', { name: 'Title', x: 112, y: 150, w: 300, h: 40, fills: [solid('#ffffff')] }),
    frame,
  );
  title.text = { ...defaultText('Good morning ☀️'), fontSize: 30, fontWeight: 700, autoResize: 'fixed' };
  const sub = add(createNode('text', { name: 'Subtitle', x: 112, y: 196, w: 300, h: 24, fills: [solid('#e9e6ff')] }), frame);
  sub.text = { ...defaultText('Here is your design workspace'), fontSize: 16, autoResize: 'fixed' };
  for (let i = 0; i < 3; i++) {
    const card = add(
      createNode('rect', {
        name: `Card ${i + 1}`,
        x: 104,
        y: 330 + i * 120,
        w: 327,
        h: 100,
        radius: 16,
        fills: [solid('#ffffff')],
        strokes: [{ ...defaultStroke('#e5e5ef', 1) }],
        effects: [{ ...defaultEffect('drop-shadow'), y: 6, blur: 18, opacity: 0.08 }],
      }),
      frame,
    );
    void card;
    add(
      createNode('ellipse', {
        name: 'Avatar',
        x: 124,
        y: 354 + i * 120,
        w: 52,
        h: 52,
        fills: [solid(['#ffd43b', '#4cd4b0', '#ff6b6b'][i])],
      }),
      frame,
    );
    const t = add(createNode('text', { name: 'Card title', x: 192, y: 362 + i * 120, w: 220, h: 22 }), frame);
    t.text = { ...defaultText(['Design review', 'Prototype sync', 'Ship v1.0'][i]), fontSize: 17, fontWeight: 600, autoResize: 'fixed' };
    const d = add(createNode('text', { name: 'Card body', x: 192, y: 388 + i * 120, w: 220, h: 18, fills: [solid('#8a8aa0')] }), frame);
    d.text = { ...defaultText('Today · 10:00'), fontSize: 13, autoResize: 'fixed' };
  }
  const note = add(createNode('text', { name: 'Hint', x: 520, y: 90, w: 360, h: 200 }));
  note.text = {
    ...defaultText(
      'Tips\n• F frame, R rectangle, O ellipse, T text, P pen\n• Space + drag to pan, Ctrl + scroll to zoom\n• Ctrl+G group, Ctrl+Alt+K make component\n• Shift+A adds auto layout\n• Switch to Prototype to link frames, then ▶ Present',
    ),
    fontSize: 15,
    lineHeight: 1.6,
    autoResize: 'fixed',
  };
  note.fills = [solid('#333344')];
  return doc;
}
