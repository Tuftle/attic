// the source registry: which file belongs to which service, and the
// "what we found" summary shown before the year is made.

import { HEAD_BYTES, decodeText } from '../core/files.js';
import { messages } from '../core/doctor.js';
import { zone, monthYear } from '../core/timezone.js';

/** @type {any[]} filled in as sources are added */
export const SOURCES = [];

export const CLAIM_AT = 0.5;
// inside a big zip, files that no source names are only sniffed when there are few
const SNIFF_EXT = /\.(json|csv|html?|sqlite|db)$|^[^.]+$/i;
const SNIFF_BUDGET = 400;

/**
 * decide which source reads which file.
 * @param {import('../core/files.js').FileInfo[]} files
 * @returns {Promise<{ claims: { source: any, files: any[] }[], notes: any[] }>}
 */
export async function detectAll(files, sources = SOURCES) {
  const notes = [];
  const nameScore = new Map();
  for (const f of files) {
    let best = 0;
    for (const s of sources) best = Math.max(best, s.match ? s.match(f) : 0);
    nameScore.set(f, best);
  }
  const perArchive = new Map();
  for (const f of files) {
    if (f.archive && !nameScore.get(f) && SNIFF_EXT.test(f.name)) perArchive.set(f.archive, (perArchive.get(f.archive) || 0) + 1);
  }
  const candidates = files.filter(f => !f.archive || nameScore.get(f) > 0
    || (SNIFF_EXT.test(f.name) && (perArchive.get(f.archive) || 0) <= SNIFF_BUDGET));
  for (const f of candidates) {
    if (f.headBytes) continue;
    try {
      f.headBytes = await f.head(HEAD_BYTES);
    } catch (e) {
      f.headBytes = new Uint8Array(0);
      f.headError = e;
    }
    f.headText = decodeText(f.headBytes);
  }

  /** @type {Map<any, { source: any, score: number }>} */
  const best = new Map();
  for (const source of sources) {
    const res = source.detect(candidates) || { score: 0, files: [] };
    for (const n of res.notes || []) notes.push({ source: source.id, ...n });
    for (const item of res.files || []) {
      const file = item.file || item;
      const score = item.score ?? res.score;
      if (score < CLAIM_AT) continue;
      const prev = best.get(file);
      if (!prev || score > prev.score) best.set(file, { source, score });
    }
  }

  const claims = [];
  for (const source of sources) {
    const own = candidates.filter(f => best.get(f)?.source === source);
    if (own.length) claims.push({ source, files: own });
  }

  const noted = new Set(notes.map(n => n.path));
  for (const f of files) {
    if (f.archive || best.has(f) || noted.has(f.path)) continue;
    notes.push(f.size === 0
      ? { path: f.path, code: 'empty', message: messages.empty }
      : { path: f.path, code: 'unknown', message: messages.unknown });
  }
  const archives = new Set(files.filter(f => f.archive).map(f => f.archive));
  for (const a of archives) {
    const used = files.some(f => f.archive === a && best.has(f));
    if (!used && !noted.has(a)) notes.push({ path: a, code: 'unknown', message: messages.unknownZip });
  }
  return { claims, notes };
}

/**
 * the rows of "what we found".
 * @param {Record<string, any>} results  by source id, each with a sorted store
 */
export function buildFound(results, notes, timeZone = 'UTC') {
  const z = zone(timeZone);
  const rows = [];
  const years = new Set();
  for (const [id, r] of Object.entries(results)) {
    const store = r.store;
    if (!store || store.length === 0) {
      rows.push({ id, name: r.source.name, files: r.files.length, count: 0, unit: r.source.unit || 'items', text: `${r.source.name}, ${plural(r.files.length, 'file')}, nothing we could count` });
      continue;
    }
    const first = store.t[0], last = store.t[store.length - 1];
    const y0 = z.year(first), y1 = z.year(last);
    for (let y = y0; y <= y1; y++) years.add(y);
    const range = monthYear(first, z) === monthYear(last, z) ? monthYear(first, z) : `${monthYear(first, z)} to ${monthYear(last, z)}`;
    rows.push({
      id, name: r.source.name, files: r.files.length, count: r.count ?? store.length,
      unit: r.source.unit || 'items', first, last, range,
      text: `${r.source.name}, ${plural(r.files.length, 'file')}, ${range}`,
    });
  }
  return { rows, notes, years: [...years].sort((a, b) => a - b) };
}

export function plural(n, word, many = word + 's') {
  return `${n.toLocaleString('en-US')} ${n === 1 ? word : many}`;
}
