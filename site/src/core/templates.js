// words for the cards. each card has a few ways to say the same thing,
// picked by a hash of its data, so the same data always gives the same
// words. no randomness at read time, no language model. numbers are
// formatted by hand so they never drift with the browser's locale.

/** a name from the data: an artist, a title, a site. hidden when names are off. */
export class Name {
  constructor(text) {
    this.text = String(text);
  }
}
export const name = text => new Name(text);
export const HIDDEN = '\u{2022}\u{2022}\u{2022}';

/** fnv-1a, 32 bit */
export function hash(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function pick(variants, seed) {
  if (typeof variants === 'string') return variants;
  return variants[hash(seed) % variants.length];
}

/**
 * fill {slots} in a template. names become the hidden mark when masked.
 * @returns {string}
 */
export function fill(template, slots = {}, masked = false) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    if (!(key in slots)) throw new Error(`no value for {${key}} in "${template}"`);
    const v = slots[key];
    if (v instanceof Name) return masked ? HIDDEN : v.text;
    return String(v);
  });
}

/** text with both faces: as shown, and with names hidden */
export function words(template, slots = {}) {
  return { plain: fill(template, slots, false), masked: fill(template, slots, true), template, slots };
}

/** 1234567 -> "1,234,567" */
export function int(n) {
  const r = Math.round(n);
  const s = String(Math.abs(r));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return (r < 0 ? '-' : '') + out;
}

/** a count with its word: "1 play", "12 plays" */
export function count(n, one, many = one + 's') {
  return `${int(n)} ${Math.round(n) === 1 ? one : many}`;
}

/** hours from ms, rounded so that small numbers keep one decimal */
export function hoursValue(ms) {
  const h = ms / 3600000;
  if (h >= 10) return Math.round(h);
  return Math.round(h * 10) / 10;
}

/** "1,234 hours", "4.5 hours", "1 hour" */
export function hours(ms) {
  const v = hoursValue(ms);
  const text = v >= 10 ? int(v) : String(v);
  return `${text} ${v === 1 ? 'hour' : 'hours'}`;
}

/** "2 hours 14 minutes", "45 minutes" */
export function duration(ms) {
  const total = Math.round(ms / 60000);
  const h = Math.floor(total / 60), m = total % 60;
  if (!h) return count(m, 'minute');
  if (!m) return count(h, 'hour');
  return `${count(h, 'hour')} ${count(m, 'minute')}`;
}

/** 0.234 -> "23%". tiny shares say so instead of rounding to 0 */
export function percent(x) {
  if (x > 0 && x < 0.005) return 'under 1%';
  if (x < 1 && x > 0.995) return 'over 99%';
  return `${Math.round(x * 100)}%`;
}

/** +0.18 -> "18% more", -0.12 -> "12% less" */
export function changeWords(x) {
  if (x === null || x === undefined) return null;
  if (Math.abs(x) < 0.005) return 'about the same';
  return `${percent(Math.abs(x))} ${x > 0 ? 'more' : 'less'}`;
}

/** "a", "b and c", "a, b and c" */
export function andList(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export const MONTH_SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
