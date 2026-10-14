import { CONTENT_SECURITY_POLICY, devContentSecurityPolicy, secureWebPreferences } from '../../src/main/security';

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
