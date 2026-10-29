// made-up browser history: a firefox places.sqlite and a chrome History
// file, built with the vendored sql.js, and the answers the cards must give.

import { rng } from './rng.js';
import { writeZip } from './zipwriter.js';
import { loadSql } from '../lib/sqljs.js';
import { local, utc, yearRange, top, byTime, longestOf, firstMax } from './ref.js';

export const BROWSER = { zone: 'America/Los_Angeles', now: Date.UTC(2026, 9, 29, 12), years: [2025, 2026] };
const DAY = 86400000;
const WEBKIT = 11644473600000;

const WORDS = ['velvet', 'paper', 'quiet', 'silver', 'harbour', 'lantern', 'orchard', 'pilot', 'meadow', 'radio', 'kite', 'owl', 'tide', 'garden', 'copper', 'amber'];

/** every visit, with where it came from and whether attic should count it */
export function makeVisits({ seed = 'browser', zone = BROWSER.zone } = {}) {
  const r = rng(seed);
  const sites = [];
  for (let i = 0; i < 70; i++) sites.push(`${WORDS[i % 16]}${WORDS[(i * 7 + 3) % 16]}${i}.example`);
  sites[0] = 'news.example.org';
  sites[1] = 'mail.example.com';
  const weights = r.zipf(70, 1.05);
  const visits = [];
  const browse = (browser, start, n) => {
    let t = start;
    for (let k = 0; k < n; k++) {
      const site = r.weighted(sites, weights);
      const www = r.chance(0.3) ? 'www.' : '';
      const path = r.chance(0.2) ? `/search?q=${r.pick(WORDS)}+${r.pick(WORDS)}` : `/${r.pick(WORDS)}/${r.int(1, 999)}`;
      const url = `http${r.chance(0.9) ? 's' : ''}://${www}${site}${path}`;
      visits.push({ browser, t, url, site, counted: true, type: r.weighted([1, 2, 9], [8, 2, 1]) });
      // things that are not visits a person made
      if (r.chance(0.05)) visits.push({ browser, t: t + 50, url: `https://ads${k}.tracker.example/frame`, site: null, counted: false, type: 'frame' });
      if (r.chance(0.03)) visits.push({ browser, t: t + 70, url: `https://short.example/${k}`, site: null, counted: false, type: 'redirect' });
      t += r.chance(0.1) ? r.int(6, 25) * 60000 : r.int(5, 240) * 1000;
    }
  };
  for (let day = Date.UTC(2024, 2, 1); day <= Date.UTC(2026, 9, 20); day += DAY) {
    const d = new Date(day);
    const [y, m, dd] = [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
    if (!r.chance(0.8)) continue;
    // chrome joined in june 2025; firefox stayed
    const browser = day >= Date.UTC(2025, 5, 1) && r.chance(0.4) ? 'chrome' : 'firefox';
    for (let s = 0; s < r.int(1, 2); s++) {
      const start = utc(zone, y, m, dd, r.weighted([...Array(24).keys()], [0.4, 0.2, 0.1, 0.1, 0.1, 0.1, 0.3, 1, 2, 3, 3, 3, 2, 3, 3, 3, 2, 2, 2, 2, 2, 2, 1.5, 1]), r.int(0, 59), r.int(0, 59));
      browse(browser, start, r.int(3, 18));
    }
    if (r.chance(0.05)) visits.push({ browser: 'firefox', t: utc(zone, y, m, dd, 9, 0), url: 'about:newtab', site: null, counted: false, type: 1 });
    if (r.chance(0.03)) visits.push({ browser: 'firefox', t: utc(zone, y, m, dd, 9, 1), url: 'file:///home/someone/private-notes.txt', site: null, counted: false, type: 1 });
    if (r.chance(0.02)) visits.push({ browser: 'firefox', t: utc(zone, y, m, dd, 9, 2), url: `https://${sites[5]}/file.zip`, site: null, counted: false, type: 7 });
  }
  return byTime(visits);
}

/** the firefox database, with microsecond times and visit types */
export async function placesSqlite(visits) {
  const SQL = await loadSql();
  const db = new SQL.Database();
  db.run('create table moz_places (id integer primary key, url longvarchar, title longvarchar, rev_host longvarchar, visit_count integer default 0, hidden integer default 0, typed integer default 0, frecency integer default -1, last_visit_date integer, guid text)');
  db.run('create table moz_historyvisits (id integer primary key, from_visit integer, place_id integer, visit_date integer, visit_type integer, session integer)');
  db.run('create table moz_bookmarks (id integer primary key, type integer, fk integer, parent integer, position integer, title longvarchar)');
  const places = new Map();
  const ins = db.prepare('insert into moz_places (id, url, title) values (?, ?, ?)');
  const vis = db.prepare('insert into moz_historyvisits (place_id, visit_date, visit_type) values (?, ?, ?)');
  let micro = 0;
  for (const v of visits.filter(x => x.browser === 'firefox')) {
    let id = places.get(v.url);
    if (!id) {
      id = places.size + 1;
      places.set(v.url, id);
      ins.run([id, v.url, `a page title that attic never reads ${id}`]);
    }
    const type = v.type === 'frame' ? 4 : v.type === 'redirect' ? 5 : v.type;
    const date = v.t * 1000 + (micro++ % 997);
    v.ms = date / 1000;
    vis.run([id, date, type]);
  }
  ins.free();
  vis.free();
  const bytes = db.export();
  db.close();
  return bytes;
}

/** the chrome database: times in microseconds since 1601, transitions with qualifiers */
export async function historySqlite(visits) {
  const SQL = await loadSql();
  const db = new SQL.Database();
  db.run('create table urls (id integer primary key, url longvarchar, title longvarchar, visit_count integer default 0 not null, typed_count integer default 0 not null, last_visit_time integer not null default 0, hidden integer default 0 not null)');
  db.run('create table visits (id integer primary key, url integer not null, visit_time integer not null, from_visit integer, transition integer default 0 not null, segment_id integer, visit_duration integer default 0 not null)');
  db.run('create table keyword_search_terms (keyword_id integer not null, url_id integer not null, term longvarchar not null, normalized_term longvarchar not null)');
  const urls = new Map();
  const ins = db.prepare('insert into urls (id, url, title) values (?, ?, ?)');
  const vis = db.prepare('insert into visits (url, visit_time, transition) values (?, ?, ?)');
  for (const v of visits.filter(x => x.browser === 'chrome')) {
    let id = urls.get(v.url);
    if (!id) {
      id = urls.size + 1;
      urls.set(v.url, id);
      ins.run([id, v.url, `a title attic never reads ${id}`]);
    }
    // a link visit is a one step chain; a redirect starts a chain that ends elsewhere
    const transition = v.type === 'frame' ? 3 : v.type === 'redirect' ? 0x10000000 : (v.type === 2 ? 1 : 0) | 0x30000000;
    v.ms = v.t;
    vis.run([id, (v.t + WEBKIT) * 1000, transition | 0]);
  }
  ins.free();
  vis.free();
  const bytes = db.export();
  db.close();
  return bytes;
}

export function browserTruth(visits, year, tz = BROWSER.zone, now = BROWSER.now) {
  const kept = byTime(visits.filter(v => v.counted).map(v => ({ t: v.ms ?? v.t, site: new URL(v.url).hostname.replace(/^www\d?\./, '') })));
  const { start, end } = yearRange(year, tz, now);
  const inYear = kept.filter(v => v.t >= start && v.t < end);
  if (!inYear.length) return {};
  const out = {};
  const online = list => { let s = 0; for (let i = 1; i < list.length; i++) { const d = list[i].t - list[i - 1].t; if (d < 5 * 60000) s += d; } return s; };
  out['browser.hours'] = { ms: online(inYear), visits: inYear.length };
  const sites = top(inYear, v => v.site, () => 1, e => e.key, 5);
  out['browser.top-sites'] = { top: sites.map(e => ({ name: e.key, visits: e.w })) };
  const bins = new Array(7).fill(0);
  for (const v of inYear) bins[local(v.t, tz).weekday]++;
  out['browser.weekday'] = { bins, peak: firstMax(bins) };
  if (kept[0].t < start - 30 * DAY) {
    const before = new Set(kept.filter(v => v.t < start).map(v => v.site));
    const seen = new Set(inYear.map(v => v.site));
    const fresh = [...seen].filter(s => !before.has(s)).length;
    if (fresh) out['browser.new-sites'] = { seen: seen.size, fresh, share: fresh / seen.size };
  }
  const runs = [];
  for (const v of inYear) {
    const last = runs.at(-1);
    if (last && v.t - last.end < 5 * 60000) { last.end = v.t; last.count++; } else runs.push({ start: v.t, end: v.t, count: 1 });
  }
  const hole = longestOf(runs, s => s.end - s.start);
  if (hole.count > 1) out['browser.rabbit-hole'] = { start: hole.start, end: hole.end, count: hole.count };
  const night = inYear.filter(v => local(v.t, tz).hour < 5).length;
  out['browser.night'] = { night, visits: inYear.length, share: night / inYear.length };
  out['browser.first-last'] = { first: { site: inYear[0].site, t: inYear[0].t }, last: { site: inYear.at(-1).site, t: inYear.at(-1).t } };
  return out;
}

export async function browserFixture() {
  const visits = makeVisits();
  const places = await placesSqlite(visits);
  const history = await historySqlite(visits);
  const truth = {};
  for (const y of BROWSER.years) truth[y] = browserTruth(visits, y);
  const zip = writeZip([{ path: 'firefox/places.sqlite', data: places }, { path: 'chrome/History', data: history }]);
  return { visits, places, history, zip, truth, zone: BROWSER.zone, now: BROWSER.now };
}
