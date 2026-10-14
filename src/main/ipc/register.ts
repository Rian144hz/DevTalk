import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { INVOKE_CHANNELS } from '../../shared/ipc-contract';
import type { Handlers } from './handlers';

/** Only the main window's top-level frame may call the API. */
function isTrusted(event: IpcMainInvokeEvent, getWindow: () => BrowserWindow | null): boolean {
  const win = getWindow();
  return !!win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame;
}

export function registerIpc(handlers: Handlers, getWindow: () => BrowserWindow | null): void {
  for (const channel of INVOKE_CHANNELS) {
    ipcMain.handle(channel, (event, payload: unknown) => {
      if (!isTrusted(event, getWindow)) {
        return { ok: false, error: { kind: 'validation', message: 'Untrusted sender.' } };
      }
      return handlers[channel](payload);
    });
  }
}
