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

/**
 * True only for the app's own page. In packaged builds that is the exact index.html file
 * (any other file:// page — e.g. one dropped onto the window — is foreign); on the dev
 * server it is the server's origin.
 */
export function isAppUrl(url: string, appUrl: string): boolean {
  let target: URL;
  let app: URL;
  try {
    target = new URL(url);
    app = new URL(appUrl);
  } catch {
    return false;
  }
  if (app.protocol === 'file:') return target.protocol === 'file:' && target.pathname === app.pathname;
  return target.origin === app.origin;
}
