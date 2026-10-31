// the browser for the runtime tests. playwright is not a dependency of
// attic; the tests use it when it is installed and skip when it is not.

import { createRequire } from 'node:module';

export function playwright() {
  try {
    return createRequire(import.meta.url)('playwright');
  } catch {
    return null;
  }
}

export const browserTests = process.env.ATTIC_BROWSER === '1';
export const skipBrowser = !browserTests ? 'set ATTIC_BROWSER=1 (npm run test:browser)' : !playwright() ? 'playwright is not installed' : false;

/** watch a page for errors, policy violations and every request */
export function watch(page) {
  const log = { errors: [], violations: [], requests: [] };
  page.on('pageerror', e => log.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') log.errors.push(m.text()); });
  page.on('request', r => log.requests.push({ url: r.url(), at: Date.now() }));
  return log;
}
