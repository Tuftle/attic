// the page policy from section 11 of the design, in one place.
// vercel.json, every html page and the single file build are checked
// against it.

export const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'none'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

// browsers ignore frame-ancestors in a meta tag, so the meta copy leaves it out
export const META_CSP = CSP.split('; ').filter(d => !d.startsWith('frame-ancestors')).join('; ');

export const PERMISSIONS = [
  'accelerometer=()', 'ambient-light-sensor=()', 'autoplay=()', 'bluetooth=()',
  'browsing-topics=()', 'camera=()', 'clipboard-read=()', 'clipboard-write=(self)', 'display-capture=()',
  'document-domain=()', 'encrypted-media=()', 'fullscreen=()', 'gamepad=()', 'geolocation=()',
  'gyroscope=()', 'hid=()', 'idle-detection=()', 'local-fonts=()', 'magnetometer=()', 'microphone=()',
  'midi=()', 'payment=()', 'picture-in-picture=()', 'publickey-credentials-get=()', 'screen-wake-lock=()',
  'serial=()', 'usb=()', 'web-share=()', 'xr-spatial-tracking=()',
].join(', ');

export const HEADERS = {
  'Content-Security-Policy': CSP,
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': PERMISSIONS,
  'Cross-Origin-Opener-Policy': 'same-origin',
};
