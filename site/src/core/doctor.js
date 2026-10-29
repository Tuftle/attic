// the format doctor: plain, specific messages for files that are wrong or
// damaged, and the shape of a file (field names, types and counts, never
// values) for a format problem report.

import { peekJsonItems } from './jsonstream.js';
import { parseCsv } from './csv.js';
import { isSqlite, openDatabase, tables, columns } from './sqlite.js';
import { looksLikeZip } from './zip.js';

export const FORMAT_PROBLEM_URL = 'https://github.com/Tuftle/attic/issues/new?template=format-problem.md';

export const messages = {
  unknown: 'this does not look like an export from a service we know yet.',
  unknownZip: 'we did not find anything we know in this zip.',
  empty: 'this file is empty.',
};

/** "this csv has columns a, b and c. a netflix viewing file has ..." */
export function csvColumnsMessage(have, want, service) {
  return `this csv has the columns ${list(have.slice(0, 8))}${have.length > 8 ? ' and more' : ''}. a ${service} file has ${list(want)}.`;
}

export function list(items) {
  const xs = items.map(s => String(s).toLowerCase());
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

const MAX_KEYS = 60;
const SAMPLE = 50;

/**
 * the shape of a json value: types, field names and counts. no values.
 * @returns {any}
 */
export function shapeOf(value, depth = 0) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    const out = { type: 'list', count: value.length };
    if (value.length && depth < 6) out.items = mergeShapes(value.slice(0, SAMPLE).map(v => shapeOf(v, depth + 1)));
    return out;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    // keys that look like ids or dates are data, not structure
    if (keys.length > 8 && keys.every(k => /^[0-9a-f-]{8,}$/i.test(k) || /^\d+$/.test(k))) {
      return { type: 'map', count: keys.length, values: depth < 6 ? mergeShapes(keys.slice(0, SAMPLE).map(k => shapeOf(value[k], depth + 1))) : undefined };
    }
    const fields = {};
    for (const k of keys.slice(0, MAX_KEYS)) fields[k] = depth < 6 ? shapeOf(value[k], depth + 1) : typeof value[k];
    return { type: 'object', fields };
  }
  return typeof value;
}

function mergeShapes(shapes) {
  const kinds = [...new Set(shapes.map(s => (typeof s === 'string' ? s : s.type)))];
  const objects = shapes.filter(s => s && s.type === 'object');
  if (objects.length && kinds.length === 1) {
    const fields = {};
    for (const o of objects) {
      for (const [k, v] of Object.entries(o.fields)) {
        if (!(k in fields)) fields[k] = v;
      }
    }
    return { type: 'object', fields };
  }
  if (kinds.length === 1) return shapes[0];
  return { type: 'mixed', of: kinds };
}

/** describe a file's shape for pasting into an issue. reads only the start, except for sqlite. sql is a loaded sql.js. */
export async function shapeOfFile(file, { sql } = {}) {
  const head = file.headBytes || await file.head(256 * 1024);
  const out = { name: genericName(file.name), size: sizeBucket(file.size) };
  if (looksLikeZip(head)) return { ...out, kind: 'zip' };
  if (isSqlite(head)) {
    out.kind = 'sqlite';
    if (sql) {
      try {
        const db = openDatabase(sql, await file.bytes());
        out.tables = {};
        for (const t of tables(db)) out.tables[t] = columns(db, t);
        db.close();
      } catch {
        out.note = 'could not open it';
      }
    }
    return out;
  }
  const text = new TextDecoder('utf-8').decode(head).replace(/^\u{feff}/u, '');
  const first = text.trimStart()[0];
  if (first === '[' || first === '{') {
    out.kind = 'json';
    if (first === '[') {
      const items = peekJsonItems(head, SAMPLE);
      out.shape = { type: 'list', items: items.length ? mergeShapes(items.map(i => shapeOf(i, 1))) : undefined };
      out.note = 'shape of the first items only';
    } else {
      try {
        out.shape = shapeOf(JSON.parse(text));
      } catch {
        out.shape = { type: 'object' };
        out.note = 'too large to read here; the top level is an object';
      }
    }
    return out;
  }
  if (/^\s*</.test(text)) return { ...out, kind: 'html or xml' };
  const firstLine = text.split(/\r?\n/)[0];
  if (/[,;\t]/.test(firstLine)) {
    const rows = parseCsv(text);
    return { ...out, kind: 'csv', columns: rows[0] || [], rowsInStart: Math.max(0, rows.length - 1) };
  }
  return { ...out, kind: 'unknown' };
}

// the name of a file can be personal; keep only its general form
function genericName(name) {
  const ext = (name.match(/\.[a-z0-9]{1,6}$/i) || [''])[0];
  const known = /^(conversations|watch-history|search-history|ViewingActivity|StreamingHistory\w*|Streaming_History_\w+|places|History|users|projects)(\.[a-z]+)?$/i;
  return known.test(name) ? name : `(a file)${ext}`;
}

function sizeBucket(n) {
  if (n < 1024 * 1024) return 'under 1 mb';
  if (n < 100 * 1024 * 1024) return `about ${Math.round(n / 1024 / 1024)} mb`;
  return `about ${Math.round(n / 1024 / 1024 / 100) * 100} mb`;
}

/** the report text for an issue */
export function shapeText(shape) {
  return 'shape of the file (no values)\n\n```json\n' + JSON.stringify(shape, null, 2) + '\n```\n';
}
