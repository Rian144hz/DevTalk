// Guards for window-level shortcuts, so a key typed into a field or the palette is not also a shortcut.
type Target = EventTarget | null;
type Closest = { closest?: (selector: string) => unknown };
const closest = (t: Target, selector: string) => {
  const el = t as Closest | null;
  return !!el && typeof el.closest === 'function' && el.closest(selector) !== null;
};

/** Inside an open dialog (the command palette). */
export const isInDialog = (t: Target) => closest(t, 'dialog[open]');

/** A text field, or anything inside an open dialog. */
export const isTextEntry = (t: Target) => closest(t, 'input, textarea, select, [contenteditable="true"], dialog[open]');

/** A text field or a control that handles Enter/Space itself. */
export const isTypingTarget = (t: Target) => closest(t, 'input, textarea, select, button, a, [role="radio"], [contenteditable="true"], dialog[open]');
