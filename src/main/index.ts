import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, shell } from 'electron';
import { PROGRESS_EVENT } from '../shared/ipc-contract';
import { createAppContext, type AppContext } from './app-context';
import { isCliMode, runCli } from './cli';
import { DatabaseTooNewError } from './db/open';
import { registerIpc } from './ipc/register';
import { linuxPasswordStoreSwitch } from './vault/key-vault';
import { isAppUrl, secureWebPreferences } from './security';

const DEV_URL = process.env['ELECTRON_RENDERER_URL'];
const RENDERER_FILE = join(__dirname, '../renderer/index.html');
const APP_URL = DEV_URL ?? pathToFileURL(RENDERER_FILE).href;
let mainWindow: BrowserWindow | null = null;

// Electron falls back to an unencrypted store on desktops it does not recognise (sway, i3, Hyprland…).
if (process.platform === 'linux') {
  const store = linuxPasswordStoreSwitch(process.env, process.argv);
  if (store) app.commandLine.appendSwitch('password-store', store);
}

// Dev/e2e only: keep test data out of the real profile directory.
const overrideUserData = process.env['DEVTALK_USER_DATA'];
if (overrideUserData && !app.isPackaged) app.setPath('userData', overrideUserData);

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0f1115',
    webPreferences: secureWebPreferences(join(__dirname, '../preload/index.cjs')),
  });

  win.once('ready-to-show', () => win.show());

  // No new windows; external links go to the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url, APP_URL)) event.preventDefault();
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadFile(RENDERER_FILE);
  return win;
}

function openContext(): AppContext | null {
  try {
    return createAppContext((requestId, stage) => mainWindow?.webContents.send(PROGRESS_EVENT, { requestId, stage }));
  } catch (err) {
    const message = err instanceof DatabaseTooNewError ? err.message : `DevTalk could not open its data: ${String(err)}`;
    if (isCliMode(process.argv)) process.stderr.write(`${message}\n`);
    else dialog.showErrorBox('DevTalk', message);
    return null;
  }
}

void app.whenReady().then(async () => {
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
  mainWindow = createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
  });
  app.on('will-quit', () => ctx.close());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
