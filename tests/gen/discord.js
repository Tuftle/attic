// a made-up discord data package and the answers the cards must give. the
// person lives in berlin; discord writes utc with microseconds.

import { rng } from './rng.js';
import { writeZip } from './zipwriter.js';
import { local, utc, yearRange, prevRange, top, byTime, busiest, hourBins, firstMax, names, bandName } from './ref.js';
import { tokens } from '../../site/src/sources/chat.js';

export const DISCORD = { zone: 'Europe/Berlin', now: Date.UTC(2026, 9, 29, 12), years: [2025, 2026] };
const DAY = 86400000;
const WORDS = ['lol', 'tonight', 'raid', 'garden', 'stream', 'patch', 'build', 'coffee', 'meeting', 'later', 'yes', 'maybe', 'ok', 'the', 'is', 'and', 'map', 'boss'];

export function makeMessages({ seed = 'discord', zone = DISCORD.zone } = {}) {
  const r = rng(seed);
  const servers = names(r, 6, bandName);
  const channels = [];
  let cid = 100000000000000000n;
  for (const s of servers) for (const c of ['general', 'off-topic', 'plans'].slice(0, r.int(1, 3))) channels.push({ id: String(cid++), type: 0, name: c, guild: s });
  for (let k = 0; k < 5; k++) channels.push({ id: String(cid++), type: 1, recipients: [`9${k}`, '1'] });
  channels.push({ id: String(cid++), type: 3, name: 'the group', recipients: ['91', '92', '1'] });
  const weights = r.zipf(channels.length, 0.9);
  const msgs = [];
  let mid = 1200000000000000000n;
  for (let d = Date.UTC(2024, 0, 4); d <= Date.UTC(2026, 9, 20); d += DAY) {
    if (!r.chance(0.6)) continue;
    const date = new Date(d);
    for (let s = 0; s < r.int(1, 3); s++) {
      const ch = r.weighted(channels, weights);
      let t = utc(zone, date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), r.weighted([...Array(24).keys()], [1, .6, .3, .2, .1, .1, .1, .3, .6, 1, 1, 1, 1.5, 1.5, 1.5, 1.5, 2, 2, 3, 3, 3, 3, 2.5, 1.5]), r.int(0, 59), r.int(0, 59)) + r.int(0, 999);
      for (let k = 0; k < r.int(1, 12); k++) {
        const text = Array.from({ length: r.int(1, 14) }, () => r.pick(WORDS)).join(' ');
        msgs.push({ id: String(mid++), t, text, attachment: r.chance(0.05), channel: ch });
        t += r.int(5, 400) * 1000 + r.int(0, 999);
      }
    }
  }
  return { channels, msgs: byTime(msgs) };
}

const stamp = t => new Date(t).toISOString().replace('T', ' ').replace(/\.(\d{3})Z$/, '.$1000+00:00');

export function discordZip({ channels, msgs }, { csvFor = 1 } = {}) {
  const entries = [];
  const index = {};
  channels.forEach((c, k) => {
    const mine = msgs.filter(m => m.channel === c);
    if (!mine.length) return;
    index[c.id] = c.type === 0 ? `${c.name} in ${c.guild}` : c.type === 3 ? c.name : 'Direct Message with someone#0';
    const info = c.type === 0 ? { id: c.id, type: 0, name: c.name, guild: { id: `g${c.guild.length}`, name: c.guild } } : { id: c.id, type: c.type, name: c.name, recipients: c.recipients };
    entries.push({ path: `package/messages/c${c.id}/channel.json`, data: JSON.stringify(info) });
    if (k === csvFor) {
      const q = v => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
      entries.push({ path: `package/messages/c${c.id}/messages.csv`, data: 'ID,Timestamp,Contents,Attachments\n' + mine.map(m => [m.id, stamp(m.t), q(m.text), m.attachment ? 'https://cdn.example/a.png' : ''].join(',')).join('\n') + '\n' });
    } else {
      entries.push({ path: `package/messages/c${c.id}/messages.json`, data: JSON.stringify(mine.map(m => ({ ID: Number(m.id) || m.id, Timestamp: stamp(m.t), Contents: m.text, Attachments: m.attachment ? 'https://cdn.example/a.png' : '' }))) });
    }
  });
  entries.push({ path: 'package/messages/index.json', data: JSON.stringify(index) });
  entries.push({ path: 'package/account/user.json', data: '{"id": "1", "username": "not-real"}' });
  entries.push({ path: 'package/activity/analytics/events-2025-00000-of-00001.json', data: '{"event_type": "never read", "ip": "0.0.0.0"}\n' });
  entries.push({ path: 'package/servers/index.json', data: '{}' });
  return writeZip(entries);
}

export function discordTruth({ msgs }, year, tz = DISCORD.zone, now = DISCORD.now) {
  const { start, end } = yearRange(year, tz, now);
  const all = msgs.filter(m => m.t >= start && m.t < end);
  if (!all.length) return {};
  const out = {};
  const months = new Array(12).fill(0);
  for (const m of all) months[local(m.t, tz).month]++;
  out['discord.messages'] = { messages: all.length, months };
  const b = busiest(all, tz, () => 1);
  const bins = hourBins(all, tz);
  out['discord.busiest'] = { day: b.day, messages: b.w, bins, peak: firstMax(bins) };
  const direct = all.filter(m => m.channel.type !== 0).length;
  out['discord.places'] = { direct, server: all.length - direct, share: direct / all.length };
  const days = [...new Set(all.map(m => local(m.t, tz).date))].sort();
  const n = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAY;
  let best = null, run = null;
  for (const d of days) {
    run = run && n(d) === n(run.end) + 1 ? { start: run.start, end: d, len: run.len + 1 } : { start: d, end: d, len: 1 };
    if (!best || run.len > best.len) best = run;
  }
  if (best.len >= 2) out['discord.streak'] = { days: best.len, start: best.start, end: best.end };
  out['discord.words'] = { words: all.reduce((s, m) => s + m.text.split(/\s+/).filter(Boolean).length, 0) };
  const night = all.filter(m => local(m.t, tz).hour < 5).length;
  out['discord.night'] = { night, messages: all.length, share: night / all.length };
  const inServers = all.filter(m => m.channel.type === 0);
  const ts = top(inServers, m => m.channel.guild, () => 1, e => e.key, 5);
  if (ts.length) {
    out['discord.top-servers'] = { top: ts.map(e => ({ name: e.key, messages: e.w })) };
    const tc = top(inServers, m => `#${m.channel.name} in ${m.channel.guild}`, () => 1, e => e.key, 5);
    out['discord.top-channels'] = { top: tc.map(e => ({ name: e.key, messages: e.w })) };
  }
  const freq = new Map();
  for (const m of byTime(all)) for (const w of tokens(m.text)) { const e = freq.get(w); if (e) e.n++; else freq.set(w, { word: w, n: 1, first: m.t }); }
  const words = [...freq.values()].sort((a, b) => (b.n - a.n) || (a.first - b.first) || (a.word < b.word ? -1 : 1)).slice(0, 8);
  if (words.length >= 3) out['discord.top-words'] = { top: words.map(w => ({ word: w.word, n: w.n })) };
  const prev = prevRange(year, tz, now);
  if (Math.min(...msgs.map(m => m.t)) <= prev.start + 14 * DAY) {
    const p = msgs.filter(m => m.t >= prev.start && m.t < prev.end).length;
    if (p) out['discord.change'] = { messages: all.length, prev: p, change: (all.length - p) / p };
  }
  return out;
}

export function discordFixture() {
  const data = makeMessages();
  const truth = {};
  for (const y of DISCORD.years) truth[y] = discordTruth(data, y);
  return { data, zip: discordZip(data), truth, zone: DISCORD.zone, now: DISCORD.now };
}
