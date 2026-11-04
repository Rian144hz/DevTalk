import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, session, shell } from 'electron';
import { PROGRESS_EVENT } from '../shared/ipc-contract';
import { appUserModelId } from './app-id';
import { createAppContext, type AppContext } from './app-context';
import { isCliMode, runCli } from './cli';
import { DatabaseTooNewError } from './db/open';
import { registerIpc } from './ipc/register';
import { linuxPasswordStoreSwitch } from './vault/key-vault';
import { fakeMediaSwitches, installPermissionHandlers, isAppUrl } from './security';
import { mainWindowOptions } from './window';
// The window icon (Linux). electron-vite emits an asset outside `resources/` (its public folder, which it does not copy) into out/, which the package ships.
import icon from '../../build/icon.png?asset';

const DEV_URL = process.env['ELECTRON_RENDERER_URL'];
const RENDERER_FILE = join(__dirname, '../renderer/index.html');
const APP_URL = DEV_URL ?? pathToFileURL(RENDERER_FILE).href;
let mainWindow: BrowserWindow | null = null;

// Electron falls back to an unencrypted store on desktops it does not recognise (sway, i3, Hyprland…).
if (process.platform === 'linux') {
  const store = linuxPasswordStoreSwitch(process.env, process.argv);
  if (store) app.commandLine.appendSwitch('password-store', store);
}

// Windows: the taskbar button, the pinned shortcut and the Start menu entry are one app (see app-id.ts).
const userModelId = appUserModelId(process.platform);
if (userModelId) app.setAppUserModelId(userModelId);

// Dev/e2e only: keep test data out of the real profile directory.
const overrideUserData = process.env['DEVTALK_USER_DATA'];
if (overrideUserData && !app.isPackaged) app.setPath('userData', overrideUserData);

// Dev/e2e only: Chromium supplies a fake microphone; the app's permission handler still decides.
for (const name of fakeMediaSwitches(process.env, app.isPackaged)) app.commandLine.appendSwitch(name);

/** At most this long is spent giving up the voice-room seat when the app quits; then it quits anyway. */
const QUIT_ROOM_WAIT_MS = 2000;

/** `leaveRoom` runs when the page is gone or replaced (window closed, reload, crash): the room lives in the page. */
function createMainWindow(leaveRoom: () => void): BrowserWindow {
  const win = new BrowserWindow(mainWindowOptions({ preload: join(__dirname, '../preload/index.cjs'), icon }));

  win.once('ready-to-show', () => win.show());

  // No new windows; external links go to the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url, APP_URL)) event.preventDefault();
  });
  win.webContents.on('did-start-navigation', (event) => {
    if (event.isMainFrame && !event.isSameDocument) leaveRoom();
  });
  win.webContents.on('render-process-gone', leaveRoom);
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    leaveRoom();
  });

  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadFile(RENDERER_FILE);
  return win;
}

function openContext(): AppContext | null {
  try {
    return createAppContext(
      (requestId, stage) => mainWindow?.webContents.send(PROGRESS_EVENT, { requestId, stage }),
      () => mainWindow,
    );
  } catch (err) {
    const message = err instanceof DatabaseTooNewError ? err.message : `DevTalk could not open its data: ${String(err)}`;
    if (isCliMode(process.argv)) process.stderr.write(`${message}\n`);
    else dialog.showErrorBox('DevTalk', message);
    return null;
  }
}

void app.whenReady().then(async () => {
  // The microphone for voice rooms, to the app's own page; every other permission is denied.
  installPermissionHandlers(session.defaultSession, APP_URL);
  const ctx = openContext();
  if (!ctx) {
    app.exit(1);
    return;
  }
  if (isCliMode(process.argv)) {
    const code = await runCli(process.argv, ctx);
    ctx.close();
    app.exit(code);
    return;
  }

  registerIpc(ctx.handlers, () => mainWindow);
  const leaveRoom = () => void ctx.leaveRoom();
  mainWindow = createMainWindow(leaveRoom);
  mainWindow.once('ready-to-show', () => ctx.startBackground());
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow(leaveRoom);
  });
  // Quitting from a room: give up the seat first so the others do not see a ghost for 90 seconds.
  let leftRoomOnQuit = false;
  app.on('before-quit', (event) => {
    // A GitHub sign-in waiting for the browser ends with the app, and its port is freed.
    ctx.cancelSignIn();
    if (leftRoomOnQuit || !ctx.inRoom()) return;
    leftRoomOnQuit = true;
    event.preventDefault();
    const patience = new Promise<void>((resolve) => setTimeout(resolve, QUIT_ROOM_WAIT_MS));
    void Promise.race([ctx.leaveRoom(), patience]).finally(() => app.quit());
  });
  app.on('will-quit', () => ctx.close());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
