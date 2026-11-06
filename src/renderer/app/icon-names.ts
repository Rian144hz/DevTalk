/**
 * The line icons the app draws (icons.tsx draws each one). A plain list in a file with no component in it, so code that
 * only names an icon (the sidebar list in lib/nav.ts) and its tests do not need the JSX compiler.
 */
export const ICON_NAMES = [
  'home', 'practice', 'review', 'people', 'rooms', 'micOff', 'progress', 'settings', 'check', 'circle', 'half', 'lock', 'x',
  'shield', 'heart', 'chat', 'copy',
] as const;
export type IconName = (typeof ICON_NAMES)[number];
