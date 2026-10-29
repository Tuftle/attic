// made-up conversations with an assistant, written as a chatgpt export and
// as a claude export, and the answers the cards must give.

import { rng } from './rng.js';
import { writeZip } from './zipwriter.js';
import { utc, yearRange, prevRange, top, byTime, busiest, hourBins, firstMax, names, songName } from './ref.js';
import STOPWORDS from '../../site/src/data/stopwords.js';

export const CHAT = { zone: 'Europe/Berlin', now: Date.UTC(2026, 9, 29, 12), years: [2025, 2026] };
const DAY = 86400000;

const TOPICS = {
  garden: ['garden', 'tomatoes', 'compost', 'seedlings', 'watering', 'soil'],
  cooking: ['recipe', 'dinner', 'lentils', 'oven', 'garlic', 'bread'],
  code: ['python', 'function', 'error', 'loop', 'script', 'tests'],
  money: ['budget', 'savings', 'rent', 'spreadsheet', 'invoice'],
  travel: ['train', 'lisbon', 'hotel', 'itinerary', 'museum'],
};
const FILLER = ['how', 'do', 'i', 'the', 'a', 'my', 'is', 'for', 'with', 'can', 'you', 'what', 'about', 'and', 'it', 'this', 'should', 'best', 'way', 'to'];
const MODELS = { 2024: [['gpt-4', 1], ['gpt-4o', 2]], 2025: [['gpt-4o', 6], ['gpt-4o-mini', 3], ['o3', 1]], 2026: [['gpt-4o', 4], ['o3', 3], ['gpt-4o-mini', 2]] };

function sentence(r, topic, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(r.chance(0.35) ? r.pick(TOPICS[topic]) : r.pick(FILLER));
  return out.join(' ');
}

/** every conversation, with every message as it was shown */
export function makeConversations({ seed = 'chat', zone = CHAT.zone, from = [2024, 1, 10], to = [2026, 9, 25] } = {}) {
  const r = rng(seed);
  const convs = [];
  let n = 0;
  for (let day = Date.UTC(...from); day <= Date.UTC(...to); day += DAY) {
    if (!r.chance(0.25)) continue;
    const d = new Date(day);
    const count = r.weighted([1, 2, 3], [6, 2, 1]);
    for (let k = 0; k < count; k++) {
      const topic = r.weighted(Object.keys(TOPICS), [3, 2, 3, 1, 1]);
      const id = `conv-${(n++).toString(16).padStart(6, '0')}`;
      let t = utc(zone, d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), r.weighted([...Array(24).keys()], [0.5, 0.3, 0.1, 0.1, 0.1, 0.1, 0.3, 1, 2, 3, 3, 3, 2, 3, 3, 3, 2, 2, 2, 2, 2, 2, 1.5, 1]), r.int(0, 59), r.int(0, 59)) + r.int(0, 999);
      const title = n % 17 === 0 ? 'New chat' : n % 23 === 0 ? null : `${songName(r)} ${topic}`;
      const year = d.getUTCFullYear();
      const msgs = [];
      const turns = r.int(1, 9);
      const withCode = topic === 'code' && r.chance(0.6);
      for (let j = 0; j < turns; j++) {
        let text = sentence(r, topic, r.int(4, 30));
        if (r.chance(0.2)) text = 'please ' + text;
        if (r.chance(0.12)) text += '. thanks!';
        if (withCode && j === 0 && r.chance(0.5)) text += '\n```python\nfor tomato in garden:\n    water(tomato)\n```';
        t = exact(t);
        msgs.push({ id: `${id}-u${j}`, role: 'user', t, text });
        t = exact(t + r.int(5, 40) * 1000 + r.int(0, 999));
        const answer = sentence(r, topic, r.int(20, 70)) + (withCode && r.chance(0.7) ? '\n```python\nprint("hello")\n```' : '');
        msgs.push({ id: `${id}-a${j}`, role: 'assistant', t, text: answer, model: r.weighted(MODELS[year].map(m => m[0]), MODELS[year].map(m => m[1])) });
        // a regenerated answer: a second branch, also shown once
        if (r.chance(0.05)) msgs.push({ id: `${id}-b${j}`, role: 'assistant', t: exact(t + 30000), text: sentence(r, topic, r.int(20, 60)), model: 'gpt-4o' });
        t += r.int(30, 300) * 1000 + r.int(0, 999);
      }
      convs.push({ id, title, t0: msgs[0].t, msgs, instructions: r.chance(0.1) });
    }
  }
  return convs;
}

const secs = t => t / 1000;
// a time that survives being written as seconds and read back as ms
const exact = t => { while (secs(t) * 1000 !== t) t++; return t; };

/** the chatgpt shape: a mapping of nodes, with hidden ones to leave out */
export function chatgptJson(convs) {
  return JSON.stringify(convs.map(c => {
    const mapping = {};
    const root = `${c.id}-root`;
    mapping[root] = { id: root, message: null, parent: null, children: [`${c.id}-sys`] };
    mapping[`${c.id}-sys`] = { id: `${c.id}-sys`, message: { id: `${c.id}-sys`, author: { role: 'system', name: null, metadata: {} }, create_time: null, content: { content_type: 'text', parts: [''] }, metadata: { is_visually_hidden_from_conversation: true } }, parent: root, children: [] };
    if (c.instructions) {
      mapping[`${c.id}-ctx`] = { id: `${c.id}-ctx`, message: { id: `${c.id}-ctx`, author: { role: 'user' }, create_time: secs(c.t0) - 1, content: { content_type: 'user_editable_context', user_profile: 'i like gardens', user_instructions: 'be brief' }, metadata: { is_visually_hidden_from_conversation: true } }, parent: `${c.id}-sys`, children: [] };
    }
    let parent = `${c.id}-sys`;
    for (const m of c.msgs) {
      mapping[m.id] = {
        id: m.id,
        message: {
          id: m.id, author: { role: m.role, name: null, metadata: {} }, create_time: m.noTime ? null : secs(m.t), update_time: null,
          content: { content_type: 'text', parts: [m.text] }, status: 'finished_successfully', end_turn: m.role === 'assistant',
          metadata: m.model ? { model_slug: m.model, finish_details: { type: 'stop' } } : {}, recipient: 'all',
        },
        parent, children: [],
      };
      mapping[parent].children.push(m.id);
      parent = m.id;
    }
    // a tool message, which is not part of the conversation's words
    mapping[`${c.id}-tool`] = { id: `${c.id}-tool`, message: { id: `${c.id}-tool`, author: { role: 'tool', name: 'browser' }, create_time: secs(c.t0) + 5, content: { content_type: 'text', parts: ['tool output'] }, metadata: {} }, parent, children: [] };
    return { title: c.title, create_time: secs(c.t0), update_time: secs(c.msgs.at(-1).t), mapping, moderation_results: [], current_node: parent, conversation_id: c.id, id: c.id, default_model_slug: 'gpt-4o', is_archived: false };
  }), null, 1);
}

const isoMicro = t => new Date(t).toISOString().replace('Z', '000Z');

/** the claude shape: chat_messages in order, no models */
export function claudeJson(convs) {
  return JSON.stringify(convs.map(c => ({
    uuid: c.id,
    name: c.title || '',
    created_at: isoMicro(c.t0),
    updated_at: isoMicro(c.msgs.at(-1).t),
    account: { uuid: 'acct-not-real' },
    chat_messages: c.msgs.map(m => ({
      uuid: m.id,
      text: m.text,
      content: [{ type: 'text', text: m.text, citations: [] }],
      sender: m.role === 'user' ? 'human' : 'assistant',
      created_at: isoMicro(m.t),
      updated_at: isoMicro(m.t),
      attachments: [],
      files: [],
    })),
  })), null, 1);
}

export const chatgptZip = convs => writeZip([
  { path: 'conversations.json', data: chatgptJson(convs) },
  { path: 'chat.html', data: '<html><body>your conversations</body></html>' },
  { path: 'user.json', data: '{"id": "user-not-real"}' },
]);
export const claudeZip = convs => writeZip([
  { path: 'conversations.json', data: claudeJson(convs) },
  { path: 'users.json', data: '[{"uuid": "user-not-real"}]' },
  { path: 'projects.json', data: '[]' },
]);

const PLEASE = /\bplease\b/gi;
const THANKS = /\b(thank you|thanks|thank u|thx)\b/gi;
function words(text) {
  const plain = text.replace(/```[\s\S]*?(```|$)/g, ' ').toLowerCase();
  return (plain.match(/\p{L}[\p{L}'-]*\p{L}|\p{L}/gu) || []).filter(w => w.length >= 3 && !STOPWORDS.has(w));
}

export function chatTruth(convs, year, prefix, { models = true, tz = CHAT.zone, now = CHAT.now } = {}) {
  const all = [];
  for (const c of convs) for (const m of c.msgs) all.push({ ...m, conv: c.id, title: c.title || 'untitled', words: (m.text.match(/\S+/g) || []).length, code: /```/.test(m.text) });
  const { start, end } = yearRange(year, tz, now);
  const ev = byTime(all.filter(m => m.t >= start && m.t < end));
  if (!ev.length) return {};
  const out = {};
  const user = ev.filter(m => m.role === 'user'), assistant = ev.filter(m => m.role === 'assistant');
  const convIds = new Set(ev.map(m => m.conv));
  out[`${prefix}.conversations`] = { conversations: convIds.size, messages: ev.length, user: user.length, assistant: assistant.length };
  const wrote = user.reduce((s, m) => s + m.words, 0), got = assistant.reduce((s, m) => s + m.words, 0);
  if (wrote) out[`${prefix}.words`] = { wrote, got, ratio: got / wrote };
  if (user.length) {
    const b = busiest(user, tz, () => 1);
    const bins = hourBins(user, tz);
    out[`${prefix}.busiest`] = { day: b.day, messages: b.w, bins, peak: firstMax(bins) };
  }
  const titleOf = new Map();
  for (const m of ev) if (!titleOf.has(m.conv)) titleOf.set(m.conv, m.title);
  const [long] = top(ev, m => m.conv, () => 1, e => e.key, 1);
  if (long.w >= 4) out[`${prefix}.longest`] = { title: titleOf.get(long.key), messages: long.w };
  const withCode = new Set(ev.filter(m => m.code).map(m => m.conv));
  if (withCode.size) out[`${prefix}.code`] = { withCode: withCode.size, conversations: convIds.size, share: withCode.size / convIds.size };
  const freq = new Map();
  let please = 0, thanks = 0;
  for (const m of user) {
    please += (m.text.match(PLEASE) || []).length;
    thanks += (m.text.match(THANKS) || []).length;
    for (const w of words(m.text)) {
      const e = freq.get(w);
      if (e) e.n++; else freq.set(w, { word: w, n: 1, first: m.t });
    }
  }
  const topWords = [...freq.values()].sort((a, b) => (b.n - a.n) || (a.first - b.first) || (a.word < b.word ? -1 : 1)).slice(0, 8);
  if (topWords.length >= 3) out[`${prefix}.top-words`] = { top: topWords.map(w => ({ word: w.word, n: w.n })) };
  if (please + thanks) out[`${prefix}.please`] = { please, thanks };
  out[`${prefix}.first`] = { title: titleOf.get(ev[0].conv), t: ev[0].t };
  if (models) {
    const m = top(assistant.filter(x => x.model), x => x.model, () => 1, e => e.key, 4);
    if (m.length) out[`${prefix}.models`] = { top: m.map(e => ({ name: e.key, messages: e.w })) };
  }
  const prev = prevRange(year, tz, now);
  if (Math.min(...all.map(m => m.t)) <= prev.start + 14 * DAY) {
    const p = new Set(all.filter(m => m.t >= prev.start && m.t < prev.end).map(m => m.conv)).size;
    if (p) out[`${prefix}.change`] = { conversations: convIds.size, prev: p, change: (convIds.size - p) / p };
  }
  return out;
}

export function chatFixture(kind = 'chatgpt', opts = {}) {
  const convs = makeConversations({ seed: kind === 'claude' ? 'claude' : 'chat', ...opts });
  const truth = {};
  for (const y of CHAT.years) truth[y] = chatTruth(convs, y, kind, { models: kind === 'chatgpt' });
  return { convs, zip: kind === 'claude' ? claudeZip(convs) : chatgptZip(convs), truth, zone: CHAT.zone, now: CHAT.now };
}
export const chatgptFixture = () => chatFixture('chatgpt');
export const claudeFixture = () => chatFixture('claude');
