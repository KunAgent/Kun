import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'

export const THREAD_HYDRATION_SLOW_MS = 15_000

export function ThreadHydrationGate({ loading, presentationKey = null, children }: {
  loading: boolean
  presentationKey?: string | null
  children: ReactNode
}): ReactElement {
  const [revealedKey, setRevealedKey] = useState<string | null>(() =>
    loading ? null : presentationKey
  )
  const committedKeyRef = useRef(presentationKey)
  const waitingForPaint = loading || Boolean(presentationKey && revealedKey !== presentationKey)

  useLayoutEffect(() => {
    const keyChanged = committedKeyRef.current !== presentationKey
    committedKeyRef.current = presentationKey
    if (!presentationKey) return
    if (loading || keyChanged) setRevealedKey(null)
    if (loading) return
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      setRevealedKey(presentationKey)
      return
    }
    let firstFrame: number | null = null
    let secondFrame: number | null = null
    firstFrame = window.requestAnimationFrame(() => {
      firstFrame = null
      secondFrame = window.requestAnimationFrame(() => {
        secondFrame = null
        setRevealedKey(presentationKey)
      })
    })
    return () => {
      if (firstFrame !== null) window.cancelAnimationFrame(firstFrame)
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame)
    }
  }, [loading, presentationKey])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        className={`flex min-h-0 flex-1 flex-col ${waitingForPaint ? 'pointer-events-none' : ''}`}
        aria-hidden={waitingForPaint || undefined}
        inert={waitingForPaint || undefined}
      >
        {children}
      </div>
      {waitingForPaint ? <ThreadHydrationLoading /> : null}
    </div>
  )
}

export function ThreadHydrationLoading(): ReactElement {
  const { t } = useTranslation('common')
  const activeThreadId = useChatStore((state) => state.activeThreadId)
  const recoverActiveTurn = useChatStore((state) => state.recoverActiveTurn)
  const [takingLong, setTakingLong] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => {
    setTakingLong(false)
    const timer = setTimeout(() => setTakingLong(true), THREAD_HYDRATION_SLOW_MS)
    return () => clearTimeout(timer)
  }, [activeThreadId, retryNonce])

  const retry = (): void => {
    setRetryNonce((value) => value + 1)
    void recoverActiveTurn?.()
  }

  return (
    <div
      data-testid="thread-hydration-loading"
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="pointer-events-auto absolute inset-0 z-20 flex min-h-[18rem] select-none items-center justify-center bg-white px-6 dark:bg-ds-main"
    >
      <div className="flex max-w-sm flex-col items-center text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-ds-border-muted bg-ds-card shadow-sm">
          <Loader2
            aria-hidden="true"
            className="h-5 w-5 animate-spin text-accent motion-reduce:animate-none"
            strokeWidth={2}
          />
        </div>
        <p className="mt-4 text-[14px] font-medium text-ds-ink">
          {t(takingLong ? 'threadHydrationTakingLongTitle' : 'threadHydrationLoadingTitle')}
        </p>
        <p className="mt-1.5 text-[12.5px] leading-5 text-ds-muted">
          {t(takingLong ? 'threadHydrationTakingLongDescription' : 'threadHydrationLoadingDescription')}
        </p>
        {takingLong && activeThreadId ? (
          <button
            type="button"
            data-testid="thread-hydration-retry"
            onClick={retry}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-ds-border px-3 py-1.5 text-[12.5px] font-medium text-ds-ink transition-colors hover:bg-ds-hover"
          >
            <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
            {t('threadHydrationRetry')}
          </button>
        ) : null}
      </div>
    </div>
  )
}
