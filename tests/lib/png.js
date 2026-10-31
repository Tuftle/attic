// a small png decoder for comparing screenshots: 8 bit, rgb or rgba, not
// interlaced, which is what browsers write. no dependency, just zlib.

import { inflateSync } from 'node:zlib';

export function decodePng(buf) {
  const b = Buffer.from(buf);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let pos = 8, width = 0, height = 0, type = 0, depth = 0, interlace = 0;
  const idat = [];
  while (pos < b.length) {
    const len = b.readUInt32BE(pos);
    const kind = b.toString('latin1', pos + 4, pos + 8);
    const data = b.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace || (type !== 2 && type !== 6)) throw new Error(`unsupported png: depth ${depth}, type ${type}`);
  const channels = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0, up = prev[x], c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      cur[x] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = cur[x * channels]; out[o + 1] = cur[x * channels + 1]; out[o + 2] = cur[x * channels + 2];
      out[o + 3] = channels === 4 ? cur[x * channels + 3] : 255;
    }
    [prev, cur] = [cur, prev];
  }
  return { width, height, data: out };
}

/** the share of pixels that differ by more than a little */
export function diff(a, b, threshold = 24) {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let bad = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) > threshold || Math.abs(a.data[i + 1] - b.data[i + 1]) > threshold || Math.abs(a.data[i + 2] - b.data[i + 2]) > threshold) bad++;
  }
  return bad / (a.width * a.height);
}
