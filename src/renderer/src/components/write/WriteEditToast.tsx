import { useRef, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { modifierLabel } from './selection-menu/shortcut-label'
import { usePublishedToast } from '../../toast/use-published-toast'
import type { ToastInput } from '../../toast/toast-types'

/** Kept from the inline pill: the undo card clears itself after 6s. */
const WRITE_EDIT_MS = 6_000

/**
 * Publishes the "edit applied" undo card. It used to be a pill floating over
 * the caret; it now uses the same dock as every other notification, and
 * hovering or focusing it still pauses the countdown.
 */
export function WriteEditToast({ onUndo, onDismiss }: {
  onUndo: () => void
  onDismiss: () => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  // The card outlives this render, so both callbacks are read through a ref.
  const callbacks = useRef({ onUndo, onDismiss })
  callbacks.current = { onUndo, onDismiss }
  const input: ToastInput = {
    id: 'write-selection-edit',
    tone: 'success',
    title: t('writeEditAppliedToast'),
    durationMs: WRITE_EDIT_MS,
    onDismiss: () => callbacks.current.onDismiss(),
    actions: [{ label: t('writeEditUndo'), run: () => callbacks.current.onUndo(), shortcut: `${modifierLabel()}Z` }]
  }
  usePublishedToast(input)
  return null
}
