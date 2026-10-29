// builds dist/attic.html: the whole app in one file, vendored libraries
// included, so it can be saved and opened with no connection at all.
//
// there is no bundler dependency. attic's modules keep to a small set of
// import and export forms, and this turns each module into a function. any
// other form stops the build with a message, rather than guessing.
//
// the single file carries its own policy: inline code is allowed only by its
// sha256 hash, the worker runs from a blob: url, and connect-src stays 'none'.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { META_CSP } from './policy.mjs';

export const SITE = fileURLToPath(new URL('../site/', import.meta.url));
export const OUT = fileURLToPath(new URL('../dist/attic.html', import.meta.url));

// plain scripts that hand their result to a global module.exports
const CLASSIC = new Set(['vendor/sql-wasm.js']);

const idOf = file => relative(SITE, file).split(sep).join('/');

function resolve(fromId, spec) {
  if (!spec.startsWith('.')) throw new Error(`${fromId}: only relative imports can be bundled, not "${spec}"`);
  return idOf(normalize(join(SITE, dirname(fromId), spec)));
}

/**
 * turn one es module into the body of a function (require, exports).
 * @returns {{ body: string, deps: string[] }}
 */
export function transform(id, src) {
  if (CLASSIC.has(id)) return { body: src, deps: [], classic: true };
  const deps = new Set();
  const names = [];
  let body = src.replace(/\bimport\.meta\.url\b/g, 'location.href');
  body = body.replace(/^import\s+([^;]*?)\s+from\s+'([^']+)';?[ \t]*$/gm, (_, what, spec) => {
    const dep = resolve(id, spec);
    deps.add(dep);
    const req = `__require(${JSON.stringify(dep)})`;
    what = what.trim();
    if (what.startsWith('{')) {
      const parts = what.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean).map(s => {
        const m = s.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
        if (!m) throw new Error(`${id}: cannot bundle the import "${s}"`);
        return m[2] ? `${m[1]}: ${m[2]}` : m[1];
      });
      return `const { ${parts.join(', ')} } = ${req};`;
    }
    if (what.startsWith('* as ')) return `const ${what.slice(5).trim()} = ${req};`;
    if (/^[A-Za-z_$][\w$]*$/.test(what)) return `const ${what} = ${req}.default;`;
    throw new Error(`${id}: cannot bundle the import "${what}"`);
  });
  body = body.replace(/\bimport\(\s*'([^']+)'\s*\)/g, (_, spec) => {
    const dep = resolve(id, spec);
    deps.add(dep);
    return `Promise.resolve().then(() => __require(${JSON.stringify(dep)}))`;
  });
  body = body.replace(/^export\s+((?:async\s+)?function\s*\*?\s*|class\s+|const\s+|let\s+|var\s+)([A-Za-z_$][\w$]*)/gm, (_, kind, name) => {
    names.push([name, name]);
    return `${kind}${name}`;
  });
  body = body.replace(/^export\s+default\s+/gm, '__exports.default = ');
  body = body.replace(/^export\s*\{([^}]*)\};?[ \t]*$/gm, (_, list) => {
    for (const part of list.split(',').map(s => s.trim()).filter(Boolean)) {
      const m = part.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (!m) throw new Error(`${id}: cannot bundle the export "${part}"`);
      names.push([m[1], m[2] || m[1]]);
    }
    return '';
  });
  const left = body.match(/^\s*(import|export)\b.*$/m);
  if (left) throw new Error(`${id}: cannot bundle "${left[0].trim()}"`);
  const tail = names.map(([local, exported]) => `__exports.${exported} = ${local};`).join('\n');
  return { body: `'use strict';\n${body}\n${tail}\n`, deps: [...deps] };
}

/** every module reachable from an entry, each wrapped, with a tiny loader */
export function bundle(entry, prelude = '') {
  const seen = new Map();
  const visit = id => {
    if (seen.has(id)) return;
    const src = readFileSync(join(SITE, id), 'utf8');
    const t = transform(id, src);
    seen.set(id, t);
    for (const d of t.deps) visit(d);
  };
  visit(entry);
  const mods = [...seen].map(([id, t]) => `__modules[${JSON.stringify(id)}] = function (__require, __exports) {\n${t.body}\n};`).join('\n');
  return `(function () {
var __modules = {}, __cache = {};
function __require(id) {
  var e = __cache[id];
  if (e) return e;
  e = __cache[id] = {};
  __modules[id](__require, e);
  return e;
}
${mods}
${prelude}
__require(${JSON.stringify(entry)});
})();
`;
}

const sha = text => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
// text inside a script element must not end it early
const safe = js => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

export function build() {
  const worker = safe(bundle('src/worker.js'));
  const page = safe(bundle('src/app.js',
    "globalThis.ATTIC_WORKER_URL = URL.createObjectURL(new Blob([document.getElementById('attic-worker').textContent], { type: 'text/javascript' }));"));
  const guidesHtml = readFileSync(join(SITE, 'guides/index.html'), 'utf8');
  const guides = guidesHtml.slice(guidesHtml.indexOf('<main id="main">') + '<main id="main">'.length, guidesHtml.indexOf('</main>'));
  const css = readFileSync(join(SITE, 'assets/style.css'), 'utf8')
    + '\n/* the single file carries the guides inline */\n.guides-inline:not(:target) { display: none; }\n.guides-inline { max-width: 760px; margin: 0 auto; padding: 0 16px 48px; }\n';
  const logo = `data:image/svg+xml;base64,${readFileSync(join(SITE, 'assets/logo.svg')).toString('base64')}`;
  const policy = [
    "default-src 'none'", `script-src ${sha(page)} 'wasm-unsafe-eval'`, `style-src ${sha(css)}`, 'img-src data: blob:',
    'worker-src blob:', "connect-src 'none'", "base-uri 'none'", "form-action 'none'",
  ].join('; ');
  let html = readFileSync(join(SITE, 'index.html'), 'utf8');
  const swap = (from, to) => {
    if (!html.includes(from)) throw new Error(`index.html no longer has: ${from}`);
    html = html.split(from).join(to);
  };
  swap(`content="${META_CSP}"`, `content="${policy}"`);
  swap('<link rel="stylesheet" href="assets/style.css">', `<style>${css}</style>`);
  swap('<script type="module" src="src/app.js"></script>\n', '');
  swap('assets/logo.svg', logo);
  swap('<a href="guides/">how do i get my files?</a>', '<a href="#guides">how do i get my files?</a>');
  swap('</body>', `  <section id="guides" class="guides-inline" aria-label="how do i get my files?">\n${guides}\n<p><a href="#">back to attic</a></p>\n</section>\n<script type="text/plain" id="attic-worker">${worker}</script>\n<script>${page}</script>\n</body>`);
  return { html, policy, sizes: { worker: worker.length, page: page.length } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { html, sizes } = build();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, html);
  console.log(`wrote dist/attic.html, ${Math.round(html.length / 1024)} kb (page ${Math.round(sizes.page / 1024)} kb, worker ${Math.round(sizes.worker / 1024)} kb). open it from your disk; it needs no connection.`);
}
