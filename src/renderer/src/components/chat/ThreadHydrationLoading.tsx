import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import kunLogo from '../../../../asset/img/kun_bird.png'
import { useChatStore } from '../../store/chat-store'

export const THREAD_HYDRATION_SLOW_MS = 15_000

export function ThreadHydrationGate({
  loading,
  catchingUp = false,
  trustedContentVisible = false,
  presentationKey = null,
  children
}: {
  loading: boolean
  catchingUp?: boolean
  trustedContentVisible?: boolean
  presentationKey?: string | null
  children: ReactNode
}): ReactElement {
  const [revealedKey, setRevealedKey] = useState<string | null>(() =>
    loading ? null : presentationKey
  )
  const committedKeyRef = useRef(presentationKey)
  const waitingForPaint = !trustedContentVisible && (
    loading || Boolean(presentationKey && revealedKey !== presentationKey)
  )

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
      {!waitingForPaint && catchingUp ? <ThreadHydrationLoading compact /> : null}
    </div>
  )
}

export function ThreadHydrationLoading({ compact = false }: { compact?: boolean } = {}): ReactElement {
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
    void recoverActiveTurn?.({ reason: 'manual_retry' })
  }

  if (compact) {
    return (
      <div
        data-testid="thread-hydration-loading"
        role="status"
        aria-busy="true"
        aria-live="polite"
        className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-4"
      >
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-ds-border bg-ds-card/95 px-3 py-1.5 text-left shadow-sm backdrop-blur">
          <div className="flex h-5 w-5 items-center justify-center">
            <Loader2
              aria-hidden="true"
              className="h-3.5 w-3.5 animate-spin text-accent motion-reduce:animate-none"
              strokeWidth={2}
            />
          </div>
          <p className="text-[12px] font-medium text-ds-ink">
            {t(takingLong ? 'threadHydrationTakingLongTitle' : 'threadHydrationLoadingTitle')}
          </p>
          <p className="hidden">
            {t(takingLong ? 'threadHydrationTakingLongDescription' : 'threadHydrationLoadingDescription')}
          </p>
          {takingLong && activeThreadId ? (
            <button
              type="button"
              data-testid="thread-hydration-retry"
              onClick={retry}
              className="inline-flex items-center gap-1 rounded-full border border-ds-border px-2 py-0.5 text-[11px] font-medium text-ds-ink hover:bg-ds-hover"
            >
              <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
              {t('threadHydrationRetry')}
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div
      data-testid="thread-hydration-loading"
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="pointer-events-auto absolute inset-0 z-20 flex min-h-[18rem] select-none items-center justify-center bg-white px-6 dark:bg-ds-main"
    >
      <div className="flex flex-col items-center text-center">
        <img
          src={kunLogo}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="ds-thread-loading-logo"
        />
        <span className="sr-only">{t('threadHydrationLoadingTitle')}</span>
        <span className="sr-only">{t('threadHydrationLoadingDescription')}</span>
        {takingLong ? (
          <div className="ds-thread-loading-slow mt-6 flex flex-col items-center">
            <p className="text-[13px] font-medium text-ds-ink">{t('threadHydrationTakingLongTitle')}</p>
            <p className="mt-1.5 max-w-xs text-[12.5px] leading-5 text-ds-muted">
              {t('threadHydrationTakingLongDescription')}
            </p>
            {activeThreadId ? (
              <button
                type="button"
                data-testid="thread-hydration-retry"
                onClick={retry}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-ds-border px-3 py-1.5 text-[12.5px] font-medium text-ds-ink transition-colors hover:bg-ds-hover"
              >
                <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                {t('threadHydrationRetry')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
