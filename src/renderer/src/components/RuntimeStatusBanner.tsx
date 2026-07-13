import type { ReactElement } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Loader2, RefreshCw, WifiOff, X } from 'lucide-react'
import { useChatStore } from '../store/chat-store'

/**
 * Slim banner for transient runtime supervisor states (auto-restart in
 * progress, crash recovery, settings rollback). Terminal failures are
 * routed into the main error banner instead, which carries the full
 * diagnostics UI.
 */
export function RuntimeStatusBanner(): ReactElement | null {
  const { t } = useTranslation('common')
  const status = useChatStore((s) => s.runtimeStatus)
  const probeRuntime = useChatStore((s) => s.probeRuntime)
  const [dismissedAt, setDismissedAt] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  if (!status) return null
  const recoveredWithRollback = status.state === 'running' && status.rolledBack === true
  const transient = status.state === 'restarting' || status.state === 'crashed'
  const degraded = status.state === 'degraded'
  const disconnected = status.state === 'offline' || status.state === 'failed' || status.state === 'stopped'
  if (!transient && !degraded && !disconnected && !recoveredWithRollback) return null
  if (dismissedAt === status.at) return null
  const label = recoveredWithRollback
    ? t('runtimeStatusRolledBack')
    : status.state === 'degraded'
      ? t('runtimeStatusDegraded')
      : status.state === 'restarting'
      ? typeof status.attempt === 'number'
        ? t('runtimeStatusRestartingAttempt', {
            attempt: status.attempt,
            max: status.maxAttempts ?? 3
          })
        : t('runtimeStatusRestarting')
      : status.state === 'crashed'
        ? t('runtimeStatusCrashed')
        : status.state === 'offline'
          ? t('runtimeStatusOffline')
          : t('runtimeStatusFailed')
  const tone = recoveredWithRollback || disconnected || status.state === 'degraded' ? 'warning' : 'info'
  const bannerClass = recoveredWithRollback
    ? 'border-amber-200/70 bg-[rgba(255,248,235,0.82)] dark:border-amber-800/50 dark:bg-amber-950/35'
    : disconnected || status.state === 'degraded'
      ? 'border-amber-200/70 bg-[rgba(255,248,235,0.82)] dark:border-amber-800/50 dark:bg-amber-950/35'
      : 'border-sky-200/70 bg-[rgba(239,248,255,0.82)] dark:border-sky-900/60 dark:bg-sky-950/30'
  const iconClass = recoveredWithRollback
    ? 'text-amber-700 dark:text-amber-300'
    : disconnected || status.state === 'degraded'
      ? 'text-amber-700 dark:text-amber-300'
      : 'text-sky-700 dark:text-sky-300'
  const textClass = recoveredWithRollback
    ? 'text-amber-950 dark:text-amber-100'
    : disconnected || status.state === 'degraded'
      ? 'text-amber-950 dark:text-amber-100'
      : 'text-sky-950 dark:text-sky-100'
  const retry = async (): Promise<void> => {
    if (retrying) return
    setRetrying(true)
    try {
      await probeRuntime('user', { restart: true })
    } finally {
      setRetrying(false)
    }
  }
  return (
    <div
      className={`ds-no-drag shrink-0 border-b backdrop-blur-lg ${bannerClass}`}
      data-variant={tone}
      role={recoveredWithRollback || disconnected ? 'alert' : 'status'}
    >
      <div className="flex w-full min-w-0 items-center gap-2 px-4 py-1.5">
        {recoveredWithRollback || degraded ? (
          <AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${iconClass}`} strokeWidth={2} />
        ) : disconnected ? (
          <WifiOff className={`h-3.5 w-3.5 shrink-0 ${iconClass}`} strokeWidth={2} />
        ) : (
          <Loader2
            className={`h-3.5 w-3.5 shrink-0 ${transient ? 'animate-spin' : ''} ${iconClass}`}
            strokeWidth={2}
          />
        )}
        <p
          className={`min-w-0 flex-1 truncate text-[12.5px] leading-5 ${textClass}`}
          title={status.message ?? label}
        >
          {label}
        </p>
        {disconnected ? (
          <button
            type="button"
            aria-label={t('retryConnection')}
            disabled={retrying}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-300/70 bg-white/80 px-2.5 py-1 text-[12px] font-medium text-amber-900/85 transition hover:bg-amber-100/70 disabled:cursor-wait disabled:opacity-60 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-100 dark:hover:bg-amber-900/40"
            onClick={() => void retry()}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} strokeWidth={2} />
            {t('retryConnection')}
          </button>
        ) : null}
        {recoveredWithRollback ? (
          <button
            type="button"
            aria-label={t('runtimeStatusDismiss')}
            className="inline-flex shrink-0 items-center rounded-md p-1 text-amber-900/70 transition hover:bg-amber-100/70 dark:text-amber-100/80 dark:hover:bg-amber-900/40"
            onClick={() => setDismissedAt(status.at)}
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        ) : null}
      </div>
    </div>
  )
}
