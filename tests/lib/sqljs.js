// loads the vendored sql.js in node, the same files the page uses.
// the repo is "type": "module", so node would read the umd file as an es
// module and drop its export. we compile it as commonjs instead.

import Module, { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../../site/vendor/sql-wasm.js', import.meta.url));
const wasm = fileURLToPath(new URL('../../site/vendor/sql-wasm.wasm', import.meta.url));
let pending;

/** @returns {Promise<any>} the sql.js namespace (Database and friends) */
export function loadSql() {
  if (!pending) {
    const m = new Module(file);
    m.filename = file;
    m.paths = [];
    m.require = createRequire(file);
    m._compile(readFileSync(file, 'utf8'), file);
    pending = m.exports({ wasmBinary: readFileSync(wasm) });
  }
  return pending;
}
