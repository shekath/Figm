import { describe, expect, it } from 'vitest';
import { deflateSync, zipSync } from 'fflate';
import { importFigFile, readFigArchive } from '../../src/lib/figFile';
import { decodeCommands } from '../../src/lib/kiwi';

/* ---------- a tiny kiwi encoder (inverse of the decoder) to build synthetic .fig files ---------- */
class W {
  out: number[] = [];
  byte(b: number) {
    this.out.push(b & 255);
  }
  varUint(v: number) {
    v >>>= 0;
    do {
      const b = v & 127;
      v >>>= 7;
      this.byte(v ? b | 128 : b);
    } while (v);
  }
  varInt(v: number) {
    this.varUint((v << 1) ^ (v >> 31));
  }
  float(v: number) {
    const f = new Float32Array([v]);
    let bits = new Uint32Array(f.buffer)[0];
    bits = (bits >>> 23) | (bits << 9);
    if ((bits & 255) === 0) return this.byte(0);
    this.byte(bits);
    this.byte(bits >>> 8);
    this.byte(bits >>> 16);
    this.byte(bits >>> 24);
  }
  string(s: string) {
    for (const b of new TextEncoder().encode(s)) this.byte(b);
    this.byte(0);
  }
  bytes() {
    return new Uint8Array(this.out);
  }
}

type FieldSpec = [name: string, type: string, isArray?: boolean];
type DefSpec = { name: string; kind: 'ENUM' | 'STRUCT' | 'MESSAGE'; fields: FieldSpec[] | string[] };
const BUILTIN: Record<string, number> = { bool: -1, byte: -2, int: -3, uint: -4, float: -5, string: -6 };

const DEFS: DefSpec[] = [
  { name: 'NodeType', kind: 'ENUM', fields: ['DOCUMENT', 'CANVAS', 'FRAME', 'GROUP', 'VECTOR', 'RECTANGLE', 'ELLIPSE', 'TEXT', 'SYMBOL', 'INSTANCE', 'STICKY'] },
  { name: 'PaintType', kind: 'ENUM', fields: ['SOLID', 'GRADIENT_LINEAR', 'IMAGE'] },
  { name: 'StackMode', kind: 'ENUM', fields: ['NONE', 'HORIZONTAL', 'VERTICAL'] },
  { name: 'GUID', kind: 'STRUCT', fields: [['sessionID', 'uint'], ['localID', 'uint']] },
  { name: 'Color', kind: 'STRUCT', fields: [['r', 'float'], ['g', 'float'], ['b', 'float'], ['a', 'float']] },
  { name: 'Vector', kind: 'STRUCT', fields: [['x', 'float'], ['y', 'float']] },
  { name: 'Matrix', kind: 'STRUCT', fields: [['m00', 'float'], ['m01', 'float'], ['m02', 'float'], ['m10', 'float'], ['m11', 'float'], ['m12', 'float']] },
  { name: 'ParentIndex', kind: 'MESSAGE', fields: [['guid', 'GUID'], ['position', 'string']] },
  { name: 'Image', kind: 'MESSAGE', fields: [['hash', 'byte', true]] },
  { name: 'Paint', kind: 'MESSAGE', fields: [['type', 'PaintType'], ['color', 'Color'], ['opacity', 'float'], ['visible', 'bool'], ['image', 'Image']] },
  { name: 'TextData', kind: 'MESSAGE', fields: [['characters', 'string']] },
  { name: 'Path', kind: 'MESSAGE', fields: [['commandsBlob', 'uint']] },
  { name: 'GUIDPath', kind: 'MESSAGE', fields: [['guids', 'GUID', true]] },
  { name: 'Override', kind: 'MESSAGE', fields: [['guidPath', 'GUIDPath'], ['textData', 'TextData']] },
  { name: 'SymbolData', kind: 'MESSAGE', fields: [['symbolID', 'GUID'], ['symbolOverrides', 'Override', true]] },
  {
    name: 'NodeChange',
    kind: 'MESSAGE',
    fields: [
      ['guid', 'GUID'], ['parentIndex', 'ParentIndex'], ['type', 'NodeType'], ['name', 'string'], ['visible', 'bool'],
      ['size', 'Vector'], ['transform', 'Matrix'], ['fillPaints', 'Paint', true], ['textData', 'TextData'], ['fontSize', 'float'],
      ['stackMode', 'StackMode'], ['stackSpacing', 'float'], ['fillGeometry', 'Path', true], ['symbolData', 'SymbolData'], ['cornerRadius', 'float'],
    ],
  },
  { name: 'Blob', kind: 'MESSAGE', fields: [['bytes', 'byte', true]] },
  { name: 'Message', kind: 'MESSAGE', fields: [['nodeChanges', 'NodeChange', true], ['blobs', 'Blob', true]] },
];
const index = new Map(DEFS.map((d, i) => [d.name, i]));

function encodeSchema() {
  const w = new W();
  w.varUint(DEFS.length);
  for (const d of DEFS) {
    w.string(d.name);
    w.byte(['ENUM', 'STRUCT', 'MESSAGE'].indexOf(d.kind));
    w.varUint(d.fields.length);
    d.fields.forEach((f, i) => {
      if (typeof f === 'string') {
        w.string(f);
        w.varInt(0);
        w.byte(0);
        w.varUint(i);
      } else {
        w.string(f[0]);
        w.varInt(BUILTIN[f[1]] ?? index.get(f[1])!);
        w.byte(f[2] ? 1 : 0);
        w.varUint(d.kind === 'MESSAGE' ? i + 1 : i);
      }
    });
  }
  return w.bytes();
}

function encodeValue(w: W, type: string, v: unknown, isArray = false) {
  if (isArray) {
    const arr = v as unknown[] | Uint8Array;
    w.varUint(arr.length);
    if (type === 'byte') for (const b of arr as Uint8Array) w.byte(b);
    else for (const x of arr as unknown[]) encodeValue(w, type, x);
    return;
  }
  if (type in BUILTIN) {
    if (type === 'bool') return w.byte(v ? 1 : 0);
    if (type === 'uint') return w.varUint(v as number);
    if (type === 'int') return w.varInt(v as number);
    if (type === 'float') return w.float(v as number);
    if (type === 'string') return w.string(v as string);
    return w.byte(v as number);
  }
  const d = DEFS[index.get(type)!];
  if (d.kind === 'ENUM') return w.varUint((d.fields as string[]).indexOf(v as string));
  const obj = v as Record<string, unknown>;
  (d.fields as FieldSpec[]).forEach(([name, t, arr], i) => {
    if (d.kind === 'STRUCT') return encodeValue(w, t, obj[name] ?? 0, arr);
    if (obj[name] === undefined) return;
    w.varUint(i + 1);
    encodeValue(w, t, obj[name], arr);
  });
  if (d.kind === 'MESSAGE') w.varUint(0);
}

function figFile(message: Record<string, unknown>, images: Record<string, Uint8Array> = {}) {
  const schema = deflateSync(encodeSchema());
  const mw = new W();
  encodeValue(mw, 'Message', message);
  const data = deflateSync(mw.bytes());
  const head = new TextEncoder().encode('fig-kiwi');
  const buf = new Uint8Array(12 + 4 + schema.length + 4 + data.length);
  const dv = new DataView(buf.buffer);
  buf.set(head, 0);
  dv.setUint32(8, 48, true);
  dv.setUint32(12, schema.length, true);
  buf.set(schema, 16);
  dv.setUint32(16 + schema.length, data.length, true);
  buf.set(data, 20 + schema.length);
  const files: Record<string, Uint8Array> = { 'canvas.fig': buf, 'meta.json': new TextEncoder().encode('{}') };
  for (const [h, b] of Object.entries(images)) files[`images/${h}`] = b;
  return zipSync(files);
}

const g = (localID: number) => ({ sessionID: 1, localID });
const T = (x: number, y: number, angle = 0) => {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return { m00: c, m01: -s, m02: x, m10: s, m11: c, m12: y };
};
const solid = (r: number, gg: number, b: number) => [{ type: 'SOLID', color: { r, g: gg, b, a: 1 }, opacity: 1, visible: true }];

function commands() {
  const b: number[] = [];
  const f = (v: number) => b.push(...new Uint8Array(new Float32Array([v]).buffer));
  b.push(1); f(0); f(0);
  b.push(2); f(24); f(0);
  b.push(4); f(24); f(12); f(12); f(24); f(0); f(24);
  b.push(0);
  return new Uint8Array(b);
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const HASH = new Uint8Array([0xab, 0xcd, 0xef, 0x01]);

const sample = () =>
  figFile(
    {
      nodeChanges: [
        { guid: g(0), type: 'DOCUMENT', name: 'Doc' },
        { guid: g(1), parentIndex: { guid: g(0), position: 'a' }, type: 'CANVAS', name: 'Screens' },
        { guid: g(2), parentIndex: { guid: g(1), position: 'a' }, type: 'FRAME', name: 'Home', size: { x: 390, y: 844 }, transform: T(0, 0), fillPaints: solid(1, 1, 1), stackMode: 'VERTICAL', stackSpacing: 12 },
        { guid: g(4), parentIndex: { guid: g(2), position: 'b' }, type: 'RECTANGLE', name: 'Second', size: { x: 100, y: 40 }, transform: T(16, 80), fillPaints: [{ type: 'IMAGE', opacity: 1, visible: true, image: { hash: HASH } }], cornerRadius: 8 },
        { guid: g(3), parentIndex: { guid: g(2), position: 'a' }, type: 'TEXT', name: 'Title', size: { x: 200, y: 30 }, transform: T(16, 24), fillPaints: solid(0, 0, 0), textData: { characters: 'Hello .fig' }, fontSize: 24 },
        { guid: g(5), parentIndex: { guid: g(1), position: 'b' }, type: 'VECTOR', name: 'Icon', size: { x: 24, y: 24 }, transform: T(500, 0, Math.PI / 4), fillPaints: solid(1, 0, 0), fillGeometry: [{ commandsBlob: 0 }] },
        { guid: g(6), parentIndex: { guid: g(1), position: 'c' }, type: 'SYMBOL', name: 'Button', size: { x: 120, y: 40 }, transform: T(600, 0), fillPaints: solid(0.36, 0.36, 0.97) },
        { guid: g(7), parentIndex: { guid: g(6), position: 'a' }, type: 'TEXT', name: 'Label', size: { x: 80, y: 20 }, transform: T(20, 10), textData: { characters: 'Buy' }, fontSize: 14 },
        { guid: g(8), parentIndex: { guid: g(1), position: 'd' }, type: 'INSTANCE', name: 'Button', size: { x: 120, y: 40 }, transform: T(600, 100), symbolData: { symbolID: g(6), symbolOverrides: [{ guidPath: { guids: [g(7)] }, textData: { characters: 'Checkout' } }] } },
        { guid: g(9), parentIndex: { guid: g(1), position: 'e' }, type: 'STICKY', name: 'Note', size: { x: 10, y: 10 }, transform: T(0, 0) },
      ],
      blobs: [{ bytes: commands() }],
    },
    { abcdef01: PNG },
  );

describe('.fig import', () => {
  it('reads the zip container, schema and message', () => {
    const arc = readFigArchive(sample());
    expect(arc.version).toBe(48);
    expect((arc.message.nodeChanges as unknown[]).length).toBe(10);
    expect(Object.keys(arc.images)).toEqual(['abcdef01']);
  });

  it('decodes vector command blobs', () => {
    expect(decodeCommands(commands())).toBe('M0 0 L24 0 C24 12 12 24 0 24 Z');
  });

  it('converts pages, frames, auto layout, text, images, vectors and child order', () => {
    const { doc, stats } = importFigFile(sample());
    const by = (n: string) => Object.values(doc.nodes).find((x) => x.name === n)!;
    expect(doc.pages.map((p) => p.name)).toEqual(['Screens']);
    const home = by('Home');
    expect(home.autoLayout).toMatchObject({ direction: 'vertical', gap: 12 });
    expect(home.children.map((c) => doc.nodes[c].name)).toEqual(['Title', 'Second']); // fractional order
    expect(by('Title').text).toMatchObject({ content: 'Hello .fig', fontSize: 24 });
    expect(by('Second').fills[0]).toMatchObject({ kind: 'image' });
    expect(by('Second').fills[0].src).toMatch(/^data:image\/png;base64,/);
    expect(by('Second').radius).toBe(8);
    const icon = by('Icon');
    expect(icon.points!.length).toBeGreaterThan(2);
    expect(icon.rotation).toBeCloseTo(45, 0);
    expect(stats.skipped).toBe(1);
    expect(stats.warnings.join(' ')).toMatch(/STICKY/);
  });

  it('links instances to components and keeps overrides', () => {
    const { doc } = importFigFile(sample());
    const comp = Object.values(doc.nodes).find((n) => n.type === 'component')!;
    const inst = Object.values(doc.nodes).find((n) => n.type === 'instance')!;
    expect(inst.componentId).toBe(comp.id);
    expect(inst.children).toEqual([]);
    const label = comp.children.find((c) => doc.nodes[c].name === 'Label')!;
    expect(inst.overrides![label].text!.content).toBe('Checkout');
  });

  it('rejects non-.fig data with a clear error', () => {
    expect(() => importFigFile(new TextEncoder().encode('hello world, not a fig'))).toThrow(/Not a Figma \.fig file/);
    expect(() => importFigFile(zipSync({ 'other.txt': new Uint8Array([1]) }))).toThrow(/no canvas\.fig/);
  });
});
