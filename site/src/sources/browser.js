// browser history: firefox and wren keep it in places.sqlite, chrome, edge
// and brave in a file called History. both are sqlite, read with sql.js.
// only the site name and the time of each visit are read: never page titles,
// full addresses or searches.

import { EventStore } from '../core/store.js';
import { isSqlite, openDatabase, tables, rows } from '../core/sqlite.js';
import { card, scope } from '../core/cards.js';
import { name, words, pick, hours, hoursValue, duration, percent, int, count } from '../core/templates.js';
import { totalsBy, topN, weekdayHistogram, peak, sessions, longest, discovery, share, change, where } from '../core/analysers.js';
import { dayName, WEEKDAYS, DAY } from '../core/timezone.js';
import { bars, progress } from './common.js';

const ONLINE_GAP = 5 * 60000;
const WEBKIT_EPOCH_MS = 11644473600000;

// firefox visit types left out: embedded, two kinds of redirect, download, framed link
const FIREFOX_SKIP = new Set([4, 5, 6, 7, 8]);
// chromium core transitions left out: automatic and manual subframes
const CHROMIUM_SKIP = new Set([3, 4]);
const CHAIN_END = 0x20000000;

/** "https://www.example.org/a?b" to "example.org", or null for anything not on the web */
export function siteOf(url) {
  const m = /^https?:\/\/(?:[^@/?#]*@)?([^/:?#]+)/i.exec(String(url || ''));
  if (!m) return null;
  const host = m[1].toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  return host.replace(/^www\d?\./, '');
}

function match(f) {
  return /^(places\.sqlite|History)$/i.test(f.name) ? 0.8 : 0;
}

function detect(files) {
  const out = [];
  for (const f of files) {
    if (!isSqlite(f.headBytes)) continue;
    out.push({ file: f, score: match(f) ? 0.9 : 0.6 });
  }
  return { files: out };
}

async function parse(files, onProgress, env = {}) {
  const store = new EventStore(16384);
  const notes = [];
  const tick = progress(onProgress, 5000);
  if (!env.sqlite) throw Object.assign(new Error('the database reader is not available here.'), { code: 'no-sqlite' });
  const SQL = await env.sqlite();
  for (const f of files) {
    let db;
    try {
      db = openDatabase(SQL, await f.bytes());
      const names = new Set(tables(db));
      if (names.has('moz_historyvisits') && names.has('moz_places')) {
        for (const [date, type, url] of rows(db, 'select v.visit_date, v.visit_type, p.url from moz_historyvisits v join moz_places p on p.id = v.place_id')) {
          if (FIREFOX_SKIP.has(Number(type))) continue;
          add(store, Number(date) / 1000, url, tick);
        }
      } else if (names.has('visits') && names.has('urls')) {
        for (const [time, transition, url] of rows(db, 'select v.visit_time, v.transition, u.url from visits v join urls u on u.id = v.url')) {
          const tr = Number(transition) >>> 0;
          if (CHROMIUM_SKIP.has(tr & 0xff)) continue;
          // in a redirect chain, only the page the chain ended on counts
          if ((tr & 0xf0000000) && !(tr & CHAIN_END)) continue;
          add(store, Number(time) / 1000 - WEBKIT_EPOCH_MS, url, tick);
        }
      } else {
        notes.push({ path: f.path, code: 'schema', message: 'this database does not look like a browser history. attic reads places.sqlite from firefox or wren, and the History file from chrome, edge or brave.' });
      }
    } catch (e) {
      const big = e instanceof RangeError || /memory|allocation/i.test(String(e && e.message));
      notes.push({ path: f.path, code: big ? 'too-large' : e.code || 'format', message: big ? 'this history file is too large for your browser\'s memory. try a copy from a profile with less history, or another browser.' : e.message });
    } finally {
      db?.close();
    }
  }
  tick.done();
  return { store, notes, count: tick.count };
}

function add(store, t, url, tick) {
  const site = siteOf(url);
  if (!site || !Number.isFinite(t) || t <= 0) return;
  store.push({ t, kind: 'visit', creator: site });
  tick.tick();
}

// the cards

function cards(r, ctx) {
  const store = r.store;
  const S = scope(store, ctx);
  const { z, when } = S;
  const visits = store.ofKind('visit', S.lo, S.hi);
  if (!visits.length) return [];
  const t = store.t, str = id => store.strings.str(id) || '';
  const base = { source: 'browser' };
  const out = [];

  // time online, estimated from the gaps between visits
  const online = gapsUnder(t, visits, ONLINE_GAP);
  let prevMs = null;
  if (S.prev) prevMs = gapsUnder(t, store.ofKind('visit', S.prev.lo, S.prev.hi), ONLINE_GAP);
  const delta = prevMs ? change(online, prevMs) : null;
  out.push(card({
    ...base, id: 'browser.hours', title: 'your year online', big: hours(online),
    caption: words(pick(['online {when}, as an estimate: the time between visits less than 5 minutes apart.', 'in your browser {when}. an estimate, adding up the gaps between visits under 5 minutes.'], `b:${ctx.year}:${visits.length}`), { when }),
    detail: words('{n} in all.', { n: count(visits.length, 'visit') }),
    values: { ms: online, visits: visits.length },
    stat: { label: 'online, as an estimate', display: hours(online), value: hoursValue(online), change: delta },
  }));

  const sites = topN(totalsBy(store.creator, visits, null, t), 5, str);
  out.push(card({
    ...base, id: 'browser.top-sites', title: 'top sites', big: name(str(sites[0].key)),
    caption: words('the site you visited most {when}, {n}.', { when, n: count(sites[0].w, 'visit') }),
    visual: bars(sites.map(e => ({ label: name(str(e.key)), value: e.w, display: count(e.w, 'visit') }))),
    values: { top: sites.map(e => ({ name: str(e.key), visits: e.w })) },
  }));

  const bins = weekdayHistogram(t, visits, z);
  const wd = peak(bins);
  out.push(card({
    ...base, id: 'browser.weekday', title: 'your busiest weekday', big: WEEKDAYS[wd],
    caption: words('with {share} of your visits {when}.', { share: percent(share(bins[wd], visits.length)), when }),
    visual: bars(bins.map((v, d) => ({ label: WEEKDAYS[d], value: v, display: int(v) }))),
    values: { bins, peak: wd },
  }));

  const earlier = store.ofKind('visit', 0, S.lo);
  if (earlier.length && t[earlier[0]] < S.y0 - 30 * DAY) {
    const d = discovery(store.creator, earlier, visits);
    if (d.fresh) out.push(card({
      ...base, id: 'browser.new-sites', title: 'new places', big: count(d.fresh, 'site'),
      caption: words('you visited for the first time {when}, out of {n}.', { when, n: int(d.seen) }),
      values: { seen: d.seen, fresh: d.fresh, share: d.share },
    }));
  }

  const runs = sessions(t, null, visits, ONLINE_GAP - 1);
  const hole = longest(runs, s => s.end - s.start);
  if (hole && hole.count > 1) {
    out.push(card({
      ...base, id: 'browser.rabbit-hole', title: 'the longest rabbit hole', big: duration(hole.end - hole.start),
      caption: words('of browsing on {day}, {n} with no break longer than 5 minutes.', { day: dayName(z.dayKey(hole.start)), n: count(hole.count, 'page') }),
      values: { start: hole.start, end: hole.end, count: hole.count },
    }));
  }

  const night = where(visits, i => z.hour(t[i]) < 5).length;
  out.push(card({
    ...base, id: 'browser.night', title: 'late nights', big: percent(share(night, visits.length)),
    caption: night ? 'of your visits were between midnight and 5 am.' : 'of your visits were between midnight and 5 am. the internet can wait.',
    values: { night, visits: visits.length, share: share(night, visits.length) },
  }));

  const f = visits[0], l = visits[visits.length - 1];
  out.push(card({
    ...base, id: 'browser.first-last', title: 'first and last', big: name(str(store.creator[f])),
    caption: words('the first site you opened {when}, on {day}.', { when, day: dayName(z.dayKey(t[f])) }),
    detail: words(S.unfinished ? 'the latest so far is {site}, on {day}.' : 'the last was {site}, on {day}.', { site: name(str(store.creator[l])), day: dayName(z.dayKey(t[l])) }),
    values: { first: { site: str(store.creator[f]), t: t[f] }, last: { site: str(store.creator[l]), t: t[l] } },
  }));
  return out;
}

/** the sum of gaps between consecutive visits that are shorter than gap */
export function gapsUnder(t, idx, gap) {
  let total = 0;
  for (let j = 1; j < idx.length; j++) {
    const d = t[idx[j]] - t[idx[j - 1]];
    if (d < gap) total += d;
  }
  return total;
}

export default {
  id: 'browser',
  name: 'your browser',
  unit: 'visits',
  guide: 'firefox',
  match,
  detect,
  parse,
  cards,
};
