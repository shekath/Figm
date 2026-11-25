/**
 * Minimal reader for the "kiwi" binary schema format (MIT-licensed format by Evan Wallace),
 * which `.fig` files use. The file carries its own schema, so decoding is generic.
 */

export interface KiwiField {
  name: string;
  type: number; // <0 builtin, >=0 definition index
  isArray: boolean;
  value: number;
}
export interface KiwiDef {
  name: string;
  kind: 'ENUM' | 'STRUCT' | 'MESSAGE';
  fields: KiwiField[];
}
export interface KiwiSchema {
  defs: KiwiDef[];
  byName: Map<string, number>;
}

const KINDS = ['ENUM', 'STRUCT', 'MESSAGE'] as const;
// builtin type codes: -1 bool, -2 byte, -3 int, -4 uint, -5 float, -6 string, -7 int64, -8 uint64

class Reader {
  i = 0;
  private dv: DataView;
  private f32 = new Float32Array(1);
  private u32 = new Uint32Array(this.f32.buffer);
  constructor(private b: Uint8Array) {
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  byte() {
    if (this.i >= this.b.length) throw new Error('Unexpected end of data');
    return this.b[this.i++];
  }
  bool() {
    return this.byte() !== 0;
  }
  varUint() {
    let v = 0,
      shift = 0,
      byte: number;
    do {
      byte = this.byte();
      v |= (byte & 127) << shift;
      shift += 7;
    } while (byte & 128 && shift < 35);
    return v >>> 0;
  }
  varInt() {
    const v = this.varUint();
    return v & 1 ? ~(v >>> 1) : v >>> 1;
  }
  varUint64(): bigint {
    let v = 0n,
      shift = 0n,
      byte: number;
    do {
      byte = this.byte();
      v |= BigInt(byte & 127) << shift;
      shift += 7n;
    } while (byte & 128 && shift < 70n);
    return v;
  }
  varInt64(): bigint {
    const v = this.varUint64();
    return v & 1n ? ~(v >> 1n) : v >> 1n;
  }
  varFloat() {
    const first = this.byte();
    if (first === 0) return 0;
    if (this.i + 3 > this.b.length) throw new Error('Unexpected end of data');
    let bits = first | (this.b[this.i] << 8) | (this.b[this.i + 1] << 16) | (this.b[this.i + 2] << 24);
    this.i += 3;
    bits = (bits << 23) | (bits >>> 9);
    this.u32[0] = bits >>> 0;
    return this.f32[0];
  }
  string() {
    const start = this.i;
    while (this.i < this.b.length && this.b[this.i] !== 0) this.i++;
    const s = new TextDecoder().decode(this.b.subarray(start, this.i));
    this.i++; // null terminator
    return s;
  }
  bytes(n: number) {
    if (this.i + n > this.b.length) throw new Error('Unexpected end of data');
    const out = this.b.slice(this.i, this.i + n);
    this.i += n;
    return out;
  }
  float32LE() {
    const v = this.dv.getFloat32(this.i, true);
    this.i += 4;
    return v;
  }
}

export function decodeSchema(bytes: Uint8Array): KiwiSchema {
  const r = new Reader(bytes);
  const count = r.varUint();
  const defs: KiwiDef[] = [];
  for (let d = 0; d < count; d++) {
    const name = r.string();
    const kind = KINDS[r.byte()];
    if (!kind) throw new Error('Invalid schema');
    const n = r.varUint();
    const fields: KiwiField[] = [];
    for (let f = 0; f < n; f++) fields.push({ name: r.string(), type: r.varInt(), isArray: r.bool(), value: r.varUint() });
    defs.push({ name, kind, fields });
  }
  return { defs, byName: new Map(defs.map((d, i) => [d.name, i])) };
}

export function decodeMessage(schema: KiwiSchema, bytes: Uint8Array, rootName = 'Message'): Record<string, unknown> {
  const root = schema.byName.get(rootName);
  if (root === undefined) throw new Error(`Schema has no ${rootName}`);
  const r = new Reader(bytes);
  const readValue = (type: number): unknown => {
    switch (type) {
      case -1:
        return r.bool();
      case -2:
        return r.byte();
      case -3:
        return r.varInt();
      case -4:
        return r.varUint();
      case -5:
        return r.varFloat();
      case -6:
        return r.string();
      case -7:
        return Number(r.varInt64());
      case -8:
        return Number(r.varUint64());
    }
    const def = schema.defs[type];
    if (!def) throw new Error(`Unknown type ${type}`);
    if (def.kind === 'ENUM') {
      const v = r.varUint();
      return def.fields.find((f) => f.value === v)?.name ?? v;
    }
    const obj: Record<string, unknown> = {};
    if (def.kind === 'STRUCT') {
      for (const f of def.fields) obj[f.name] = readField(f);
      return obj;
    }
    // MESSAGE: (field id, value)* terminated by 0
    for (;;) {
      const id = r.varUint();
      if (id === 0) return obj;
      const f = def.fields.find((x) => x.value === id);
      if (!f) throw new Error(`Unknown field ${id} in ${def.name}`);
      obj[f.name] = readField(f);
    }
  };
  const readField = (f: KiwiField): unknown => {
    if (!f.isArray) return readValue(f.type);
    const n = r.varUint();
    if (f.type === -2) return r.bytes(n);
    const arr = new Array(n);
    for (let k = 0; k < n; k++) arr[k] = readValue(f.type);
    return arr;
  };
  return readValue(root) as Record<string, unknown>;
}

/** Decode Figma's path commands blob: 0 close, 1 move, 2 line, 3 quad, 4 cubic (float32 LE coords). */
export function decodeCommands(blob: Uint8Array): string {
  const r = new Reader(blob);
  const parts: string[] = [];
  const n = (v: number) => Math.round(v * 1000) / 1000;
  while (r.i < blob.length) {
    const op = r.byte();
    switch (op) {
      case 0:
        parts.push('Z');
        break;
      case 1:
        parts.push(`M${n(r.float32LE())} ${n(r.float32LE())}`);
        break;
      case 2:
        parts.push(`L${n(r.float32LE())} ${n(r.float32LE())}`);
        break;
      case 3:
        parts.push(`Q${n(r.float32LE())} ${n(r.float32LE())} ${n(r.float32LE())} ${n(r.float32LE())}`);
        break;
      case 4:
        parts.push(`C${n(r.float32LE())} ${n(r.float32LE())} ${n(r.float32LE())} ${n(r.float32LE())} ${n(r.float32LE())} ${n(r.float32LE())}`);
        break;
      default:
        throw new Error(`Unknown path command ${op}`);
    }
  }
  return parts.join(' ');
}
