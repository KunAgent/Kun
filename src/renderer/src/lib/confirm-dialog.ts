import i18n from '../i18n'

/**
 * Confirmation prompt that is safe to use inside the Electron shell.
 *
 * `window.confirm` is intentionally avoided: after the synchronous native
 * dialog closes, the WebContents can no longer focus any input element
 * (electron/electron#19977) until the window is blurred and refocused. The
 * desktop build routes through Kun's asynchronous, Main-owned dialog,
 * which does not have that problem; `window.confirm` remains only as a
 * fallback for non-Electron contexts such as tests.
 */
export async function confirmDialog(message: string, detail?: string): Promise<boolean> {
  if (typeof window !== 'undefined' && typeof window.kunGui?.confirmDialog === 'function') {
    try {
      return await window.kunGui.confirmDialog({
        message,
        detail,
        confirmLabel: i18n.t('common:confirm'),
        cancelLabel: i18n.t('common:cancel')
      })
    } catch {
      // A failed app dialog is cancellation; do not reopen a system prompt.
      return false
    }
  }
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    return window.confirm(detail ? `${message}\n\n${detail}` : message)
  }
  return false
}
