// writes zip archives for the tests, including layouts fflate never writes:
// data descriptors and zip64 records. written from the spec on its own, so
// the reader is not checked against itself.

import { deflateSync } from '../../site/vendor/fflate.js';

const enc = new TextEncoder();

let TABLE;
function crc32(bytes) {
  if (!TABLE) {
    TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

class Out {
  constructor() { this.parts = []; this.length = 0; }
  bytes(b) { this.parts.push(b); this.length += b.length; }
  u16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); this.bytes(b); }
  u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); this.bytes(b); }
  u64(v) { const b = new Uint8Array(8); const dv = new DataView(b.buffer); dv.setUint32(0, v % 4294967296, true); dv.setUint32(4, Math.floor(v / 4294967296), true); this.bytes(b); }
  done() {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) { out.set(p, at); at += p.length; }
    return out;
  }
}

// 2026-01-01 12:00, fixed so archives are identical every run
const DOS_TIME = (12 << 11), DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/**
 * @param {{ path: string, data: Uint8Array|string, method?: 0|8, descriptor?: boolean }[]} entries
 * @param {{ zip64?: boolean, prefix?: Uint8Array, relative?: boolean, comment?: string }} [opts]
 *   prefix puts bytes in front; relative keeps offsets counted from the zip, as a self extractor does
 */
export function writeZip(entries, opts = {}) {
  const out = new Out();
  if (opts.prefix) out.bytes(opts.prefix);
  const base = opts.prefix && opts.relative ? opts.prefix.length : 0;
  const central = [];
  const z64 = !!opts.zip64;
  for (const e of entries) {
    const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const method = e.method ?? 8;
    const body = method === 8 ? deflateSync(data) : data;
    const name = enc.encode(e.path);
    const crc = crc32(data);
    const dd = !!e.descriptor;
    const offset = out.length;
    const flags = (dd ? 8 : 0) | 0x800;
    out.u32(0x04034b50);
    out.u16(z64 ? 45 : 20);
    out.u16(flags);
    out.u16(method);
    out.u16(DOS_TIME);
    out.u16(DOS_DATE);
    out.u32(dd ? 0 : crc);
    if (z64) { out.u32(0xffffffff); out.u32(0xffffffff); } else { out.u32(dd ? 0 : body.length); out.u32(dd ? 0 : data.length); }
    out.u16(name.length);
    out.u16(z64 ? 20 : 0);
    out.bytes(name);
    if (z64) { out.u16(1); out.u16(16); out.u64(dd ? 0 : data.length); out.u64(dd ? 0 : body.length); }
    out.bytes(body);
    if (dd) {
      out.u32(0x08074b50);
      out.u32(crc);
      if (z64) { out.u64(body.length); out.u64(data.length); } else { out.u32(body.length); out.u32(data.length); }
    }
    central.push({ name, crc, method, flags, comp: body.length, size: data.length, offset: offset - base });
  }
  const cdStart = out.length;
  for (const c of central) {
    out.u32(0x02014b50);
    out.u16(z64 ? 45 : 20);
    out.u16(z64 ? 45 : 20);
    out.u16(c.flags);
    out.u16(c.method);
    out.u16(DOS_TIME);
    out.u16(DOS_DATE);
    out.u32(c.crc);
    if (z64) { out.u32(0xffffffff); out.u32(0xffffffff); } else { out.u32(c.comp); out.u32(c.size); }
    out.u16(c.name.length);
    out.u16(z64 ? 28 : 0);
    out.u16(0);
    out.u16(0);
    out.u16(0);
    out.u32(0);
    out.u32(z64 ? 0xffffffff : c.offset);
    out.bytes(c.name);
    if (z64) { out.u16(1); out.u16(24); out.u64(c.size); out.u64(c.comp); out.u64(c.offset); }
  }
  const cdSize = out.length - cdStart;
  if (z64) {
    const recAt = out.length;
    out.u32(0x06064b50);
    out.u64(44);
    out.u16(45);
    out.u16(45);
    out.u32(0);
    out.u32(0);
    out.u64(central.length);
    out.u64(central.length);
    out.u64(cdSize);
    out.u64(cdStart - base);
    out.u32(0x07064b50);
    out.u32(0);
    out.u64(recAt - base);
    out.u32(1);
  }
  const comment = enc.encode(opts.comment || '');
  out.u32(0x06054b50);
  out.u16(0);
  out.u16(0);
  out.u16(z64 ? 0xffff : central.length);
  out.u16(z64 ? 0xffff : central.length);
  out.u32(z64 ? 0xffffffff : cdSize);
  out.u32(z64 ? 0xffffffff : cdStart - base);
  out.u16(comment.length);
  out.bytes(comment);
  return out.done();
}

/** a File like the browser gives, for the pipeline */
export function file(name, data) {
  return new File([typeof data === 'string' ? enc.encode(data) : data], name);
}
