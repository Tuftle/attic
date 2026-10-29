// "your year with ai": the cards chatgpt and claude share. titles and
// your own words are private, so those cards are sensitive, and the most
// used words card waits until the visitor asks for it.

import { card, scope } from '../core/cards.js';
import { name, words, int, count, percent, changeWords } from '../core/templates.js';
import { totalsBy, topN, sum, hourHistogram, peak, dayTotals, busiestDay, share, change, where } from '../core/analysers.js';
import { dayName, hourName } from '../core/timezone.js';
import { isoDay, clock, bars } from './common.js';
import STOPWORDS from '../data/stopwords.js';

/** how many words: runs of anything that is not a space */
export function wordCount(text) {
  const m = String(text || '').match(/\S+/g);
  return m ? m.length : 0;
}

/** a fenced code block, the way chat apps write code */
export const hasCode = text => /```/.test(String(text || ''));

const PLEASE = /\bplease\b/gi;
const THANKS = /\b(thank you|thanks|thank u|thx)\b/gi;

/** the words worth counting in one message */
export function tokens(text) {
  const plain = String(text || '').replace(/```[\s\S]*?(```|$)/g, ' ').replace(/\u{2019}/gu, '\'').toLowerCase();
  const m = plain.match(/\p{L}[\p{L}'-]*\p{L}|\p{L}/gu) || [];
  return m.filter(w => w.length >= 3 && !STOPWORDS.has(w));
}

/**
 * the shared deck.
 * @param {{ store: any, extras: { texts: Map<string, string> } }} r
 */
export function chatCards(r, ctx, src) {
  const store = r.store;
  const S = scope(store, ctx);
  const { z, when } = S;
  const all = store.ofKind('chat', S.lo, S.hi);
  if (!all.length) return [];
  const t = store.t, str = id => store.strings.str(id) || '';
  const userId = store.strings.map.get('user');
  const assistantId = store.strings.map.get('assistant');
  const user = where(all, i => store.creator[i] === userId);
  const assistant = where(all, i => store.creator[i] === assistantId);
  const wordsCol = store.column('words');
  const out = [];
  const base = { source: src.id };
  const id = s => `${src.id}.${s}`;
  const convs = new Set();
  for (const i of all) convs.add(store.album[i]);
  const titleOf = new Map();
  for (const i of all) if (!titleOf.has(store.album[i])) titleOf.set(store.album[i], str(store.title[i]) || 'untitled');

  let prevConvs = null;
  if (S.prev) {
    const s = new Set();
    for (const i of store.ofKind('chat', S.prev.lo, S.prev.hi)) s.add(store.album[i]);
    prevConvs = s.size;
  }
  const delta = prevConvs ? change(convs.size, prevConvs) : null;
  out.push(card({
    ...base, id: id('conversations'), title: `your year with ${src.name}`, big: count(convs.size, 'conversation'),
    caption: words('and {n} {when}.', { n: count(all.length, 'message'), when }),
    detail: words('{u} from you, {a} back.', { u: int(user.length), a: int(assistant.length) }),
    values: { conversations: convs.size, messages: all.length, user: user.length, assistant: assistant.length },
    stat: { label: `conversations with ${src.name}`, display: int(convs.size), value: convs.size, change: delta },
  }));

  if (wordsCol) {
    const wrote = sum(wordsCol, user), got = sum(wordsCol, assistant);
    if (wrote > 0) {
      const ratio = got / wrote;
      out.push(card({
        ...base, id: id('words'), title: 'words', big: count(wrote, 'word'),
        caption: words('you wrote {when}, and {got} came back.', { when, got: int(got) }),
        detail: ratio >= 1.5 ? words('about {r} words back for every word you wrote.', { r: int(ratio) }) : '',
        values: { wrote, got, ratio },
        stat: { label: `words you wrote to ${src.name}`, display: int(wrote), value: wrote, change: null },
      }));
    }
  }

  if (user.length) {
    const big = busiestDay(dayTotals(t, user, z));
    const bins = hourHistogram(t, user, z);
    const h = peak(bins);
    out.push(card({
      ...base, id: id('busiest'), title: 'your busiest day', big: dayName(big.day),
      caption: words('{n} from you in one day. your busiest hour is {hour}.', { n: count(big.w, 'message'), hour: hourName(h) }),
      visual: clock(bins, h),
      values: { day: isoDay(big.day), messages: big.w, bins, peak: h },
    }));
  }

  const [long] = topN(totalsBy(store.album, all, null, t), 1, str);
  if (long && long.w >= 4) {
    out.push(card({
      ...base, id: id('longest'), title: 'the longest conversation', big: count(long.w, 'message'),
      caption: words('in one conversation: {title}.', { title: name(titleOf.get(long.key)) }),
      values: { title: titleOf.get(long.key), messages: long.w },
    }));
  }

  const codeCol = store.column('code');
  if (codeCol) {
    const withCode = new Set();
    for (const i of all) if (codeCol[i] === 2) withCode.add(store.album[i]);
    if (withCode.size) {
      out.push(card({
        ...base, id: id('code'), title: 'code', big: count(withCode.size, 'conversation'),
        caption: words('had code in them, {share} of your conversations {when}. we count fenced code blocks.', { share: percent(share(withCode.size, convs.size)), when }),
        values: { withCode: withCode.size, conversations: convs.size, share: share(withCode.size, convs.size) },
      }));
    }
  }

  const texts = r.extras?.texts;
  if (texts && user.length) {
    const freq = new Map();
    let please = 0, thanks = 0;
    for (const i of user) {
      const text = texts.get(str(store.uid[i])) || '';
      please += (text.match(PLEASE) || []).length;
      thanks += (text.match(THANKS) || []).length;
      for (const w of tokens(text)) {
        const e = freq.get(w);
        if (e) e.n++; else freq.set(w, { word: w, n: 1, first: t[i] });
      }
    }
    const topWords = [...freq.values()].sort((a, b) => (b.n - a.n) || (a.first - b.first) || (a.word < b.word ? -1 : 1)).slice(0, 8);
    if (topWords.length >= 3) {
      out.push(card({
        ...base, id: id('top-words'), title: 'your words', big: name(topWords[0].word), optIn: true,
        caption: words('the word you used most {when}, {n}.', { when, n: count(topWords[0].n, 'time') }),
        detail: 'counted here, from your own messages only. common words are left out.',
        visual: bars(topWords.map(w => ({ label: name(w.word), value: w.n, display: int(w.n) }))),
        values: { top: topWords.map(w => ({ word: w.word, n: w.n })) },
      }));
    }
    if (please + thanks) {
      out.push(card({
        ...base, id: id('please'), title: 'manners', big: count(please, 'please', 'pleases'),
        caption: words('and {thanks} {when}. very polite.', { thanks: count(thanks, 'thank you', 'thank yous'), when }),
        values: { please, thanks },
      }));
    }
  }

  const f = all[0];
  out.push(card({
    ...base, id: id('first'), title: 'where it started', big: name(titleOf.get(store.album[f])),
    caption: words('your first conversation {when}, on {day}.', { when, day: dayName(z.dayKey(t[f])) }),
    values: { title: titleOf.get(store.album[f]), t: t[f] },
  }));

  const modelCol = store.column('model');
  if (modelCol) {
    const withModel = where(assistant, i => modelCol[i] >= 0);
    const models = topN(totalsBy(modelCol, withModel, null, t), 4, str);
    if (models.length) {
      out.push(card({
        ...base, id: id('models'), title: 'the model mix', big: str(models[0].key).toLowerCase(),
        caption: words('wrote {share} of the answers you got.', { share: percent(share(models[0].w, withModel.length)) }),
        visual: bars(models.map(e => ({ label: str(e.key).toLowerCase(), value: e.w, display: count(e.w, 'answer') }))),
        values: { top: models.map(e => ({ name: str(e.key), messages: e.w })) },
      }));
    }
  }

  if (delta !== null) {
    out.push(card({
      ...base, id: id('change'), title: 'compared with last year', big: changeWords(delta),
      caption: words('conversations than {last}: {now} against {then}.', { last: S.lastYear, now: int(convs.size), then: int(prevConvs) }),
      values: { conversations: convs.size, prev: prevConvs, change: delta },
    }));
  }
  return out;
}
