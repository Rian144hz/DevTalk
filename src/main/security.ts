import type { WebPreferences } from 'electron';

const DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
];

/** Delivered as a <meta> tag (the packaged app loads from file://, where response headers do not apply). */
export const CONTENT_SECURITY_POLICY = DIRECTIVES.join('; ');

/** Dev server only: Vite's React Refresh preamble is an inline script. */
export function devContentSecurityPolicy(): string {
  return DIRECTIVES.map((d) => (d === "script-src 'self'" ? "script-src 'self' 'unsafe-inline'" : d)).join('; ');
}

export function secureWebPreferences(preloadPath: string): WebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
  };
}
