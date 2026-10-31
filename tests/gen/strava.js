// a made-up strava export and the answers the cards must give. the
// athlete lives in london; strava writes utc.

import { rng } from './rng.js';
import { writeZip } from './zipwriter.js';
import { local, utc, yearRange, prevRange, byTime, hourBins, firstMax } from './ref.js';

export const STRAVA = { zone: 'Europe/London', now: Date.UTC(2026, 9, 29, 12), years: [2025, 2026] };
const DAY = 86400000;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function makeActivities({ seed = 'strava', zone = STRAVA.zone } = {}) {
  const r = rng(seed);
  const out = [];
  let id = 9000000000;
  for (let d = Date.UTC(2024, 0, 2); d <= Date.UTC(2026, 9, 22); d += DAY) {
    const date = new Date(d);
    // a quiet stretch each summer breaks the weekly streak
    if (date.getUTCMonth() === 7 && date.getUTCDate() < 20) continue;
    if (!r.chance(0.4)) continue;
    const type = r.weighted(['Run', 'Ride', 'Walk', 'Swim'], [5, 3, 2, 1]);
    const km = type === 'Ride' ? r.int(15, 90) : type === 'Swim' ? r.int(1, 3) : r.int(3, 21);
    const speed = { Run: 11, Ride: 26, Walk: 5, Swim: 2.5 }[type];
    const moving = Math.round((km / speed) * 3600);
    out.push({
      id: String(id++), t: utc(zone, date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), r.weighted([6, 7, 12, 17, 18, 19], [3, 3, 1, 2, 3, 2]), r.int(0, 59), r.int(0, 59)),
      type, metres: km * 1000 + r.int(0, 999), moving, elapsed: moving + r.int(0, 900), elevation: type === 'Swim' ? 0 : r.int(0, type === 'Ride' ? 900 : 200),
    });
  }
  return byTime(out);
}

const takeout = t => { const d = new Date(t); const h = d.getUTCHours(); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}, ${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

export function activitiesCsv(acts) {
  const head = ['Activity ID', 'Activity Date', 'Activity Name', 'Activity Type', 'Activity Description', 'Elapsed Time', 'Distance', 'Max Heart Rate', 'Commute', 'Activity Private Note', 'Filename', 'Elapsed Time', 'Moving Time', 'Distance', 'Max Speed', 'Elevation Gain'];
  const q = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows = acts.map(a => [a.id, takeout(a.t), `Morning ${a.type}, by the river`, a.type, 'a private description', a.elapsed, (a.metres / 1000).toFixed(2), 160, 'false', 'a private note', `activities/${a.id}.fit.gz`, a.elapsed, a.moving, a.metres.toFixed(1), 5.2, a.elevation].map(q).join(','));
  return [head.join(','), ...rows].join('\n') + '\n';
}

export function stravaZip(acts) {
  return writeZip([
    { path: 'export_123/activities.csv', data: activitiesCsv(acts) },
    { path: 'export_123/activities/9000000000.gpx', data: '<gpx>never read</gpx>' },
    { path: 'export_123/profile.csv', data: 'Athlete ID,Email Address,First Name\n1,nobody@example.org,someone\n' },
  ]);
}

export function stravaTruth(acts, year, tz = STRAVA.zone, now = STRAVA.now) {
  const { start, end } = yearRange(year, tz, now);
  const inYear = acts.filter(a => a.t >= start && a.t < end);
  if (!inYear.length) return {};
  const out = {};
  const months = new Array(12).fill(0);
  for (const a of inYear) months[local(a.t, tz).month]++;
  out['strava.activities'] = { activities: inYear.length, months };
  const metres = inYear.reduce((s, a) => s + a.metres, 0);
  const types = new Map();
  for (const a of inYear) { const e = types.get(a.type) || { w: 0, first: a.t }; e.w += a.metres; types.set(a.type, e); }
  const byType = [...types].sort((a, b) => b[1].w - a[1].w || a[1].first - b[1].first || (a[0] < b[0] ? -1 : 1)).slice(0, 5);
  out['strava.distance'] = { metres, byType: byType.map(([type, e]) => ({ type, metres: e.w })) };
  const longest = inYear.reduce((a, b) => (b.metres > a.metres ? b : a));
  out['strava.longest'] = { type: longest.type, metres: longest.metres };
  out['strava.time'] = { ms: inYear.reduce((s, a) => s + a.moving * 1000, 0) };
  let m = 0;
  for (let i = 1; i < 12; i++) if (months[i] > months[m]) m = i;
  out['strava.month'] = { month: m, activities: months[m] };
  const dayNum = a => { const p = local(a.t, tz); return Date.UTC(p.year, p.month, p.day) / DAY; };
  const weeks = [...new Set(inYear.map(a => dayNum(a) - local(a.t, tz).weekday))].sort((a, b) => a - b);
  let best = 1, run = 1;
  for (let k = 1; k < weeks.length; k++) { run = weeks[k] - weeks[k - 1] === 7 ? run + 1 : 1; if (run > best) best = run; }
  out['strava.weeks'] = { weeks: best };
  const bins = hourBins(inYear, tz);
  out['strava.hour'] = { bins, peak: firstMax(bins) };
  const climbed = inYear.reduce((s, a) => s + a.elevation, 0);
  if (climbed > 0) out['strava.elevation'] = { metres: climbed };
  const prev = prevRange(year, tz, now);
  if (acts[0].t <= prev.start + 14 * DAY) {
    const p = acts.filter(a => a.t >= prev.start && a.t < prev.end).length;
    if (p) out['strava.change'] = { activities: inYear.length, prev: p, change: (inYear.length - p) / p };
  }
  return out;
}

export function stravaFixture() {
  const acts = makeActivities();
  const truth = {};
  for (const y of STRAVA.years) truth[y] = stravaTruth(acts, y);
  return { items: acts, zip: stravaZip(acts), truth, zone: STRAVA.zone, now: STRAVA.now };
}
