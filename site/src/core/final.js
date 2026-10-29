// "your year in one page": the three or four best numbers across every
// source, picked by a fixed rule. the largest change against last year
// comes first, then the largest number. one per source before any second
// one, so a rich export cannot crowd out the others.

import { card } from './cards.js';
import { words } from './templates.js';

const surprise = s => (s.change === null || s.change === undefined ? 0 : Math.abs(s.change));
const size = s => Math.log10(1 + Math.abs(s.value || 0));

/** rank every card that carries a stat */
export function rank(cards) {
  return cards
    .filter(c => c.stat && !c.optIn)
    .sort((a, b) => (surprise(b.stat) - surprise(a.stat)) || (size(b.stat) - size(a.stat)) || (a.id < b.id ? -1 : 1));
}

/** pick up to max cards: the best of each source first, then the best of the rest */
export function pickBest(cards, max = 4) {
  const ranked = rank(cards);
  const picked = [];
  const sources = new Set();
  for (const c of ranked) {
    if (picked.length >= max) break;
    if (!sources.has(c.source)) { picked.push(c); sources.add(c.source); }
  }
  for (const c of ranked) {
    if (picked.length >= max) break;
    if (!picked.includes(c)) picked.push(c);
  }
  return picked;
}

const changeNote = x => (x === null || x === undefined || Math.abs(x) < 0.005 ? '' : `${Math.round(Math.abs(x) * 100)}% ${x > 0 ? 'more' : 'less'} than last year`);

/**
 * @param {import('./cards.js').Card[]} cards
 * @param {{ year: number, unfinished?: boolean }} ctx
 */
export function finalCard(cards, ctx) {
  const picks = pickBest(cards);
  if (!picks.length) return null;
  return card({
    id: 'final', source: 'attic', title: 'your year in one page', big: String(ctx.year),
    caption: words(ctx.unfinished ? 'so far, from your own data. it never left this browser.' : 'from your own data. it never left this browser.', {}),
    visual: { type: 'stats', items: picks.map(c => ({ label: c.stat.label, value: c.stat.value, display: c.stat.display, note: changeNote(c.stat.change), from: c.id })) },
    values: { picks: picks.map(c => c.id) },
  });
}
