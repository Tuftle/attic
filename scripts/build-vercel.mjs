// writes vercel.json from the policy in scripts/policy.mjs, so the headers
// the site is served with and the meta tags in its pages never drift apart.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HEADERS } from './policy.mjs';

export const OUT = fileURLToPath(new URL('../vercel.json', import.meta.url));

export function render() {
  return JSON.stringify({
    $schema: 'https://openapi.vercel.sh/vercel.json',
    outputDirectory: 'site',
    cleanUrls: false,
    headers: [{ source: '/(.*)', headers: Object.entries(HEADERS).map(([key, value]) => ({ key, value })) }],
  }, null, 2) + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(OUT, render());
  console.log('wrote vercel.json');
}
