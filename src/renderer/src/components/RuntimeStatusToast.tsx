import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { KunRuntimeStatusPayload } from '@shared/kun-gui-api'
import { useChatStore } from '../store/chat-store'
import { usePublishedToast } from '../toast/use-published-toast'
import type { ToastInput } from '../toast/toast-types'

const TOAST_ID = 'runtime-status'

/**
 * Reports the runtime supervisor in the global dock: an automatic restart is
 * a sticky running card with its attempt count, a crash and a settings
 * rollback warn, and a restart that succeeded leaves a short success card.
 * Terminal failures stay out of the dock — the main error banner owns the
 * full diagnostics UI for those.
 */
export function RuntimeStatusToast(): null {
  const { t } = useTranslation('common')
  const status = useChatStore((state) => state.runtimeStatus)
  const previousState = useRef<KunRuntimeStatusPayload['state'] | null>(null)
  const [recovered, setRecovered] = useState(false)
  const state = status?.state ?? null

  useEffect(() => {
    const previous = previousState.current
    previousState.current = state
    if (previous === 'restarting' && state === 'running') setRecovered(true)
    else if (state !== 'running') setRecovered(false)
  }, [state])

  let input: ToastInput | null = null
  if (status?.state === 'restarting') {
    const max = status.maxAttempts ?? 3
    input = {
      id: TOAST_ID,
      tone: 'running',
      title: status.attempt === undefined
        ? t('runtimeStatusRestarting')
        : t('runtimeStatusRestartingAttempt', { attempt: status.attempt, max }),
      ...(status.message ? { description: status.message } : {}),
      ...(status.attempt === undefined ? {} : { badge: `${status.attempt}/${max}` }),
      durationMs: null,
      onDismiss: () => setRecovered(false)
    }
  } else if (status?.state === 'crashed') {
    input = {
      id: TOAST_ID,
      tone: 'warning',
      title: t('runtimeStatusCrashed'),
      ...(status.message ? { description: status.message } : {}),
      durationMs: null
    }
  } else if (status?.state === 'running' && status.rolledBack) {
    input = { id: TOAST_ID, tone: 'warning', title: t('runtimeStatusRolledBack'), durationMs: null }
  } else if (recovered) {
    input = {
      id: TOAST_ID,
      tone: 'success',
      title: t('runtimeStatusRecovered'),
      description: t('runtimeStatusRecoveredDetail'),
      onDismiss: () => setRecovered(false)
    }
  }

  usePublishedToast(input)
  return null
}
