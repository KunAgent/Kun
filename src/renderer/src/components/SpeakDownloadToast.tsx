import { useCallback, useEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Download, Square, X } from 'lucide-react'
import { useSpeakStore } from '../stores/speak-store'
import { stopSpeaking } from './chat/speak-controller'
import { speakErrorLabel } from './chat/AssistantSpeakButton'
import { formatBytes, formatTransferRate } from './settings-section-speech-to-text-support'

/** How long a failure stays on screen before it clears itself. */
const ERROR_DISMISS_MS = 8_000

/**
 * Floating progress card for the first Speak on a fresh install, when the
 * Kokoro weights still have to be downloaded. It also surfaces Speak failures,
 * which would otherwise only appear as a tooltip on a hover-only action.
 */
export function SpeakDownloadToast(): ReactElement | null {
  const { t } = useTranslation('common')
  const phase = useSpeakStore((state) => state.phase)
  const download = useSpeakStore((state) => state.download)
  const error = useSpeakStore((state) => state.error ?? state.recordingNotice)
  const clearError = useCallback(() => {
    useSpeakStore.getState().clearError()
    useSpeakStore.getState().setRecordingNotice(null)
  }, [])

  useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(() => clearError(), ERROR_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [clearError, error])

  if (!download && !error) {
    if (phase === 'idle') return null
    return (
      <div role="status" className="fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-xl border border-ds-border bg-ds-card px-3 py-2 shadow-lg">
        <span>{t(phase === 'speaking' ? 'speakAnswer' : 'speakPreparing')}</span>
        <button type="button" onClick={stopSpeaking} aria-label={t('speakStop')} className="flex items-center gap-1 text-accent">
          <Square className="h-4 w-4" />{t('speakStop')}
        </button>
      </div>
    )
  }

  if (!download && error) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="speak-error-toast"
        className="pointer-events-auto fixed bottom-5 right-5 z-50 flex max-w-sm items-start gap-2.5 rounded-2xl border border-amber-300/70 bg-ds-card px-3.5 py-3 text-[12.5px] text-ds-ink shadow-[0_18px_44px_rgba(16,24,40,0.18)] dark:border-amber-800/60"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
        <span className="min-w-0 flex-1 leading-5">{speakErrorLabel(t, error)}</span>
        {phase !== 'idle' ? <button type="button" onClick={stopSpeaking} aria-label={t('speakStop')}><Square className="h-4 w-4" /></button> : null}
        <button
          type="button"
          onClick={() => clearError()}
          title={t('close')}
          aria-label={t('close')}
          className="shrink-0 rounded-md p-0.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.9} />
        </button>
      </div>
    )
  }

  if (!download) return null
  const percent = download.percent ?? (download.totalBytes
    ? Math.min(100, (download.downloadedBytes / download.totalBytes) * 100)
    : 0)
  const title = download.asset === 'voice'
    ? t('speakDownloadingVoice', { voice: download.label })
    : t('speakDownloadingModel', { model: download.label })
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="speak-download-toast"
      className="pointer-events-auto fixed bottom-5 right-5 z-50 w-[min(24rem,calc(100vw-2.5rem))] rounded-2xl border border-ds-border bg-ds-card px-3.5 py-3 text-[12.5px] text-ds-ink shadow-[0_18px_44px_rgba(16,24,40,0.18)]"
    >
      <div className="flex items-start gap-2.5">
        <Download className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium leading-5">{title}</p>
          <p className="mt-0.5 text-[11.5px] text-ds-muted">{t('speakDownloadingHint')}</p>
        </div>
        <button
          type="button"
          onClick={() => stopSpeaking()}
          title={t('cancel')}
          aria-label={t('cancel')}
          className="shrink-0 rounded-md p-0.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.9} />
        </button>
      </div>
      <div
        className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-ds-subtle"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-200"
          style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] tabular-nums text-ds-muted">
        <span>
          {/* formatBytes yields an empty string at zero, which would render a bare slash. */}
          {formatBytes(download.downloadedBytes) || '0 MB'}
          {download.totalBytes ? ` / ${formatBytes(download.totalBytes)}` : ''}
        </span>
        <span>{formatTransferRate(download.speedBytesPerSecond, `${Math.round(percent)}%`)}</span>
      </div>
    </div>
  )
}
