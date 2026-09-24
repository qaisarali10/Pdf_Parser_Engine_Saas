/**
 * Cursor arithmetic for the command palette's result list.
 *
 * Kept out of the component so the wrap-around cases can be tested directly:
 * the list length changes on every keystroke while the cursor keeps its old
 * value until the next render, so "index is within range" is not something
 * these can assume.
 */

/** Keeps an index inside a list that may have shrunk under it. */
export function clampCursor(index, length) {
  if (!Number.isInteger(length) || length <= 0) return 0;
  if (!Number.isFinite(index) || index < 0) return 0;
  return Math.min(index, length - 1);
}

/** Moves the cursor by `step`, wrapping at either end. */
export function moveCursor(index, step, length) {
  if (!Number.isInteger(length) || length <= 0) return 0;
  const from = clampCursor(index, length);
  return ((from + step) % length + length) % length;
}
