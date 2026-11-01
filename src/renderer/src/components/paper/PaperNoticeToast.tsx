import type { ReactElement } from 'react'
import { usePaperStore } from '../../write/paper/paper-store'
import { usePublishedToast } from '../../toast/use-published-toast'
import type { ToastAction, ToastInput } from '../../toast/toast-types'

const PAPER_NOTICE_MS = 6_000
/** Notices that offer Undo stay long enough to be used. */
const PAPER_NOTICE_ACTION_MS = 12_000

/**
 * Publishes `usePaperStore.notice` to the global dock on both Work surfaces.
 * Paper actions run from the library, discover view, onboarding, the sidebar
 * and the docs-surface "add to paper library" action, and session actions
 * offer Undo here, so the notice cannot live inside the reader-only paper bar.
 */
export function PaperNoticeToast(): ReactElement | null {
  const notice = usePaperStore((state) => state.notice)
  const clear = (): void => usePaperStore.getState().setNotice(null)

  let input: ToastInput | null = null
  if (notice) {
    const actions: ToastAction[] = []
    // Running a follow-up dismisses the notice first, as it always has.
    for (const followUp of [notice.action, notice.secondaryAction]) {
      if (!followUp) continue
      actions.push({ label: followUp.label, run: () => { clear(); followUp.run() } })
    }
    input = {
      id: 'paper',
      tone: notice.tone,
      title: notice.message,
      durationMs: actions.length ? PAPER_NOTICE_ACTION_MS : PAPER_NOTICE_MS,
      onDismiss: clear,
      ...(actions.length ? { actions } : {})
    }
  }

  usePublishedToast(input)
  return null
}
