// the static privacy scan. reads everything under site/ and fails on
// anything that could send data out, run text as code, or store data where
// the visitor did not ask for it. the vendored libraries are checked
// against recorded counts of what they are known to contain.
// usage: node scripts/privacy-scan.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SITE = fileURLToPath(new URL('../site/', import.meta.url));

// patterns that must not appear in attic's own code
export const CODE_RULES = [
  [/\bfetch\s*\(/, 'calls fetch'],
  [/\bnew\s+XMLHttpRequest\b|\bXMLHttpRequest\s*\(/, 'uses XMLHttpRequest'],
  [/\bnew\s+(WebSocket|EventSource|WebTransport)\b/, 'opens a connection'],
  [/\bsendBeacon\s*\(/, 'calls sendBeacon'],
  [/\bimportScripts\s*\(/, 'calls importScripts'],
  [/\beval\s*\(|\bnew\s+Function\s*\(|\bFunction\s*\(\s*['"`]/, 'runs text as code'],
  [/set(Timeout|Interval)\s*\(\s*['"`]/, 'runs a string as code'],
  [/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write/, 'writes markup from strings'],
  [/document\.cookie/, 'uses cookies'],
  [/\bindexedDB\b|\bsessionStorage\b|\bcaches\.open\b|navigator\.serviceWorker/, 'stores data'],
  [/\bwindow\.open\s*\(|\.postMessage\s*\([^)]*,\s*['"`]https?:/, 'talks to another window'],
  [/navigator\.(geolocation|mediaDevices|bluetooth|usb|serial|hid)/, 'asks for a device'],
];

// local storage only where the visitor ticks "keep my results"
const STORAGE_ONLY_IN = 'src/ui/share.js';

// web addresses attic's own code may name: links people click, and the svg namespace
const ALLOWED_URLS = [
  'https://github.com/Tuftle/attic/issues/new?template=format-problem.md',
  'http://www.w3.org/2000/svg',
];

// what each vendored file is known to contain. a new version changes these
// counts, and the scan fails until someone has looked.
export const VENDOR_EXPECT = {
  'vendor/fflate.js': { 'fetch(': 0, XMLHttpRequest: 0, 'new Worker': 1, importScripts: 0, 'eval(': 0, 'new Function': 0 },
  'vendor/sql-wasm.js': { 'fetch(': 2, XMLHttpRequest: 2, 'new Worker': 0, importScripts: 0, 'eval(': 0, 'new Function': 0 },
};

const GENERATED = /(^|\/)(vendor\/sql-wasm\.wasm\.js|sample\/sample\.js)$/;

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

const count = (text, needle) => text.split(needle).length - 1;

/** check one file's text. path is relative to site/. */
export function scanText(path, text) {
  const problems = [];
  const add = what => problems.push(`${path}: ${what}`);
  if (path.startsWith('vendor/')) {
    const expect = VENDOR_EXPECT[path];
    if (!expect) return problems;
    for (const [needle, n] of Object.entries(expect)) {
      const got = count(text, needle);
      if (got !== n) add(`has ${got} of "${needle}", recorded ${n}. check the new version, then update VENDOR_EXPECT`);
    }
    return problems;
  }
  if (GENERATED.test(path)) {
    // generated data: one exported constant and nothing else
    const body = text.replace(/^\/\/.*\n/gm, '');
    if (!/^export (default '[A-Za-z0-9+/=]*';|const SAMPLE = \[\n(  \{ name: '[^']+', data: '[A-Za-z0-9+/=]*' \},\n)*\];)\n$/.test(body)) add('generated data has something besides its data');
    return problems;
  }
  if (path.endsWith('.js')) {
    const code = text.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [re, what] of CODE_RULES) if (re.test(code)) add(what);
    if (/\blocalStorage\b/.test(code) && path !== STORAGE_ONLY_IN) add('uses localStorage outside the keep-my-results code');
    for (const url of code.match(/https?:\/\/[^\s'"`)]+/g) || []) if (!ALLOWED_URLS.includes(url)) add(`names a web address: ${url}`);
  }
  if (path.endsWith('.html')) {
    for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const attrs = m[1];
      if (!/\bsrc=/.test(attrs)) add('has an inline script');
      const src = (attrs.match(/\bsrc="([^"]+)"/) || [])[1];
      if (src && /^(https?:)?\/\//.test(src)) add(`loads a script from elsewhere: ${src}`);
      if (m[2].trim()) add('has code inside a script tag');
    }
    if (/<style\b/i.test(text)) add('has an inline style block');
    if (/\sstyle\s*=/i.test(text)) add('has an inline style attribute');
    if (/\son[a-z]+\s*=/i.test(text)) add('has an inline event handler');
    for (const m of text.matchAll(/<(link|img|iframe|source|video|audio|embed|object)\b[^>]*\b(href|src)="([^"]+)"/gi)) {
      if (/^(https?:)?\/\//.test(m[3])) add(`loads ${m[1]} from elsewhere: ${m[3]}`);
    }
    for (const m of text.matchAll(/<a\b[^>]*href="(https?:[^"]+)"[^>]*>/gi)) {
      if (!/rel="[^"]*noreferrer/.test(m[0])) add(`a link out without rel="noreferrer": ${m[1]}`);
    }
    if (/<form\b/i.test(text)) add('has a form');
  }
  if (path.endsWith('.css')) {
    if (/@import|url\(\s*['"]?(https?:)?\/\//i.test(text)) add('loads something from css');
  }
  return problems;
}

export function scanSite(root = SITE) {
  const problems = [];
  for (const file of walk(root)) {
    const path = relative(root, file).split(sep).join('/');
    if (!/\.(js|html|css|svg)$/.test(path)) continue;
    problems.push(...scanText(path, readFileSync(file, 'utf8')));
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = scanSite();
  for (const p of problems) console.log(p);
  if (problems.length) {
    console.log(`\n${problems.length} privacy problem${problems.length === 1 ? '' : 's'}.`);
    process.exit(1);
  }
  console.log('privacy scan: nothing in site/ can send your data anywhere.');
}
