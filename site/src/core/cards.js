// a card is a plain object made by a pure function, so it can be tested
// without a browser. each text field is kept twice: as shown, and with every
// name from the data hidden, made from the same template. hiding names never
// has to search the text for them.

import { Name, HIDDEN } from './templates.js';
import { zone } from './timezone.js';

/**
 * @typedef {Object} Card
 * @property {string} id
 * @property {string} source
 * @property {string} title
 * @property {string} big
 * @property {string} caption
 * @property {string} detail
 * @property {any} visual        an instruction for the renderer
 * @property {boolean} sensitive  true when the card shows names or titles
 * @property {{ text: string }} share
 * @property {Record<string, any>} values  the raw numbers, for tests and the last card
 * @property {{ label: string, display: string, value: number, change: number|null } | null} stat
 * @property {string[]} names
 * @property {boolean} [optIn]   shown only when the visitor asks for it
 * @property {any} masked        the same card with names hidden
 */

function face(v, masked, names) {
  if (v === undefined || v === null) return '';
  if (v instanceof Name) {
    names.add(v.text);
    return masked ? HIDDEN : v.text;
  }
  if (typeof v === 'object' && 'plain' in v) {
    for (const s of Object.values(v.slots || {})) if (s instanceof Name) names.add(s.text);
    return masked ? v.masked : v.plain;
  }
  return String(v);
}

function visualFace(visual, masked, names) {
  if (!visual) return null;
  const out = { ...visual };
  if (visual.items) {
    out.items = visual.items.map((item, i) => {
      const label = face(item.label, false, names);
      const sub = item.sub !== undefined ? face(item.sub, false, names) : undefined;
      const hide = masked && (item.label instanceof Name);
      return {
        ...item,
        label: hide ? `#${i + 1}` : label,
        sub: sub === undefined ? undefined : masked && item.sub instanceof Name ? HIDDEN : sub,
      };
    });
  }
  return out;
}

/**
 * build a card. text fields take a string, a name, or words(...).
 * @returns {Card}
 */
export function card(spec) {
  const names = new Set();
  const make = masked => ({
    title: face(spec.title, masked, names),
    big: face(spec.big, masked, names),
    caption: face(spec.caption, masked, names),
    detail: face(spec.detail, masked, names),
    visual: visualFace(spec.visual, masked, names),
  });
  const plain = make(false);
  const hidden = make(true);
  const shareText = f => [f.title, f.big, f.caption].filter(Boolean).join('. ').replace(/\.\./g, '.');
  const sensitive = names.size > 0;
  return {
    id: spec.id,
    source: spec.source,
    ...plain,
    sensitive,
    optIn: !!spec.optIn,
    share: { text: shareText(plain) },
    values: spec.values || {},
    stat: spec.stat || null,
    names: [...names],
    masked: { ...hidden, share: { text: shareText(hidden) } },
  };
}

/**
 * the time frame of one year, and the year before it if the data covers it.
 * @param {import('./store.js').EventStore} store
 * @param {{ year: number, timeZone: string, now?: number }} ctx
 */
export function scope(store, ctx) {
  const z = zone(ctx.timeZone);
  const [y0, y1full] = z.yearBounds(ctx.year);
  const now = ctx.now ?? Date.now();
  const unfinished = now >= y0 && now < y1full;
  const y1 = unfinished ? now : y1full;
  const [p0] = z.yearBounds(ctx.year - 1);
  // the same stretch of last year: all of it, or the same months so far
  const p1 = unfinished ? p0 + (now - y0) : y0;
  const [lo, hi] = store.range(y0, y1);
  const [plo, phi] = store.range(p0, p1);
  const covered = store.length > 0 && store.t[0] <= p0 + 14 * 86400000;
  return {
    z, year: ctx.year, y0, y1, unfinished, lo, hi,
    prev: covered ? { lo: plo, hi: phi, year: ctx.year - 1 } : null,
    // "in 2025" or "so far in 2026"
    when: unfinished ? `so far in ${ctx.year}` : `in ${ctx.year}`,
    lastYear: unfinished ? `the same months of ${ctx.year - 1}` : `${ctx.year - 1}`,
  };
}
