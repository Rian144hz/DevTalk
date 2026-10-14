import { CONTENT_SECURITY_POLICY, devContentSecurityPolicy, isAppUrl, secureWebPreferences } from '../../src/main/security';

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
