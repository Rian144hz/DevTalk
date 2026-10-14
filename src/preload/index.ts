import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ProgressEvent } from '../shared/ipc-contract';
import { buildApi } from './api';

contextBridge.exposeInMainWorld(
  'devtalk',
  buildApi(
    (channel, payload) => ipcRenderer.invoke(channel, payload),
    (event, cb) => {
      const listener = (_: IpcRendererEvent, payload: ProgressEvent) => cb(payload);
      ipcRenderer.on(event, listener);
      return () => ipcRenderer.removeListener(event, listener);
    },
  ),
);
