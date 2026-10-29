// a small streaming csv reader (rfc 4180 and the usual drift): quoted
// fields, doubled quotes, newlines inside quotes, crlf or lf or cr, a byte
// order mark, and comma, semicolon or tab, sniffed from the first line.

const QUOTE = 34, LF = 10, CR = 13;

/**
 * @param {{ onRow: (row: string[]) => void, delimiter?: string }} opts
 */
export function createCsvParser({ onRow, delimiter }) {
  let delim = delimiter ? delimiter.charCodeAt(0) : -1;
  let started = false;
  let field = '';
  let fieldStarted = false;
  let row = [];
  let inQuotes = false;
  let quotePending = false; // saw a quote at the end of a chunk while quoted
  let skipLF = false;
  let rows = 0;

  const endField = () => {
    row.push(field);
    field = '';
    fieldStarted = false;
  };
  const endRow = () => {
    endField();
    const r = row;
    row = [];
    if (r.length === 1 && r[0] === '') return; // blank line
    rows++;
    onRow(r);
  };

  function push(chunk) {
    if (!chunk) return;
    let i = 0;
    if (!started) {
      if (chunk.charCodeAt(0) === 0xfeff) i = 1;
      if (delim === -1) delim = sniffDelimiter(chunk.slice(i, i + 4096)).charCodeAt(0);
      started = true;
    }
    const n = chunk.length;
    if (quotePending) {
      quotePending = false;
      if (chunk.charCodeAt(i) === QUOTE) { field += '"'; i++; } else inQuotes = false;
    }
    if (skipLF && i < n) {
      if (chunk.charCodeAt(i) === LF) i++;
      skipLF = false;
    }
    while (i < n) {
      if (inQuotes) {
        const q = chunk.indexOf('"', i);
        if (q === -1) { field += chunk.slice(i); i = n; break; }
        field += chunk.slice(i, q);
        if (q + 1 === n) { quotePending = true; i = n; break; }
        if (chunk.charCodeAt(q + 1) === QUOTE) { field += '"'; i = q + 2; } else { inQuotes = false; i = q + 1; }
        continue;
      }
      const c = chunk.charCodeAt(i);
      if (c === delim) { endField(); i++; continue; }
      if (c === LF) { endRow(); i++; continue; }
      if (c === CR) {
        endRow();
        i++;
        if (i < n) { if (chunk.charCodeAt(i) === LF) i++; } else skipLF = true;
        continue;
      }
      if (c === QUOTE) {
        if (!fieldStarted) { inQuotes = true; fieldStarted = true; } else field += '"';
        i++;
        continue;
      }
      let j = i + 1;
      while (j < n) {
        const d = chunk.charCodeAt(j);
        if (d === delim || d === LF || d === CR || d === QUOTE) break;
        j++;
      }
      field += chunk.slice(i, j);
      fieldStarted = true;
      i = j;
    }
  }

  function end() {
    quotePending = false;
    inQuotes = false;
    if (field !== '' || row.length) endRow();
    return rows;
  }

  return { push, end, get rows() { return rows; } };
}

/** pick the delimiter that appears most in the first line, outside quotes */
export function sniffDelimiter(text) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && ch in counts) counts[ch]++;
  }
  let best = ',';
  for (const d of [';', '\t']) if (counts[d] > counts[best]) best = d;
  return best;
}

/** parse a whole csv text into rows */
export function parseCsv(text, opts = {}) {
  const rows = [];
  const p = createCsvParser({ ...opts, onRow: r => rows.push(r) });
  p.push(text);
  p.end();
  return rows;
}

/** "Start Time", "start_time" and "StartTime" all become "starttime" */
export const fold = s => String(s).replace(/^\u{feff}/u, '').trim().toLowerCase().replace(/[\s_\-.]+/g, '');

/**
 * find columns by alias lists.
 * @param {string[]} header
 * @param {Record<string, string[]>} aliases
 * @returns {{ index: Record<string, number>, missing: string[] }}
 */
export function mapHeader(header, aliases) {
  const folded = header.map(fold);
  const index = {};
  const missing = [];
  for (const [key, names] of Object.entries(aliases)) {
    let at = -1;
    for (const name of names) {
      at = folded.indexOf(fold(name));
      if (at !== -1) break;
    }
    index[key] = at;
    if (at === -1) missing.push(key);
  }
  return { index, missing };
}
