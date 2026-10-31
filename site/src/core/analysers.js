// shared analysers. pure functions over the store's columns and lists of
// event indices, so each is tested once and every source can use it.

/**
 * totals by key: weight, count and first time seen.
 * @param {ArrayLike<number> | ((i: number) => number)} keys  a column of ids, or a function of the event index. negative means none.
 * @param {ArrayLike<number>} idx event indices to count
 * @param {ArrayLike<number>|null} weights  per event, or null to count events
 * @param {Float64Array} t       times, for first seen
 * @returns {Map<number, { key: number, w: number, n: number, first: number }>}
 */
export function totalsBy(keys, idx, weights, t) {
  const map = new Map();
  const keyOf = typeof keys === 'function' ? keys : i => keys[i];
  for (let j = 0; j < idx.length; j++) {
    const i = idx[j];
    const k = keyOf(i);
    if (k < 0) continue;
    const w = weights ? (Number.isNaN(weights[i]) ? 0 : weights[i]) : 1;
    const e = map.get(k);
    if (e) {
      e.w += w;
      e.n++;
      if (t[i] < e.first) e.first = t[i];
    } else {
      map.set(k, { key: k, w, n: 1, first: t[i] });
    }
  }
  return map;
}

/**
 * the top n entries. ties: larger weight, then seen first, then name in
 * code unit order. the same data always gives the same list.
 * @param {Map<number, { key: number, w: number, n: number, first: number }>} totals
 * @param {(key: number) => string} nameOf
 */
export function topN(totals, n, nameOf) {
  const all = [...totals.values()];
  all.sort((a, b) => (b.w - a.w) || (a.first - b.first) || cmp(nameOf(a.key), nameOf(b.key)));
  return all.slice(0, n);
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** sum of a column over indices (NaN counts as 0) */
export function sum(values, idx) {
  let s = 0;
  for (let j = 0; j < idx.length; j++) {
    const v = values[idx[j]];
    if (!Number.isNaN(v)) s += v;
  }
  return s;
}

/** 24 bins of local hours, by start time */
export function hourHistogram(t, idx, z, weights = null) {
  const bins = new Array(24).fill(0);
  for (let j = 0; j < idx.length; j++) {
    const i = idx[j];
    bins[z.hour(t[i])] += weights ? weights[i] : 1;
  }
  return bins;
}

/** 7 bins of local weekdays, monday first */
export function weekdayHistogram(t, idx, z, weights = null) {
  const bins = new Array(7).fill(0);
  for (let j = 0; j < idx.length; j++) {
    const i = idx[j];
    bins[z.weekday(t[i])] += weights ? weights[i] : 1;
  }
  return bins;
}

/** 12 bins of local months */
export function monthHistogram(t, idx, z, weights = null) {
  const bins = new Array(12).fill(0);
  for (let j = 0; j < idx.length; j++) {
    const i = idx[j];
    bins[z.parts(t[i]).month] += weights ? weights[i] : 1;
  }
  return bins;
}

/** the index of the largest bin; ties go to the first */
export function peak(bins) {
  let best = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i] > bins[best]) best = i;
  return best;
}

/** totals per local day number */
export function dayTotals(t, idx, z, weights = null) {
  const map = new Map();
  for (let j = 0; j < idx.length; j++) {
    const i = idx[j];
    const d = z.dayKey(t[i]);
    map.set(d, (map.get(d) || 0) + (weights ? weights[i] : 1));
  }
  return map;
}

/** the day with the largest total; ties go to the earlier day */
export function busiestDay(totals) {
  let day = null, w = -Infinity;
  for (const [d, v] of totals) {
    if (v > w || (v === w && d < day)) { day = d; w = v; }
  }
  return day === null ? null : { day, w };
}

/**
 * group events into sessions. a session ends when the next event starts
 * more than gap ms after the previous one ended. idx must be in time order.
 * @returns {{ from: number, to: number, count: number, start: number, end: number, ms: number }[]}
 *   from and to are positions in idx
 */
export function sessions(t, dur, idx, gap) {
  const out = [];
  if (!idx.length) return out;
  let from = 0, start = t[idx[0]];
  let end = start + (dur && !Number.isNaN(dur[idx[0]]) ? dur[idx[0]] : 0);
  let ms = dur && !Number.isNaN(dur[idx[0]]) ? dur[idx[0]] : 0;
  for (let j = 1; j <= idx.length; j++) {
    const i = idx[j];
    if (j === idx.length || t[i] - end > gap) {
      out.push({ from, to: j - 1, count: j - from, start, end, ms });
      if (j === idx.length) break;
      from = j;
      start = t[i];
      end = start;
      ms = 0;
    }
    const d = dur && !Number.isNaN(dur[i]) ? dur[i] : 0;
    end = Math.max(end, t[i] + d);
    ms += d;
  }
  return out;
}

/** the longest of a list by a key; ties go to the earlier one */
export function longest(list, key) {
  let best = null;
  for (const s of list) if (!best || key(s) > key(best)) best = s;
  return best;
}

/** the longest run of consecutive days in a sorted list of unique day numbers */
export function streak(days) {
  let best = null, start = null, prev = null, len = 0;
  for (const d of days) {
    if (prev !== null && d === prev + 1) len++;
    else { start = d; len = 1; }
    if (!best || len > best.len) best = { len, start, end: d };
    prev = d;
  }
  return best;
}

/**
 * which keys of this year were never seen before it.
 * @returns {{ seen: number, fresh: number, share: number, freshKeys: Set<number> }}
 */
export function discovery(keys, beforeIdx, yearIdx) {
  const before = new Set();
  for (let j = 0; j < beforeIdx.length; j++) {
    const k = keys[beforeIdx[j]];
    if (k >= 0) before.add(k);
  }
  const seen = new Set();
  for (let j = 0; j < yearIdx.length; j++) {
    const k = keys[yearIdx[j]];
    if (k >= 0) seen.add(k);
  }
  const freshKeys = new Set([...seen].filter(k => !before.has(k)));
  return { seen: seen.size, fresh: freshKeys.size, share: share(freshKeys.size, seen.size), freshKeys };
}

export function distinct(keys, idx) {
  const s = new Set();
  for (let j = 0; j < idx.length; j++) if (keys[idx[j]] >= 0) s.add(keys[idx[j]]);
  return s.size;
}

export function share(part, whole) {
  return whole ? part / whole : 0;
}

/** relative change, or null when there is nothing to compare with */
export function change(current, previous) {
  return previous ? (current - previous) / previous : null;
}

// two ids below 2^26 fit in one exact number
export const PAIR = 67108864;
/** one number for a pair of ids, such as a track and its artist */
export const pair = (a, b) => (a < 0 ? -1 : a * PAIR + (b < 0 ? PAIR - 1 : b));

/**
 * the most times one key appears in a single local day.
 * ties: more repeats, then the earlier day, then the name.
 */
export function maxPerDay(keys, t, idx, z, nameOf) {
  const keyOf = typeof keys === 'function' ? keys : i => keys[i];
  /** @type {Map<number, Map<number, number>>} */
  const byDay = new Map();
  for (let j = 0; j < idx.length; j++) {
    const i = idx[j];
    const k = keyOf(i);
    if (k < 0) continue;
    const day = z.dayKey(t[i]);
    let m = byDay.get(day);
    if (!m) byDay.set(day, (m = new Map()));
    m.set(k, (m.get(k) || 0) + 1);
  }
  let best = null;
  for (const [day, m] of byDay) {
    for (const [key, n] of m) {
      if (!best || n > best.n || (n === best.n && (day < best.day || (day === best.day && cmp(nameOf(key), nameOf(best.key)) < 0)))) {
        best = { key, day, n };
      }
    }
  }
  return best;
}

/** indices from a list where a test holds */
export function where(idx, test) {
  const out = [];
  for (let j = 0; j < idx.length; j++) if (test(idx[j])) out.push(idx[j]);
  return out;
}
