// a small seeded random source, so every generated export is the same
// every time. sfc32, seeded through a string hash.

export function rng(seed = 'attic') {
  let h = 1779033703 ^ String(seed).length;
  for (let i = 0; i < String(seed).length; i++) {
    h = Math.imul(h ^ String(seed).charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  const next32 = () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
  let a = next32(), b = next32(), c = next32(), d = next32();
  const float = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  const r = {
    float,
    /** integer in [lo, hi] */
    int: (lo, hi) => lo + Math.floor(float() * (hi - lo + 1)),
    chance: p => float() < p,
    pick: arr => arr[Math.floor(float() * arr.length)],
    /** pick with weights */
    weighted(items, weights) {
      let total = 0;
      for (const w of weights) total += w;
      let x = float() * total;
      for (let i = 0; i < items.length; i++) {
        x -= weights[i];
        if (x < 0) return items[i];
      }
      return items[items.length - 1];
    },
    shuffle(arr) {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(float() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    /** zipf-like weights 1, 1/2, 1/3 ... */
    zipf(n, s = 1) {
      return Array.from({ length: n }, (_, i) => 1 / Math.pow(i + 1, s));
    },
  };
  return r;
}
