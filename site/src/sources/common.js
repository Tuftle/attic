// small helpers the sources share.

import { MONTH_SHORT } from '../core/templates.js';
import { dayParts } from '../core/timezone.js';

/** the first field of an object that is present, by alias */
export function field(obj, aliases) {
  for (const a of aliases) {
    const v = obj[a];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/**
 * a utc time from the strings exports use: iso with or without a zone,
 * "2024-03-02 14:03" (utc by convention), or seconds since 1970.
 */
export function parseUtc(v) {
  if (typeof v === 'number') return v > 1e11 ? v : v * 1000;
  if (typeof v !== 'string') return NaN;
  // the usual shape, "2024-03-02T14:03:22Z", needs no clean up
  if (v.length >= 20 && v.charCodeAt(10) === 84 && v.charCodeAt(v.length - 1) === 90) {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return parseUtc(Number(s));
  let iso = s.replace(' ', 'T');
  if (!/(Z|[+-]\d\d:?\d\d)$/i.test(iso)) iso += 'Z';
  if (/T\d\d:\d\d(Z|$)/.test(iso)) iso = iso.replace(/(T\d\d:\d\d)/, '$1:00');
  return Date.parse(iso);
}

/** "2026-03-03" for a local day number */
export function isoDay(dayKey) {
  const p = dayParts(dayKey);
  return `${p.year}-${String(p.month + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** a month by month line for the renderer */
export function monthLine(bins, format) {
  return { type: 'line', points: bins, labels: MONTH_SHORT, displays: bins.map(format) };
}

/** a 24 hour clock for the renderer */
export function clock(bins, peakHour) {
  return { type: 'clock', bins, peak: peakHour };
}

/** a calendar of the year: one value per local day */
export function heatmap(z, y0, y1, totals, mark) {
  const first = z.dayKey(y0), last = z.dayKey(y1 - 1);
  const values = [];
  for (let d = first; d <= last; d++) values.push(totals.get(d) || 0);
  return { type: 'heatmap', first, values, mark };
}

/** bars for the renderer: label and sub may be names */
export function bars(items) {
  return { type: 'bars', items };
}

/** the time zone written for people: Europe/Amsterdam becomes "europe/amsterdam" */
export const zoneLabel = tz => tz.toLowerCase().replace(/_/g, ' ');

/** report progress now and then, not for every item */
export function progress(onProgress, every = 5000) {
  let n = 0;
  return {
    tick(k = 1) {
      n += k;
      if (n % every < k) onProgress?.({ count: n });
    },
    get count() { return n; },
    done() { onProgress?.({ count: n }); },
  };
}
