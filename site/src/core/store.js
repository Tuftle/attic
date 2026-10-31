// the event store: every source turns its files into events, and every
// card works only on events. columns are typed arrays and names are
// interned, so a million events fit comfortably in memory.

/**
 * @typedef {Object} Event
 * @property {number} t          start time, ms since epoch, utc
 * @property {number} [dur]      length in ms, if known
 * @property {string} kind       'listen' | 'podcast' | 'watch' | 'video' | 'chat' | 'visit'
 * @property {string} [title]    track, episode, video, conversation
 * @property {string} [creator]  artist, channel, site, role
 * @property {string} [album]    album or show
 * @property {string} [id]       a unique id from the export, used only to keep apart look-alikes
 * @property {Object} [meta]     small extra values: skipped, device, words, code
 */

export class Interner {
  constructor() {
    /** @type {Map<string, number>} */
    this.map = new Map();
    /** @type {string[]} */
    this.list = [];
  }

  /** @param {string|null|undefined} s */
  id(s) {
    if (s === undefined || s === null || s === '') return -1;
    s = String(s);
    let i = this.map.get(s);
    if (i === undefined) {
      i = this.list.length;
      this.list.push(s);
      this.map.set(s, i);
    }
    return i;
  }

  /** @param {number} i */
  str(i) {
    return i < 0 ? undefined : this.list[i];
  }

  get size() {
    return this.list.length;
  }
}

const BOOL_UNKNOWN = 0, BOOL_FALSE = 1, BOOL_TRUE = 2;

function makeColumn(type, cap) {
  if (type === 'bool') return new Uint8Array(cap);
  if (type === 'num') return new Float64Array(cap).fill(NaN);
  return new Int32Array(cap).fill(-1);
}

function growArray(arr, cap, fill) {
  const next = new arr.constructor(cap);
  next.set(arr);
  if (fill !== undefined && fill !== 0) next.fill(fill, arr.length);
  return next;
}

const fillFor = type => (type === 'num' ? NaN : type === 'str' ? -1 : 0);

export class EventStore {
  constructor(capacity = 1024) {
    this.length = 0;
    this.cap = Math.max(16, capacity);
    this.strings = new Interner();
    /** @type {string[]} */
    this.kinds = [];
    this.t = new Float64Array(this.cap);
    this.dur = new Float64Array(this.cap).fill(NaN);
    this.kind = new Uint8Array(this.cap);
    this.title = new Int32Array(this.cap).fill(-1);
    this.creator = new Int32Array(this.cap).fill(-1);
    this.album = new Int32Array(this.cap).fill(-1);
    this.uid = new Int32Array(this.cap).fill(-1);
    /** @type {Record<string, { type: 'bool'|'num'|'str', data: any }>} */
    this.meta = {};
    this.sorted = true;
  }

  kindCode(name) {
    let k = this.kinds.indexOf(name);
    if (k === -1) {
      if (this.kinds.length >= 255) throw new Error('too many kinds');
      k = this.kinds.push(name) - 1;
    }
    return k;
  }

  grow() {
    const cap = this.cap * 2;
    this.t = growArray(this.t, cap);
    this.dur = growArray(this.dur, cap, NaN);
    this.kind = growArray(this.kind, cap);
    this.title = growArray(this.title, cap, -1);
    this.creator = growArray(this.creator, cap, -1);
    this.album = growArray(this.album, cap, -1);
    this.uid = growArray(this.uid, cap, -1);
    for (const col of Object.values(this.meta)) col.data = growArray(col.data, cap, fillFor(col.type));
    this.cap = cap;
  }

  /** @param {Event} ev */
  push(ev) {
    if (!Number.isFinite(ev.t)) return false;
    if (this.length === this.cap) this.grow();
    const i = this.length++;
    this.t[i] = ev.t;
    this.dur[i] = Number.isFinite(ev.dur) ? ev.dur : NaN;
    this.kind[i] = this.kindCode(ev.kind);
    this.title[i] = this.strings.id(ev.title);
    this.creator[i] = this.strings.id(ev.creator);
    this.album[i] = this.strings.id(ev.album);
    this.uid[i] = this.strings.id(ev.id);
    if (i > 0 && ev.t < this.t[i - 1]) this.sorted = false;
    if (ev.meta) {
      for (const key in ev.meta) {
        const v = ev.meta[key];
        if (v === undefined || v === null) continue;
        this.setMeta(key, i, v);
      }
    }
    return true;
  }

  setMeta(key, i, v) {
    let col = this.meta[key];
    if (!col) {
      const type = typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? 'num' : 'str';
      col = this.meta[key] = { type, data: makeColumn(type, this.cap) };
    }
    if (col.type === 'bool') col.data[i] = v ? BOOL_TRUE : BOOL_FALSE;
    else if (col.type === 'num') col.data[i] = Number(v);
    else col.data[i] = this.strings.id(String(v));
  }

  /** the value of a meta field for event i, or undefined */
  metaValue(key, i) {
    const col = this.meta[key];
    if (!col) return undefined;
    const v = col.data[i];
    if (col.type === 'bool') return v === BOOL_UNKNOWN ? undefined : v === BOOL_TRUE;
    if (col.type === 'num') return Number.isNaN(v) ? undefined : v;
    return this.strings.str(v);
  }

  /** a meta column as raw codes: bool 0 unknown, 1 false, 2 true; str ids; num values */
  column(key) {
    return this.meta[key]?.data;
  }

  hasMeta(key) {
    return !!this.meta[key];
  }

  /** sort by time and drop exact repeats of (time, kind, title, creator, album, id). */
  sortAndDedupe() {
    const n = this.length;
    const { t, kind, title, creator, album, uid } = this;
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    // ties on time compare the strings themselves, so the order depends only
    // on content and never on the order files were read in
    const list = this.strings.list, kinds = this.kinds;
    const cmp = (x, y) => (x === y ? 0 : x === -1 ? -1 : y === -1 ? 1 : list[x] < list[y] ? -1 : 1);
    const cmpKind = (x, y) => (x === y ? 0 : kinds[x] < kinds[y] ? -1 : 1);
    order.sort((a, b) => (t[a] - t[b]) || cmpKind(kind[a], kind[b]) || cmp(title[a], title[b])
      || cmp(creator[a], creator[b]) || cmp(album[a], album[b]) || cmp(uid[a], uid[b]) || (a - b));
    const keep = [];
    let prev = -1;
    for (let j = 0; j < n; j++) {
      const i = order[j];
      if (prev !== -1 && t[i] === t[prev] && kind[i] === kind[prev] && title[i] === title[prev]
        && creator[i] === creator[prev] && album[i] === album[prev] && uid[i] === uid[prev]) continue;
      keep.push(i);
      prev = i;
    }
    const m = keep.length;
    const pick = arr => {
      const out = new arr.constructor(Math.max(16, m));
      for (let j = 0; j < m; j++) out[j] = arr[keep[j]];
      return out;
    };
    this.t = pick(t);
    this.dur = pick(this.dur);
    this.kind = pick(kind);
    this.title = pick(title);
    this.creator = pick(creator);
    this.album = pick(album);
    this.uid = pick(uid);
    for (const col of Object.values(this.meta)) col.data = pick(col.data);
    const removed = n - m;
    this.length = m;
    this.cap = Math.max(16, m);
    this.sorted = true;
    return removed;
  }

  /** the index range [lo, hi) of events with lo <= t < hi. needs a sorted store. */
  range(t0, t1) {
    if (!this.sorted) throw new Error('sort the store first');
    return [this.lowerBound(t0), this.lowerBound(t1)];
  }

  lowerBound(x) {
    let lo = 0, hi = this.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.t[mid] < x) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  /** indices of events of one kind in [lo, hi) */
  ofKind(name, lo = 0, hi = this.length) {
    const k = this.kinds.indexOf(name);
    const out = [];
    if (k === -1) return new Uint32Array(0);
    for (let i = lo; i < hi; i++) if (this.kind[i] === k) out.push(i);
    return Uint32Array.from(out);
  }

  /** @returns {Event} */
  get(i) {
    const ev = { t: this.t[i], kind: this.kinds[this.kind[i]] };
    if (!Number.isNaN(this.dur[i])) ev.dur = this.dur[i];
    const s = this.strings;
    if (this.title[i] >= 0) ev.title = s.str(this.title[i]);
    if (this.creator[i] >= 0) ev.creator = s.str(this.creator[i]);
    if (this.album[i] >= 0) ev.album = s.str(this.album[i]);
    if (this.uid[i] >= 0) ev.id = s.str(this.uid[i]);
    const meta = {};
    let any = false;
    for (const key of Object.keys(this.meta)) {
      const v = this.metaValue(key, i);
      if (v !== undefined) { meta[key] = v; any = true; }
    }
    if (any) ev.meta = meta;
    return ev;
  }

  toEvents() {
    const out = new Array(this.length);
    for (let i = 0; i < this.length; i++) out[i] = this.get(i);
    return out;
  }

  /** add every event of another store */
  addAll(other) {
    for (let i = 0; i < other.length; i++) this.push(other.get(i));
  }
}
