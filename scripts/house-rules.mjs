// the house-rule linter: no em dashes, no emojis, no buzzwords anywhere we
// write for people, and never the word "wrapped" in the site.
// usage: node scripts/house-rules.mjs [paths...]   or   ... --stdin

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUZZWORDS = [
  'seamless', 'seamlessly', 'leverage', 'leveraging', 'synergy', 'synergies',
  'cutting-edge', 'cutting edge', 'game-changer', 'game changer', 'game-changing',
  'revolutionary', 'revolutionise', 'revolutionize', 'supercharge', 'supercharged',
  'empower', 'empowering', 'empowers', 'frictionless', 'best-in-class', 'world-class',
  'next-gen', 'next-generation', 'blazing fast', 'blazingly fast', 'state-of-the-art',
  'innovative', 'streamline', 'streamlined', 'paradigm', 'holistic', 'ai-powered',
  'unleash', 'turnkey', 'disruptive', 'hyper-personalised', 'hyper-personalized',
];

const EMDASH = /\u{2014}/gu;
// pictographs, minus the copyright, registered and trademark signs, plus the
// emoji variation selector and the regional indicator letters used for flags
const EMOJI = /(?![\u{a9}\u{ae}\u{2122}])\p{Extended_Pictographic}|\u{fe0f}|[\u{1f1e6}-\u{1f1ff}]/gu;
const WRAPPED = /\bwrapped\b/gi;
const BUZZ = new RegExp(
  '(?<![\\p{L}\\p{N}-])(' + BUZZWORDS.map(w => w.replace(/[-]/g, '[- ]?').replace(/ /g, '\\s+')).join('|') + ')(?![\\p{L}\\p{N}-])',
  'giu',
);

export const TEXT_EXTENSIONS = new Set(['.md', '.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.yml', '.yaml']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'out', 'dist']);
// third party text we copy and do not edit, and this file, which holds the word list
const SKIP_PATHS = ['site/vendor/', 'scripts/house-rules.mjs'];

function lineCol(text, index) {
  let line = 1, last = -1;
  for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) { line++; last = i; }
  return { line, col: index - last };
}

/**
 * check one piece of text. path decides which rules apply.
 * @param {string} text
 * @param {{ path?: string, site?: boolean }} [opts]
 * @returns {{ rule: string, match: string, line: number, col: number }[]}
 */
export function checkText(text, opts = {}) {
  const path = (opts.path || '').split(sep).join('/');
  const site = opts.site ?? (path.startsWith('site/') || path.includes('/site/'));
  const out = [];
  const scan = (re, rule) => {
    re.lastIndex = 0;
    for (let m; (m = re.exec(text));) out.push({ rule, match: m[0], ...lineCol(text, m.index) });
  };
  scan(EMDASH, 'em dash');
  scan(EMOJI, 'emoji');
  scan(BUZZ, 'buzzword');
  if (site) scan(WRAPPED, 'the word wrapped');
  return out.sort((a, b) => a.line - b.line || a.col - b.col);
}

/** list every text file under root that the rules cover. */
export function listFiles(root, dir = root) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(root, full).split(sep).join('/');
    if (SKIP_PATHS.some(p => rel.startsWith(p))) continue;
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) files.push(...listFiles(root, full));
    } else if (TEXT_EXTENSIONS.has(extname(name)) || name === 'LICENSE') {
      files.push(rel);
    }
  }
  return files;
}

/** check the whole repository, returns problems with file paths. */
export function checkRepo(root) {
  const problems = [];
  for (const rel of listFiles(root)) {
    // generated base64 data cannot hold words
    if (rel.endsWith('.wasm.js')) continue;
    const text = readFileSync(join(root, rel), 'utf8');
    for (const p of checkText(text, { path: rel })) problems.push({ file: rel, ...p });
  }
  return problems;
}

async function main(args) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  let problems;
  if (args.includes('--stdin')) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    problems = checkText(Buffer.concat(chunks).toString('utf8'), { site: true }).map(p => ({ file: 'stdin', ...p }));
  } else {
    problems = checkRepo(root);
  }
  for (const p of problems) console.log(`${p.file}:${p.line}:${p.col} ${p.rule}: ${JSON.stringify(p.match)}`);
  if (problems.length) {
    console.log(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}.`);
    process.exit(1);
  }
  console.log('house rules: all clear.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
