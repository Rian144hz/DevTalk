import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { buildApi } from './api';

contextBridge.exposeInMainWorld(
  'devtalk',
  buildApi(
    (channel, payload) => ipcRenderer.invoke(channel, payload),
    (event, cb) => {
      const listener = (_: IpcRendererEvent, payload: unknown) => cb(payload as never);
      ipcRenderer.on(event, listener);
      return () => ipcRenderer.removeListener(event, listener);
    },
  ),
);
