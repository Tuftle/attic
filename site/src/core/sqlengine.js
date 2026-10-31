// loads sql.js in the browser. the vendored file is a plain script that
// hands its function to module.exports, so a module and exports are set up
// for it to fill in. the wasm comes as base64 from a script, because the
// page policy does not let the page fetch it.

import wasmBase64 from '../../vendor/sql-wasm.wasm.js';

export function decodeBase64(s) {
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(s);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let pending = null;

/** @returns {Promise<any>} the sql.js namespace */
export function loadSqlEngine() {
  if (!pending) {
    pending = (async () => {
      const g = globalThis;
      const before = { module: g.module, exports: g.exports };
      g.module = { exports: {} };
      g.exports = g.module.exports;
      let ready;
      try {
        await import('../../vendor/sql-wasm.js');
        const init = g.module.exports;
        if (typeof init !== 'function') throw new Error('the database reader did not load');
        // sql.js sets module to undefined as it starts, so the stand-in has
        // to be there until it has been called
        ready = init({ wasmBinary: decodeBase64(wasmBase64) });
      } finally {
        if (before.module === undefined) delete g.module; else g.module = before.module;
        if (before.exports === undefined) delete g.exports; else g.exports = before.exports;
      }
      return ready;
    })();
    pending.catch(() => { pending = null; });
  }
  return pending;
}
