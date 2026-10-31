// the best cards of each source, so a year with many sources stays a deck
// you can get through. each source has a fixed order of what matters most;
// the rest wait behind a "more from" card, in the order they were made.

import { count } from './templates.js';

export const MAX_PER_SOURCE = 6;

export const BEST = {
  spotify: ['hours', 'top-artists', 'top-tracks', 'clock', 'repeat', 'change'],
  apple: ['hours', 'top-artists', 'top-tracks', 'clock', 'repeat', 'change'],
  netflix: ['hours', 'top-shows', 'binge', 'tried', 'rewatch', 'night'],
  youtube: ['videos', 'top-channels', 'rabbit-hole', 'clock', 'shorts', 'change'],
  chatgpt: ['conversations', 'words', 'longest', 'busiest', 'please', 'models'],
  claude: ['conversations', 'words', 'longest', 'busiest', 'please', 'code'],
  discord: ['messages', 'top-servers', 'busiest', 'streak', 'places', 'words'],
  browser: ['hours', 'top-sites', 'rabbit-hole', 'weekday', 'night', 'first-last'],
  letterboxd: ['films', 'ratings', 'decade', 'rewatches', 'weekday', 'change'],
  goodreads: ['books', 'pages', 'authors', 'longest', 'oldest', 'ratings'],
  strava: ['activities', 'distance', 'longest', 'weeks', 'elevation', 'hour'],
  steam: ['games', 'how', 'first-last', 'month', 'change'],
  amazon: ['orders', 'spent', 'biggest', 'repeat', 'night', 'change'],
};

export const SOURCE_NAMES = { browser: 'your browser', apple: 'apple music' };

// "spotify.hours" is in group "spotify"; "netflix.hours@2" in "netflix@2"
const groupOf = c => `${c.source}${(c.id.match(/@\d+$/) || [''])[0]}`;
const shortId = c => c.id.slice(c.id.indexOf('.') + 1).replace(/@\d+$/, '');

/**
 * the deck with each group cut to its best cards. what is left out sits in
 * one "more" card after the group, holding the rest in their first order.
 * @param {import('./cards.js').Card[]} cards
 */
export function capDeck(cards, max = MAX_PER_SOURCE) {
  const groups = new Map();
  for (const c of cards) {
    const g = groupOf(c);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }
  const out = [];
  for (const [g, list] of groups) {
    const order = BEST[list[0].source] || [];
    const rank = c => { const k = order.indexOf(shortId(c)); return k === -1 ? Infinity : k; };
    const keep = new Set(list.slice().sort((a, b) => rank(a) - rank(b) || list.indexOf(a) - list.indexOf(b)).slice(0, max));
    const rest = list.filter(c => !keep.has(c));
    out.push(...list.filter(c => keep.has(c)));
    if (rest.length) out.push(moreCard(g, list[0], rest));
  }
  return out;
}

function moreCard(group, first, rest) {
  const who = SOURCE_NAMES[first.source] || first.source;
  const titles = rest.map(c => c.masked.title.replace(/, for .*$/, ''));
  const text = `${titles.join(', ')}.`;
  const face = { title: `more from ${who}`, big: count(rest.length, 'more card'), caption: text, detail: '', visual: null };
  return {
    id: `more:${group}`, source: first.source, ...face, sensitive: false, optIn: false,
    share: { text: '' }, values: {}, stat: null, names: [], masked: { ...face, share: { text: '' } }, more: rest,
  };
}
