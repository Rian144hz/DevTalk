import type { Session, WebPreferences } from 'electron';

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

/**
 * GitHub sign-in: the only page the app opens in the browser for it is an auth page of the configured Supabase
 * project — `https:`, the same origin (no other host, port or look-alike name, no user:password@), path under
 * /auth/v1/. A project URL that is not https allows nothing.
 */
export function isAllowedAuthUrl(url: string, supabaseUrl: string): boolean {
  let target: URL;
  let project: URL;
  try {
    target = new URL(url);
    project = new URL(supabaseUrl);
  } catch {
    return false;
  }
  return (
    project.protocol === 'https:' &&
    target.protocol === 'https:' &&
    target.origin === project.origin &&
    target.username === '' &&
    target.password === '' &&
    target.pathname.startsWith('/auth/v1/')
  );
}

/**
 * Request handler rule: the only permission the app ever gives is the microphone (voice rooms), to its own page.
 * `media` must say what it wants and want audio only; the camera, the screen, location, notifications and the rest are denied.
 */
export function allowPermission(
  permission: string,
  details: { mediaTypes?: readonly string[]; isMainFrame?: boolean },
  requestingUrl: string,
  appUrl: string,
): boolean {
  if (permission !== 'media' || details.isMainFrame === false) return false;
  const types = details.mediaTypes;
  if (!types || types.length === 0 || !types.every((t) => t === 'audio')) return false;
  return isAppUrl(requestingUrl, appUrl);
}

/**
 * Check handler rule ("may this page already use it?", asked by enumerateDevices() and before a request): the same
 * limits. A check often does not say audio or video, so it is allowed for the app page unless it names the camera.
 */
export function allowPermissionCheck(
  permission: string,
  details: { mediaType?: string; isMainFrame?: boolean },
  requestingUrl: string,
  appUrl: string,
): boolean {
  if (permission !== 'media' || details.isMainFrame === false || details.mediaType === 'video') return false;
  return isAppUrl(requestingUrl, appUrl);
}

/** Wires both rules into Electron's session; everything they do not allow is denied. */
export function installPermissionHandlers(
  ses: Pick<Session, 'setPermissionRequestHandler' | 'setPermissionCheckHandler'>,
  appUrl: string,
): void {
  ses.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    callback(allowPermission(permission, details as { mediaTypes?: string[]; isMainFrame?: boolean }, details.requestingUrl ?? '', appUrl));
  });
  // The origin of a file:// page is just "file:///", so the page's own URL (when Electron gives it) is what counts.
  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) =>
    allowPermissionCheck(permission, details, details.requestingUrl ?? requestingOrigin, appUrl),
  );
}

/**
 * Dev/e2e only (DEVTALK_FAKE_MEDIA=1, never packaged): Chromium gets a fake microphone so voice rooms run without hardware.
 * Never `use-fake-ui-for-media-stream`: it makes Chromium skip the app's own permission handler, which must keep deciding.
 */
export function fakeMediaSwitches(env: Record<string, string | undefined>, packaged: boolean): string[] {
  return !packaged && env['DEVTALK_FAKE_MEDIA'] === '1' ? ['use-fake-device-for-media-stream'] : [];
}
