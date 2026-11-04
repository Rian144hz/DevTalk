import type { BrowserWindowConstructorOptions } from 'electron';
import { secureWebPreferences } from './security';

/**
 * Options for the main window. On Linux it gets the app's icon (the duck), so the dock and the taskbar show it in
 * development and in a packaged build alike; macOS and Windows take theirs from the app bundle. The web preferences
 * are the secure ones on every platform.
 */
export function mainWindowOptions(o: { preload: string; icon: string; platform?: NodeJS.Platform }): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0f1726',
    ...((o.platform ?? process.platform) === 'linux' ? { icon: o.icon } : {}),
    webPreferences: secureWebPreferences(o.preload),
  };
}
