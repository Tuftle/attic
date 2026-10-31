// plain reference helpers for the truth files. deliberately slow and simple:
// Intl is asked for every single time, and nothing is shared with site/src,
// so the truth is never just the code under test agreeing with itself.

const fmts = new Map();
function fmt(tz) {
  let f = fmts.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
    fmts.set(tz, f);
  }
  return f;
}

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** local wall clock parts of a utc time */
export function local(t, tz) {
  const p = {};
  for (const x of fmt(tz).formatToParts(new Date(t))) p[x.type] = x.value;
  const out = { year: +p.year, month: +p.month - 1, day: +p.day, hour: +p.hour % 24, minute: +p.minute, second: +p.second, weekday: WD.indexOf(p.weekday) };
  out.date = `${p.year}-${p.month}-${p.day}`;
  return out;
}

/** the utc time of a local wall clock time */
export function utc(tz, year, month, day, hour = 0, minute = 0, second = 0) {
  const wall = Date.UTC(year, month, day, hour, minute, second);
  let guess = wall;
  for (let k = 0; k < 4; k++) {
    const p = local(guess, tz);
    const shown = Date.UTC(p.year, p.month, p.day, p.hour, p.minute, p.second);
    guess = guess + (wall - shown);
  }
  return guess;
}

/** [start, end) of a local year, cut at now if the year is not over */
export function yearRange(year, tz, now) {
  const start = utc(tz, year, 0, 1);
  const full = utc(tz, year + 1, 0, 1);
  const unfinished = now >= start && now < full;
  return { start, end: unfinished ? now : full, unfinished, full };
}

/** the stretch of last year to compare with */
export function prevRange(year, tz, now) {
  const r = yearRange(year, tz, now);
  const start = utc(tz, year - 1, 0, 1);
  return { start, end: r.unfinished ? start + (now - r.start) : r.start };
}

/** group items by a key into totals; sort them the documented way */
export function top(items, keyOf, weightOf, nameOf, n) {
  const map = new Map();
  for (const it of items) {
    const k = keyOf(it);
    if (k === null || k === undefined) continue;
    let e = map.get(k);
    if (!e) { e = { key: k, w: 0, first: it.t, item: it }; map.set(k, e); }
    e.w += weightOf(it);
    if (it.t < e.first) e.first = it.t;
  }
  const list = [...map.values()].sort((a, b) => (b.w - a.w) || (a.first - b.first) || (nameOf(a) < nameOf(b) ? -1 : nameOf(a) > nameOf(b) ? 1 : 0));
  return n ? list.slice(0, n) : list;
}

export function byTime(items) {
  return items.slice().sort((a, b) => a.t - b.t);
}

/** sessions: a new one starts when an item begins more than gap after the latest end */
export function sessionsOf(items, gap) {
  const sorted = byTime(items);
  const out = [];
  let cur = null;
  for (const it of sorted) {
    const end = it.t + (it.ms || 0);
    if (!cur || it.t - cur.end > gap) {
      cur = { start: it.t, end, count: 0, ms: 0 };
      out.push(cur);
    }
    cur.count++;
    cur.ms += it.ms || 0;
    if (end > cur.end) cur.end = end;
  }
  return out;
}

export function longestOf(list, key) {
  let best = null;
  for (const s of list) if (!best || key(s) > key(best)) best = s;
  return best;
}

/** the busiest local day by a weight; ties go to the earlier day */
export function busiest(items, tz, weightOf) {
  const map = new Map();
  for (const it of items) {
    const d = local(it.t, tz).date;
    map.set(d, (map.get(d) || 0) + weightOf(it));
  }
  let best = null;
  for (const [day, w] of map) if (!best || w > best.w || (w === best.w && day < best.day)) best = { day, w };
  return best;
}

export function hourBins(items, tz) {
  const bins = new Array(24).fill(0);
  for (const it of items) bins[local(it.t, tz).hour]++;
  return bins;
}

export function firstMax(bins) {
  let b = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i] > bins[b]) b = i;
  return b;
}

/** the most times one key shows up in one local day */
export function mostInADay(items, tz, keyOf, nameOf) {
  const map = new Map();
  for (const it of items) {
    const k = `${local(it.t, tz).date}\u{1}${keyOf(it)}`;
    let e = map.get(k);
    if (!e) { e = { day: local(it.t, tz).date, name: nameOf(it), item: it, n: 0 }; map.set(k, e); }
    e.n++;
  }
  let best = null;
  for (const e of map.values()) {
    if (!best || e.n > best.n || (e.n === best.n && (e.day < best.day || (e.day === best.day && e.name < best.name)))) best = e;
  }
  return best;
}

/** a list of names the way people write them */
const A = ['velvet', 'paper', 'quiet', 'silver', 'wild', 'golden', 'hollow', 'little', 'northern', 'electric', 'amber', 'distant', 'lazy', 'bright', 'secret', 'winter', 'summer', 'broken', 'gentle', 'midnight', 'copper', 'blue', 'crimson', 'lucky'];
const N = ['harbour', 'lanterns', 'foxes', 'rivers', 'gardens', 'machines', 'orchard', 'pilots', 'echoes', 'meadow', 'satellites', 'tigers', 'kites', 'owls', 'parade', 'tides', 'ghosts', 'dreamers', 'radios', 'hills', 'sailors', 'lights', 'bees', 'wolves'];
const cap = s => s.replace(/\b[a-z]/g, c => c.toUpperCase());

export function names(r, n, form) {
  const seen = new Set();
  const out = [];
  while (out.length < n) {
    let s = form(r);
    if (seen.has(s)) s = `${s} ${out.length}`;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export const bandName = r => cap((r.chance(0.4) ? 'the ' : '') + r.pick(A) + ' ' + r.pick(N));
export const songName = r => cap(r.pick(A) + ' ' + r.pick(N) + (r.chance(0.15) ? ' (live)' : ''));
export const showName = r => cap('the ' + r.pick(A) + ' ' + r.pick(N));
