import type { ReactElement } from 'react'
import { usePublishedToast } from '../../toast/use-published-toast'
import type { ToastInput } from '../../toast/toast-types'
import { WRITE_EXPORT_NOTICE_MS, type WriteNotice } from './write-workspace-view-utils'

/**
 * Publishes the export result to the global dock. It used to be a pill
 * floating over the editor, so a slow export's result was lost as soon as the
 * user left the document; the dock survives that. The countdown matches
 * `WRITE_EXPORT_NOTICE_MS`, the delay the write surface already uses to clear
 * `exportNotice`, so both reach the same end.
 */
export function WriteExportToast({ notice, onDismiss }: {
  notice: WriteNotice | null
  onDismiss: () => void
}): ReactElement | null {
  const input: ToastInput | null = notice
    ? { id: 'write-export', tone: notice.tone, title: notice.message, durationMs: WRITE_EXPORT_NOTICE_MS, onDismiss }
    : null
  usePublishedToast(input)
  return null
}
