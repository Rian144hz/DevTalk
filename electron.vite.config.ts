import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { CONTENT_SECURITY_POLICY, devContentSecurityPolicy } from './src/main/security';
import { findShippedSecrets } from './src/main/social/config';

/** Injects the CSP <meta> tag: strict in builds, React-Refresh-friendly on the dev server. */
function contentSecurityPolicy(): Plugin {
  let isDev = false;
  return {
      name: 'devtalk-csp',
      configResolved(config) {
        isDev = config.command === 'serve';
      },
      transformIndexHtml() {
        const content = isDev ? devContentSecurityPolicy() : CONTENT_SECURITY_POLICY;
        return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content }, injectTo: 'head-prepend' }];
      },
    };
  }

  /** Refuses to build when .env would put a secret Supabase key into the app (only the publishable key may ship). */
  function assertNoShippedSecrets(mode: string): void {
    const secrets = findShippedSecrets(loadEnv(mode, __dirname, ''));
    if (secrets.length > 0) {
      throw new Error(`Refusing to build: ${secrets.join(', ')} holds a secret Supabase key. Use the publishable key (sb_publishable_…).`);
    }
  }

  export default defineConfig(({ mode }) => {
    assertNoShippedSecrets(mode);
    return {
    main: {
      plugins: [externalizeDepsPlugin()],
      build: { rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') } },
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      build: {
        rollupOptions: {
          input: resolve(__dirname, 'src/preload/index.ts'),
          // Sandboxed preloads cannot be ESM.
          output: { format: 'cjs', entryFileNames: '[name].cjs' },
        },
      },
    },
    renderer: {
      root: resolve(__dirname, 'src/renderer'),
      plugins: [contentSecurityPolicy(), react()],
      build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
    },
  };
});
