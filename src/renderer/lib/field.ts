/**
 * Focuses a text field and selects `[start, end)` in it, with the passage in view. `setSelectionRange` alone does not
 * scroll in Chromium, so a passage low in a long text would stay hidden: the field is given its text cut at the end of
 * the passage, scrolled to the bottom (where that line is), and given the whole text back, all before the next paint.
 */
export function selectPassage(field: HTMLTextAreaElement, start: number, end: number): void {
  const text = field.value;
  field.value = text.slice(0, end);
  field.scrollTop = field.scrollHeight;
  field.value = text;
  field.focus();
  field.setSelectionRange(start, end);
}
