import {
  allowPermission, allowPermissionCheck, CONTENT_SECURITY_POLICY, devContentSecurityPolicy, fakeMediaSwitches, installPermissionHandlers, isAllowedAuthUrl, isAppUrl, secureWebPreferences,
} from '../../src/main/security';

test('window is isolated and sandboxed', () => {
  const p = secureWebPreferences('/x/preload.cjs');
  expect(p).toMatchObject({
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    preload: '/x/preload.cjs',
  });
});

test('CSP forbids remote scripts and eval', () => {
  expect(CONTENT_SECURITY_POLICY).toContain("default-src 'self'");
  expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
  expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval');
});

test('CSP lets images come from the app itself and data: URLs only (the favicon, the avatars)', () => {
  expect(CONTENT_SECURITY_POLICY).toContain("img-src 'self' data:");
  expect(CONTENT_SECURITY_POLICY).not.toMatch(/img-src[^;]*(https?:|\*)/);
});

test('dev CSP only relaxes inline scripts for the React Refresh preamble', () => {
  const dev = devContentSecurityPolicy();
  expect(dev).toContain("script-src 'self' 'unsafe-inline'");
  expect(dev.replace("script-src 'self' 'unsafe-inline'", "script-src 'self'")).toBe(CONTENT_SECURITY_POLICY);
});

test('CSP has no directives that meta tags ignore', () => {
  expect(CONTENT_SECURITY_POLICY).not.toContain('frame-ancestors');
});

describe('isAppUrl', () => {
  const appFile = 'file:///home/u/app/out/renderer/index.html';
  test('only the app page itself counts in the packaged build', () => {
    expect(isAppUrl(`${appFile}#/review`, appFile)).toBe(true);
    expect(isAppUrl(`${appFile}?x=1`, appFile)).toBe(true);
    expect(isAppUrl('file:///home/u/Downloads/evil.html', appFile)).toBe(false);
    expect(isAppUrl('file:///home/u/app/out/renderer/other.html', appFile)).toBe(false);
  });
  test('dev server: same origin only', () => {
    expect(isAppUrl('http://localhost:5173/#/x', 'http://localhost:5173/')).toBe(true);
    expect(isAppUrl('http://localhost:5174/', 'http://localhost:5173/')).toBe(false);
    expect(isAppUrl('https://example.com/', 'http://localhost:5173/')).toBe(false);
    expect(isAppUrl('not a url', 'http://localhost:5173/')).toBe(false);
  });
});

describe('isAllowedAuthUrl (what the app may open in the browser for GitHub sign-in)', () => {
  const project = 'https://xjyp.supabase.co';

  test('the authorize page of the configured project is allowed', () => {
    expect(isAllowedAuthUrl('https://xjyp.supabase.co/auth/v1/authorize?provider=github&redirect_to=http%3A%2F%2F127.0.0.1%3A53682%2Fcallback', project)).toBe(true);
    expect(isAllowedAuthUrl('https://XJYP.supabase.co/auth/v1/authorize?provider=github', project)).toBe(true);
    expect(isAllowedAuthUrl('https://xjyp.supabase.co/auth/v1/authorize?provider=github', `${project}/`)).toBe(true);
  });

  test('http, another project, another host or port are refused', () => {
    expect(isAllowedAuthUrl('http://xjyp.supabase.co/auth/v1/authorize?provider=github', project)).toBe(false);
    expect(isAllowedAuthUrl('https://other.supabase.co/auth/v1/authorize?provider=github', project)).toBe(false);
    expect(isAllowedAuthUrl('https://github.com/login/oauth/authorize', project)).toBe(false);
    expect(isAllowedAuthUrl('https://xjyp.supabase.co:8443/auth/v1/authorize', project)).toBe(false);
    expect(isAllowedAuthUrl('javascript:alert(1)', project)).toBe(false);
    expect(isAllowedAuthUrl('file:///etc/passwd', project)).toBe(false);
  });

  test('look-alike hosts are refused', () => {
    expect(isAllowedAuthUrl('https://xjyp.supabase.co.evil.example/auth/v1/authorize', project)).toBe(false);
    expect(isAllowedAuthUrl('https://xjyp.supabase.co@evil.example/auth/v1/authorize', project)).toBe(false);
    expect(isAllowedAuthUrl('https://user:pw@xjyp.supabase.co/auth/v1/authorize', project)).toBe(false);
    expect(isAllowedAuthUrl('https://evil.example/?https://xjyp.supabase.co/auth/v1/authorize', project)).toBe(false);
    expect(isAllowedAuthUrl('https://xjyp-supabase.co/auth/v1/authorize', project)).toBe(false);
    expect(isAllowedAuthUrl('https://xjyp.supabase.co%2eevil.example/auth/v1/authorize', project)).toBe(false);
  });

  test('only the auth pages of the project, never another path on it', () => {
    expect(isAllowedAuthUrl('https://xjyp.supabase.co/storage/v1/object/public/x.html', project)).toBe(false);
    expect(isAllowedAuthUrl('https://xjyp.supabase.co/', project)).toBe(false);
  });

  test('a project URL that is not https, or anything malformed, allows nothing', () => {
    expect(isAllowedAuthUrl('http://127.0.0.1:54321/auth/v1/authorize?provider=github', 'http://127.0.0.1:54321')).toBe(false);
    expect(isAllowedAuthUrl('not a url', project)).toBe(false);
    expect(isAllowedAuthUrl('https://xjyp.supabase.co/auth/v1/authorize', 'not a url')).toBe(false);
    expect(isAllowedAuthUrl('', '')).toBe(false);
  });
});

describe('microphone-only permissions', () => {
  const appFile = 'file:///home/u/app/out/renderer/index.html';
  const appDev = 'http://localhost:5173/';

  test('a page of the app may use the microphone and nothing else', () => {
    expect(allowPermission('media', { mediaTypes: ['audio'] }, `${appFile}#/rooms/r1`, appFile)).toBe(true);
    expect(allowPermission('media', { mediaTypes: ['audio'], isMainFrame: true }, `${appDev}#/rooms`, appDev)).toBe(true);
  });

  test('camera, or camera together with the microphone, is denied', () => {
    expect(allowPermission('media', { mediaTypes: ['video'] }, appFile, appFile)).toBe(false);
    expect(allowPermission('media', { mediaTypes: ['audio', 'video'] }, appFile, appFile)).toBe(false);
    expect(allowPermission('media', { mediaTypes: ['video', 'audio'] }, appFile, appFile)).toBe(false);
  });

  test('a media request that does not say what it wants is denied', () => {
    expect(allowPermission('media', {}, appFile, appFile)).toBe(false);
    expect(allowPermission('media', { mediaTypes: [] }, appFile, appFile)).toBe(false);
  });

  test('screen capture, location, notifications and every other permission are denied, even for the app page', () => {
    for (const permission of [
      'display-capture', 'geolocation', 'notifications', 'clipboard-read', 'midi', 'hid', 'usb', 'serial', 'fullscreen', 'openExternal', 'unknown',
    ]) {
      expect(allowPermission(permission, { mediaTypes: ['audio'] }, appFile, appFile)).toBe(false);
      expect(allowPermission(permission, {}, appFile, appFile)).toBe(false);
    }
  });

  test('a page that is not the app is denied, whatever it asks for', () => {
    expect(allowPermission('media', { mediaTypes: ['audio'] }, 'https://example.com/', appFile)).toBe(false);
    expect(allowPermission('media', { mediaTypes: ['audio'] }, 'file:///home/u/Downloads/evil.html', appFile)).toBe(false);
    expect(allowPermission('media', { mediaTypes: ['audio'] }, 'http://localhost:5174/', appDev)).toBe(false);
    expect(allowPermission('media', { mediaTypes: ['audio'] }, 'not a url', appFile)).toBe(false);
    expect(allowPermission('media', { mediaTypes: ['audio'] }, '', appFile)).toBe(false);
  });

  test('a frame inside the page is denied', () => {
    expect(allowPermission('media', { mediaTypes: ['audio'], isMainFrame: false }, appFile, appFile)).toBe(false);
  });

  test('the check (is the microphone already allowed?) follows the same rules from the page URL', () => {
    expect(allowPermissionCheck('media', { mediaType: 'audio' }, appFile, appFile)).toBe(true);
    // enumerateDevices() and similar checks do not say audio or video: the app page may ask, others may not.
    expect(allowPermissionCheck('media', {}, appFile, appFile)).toBe(true);
    expect(allowPermissionCheck('media', { mediaType: 'unknown' }, appFile, appFile)).toBe(true);
    expect(allowPermissionCheck('media', { mediaType: 'video' }, appFile, appFile)).toBe(false);
    expect(allowPermissionCheck('media', { mediaType: 'audio' }, 'https://example.com/', appFile)).toBe(false);
    expect(allowPermissionCheck('media', { mediaType: 'audio', isMainFrame: false }, appFile, appFile)).toBe(false);
    for (const permission of ['display-capture', 'geolocation', 'notifications', 'clipboard-read', 'fullscreen']) {
      expect(allowPermissionCheck(permission, {}, appFile, appFile)).toBe(false);
    }
  });

  test('both Electron handlers are installed and answer with these rules', () => {
    let request!: (wc: unknown, permission: string, callback: (granted: boolean) => void, details: Record<string, unknown>) => void;
    let check!: (wc: unknown, permission: string, origin: string, details: Record<string, unknown>) => boolean;
    installPermissionHandlers(
      {
        setPermissionRequestHandler: (h: unknown) => void (request = h as typeof request),
        setPermissionCheckHandler: (h: unknown) => void (check = h as typeof check),
      },
      appFile,
    );
    const ask = (permission: string, details: Record<string, unknown>) => {
      let answer: boolean | null = null;
      request(null, permission, (granted) => void (answer = granted), details);
      return answer;
    };
    expect(ask('media', { requestingUrl: `${appFile}#/rooms`, mediaTypes: ['audio'], isMainFrame: true })).toBe(true);
    expect(ask('media', { requestingUrl: appFile, mediaTypes: ['audio', 'video'], isMainFrame: true })).toBe(false);
    expect(ask('display-capture', { requestingUrl: appFile, isMainFrame: true })).toBe(false);
    expect(ask('geolocation', { requestingUrl: appFile, isMainFrame: true })).toBe(false);
    expect(ask('notifications', { requestingUrl: appFile, isMainFrame: true })).toBe(false);
    expect(ask('media', { requestingUrl: 'https://example.com/', mediaTypes: ['audio'], isMainFrame: true })).toBe(false);
    expect(ask('media', { mediaTypes: ['audio'], isMainFrame: true })).toBe(false);

    // The check sees the origin only ("file:///" for a file), so it reads the page URL from the details.
    expect(check(null, 'media', 'file:///', { requestingUrl: appFile, mediaType: 'audio', isMainFrame: true })).toBe(true);
    expect(check(null, 'media', 'file:///', { requestingUrl: appFile, mediaType: 'video', isMainFrame: true })).toBe(false);
    expect(check(null, 'media', 'https://example.com', { requestingUrl: 'https://example.com/', mediaType: 'audio', isMainFrame: true })).toBe(false);
    expect(check(null, 'geolocation', 'file:///', { requestingUrl: appFile, isMainFrame: true })).toBe(false);
    expect(check(null, 'media', 'file:///', { isMainFrame: true })).toBe(false);
  });
});

describe('fakeMediaSwitches', () => {
  test('DEVTALK_FAKE_MEDIA=1 gives Chromium a fake microphone and nothing else: no fake permission UI', () => {
    // use-fake-ui-for-media-stream would make Chromium skip the app's own permission handler.
    expect(fakeMediaSwitches({ DEVTALK_FAKE_MEDIA: '1' }, false)).toEqual(['use-fake-device-for-media-stream']);
  });
  test('no switches when it is off, set to anything else, or the app is packaged', () => {
    expect(fakeMediaSwitches({}, false)).toEqual([]);
    expect(fakeMediaSwitches({ DEVTALK_FAKE_MEDIA: '0' }, false)).toEqual([]);
    expect(fakeMediaSwitches({ DEVTALK_FAKE_MEDIA: 'true' }, false)).toEqual([]);
    expect(fakeMediaSwitches({ DEVTALK_FAKE_MEDIA: '1' }, true)).toEqual([]);
  });
});
