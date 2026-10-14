/// <reference types="vite/client" />
import type { DevtalkApi } from '../shared/ipc-contract';

declare global {
  interface Window {
    devtalk: DevtalkApi;
  }
}
