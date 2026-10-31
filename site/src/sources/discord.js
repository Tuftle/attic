// discord: the data package. each channel you wrote in has a folder in
// messages/ with channel.json and your messages (messages.json, or
// messages.csv in older packages). only your own messages are in it.
// the activity/ analytics files are never opened. server and channel names
// are sensitive, and direct message partners are never named at all.

import { EventStore } from '../core/store.js';
import { readJsonList } from '../core/jsonstream.js';
import { card, scope } from '../core/cards.js';
import { name, words, percent, int, count, changeWords } from '../core/templates.js';
import { totalsBy, topN, sum, hourHistogram, monthHistogram, peak, dayTotals, busiestDay, streak, share, change, where } from '../core/analysers.js';
import { dayName, hourName } from '../core/timezone.js';
import { isoDay, monthLine, clock, bars, progress, readCsv, parseUtc } from './common.js';
import { wordCount, tokens } from './chat.js';

const CHANNEL_FILE = /(^|\/)messages\/c?(\d+)\/(messages\.(json|csv)|channel\.json)$/i;
const DM_TYPES = new Set([1, 3]);

const skip = f => /(^|\/)activity\/(analytics|reporting|tns|modeling)\//i.test(f.path);
const match = f => (CHANNEL_FILE.test(f.path) || /(^|\/)messages\/index\.json$/i.test(f.path) ? 0.9 : 0);

function detect(files) {
  return { files: files.filter(f => match(f) > 0 && !/^\s*</.test(f.headText || '')).map(f => ({ file: f, score: 0.95 })) };
}

/** "2024-01-05 10:00:00.123000+00:00" to utc ms */
export function discordTime(v) {
  return parseUtc(String(v || '').replace(/(\.\d{3})\d+/, '$1').replace(/\+00:00$/, 'Z'));
}

async function parse(files, onProgress) {
  const store = new EventStore(16384);
  const notes = [];
  const texts = new Map();
  const tick = progress(onProgress, 2000);
  const folders = new Map();
  for (const f of files) {
    const m = CHANNEL_FILE.exec(f.path);
    if (!m) continue;
    const key = `${f.archive || ''}:${m[2]}`;
    if (!folders.has(key)) folders.set(key, { id: m[2] });
    folders.get(key)[/channel\.json$/i.test(f.name) ? 'channel' : 'messages'] = f;
  }
  for (const folder of folders.values()) {
    if (!folder.messages) continue;
    let info = {};
    if (folder.channel) {
      try { info = JSON.parse(await folder.channel.text()); } catch { info = {}; }
    }
    const dm = DM_TYPES.has(Number(info.type)) || (!info.guild && Array.isArray(info.recipients));
    const place = dm ? (Number(info.type) === 3 ? 'a group chat' : 'a direct message') : (info.guild && info.guild.name) || 'a server';
    const channel = dm ? undefined : info.name || undefined;
    const add = (time, contents, attachments) => {
      const t = discordTime(time);
      if (!Number.isFinite(t)) return;
      const text = String(contents || '');
      // message ids are 19 digit numbers, past what json numbers hold
      // exactly, so two messages can share one. the channel, the time and
      // the length of the text tell them apart instead.
      const mid = `${folder.id}:${t}:${text.length}`;
      store.push({ t, kind: 'message', creator: place, title: channel, album: folder.id, id: mid, meta: { words: wordCount(text), attachment: !!String(attachments || '').trim(), dm } });
      if (text) texts.set(mid, text);
      tick.tick();
    };
    try {
      if (/\.csv$/i.test(folder.messages.name)) {
        await readCsv(folder.messages, { time: ['Timestamp'], contents: ['Contents'], attachments: ['Attachments'] }, ['time'], 'discord messages', get => add(get('time'), get('contents'), get('attachments')));
      } else {
        await readJsonList(folder.messages, m => m && add(m.Timestamp ?? m.timestamp, m.Contents ?? m.content, m.Attachments ?? m.attachments));
      }
    } catch (e) {
      notes.push({ path: folder.messages.path, code: e.code || 'format', message: 'one discord channel could not be read to the end. the others still count.' });
    }
  }
  tick.done();
  return { store, notes, extras: { texts }, count: tick.count };
}

function cards(r, ctx) {
  const store = r.store;
  const S = scope(store, ctx);
  const { z, when } = S;
  const all = store.ofKind('message', S.lo, S.hi);
  if (!all.length) return [];
  const t = store.t, str = id => store.strings.str(id) || '';
  const base = { source: 'discord' };
  const out = [];
  const dmCol = store.column('dm');
  const direct = dmCol ? where(all, i => dmCol[i] === 2) : [];
  const servers = dmCol ? where(all, i => dmCol[i] !== 2) : all;

  const prev = S.prev ? store.ofKind('message', S.prev.lo, S.prev.hi).length : null;
  const delta = prev ? change(all.length, prev) : null;
  const months = monthHistogram(t, all, z);
  out.push(card({
    ...base, id: 'discord.messages', title: 'your year on discord', big: count(all.length, 'message'),
    caption: words('you sent {when}.', { when }),
    visual: monthLine(months, v => int(v)),
    values: { messages: all.length, months },
    stat: { label: 'discord messages', display: int(all.length), value: all.length, change: delta },
  }));

  const big = busiestDay(dayTotals(t, all, z));
  const bins = hourHistogram(t, all, z);
  const h = peak(bins);
  out.push(card({
    ...base, id: 'discord.busiest', title: 'your busiest day', big: dayName(big.day),
    caption: words('{n} in one day. your busiest hour is {hour}.', { n: count(big.w, 'message'), hour: hourName(h) }),
    visual: clock(bins, h),
    values: { day: isoDay(big.day), messages: big.w, bins, peak: h },
  }));

  out.push(card({
    ...base, id: 'discord.places', title: 'where you talked', big: percent(share(direct.length, all.length)),
    caption: words('of your messages went to direct messages and group chats, the rest to {n}.', { n: count(new Set(servers.map(i => store.creator[i])).size, 'server') }),
    values: { direct: direct.length, server: servers.length, share: share(direct.length, all.length) },
  }));

  const days = [...new Set([...all].map(i => z.dayKey(t[i])))].sort((a, b) => a - b);
  const run = streak(days);
  if (run && run.len >= 2) {
    out.push(card({
      ...base, id: 'discord.streak', title: 'days in a row', big: count(run.len, 'day'),
      caption: words('in a row with at least one message, from {from} to {to}.', { from: dayName(run.start), to: dayName(run.end) }),
      values: { days: run.len, start: isoDay(run.start), end: isoDay(run.end) },
    }));
  }

  const wordsCol = store.column('words');
  if (wordsCol) {
    const w = sum(wordsCol, all);
    out.push(card({
      ...base, id: 'discord.words', title: 'words', big: count(w, 'word'),
      caption: words('you wrote {when}, about {n} a message.', { when, n: int(w / all.length) }),
      values: { words: w },
    }));
  }

  const night = where(all, i => z.hour(t[i]) < 5).length;
  out.push(card({
    ...base, id: 'discord.night', title: 'late nights', big: percent(share(night, all.length)),
    caption: night ? 'of your messages were sent between midnight and 5 am.' : 'of your messages were sent between midnight and 5 am. none at all, which is restful.',
    values: { night, messages: all.length, share: share(night, all.length) },
  }));

  const topServers = topN(totalsBy(store.creator, servers, null, t), 5, str);
  if (topServers.length) {
    out.push(card({
      ...base, id: 'discord.top-servers', title: 'top servers', big: name(str(topServers[0].key)),
      caption: words('where you talked most {when}, {n}.', { when, n: count(topServers[0].w, 'message') }),
      visual: bars(topServers.map(e => ({ label: name(str(e.key)), value: e.w, display: count(e.w, 'message') }))),
      values: { top: topServers.map(e => ({ name: str(e.key), messages: e.w })) },
    }));
    const named = where(servers, i => store.title[i] >= 0);
    const label = id => { const i = named.find(j => store.album[j] === id); return `#${str(store.title[i])} in ${str(store.creator[i])}`; };
    const topChannels = topN(totalsBy(store.album, named, null, t), 5, label);
    if (topChannels.length) {
      out.push(card({
        ...base, id: 'discord.top-channels', title: 'top channels', big: name(label(topChannels[0].key)),
        caption: words('your busiest channel {when}, {n}.', { when, n: count(topChannels[0].w, 'message') }),
        visual: bars(topChannels.map(e => ({ label: name(label(e.key)), value: e.w, display: count(e.w, 'message') }))),
        values: { top: topChannels.map(e => ({ name: label(e.key), messages: e.w })) },
      }));
    }
  }

  const texts = r.extras?.texts;
  if (texts) {
    const freq = new Map();
    for (const i of all) {
      for (const w of tokens(texts.get(str(store.uid[i])) || '')) {
        const e = freq.get(w);
        if (e) e.n++; else freq.set(w, { word: w, n: 1, first: t[i] });
      }
    }
    const top = [...freq.values()].sort((a, b) => (b.n - a.n) || (a.first - b.first) || (a.word < b.word ? -1 : 1)).slice(0, 8);
    if (top.length >= 3) {
      out.push(card({
        ...base, id: 'discord.top-words', title: 'your words', big: name(top[0].word), optIn: true,
        caption: words('the word you used most {when}, {n}.', { when, n: count(top[0].n, 'time') }),
        detail: 'counted here, from your own messages only. common words are left out.',
        visual: bars(top.map(w => ({ label: name(w.word), value: w.n, display: int(w.n) }))),
        values: { top: top.map(w => ({ word: w.word, n: w.n })) },
      }));
    }
  }

  if (delta !== null) {
    out.push(card({
      ...base, id: 'discord.change', title: 'compared with last year', big: changeWords(delta),
      caption: words('messages than {last}: {now} against {then}.', { last: S.lastYear, now: int(all.length), then: int(prev) }),
      values: { messages: all.length, prev, change: delta },
    }));
  }
  return out;
}

export default { id: 'discord', name: 'discord', unit: 'messages', guide: 'discord', skip, match, detect, parse, cards };
