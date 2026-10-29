// the work behind the page, behind one message handler. it runs in the
// worker, or on the page itself when a worker cannot start (the single file
// version opened from disk in some browsers).

import { readAll, makeYear } from './core/pipeline.js';
import { buildFound } from './sources/index.js';
import { shapeOfFile, shapeText } from './core/doctor.js';

function friendly(e) {
  if (e && (e.name === 'RangeError' || /memory|allocation/i.test(String(e.message)))) {
    return 'this file is too large for your browser\'s memory. the guides show how to export only the part attic needs.';
  }
  return 'something went wrong while reading. try again, or with fewer files at once.';
}

/**
 * @param {(msg: any) => void} post
 * @param {{ sqlite?: () => Promise<any> }} env
 */
export function createHost(post, env) {
  let read = null;
  return async function handle(msg) {
    try {
      if (msg.type === 'read') {
        read = await readAll(msg.files, { onProgress: p => post({ type: 'progress', p }), env, timeZone: msg.timeZone });
        post({ type: 'found', found: read.found });
      } else if (msg.type === 'zone') {
        if (read) post({ type: 'found', found: buildFound(read.results, read.notes, msg.timeZone), quiet: true });
      } else if (msg.type === 'make') {
        if (!read) throw new Error('nothing has been read');
        const { cards, final, notes } = makeYear(read.results, { year: msg.year, timeZone: msg.timeZone, now: msg.now });
        post({ type: 'cards', cards, final, notes, year: msg.year });
      } else if (msg.type === 'shape') {
        const files = (read && read.files) || [];
        const file = files.find(f => f.path === msg.path);
        let shape;
        if (file) {
          shape = await shapeOfFile(file, { sql: env.sqlite ? await env.sqlite().catch(() => null) : null });
        } else {
          const inside = files.filter(f => f.archive === msg.path || f.path.startsWith(msg.path + '/'));
          const types = {};
          for (const f of inside) {
            const ext = (f.name.match(/\.[a-z0-9]{1,6}$/i) || ['(none)'])[0].toLowerCase();
            types[ext] = (types[ext] || 0) + 1;
          }
          shape = { kind: 'zip', files: inside.length, types };
        }
        post({ type: 'shape', path: msg.path, text: shapeText(shape) });
      } else if (msg.type === 'forget') {
        read = null;
        post({ type: 'forgotten' });
      }
    } catch (e) {
      post({ type: 'error', message: friendly(e), detail: String(e && e.stack || e) });
    }
  };
}
