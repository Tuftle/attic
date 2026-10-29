// a made-up netflix account with two profiles, its ViewingActivity.csv,
// and the answers the cards must give. the household lives in new york;
// netflix writes start times in utc.

import { rng } from './rng.js';
import { writeZip } from './zipwriter.js';
import { local, utc, yearRange, prevRange, top, byTime, busiest, names, showName, songName } from './ref.js';

export const NETFLIX = { zone: 'America/New_York', now: Date.UTC(2026, 9, 29, 12), years: [2025, 2026] };
const DAY = 86400000;

export function makeViews({ seed = 'netflix', zone = NETFLIX.zone, from = [2024, 2, 1], to = [2026, 9, 15] } = {}) {
  const r = rng(seed);
  const showNames = names(r, 60, showName);
  const shows = showNames.map((show, k) => {
    const seasons = r.int(1, 3);
    const eps = [];
    const limited = k === 5;
    for (let s = 1; s <= seasons && !(limited && s > 1); s++) {
      const n = r.int(6, 10);
      const epNames = names(r, n, songName);
      for (let e = 0; e < n; e++) {
        const title = limited ? `${show}: Limited Series: Episode ${e + 1}` : `${show}: Season ${s}: ${epNames[e]}`;
        eps.push({ title, len: r.int(25, 55) * 60000 });
      }
    }
    return { show, eps, kids: k >= 52 };
  });
  // a title with a comma and quotes, to test the csv quoting
  shows[2].eps[0].title = `${shows[2].show}: Season 1: "Hello, Again"`;
  const films = names(r, 15, songName).map((f, k) => ({ title: k % 5 === 0 ? `${f}: The Return` : f, len: r.int(88, 140) * 60000 }));
  const items = [];
  const profiles = {
    Sam: { devices: ['Samsung 2021 QLED TV', 'iPhone 14'], hours: [19, 20, 21, 22], p: 0.35, show: 0, ep: 0, pool: shows.filter(s => !s.kids) },
    Kid: { devices: ['Amazon Fire TV Stick', 'iPad Air'], hours: [15, 16, 17], p: 0.25, show: 0, ep: 0, pool: shows.filter(s => s.kids) },
  };
  const push = (profile, t, ms, title, show, film, device, extra = {}) => items.push({ t: Math.round(t / 1000) * 1000, ms, profile, title, show, film, device, ...extra });

  // watches episodes in a row from a start time, moving through the profile's shows
  const watch = (name, start, n) => {
    const p = profiles[name];
    let cursor = start;
    for (let k = 0; k < n; k++) {
      const s = p.pool[p.show % p.pool.length];
      const ep = s.eps[p.ep];
      const full = r.chance(0.85);
      const ms = full ? ep.len : r.int(5, ep.len / 60000 - 2) * 60000;
      push(name, cursor, ms, ep.title, s.show, false, r.pick(p.devices));
      cursor += ms + r.int(10, 90) * 1000;
      if (full) p.ep++;
      if (p.ep >= s.eps.length || (p.ep >= 3 && r.chance(0.03))) { p.show++; p.ep = 0; }
    }
    return cursor;
  };

  const special = {
    '2025-11-08': () => watch('Sam', utc(zone, 2025, 10, 8, 13, 0), 9),
    '2025-02-10': () => push('Sam', utc(zone, 2025, 1, 10, 20, 0), films[3].len, films[3].title, films[3].title, true, 'Samsung 2021 QLED TV'),
    '2025-08-15': () => push('Sam', utc(zone, 2025, 7, 15, 20, 30), films[3].len, films[3].title, films[3].title, true, 'Samsung 2021 QLED TV'),
  };
  // shows tried once and left, early in 2025
  const tried = shows.slice(14, 18);
  tried.forEach((s, k) => {
    special[`2025-02-0${k + 2}`] = () => push('Sam', utc(zone, 2025, 1, 2 + k, 16, 0), s.eps[0].len, s.eps[0].title, s.show, false, 'iPhone 14');
  });
  profiles.Sam.pool = profiles.Sam.pool.filter(s => !tried.includes(s));

  for (let day = Date.UTC(...from); day <= Date.UTC(...to); day += DAY) {
    const d = new Date(day);
    const [y, m, dd] = [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
    const date = `${y}-${String(m + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    if (special[date]) { special[date](); continue; }
    for (const name of ['Sam', 'Kid']) {
      const p = profiles[name];
      if (!r.chance(p.p)) continue;
      const start = utc(zone, y, m, dd, r.pick(p.hours), r.int(0, 59), r.int(0, 59));
      if (name === 'Sam' && r.chance(0.12)) {
        const f = r.pick(films);
        push(name, start, f.len - r.int(0, 3) * 60000, f.title, f.title, true, r.pick(p.devices));
      } else {
        watch(name, start, r.int(1, 4));
      }
      if (r.chance(0.2)) push(name, start - 5 * 60000, r.int(30, 90) * 1000, r.pick(films).title, '', false, r.pick(p.devices), { supplemental: r.pick(['TRAILER', 'HOOK', 'TEASER_TRAILER']) });
      if (r.chance(0.1)) push(name, start - 15 * 60000, r.int(40, 100) * 1000, r.pick(films).title, '', true, r.pick(p.devices));
    }
    if (r.chance(0.05)) watch('Sam', utc(zone, y, m, dd, 0, r.int(10, 50)), 1);
  }
  return byTime(items);
}

const pad = n => String(n).padStart(2, '0');
const stamp = t => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; };
const clock = ms => { const s = Math.round(ms / 1000); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };
const q = v => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** ViewingActivity.csv, profile by profile, newest first, as netflix writes it */
export function viewingCsv(items, { bom = false, crlf = false, header } = {}) {
  const head = header || ['Profile Name', 'Start Time', 'Duration', 'Attributes', 'Title', 'Supplemental Video Type', 'Device Type', 'Bookmark', 'Latest Bookmark', 'Country'];
  const rows = [head.join(',')];
  const order = [...items].sort((a, b) => (a.profile < b.profile ? -1 : a.profile > b.profile ? 1 : b.t - a.t));
  for (const it of order) {
    rows.push([it.profile, stamp(it.t), clock(it.ms), it.t % 7 === 0 ? 'Autoplayed: user action: None; ' : '', it.title, it.supplemental || '', it.device, clock(it.ms), it.t % 3 ? clock(it.ms) : 'Not latest view', 'US (United States)'].map(q).join(','));
  }
  const nl = crlf ? '\r\n' : '\n';
  return (bom ? '\u{feff}' : '') + rows.join(nl) + nl;
}

export function netflixZip(items, opts) {
  return writeZip([
    { path: 'netflix-report/CONTENT_INTERACTION/ViewingActivity.csv', data: viewingCsv(items, opts) },
    { path: 'netflix-report/CONTENT_INTERACTION/IndicatedPreferences.csv', data: 'Profile Name,Show,Has Watched,Is Interested\nSam,Something,true,true\n' },
    { path: 'netflix-report/ACCOUNT/AccountDetails.csv', data: 'First Name,Last Name,Email Address\nnot,real,nobody@example.org\n' },
  ]);
}

const dayNumber = date => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / DAY;

export function netflixTruth(items, year, tz = NETFLIX.zone, now = NETFLIX.now) {
  const kept = items.filter(it => !it.supplemental && it.ms >= 120000);
  const { start, end } = yearRange(year, tz, now);
  const inYear = kept.filter(it => it.t >= start && it.t < end);
  if (!inYear.length) return {};
  const prev = prevRange(year, tz, now);
  const covered = Math.min(...kept.map(it => it.t)) <= prev.start + 14 * DAY;
  const profiles = top(inYear, it => it.profile, it => it.ms, e => e.key);
  const out = {};
  const deck = (views, profile, suffix) => {
    const mine = it => profile === null || it.profile === profile;
    const ms = views.reduce((s, it) => s + it.ms, 0);
    const months = new Array(12).fill(0);
    for (const it of views) months[local(it.t, tz).month] += it.ms;
    out['netflix.hours' + suffix] = { ms, views: views.length, months };
    const eps = views.filter(it => !it.film);
    const shows = top(eps, it => it.show, it => it.ms, e => e.key, 5);
    if (shows.length) out['netflix.top-shows' + suffix] = { top: shows.map(e => ({ name: e.key, ms: e.w })) };
    const b = busiest(eps, tz, () => 1);
    if (b && b.w >= 3) {
      const [show] = top(eps.filter(it => local(it.t, tz).date === b.day), it => it.show, () => 1, e => e.key, 1);
      out['netflix.binge' + suffix] = { day: b.day, episodes: b.w, show: show.key };
    }
    const ever = kept.filter(mine);
    const dataEnd = Math.max(...ever.map(it => it.t));
    const info = new Map();
    for (const it of byTime(ever)) {
      if (it.film) continue;
      let s = info.get(it.show);
      if (!s) info.set(it.show, (s = { first: it.t, last: it.t, eps: new Set() }));
      s.last = it.t;
      s.eps.add(it.title);
    }
    const started = [...info.entries()].filter(([, s]) => s.first >= start && s.first < end);
    if (started.length >= 3) {
      const tried = started.filter(([, s]) => s.eps.size <= 2 && dataEnd - s.last >= 60 * DAY).sort((a, c) => a[1].first - c[1].first);
      out['netflix.tried' + suffix] = { started: started.length, tried: tried.length, kept: started.filter(([, s]) => s.eps.size >= 3).length, triedNames: tried.slice(0, 5).map(([k]) => k) };
    }
    const sorted = byTime(views);
    out['netflix.first-last' + suffix] = { first: { title: sorted[0].title, t: sorted[0].t }, last: { title: sorted.at(-1).title, t: sorted.at(-1).t } };
    const night = views.filter(it => local(it.t, tz).hour < 5).length;
    out['netflix.night' + suffix] = { night, views: views.length, share: night / views.length };
    const devices = top(views, it => it.device, it => it.ms, e => e.key, 4);
    if (devices.length) out['netflix.devices' + suffix] = { top: devices.map(e => ({ name: e.key, ms: e.w })) };
    const firstDay = local(start, tz).date;
    const days = new Map();
    for (const it of byTime(ever.filter(it => it.t < end))) {
      let d = days.get(it.title);
      if (!d) days.set(it.title, (d = { dates: [], first: it.t }));
      const date = local(it.t, tz).date;
      if (d.dates.at(-1) !== date) d.dates.push(date);
    }
    const re = [];
    for (const [title, d] of days) {
      const inside = d.dates.filter(x => x >= firstDay);
      if (inside.length && dayNumber(inside.at(-1)) - dayNumber(d.dates[0]) >= 30) re.push({ title, w: d.dates.length, first: d.first, t: d.first });
    }
    if (re.length) {
      const [best] = top(re, x => x.title, x => x.w, e => e.key, 1);
      out['netflix.rewatch' + suffix] = { titles: re.length, top: { title: best.key, days: best.w } };
    }
    if (covered) {
      const prevMs = kept.filter(it => mine(it) && it.t >= prev.start && it.t < prev.end).reduce((s, it) => s + it.ms, 0);
      if (prevMs) out['netflix.change' + suffix] = { ms, prevMs, change: (ms - prevMs) / prevMs };
    }
  };
  if (profiles.length <= 1) deck(inYear, null, '');
  else profiles.forEach((p, n) => deck(inYear.filter(it => it.profile === p.key), p.key, `@${n + 1}`));
  return out;
}

export function netflixFixture(opts = {}) {
  const items = makeViews(opts);
  const truth = {};
  for (const y of NETFLIX.years) truth[y] = netflixTruth(items, y);
  return { items, zip: netflixZip(items), truth, zone: NETFLIX.zone, now: NETFLIX.now };
}
