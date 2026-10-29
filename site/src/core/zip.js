// reading zip archives without loading them. the central directory at the
// end of the file lists every entry with its offset, so attic reads only that
// index, then slices out and inflates just the entries a source asks for. a
// full google takeout can hold gigabytes of photos; none of them are read.
//
// fflate's streaming Inflate does the decompressing. its streaming Unzip is
// not used: it keeps the compressed bytes of every file it skips, which would
// hold a whole archive in memory.

import { Inflate } from '../../vendor/fflate.js';

export class ZipError extends Error {
  /** @param {'not-zip'|'empty'|'truncated'|'damaged'|'encrypted'|'method'|'too-large'} code */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const SIG_LOCAL = 0x04034b50, SIG_CD = 0x02014b50, SIG_EOCD = 0x06054b50;
const SIG_Z64_LOC = 0x07064b50, SIG_Z64_EOCD = 0x06064b50, SIG_DD = 0x08074b50;
const MAX32 = 0xffffffff, MAX16 = 0xffff;

/** counts for tests: how many entries were inflated */
export const stats = { inflates: 0 };

const u16 = (b, i) => b[i] | (b[i + 1] << 8);
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const u64 = (b, i) => u32(b, i) + u32(b, i + 4) * 4294967296;

async function readAt(blob, start, end) {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

let CRC_TABLE;
function crcTable() {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  return CRC_TABLE;
}

/** running crc32. start with crc32(bytes), continue with crc32(more, previous). */
export function crc32(bytes, previous = 0) {
  const table = crcTable();
  let c = ~previous;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

const utf8 = new TextDecoder('utf-8');
const decodeName = bytes => utf8.decode(bytes);

/** true if the bytes start like a zip archive (including an empty one) */
export function looksLikeZip(head) {
  return head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b
    && ((head[2] === 3 && head[3] === 4) || (head[2] === 5 && head[3] === 6) || (head[2] === 7 && head[3] === 8));
}

/**
 * @typedef {Object} ZipEntry
 * @property {string} path
 * @property {number} size            uncompressed
 * @property {number} compressedSize
 * @property {number} method
 * @property {number} crc
 * @property {number} flags
 * @property {number} localOffset
 * @property {boolean} [truncated]
 */

/**
 * open a zip from any blob.
 * @param {Blob} blob
 * @returns {Promise<{ entries: ZipEntry[], damaged: null | 'truncated', blob: Blob }>}
 */
export async function openZip(blob) {
  const size = blob.size;
  const tailStart = Math.max(0, size - (65535 + 22));
  const tail = await readAt(blob, tailStart, size);
  let at = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && u32(tail, i) === SIG_EOCD && i + 22 + u16(tail, i + 20) <= tail.length) { at = i; break; }
  }
  if (at === -1) {
    const head = await readAt(blob, 0, 4);
    if (looksLikeZip(head)) return { entries: await walkLocalHeaders(blob), damaged: 'truncated', blob };
    throw new ZipError('not-zip', 'this file is not a zip archive');
  }
  const eocdPos = tailStart + at;
  let total = u16(tail, at + 10);
  let cdSize = u32(tail, at + 12);
  let cdOff = u32(tail, at + 16);
  let recordStart = eocdPos;
  if (total === MAX16 || cdSize === MAX32 || cdOff === MAX32) {
    const loc = await readAt(blob, eocdPos - 20, eocdPos);
    if (loc.length === 20 && u32(loc, 0) === SIG_Z64_LOC) {
      const z64Off = u64(loc, 8);
      const rec = await readAt(blob, z64Off, z64Off + 56);
      if (u32(rec, 0) !== SIG_Z64_EOCD) throw new ZipError('damaged', 'the zip64 index is damaged');
      total = u64(rec, 32);
      cdSize = u64(rec, 40);
      cdOff = u64(rec, 48);
      recordStart = z64Off;
    }
  }
  if (total === 0) return { entries: [], damaged: null, blob };
  // a zip with something stuck in front of it (a self extractor) has shifted offsets
  let shift = 0;
  const probe = await readAt(blob, cdOff, cdOff + 4);
  if (probe.length < 4 || u32(probe, 0) !== SIG_CD) {
    shift = recordStart - cdSize - cdOff;
    const again = await readAt(blob, cdOff + shift, cdOff + shift + 4);
    if (shift <= 0 || again.length < 4 || u32(again, 0) !== SIG_CD) {
      return { entries: await walkLocalHeaders(blob), damaged: 'truncated', blob };
    }
  }
  const cd = await readAt(blob, cdOff + shift, cdOff + shift + cdSize);
  const entries = [];
  let p = 0;
  while (p + 46 <= cd.length && u32(cd, p) === SIG_CD) {
    const flags = u16(cd, p + 8);
    const method = u16(cd, p + 10);
    const crc = u32(cd, p + 16);
    let comp = u32(cd, p + 20);
    let uncomp = u32(cd, p + 24);
    const nlen = u16(cd, p + 28), elen = u16(cd, p + 30), clen = u16(cd, p + 32);
    let local = u32(cd, p + 42);
    const path = decodeName(cd.subarray(p + 46, p + 46 + nlen));
    let e = p + 46 + nlen;
    const eEnd = e + elen;
    while (e + 4 <= eEnd) {
      const id = u16(cd, e), len = u16(cd, e + 2);
      if (id === 1) {
        let q = e + 4;
        if (uncomp === MAX32) { uncomp = u64(cd, q); q += 8; }
        if (comp === MAX32) { comp = u64(cd, q); q += 8; }
        if (local === MAX32) { local = u64(cd, q); q += 8; }
      }
      e += 4 + len;
    }
    p = eEnd + clen;
    if (path.endsWith('/')) continue;
    entries.push({ path, size: uncomp, compressedSize: comp, method, crc, flags, localOffset: local + shift });
  }
  if (entries.length === 0 && total > 0) throw new ZipError('damaged', 'the index of this zip is damaged');
  return { entries, damaged: null, blob };
}

/**
 * when the index at the end is missing (a download that stopped early), walk
 * the local headers from the start and keep what is complete.
 * @param {Blob} blob
 */
async function walkLocalHeaders(blob) {
  const size = blob.size;
  const entries = [];
  let pos = 0;
  while (pos + 30 <= size) {
    const h = await readAt(blob, pos, Math.min(size, pos + 30 + 1024));
    if (u32(h, 0) !== SIG_LOCAL) break;
    const flags = u16(h, 6), method = u16(h, 8);
    let crc = u32(h, 14), comp = u32(h, 18), uncomp = u32(h, 22);
    const nlen = u16(h, 26), elen = u16(h, 28);
    let headerBytes = h;
    if (30 + nlen + elen > h.length) headerBytes = await readAt(blob, pos, pos + 30 + nlen + elen);
    const path = decodeName(headerBytes.subarray(30, 30 + nlen));
    let e = 30 + nlen;
    let zip64 = false;
    while (e + 4 <= 30 + nlen + elen) {
      const id = u16(headerBytes, e), len = u16(headerBytes, e + 2);
      if (id === 1 && len >= 16) { uncomp = u64(headerBytes, e + 4); comp = u64(headerBytes, e + 12); zip64 = true; }
      e += 4 + len;
    }
    const dataStart = pos + 30 + nlen + elen;
    let next;
    if (flags & 8) {
      const found = await findDescriptor(blob, dataStart, zip64);
      if (!found) {
        entries.push({ path, size: -1, compressedSize: size - dataStart, method, crc: 0, flags, localOffset: pos, truncated: true });
        break;
      }
      ({ crc, comp, uncomp } = found);
      next = dataStart + comp + found.length;
    } else {
      next = dataStart + comp;
    }
    const entry = { path, size: uncomp, compressedSize: comp, method, crc, flags, localOffset: pos };
    if (next > size) {
      entry.truncated = true;
      entry.compressedSize = size - dataStart;
    }
    if (!path.endsWith('/')) entries.push(entry);
    if (entry.truncated) break;
    pos = next;
  }
  return entries;
}

/** look for a data descriptor whose size field matches its own position */
async function findDescriptor(blob, dataStart, zip64) {
  const STEP = 1 << 20;
  let from = dataStart;
  while (from < blob.size) {
    const buf = await readAt(blob, from, Math.min(blob.size, from + STEP + 24));
    for (let i = 0; i + 16 <= buf.length; i++) {
      if (buf[i] !== 0x50 || u32(buf, i) !== SIG_DD) continue;
      const comp = zip64 ? u64(buf, i + 8) : u32(buf, i + 8);
      if (from + i - dataStart === comp) {
        return { crc: u32(buf, i + 4), comp, uncomp: zip64 ? u64(buf, i + 16) : u32(buf, i + 12), length: zip64 ? 24 : 16 };
      }
    }
    from += STEP;
  }
  return null;
}

/**
 * the uncompressed bytes of one entry, chunk by chunk.
 * @param {Blob} blob
 * @param {ZipEntry} entry
 * @param {{ verify?: boolean }} [opts]
 * @returns {AsyncGenerator<Uint8Array>}
 */
export async function* entryChunks(blob, entry, opts = {}) {
  if (entry.flags & 1) throw new ZipError('encrypted', 'this file in the zip is protected with a password');
  if (entry.method !== 0 && entry.method !== 8) {
    throw new ZipError('method', `this file in the zip is compressed in a way attic cannot read yet (method ${entry.method})`);
  }
  const local = await readAt(blob, entry.localOffset, entry.localOffset + 30);
  if (local.length < 30 || u32(local, 0) !== SIG_LOCAL) throw new ZipError('damaged', 'this zip is damaged');
  const start = entry.localOffset + 30 + u16(local, 26) + u16(local, 28);
  const reader = blob.slice(start, start + entry.compressedSize).stream().getReader();
  const verify = opts.verify && !entry.truncated && entry.size >= 0;
  let crc = 0;
  let total = 0;
  try {
    if (entry.method === 0) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (verify) crc = crc32(value, crc);
        total += value.length;
        yield value;
      }
    } else {
      stats.inflates++;
      const out = [];
      const inflate = new Inflate(data => { if (data.length) out.push(data); });
      for (;;) {
        const { done, value } = await reader.read();
        try {
          inflate.push(done ? new Uint8Array(0) : value, done);
        } catch {
          throw new ZipError(entry.truncated ? 'truncated' : 'damaged', entry.truncated
            ? 'this file stops partway, maybe the download did not finish'
            : 'this file in the zip is damaged');
        }
        while (out.length) {
          const data = out.shift();
          if (verify) crc = crc32(data, crc);
          total += data.length;
          yield data;
        }
        if (done) break;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  if (entry.truncated) throw new ZipError('truncated', 'this file stops partway, maybe the download did not finish');
  if (verify && (crc !== entry.crc || total !== entry.size)) throw new ZipError('damaged', 'this file in the zip is damaged (its checksum does not match)');
}

/** the first n uncompressed bytes of an entry */
export async function entryHead(blob, entry, n) {
  const parts = [];
  let len = 0;
  try {
    for await (const chunk of entryChunks(blob, entry)) {
      parts.push(chunk);
      len += chunk.length;
      if (len >= n) break;
    }
  } catch (e) {
    if (!len) throw e;
  }
  const out = new Uint8Array(Math.min(n, len));
  let at = 0;
  for (const p of parts) {
    const take = Math.min(p.length, out.length - at);
    out.set(p.subarray(0, take), at);
    at += take;
    if (at === out.length) break;
  }
  return out;
}
