/// <reference types="electron-vite/node" />
// Build-time values electron-vite injects into the main process (from .env; MAIN_VITE_ prefix only).
interface ImportMetaEnv {
  readonly MAIN_VITE_SUPABASE_URL?: string;
  readonly MAIN_VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
