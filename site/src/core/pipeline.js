// the whole path from dropped files to cards, with no dom. the page's
// worker calls these two functions; the tests call them directly.

import { expandAll } from './files.js';
import { detectAll, buildFound, SOURCES } from '../sources/index.js';

/**
 * read every dropped file into events, source by source.
 * @param {any[]} inputs  File or Blob objects with names
 * @param {{ onProgress?: (p: any) => void, env?: any, sources?: any[], timeZone?: string }} [opts]
 */
export async function readAll(inputs, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const sources = opts.sources || SOURCES;
  const env = opts.env || {};
  onProgress({ stage: 'opening', count: inputs.length });
  const { files, notes } = await expandAll(inputs);
  onProgress({ stage: 'looking', count: files.length });
  const detected = await detectAll(files, sources);
  notes.push(...detected.notes);
  const results = {};
  for (const { source, files: own } of detected.claims) {
    onProgress({ stage: 'reading', source: source.id, count: 0, unit: source.unit });
    try {
      const res = await source.parse(own, p => onProgress({ stage: 'reading', source: source.id, unit: source.unit, ...p }), env);
      const removed = res.store.sortAndDedupe();
      for (const n of res.notes || []) notes.push({ source: source.id, ...n });
      results[source.id] = { source, files: own, removed, ...res, notes: undefined };
      onProgress({ stage: 'read', source: source.id, count: res.count ?? res.store.length, unit: source.unit });
    } catch (e) {
      notes.push({ source: source.id, path: own.map(f => f.path).join(', '), code: e.code || 'error', message: e.code ? e.message : `attic could not read this ${source.name} export. ${e.message || ''}`.trim() });
    }
  }
  const found = buildFound(results, notes, opts.timeZone);
  return { results, notes, found };
}

/**
 * make the cards for one year.
 * @param {Record<string, any>} results  from readAll
 * @param {{ year: number, timeZone: string, now?: number }} ctx
 */
export function makeYear(results, ctx) {
  const cards = [];
  const notes = [];
  for (const r of Object.values(results)) {
    try {
      cards.push(...r.source.cards(r, { now: Date.now(), ...ctx }));
    } catch (e) {
      notes.push({ source: r.source.id, code: 'cards', message: `something went wrong making the ${r.source.name} cards.`, detail: String(e && e.stack || e) });
    }
  }
  return { cards, notes };
}
