export function isWriteFocusModeShortcut(
  event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'repeat' | 'isComposing'>
): boolean {
  return event.code === 'KeyF' &&
    event.shiftKey &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.repeat &&
    !event.isComposing
}
