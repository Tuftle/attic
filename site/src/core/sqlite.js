// reading sqlite files (browser history) with sql.js. the engine is passed
// in, so the same code runs in node tests and in the page's worker.

export class SqliteError extends Error {
  /** @param {'not-sqlite'|'malformed'|'locked'|'schema'} code */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const MAGIC = [83, 81, 76, 105, 116, 101, 32, 102, 111, 114, 109, 97, 116, 32, 51, 0]; // "SQLite format 3\0"

/** true if the bytes start like a sqlite database */
export function isSqlite(head) {
  if (!head || head.length < 16) return false;
  for (let i = 0; i < 16; i++) if (head[i] !== MAGIC[i]) return false;
  return true;
}

/**
 * a copy of the bytes that sql.js can open. firefox and chrome keep their
 * history in wal mode, which an in-memory copy cannot use, so the copy is
 * switched back to the plain journal mode. visits still waiting in the side
 * file are not in the copy, which is why the guides say to quit the browser
 * first.
 */
export function prepareBytes(bytes) {
  const copy = new Uint8Array(bytes);
  if (copy.length > 19 && (copy[18] === 2 || copy[19] === 2)) {
    copy[18] = 1;
    copy[19] = 1;
  }
  return copy;
}

export function friendlyError(e) {
  const m = String(e && e.message || e);
  if (/locked|busy/i.test(m)) return new SqliteError('locked', 'this database is locked. quit the program it belongs to, or copy the file first, then drop the copy.');
  if (/not a database|file is encrypted/i.test(m)) return new SqliteError('not-sqlite', 'this file is not a database attic can read.');
  return new SqliteError('malformed', 'this database is damaged. try copying it again after quitting the program it belongs to.');
}

/** open a database from bytes with a loaded sql.js namespace */
export function openDatabase(SQL, bytes) {
  try {
    const db = new SQL.Database(prepareBytes(bytes));
    db.exec('select count(*) from sqlite_master');
    return db;
  } catch (e) {
    throw friendlyError(e);
  }
}

export function tables(db) {
  try {
    const res = db.exec("select name from sqlite_master where type = 'table' order by name");
    return res.length ? res[0].values.map(r => String(r[0])) : [];
  } catch (e) {
    throw friendlyError(e);
  }
}

export function columns(db, table) {
  const res = db.exec(`pragma table_info("${table.replace(/"/g, '""')}")`);
  return res.length ? res[0].values.map(r => String(r[1])) : [];
}

/** run a query and yield each row as an array, without building one big result */
export function* rows(db, sql, params) {
  let stmt;
  try {
    stmt = db.prepare(sql);
    if (params) stmt.bind(params);
  } catch (e) {
    throw friendlyError(e);
  }
  try {
    while (stmt.step()) yield stmt.get();
  } catch (e) {
    throw friendlyError(e);
  } finally {
    stmt.free();
  }
}
