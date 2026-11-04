/** The app's id: the `appId` in electron-builder.yml, which the Windows installer also stamps on its shortcuts. */
export const APP_ID = 'dev.devtalk.app';

/**
 * Windows groups taskbar buttons and pinned shortcuts by an AppUserModelID. The installer gives the Start menu and
 * desktop shortcuts the `appId`; left alone, Electron makes up a different id for the running window from the app
 * name, so a pinned DevTalk and the open one would be two buttons. Null elsewhere: only Windows has this id.
 */
export function appUserModelId(platform: NodeJS.Platform): string | null {
  return platform === 'win32' ? APP_ID : null;
}
