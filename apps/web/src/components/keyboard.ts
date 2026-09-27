// Keyboard rules shared by the inline editors (stage-6.md §6.9 F): Escape closes an inline form as
// its Cancel button does (the page then returns focus to the control that opened it).
import type { KeyboardEvent } from 'react';

/**
 * An `onKeyDown` for an inline form: Escape runs `onCancel` unless the form is busy (or has nothing
 * to cancel). A nested control that handles Escape itself (a delete confirm, an open listbox) stops
 * the event first, so this never fires for it.
 */
export function escapeCancels(
  onCancel: (() => void) | undefined,
  disabled = false,
): (event: KeyboardEvent<HTMLElement>) => void {
  return (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || disabled || !onCancel) return;
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  };
}
