import type { ReactElement } from 'react'
import { useState } from 'react'
import { AlertCircle, ChevronDown, ChevronRight, Copy, FolderOpen, X } from 'lucide-react'

export function RuntimeBanner({
  message,
  detail,
  code,
  logPath,
  onOpenLogDir,
  onOpenSettings,
  onRetryConnection,
  runtimeReady,
  showSettingsAction = false,
  stageInsetClass,
  t
}: {
  message: string
  detail?: string | null
  code?: string | null
  logPath?: string | null
  onOpenLogDir?: () => Promise<{ ok: boolean; message?: string }>
  onOpenSettings: () => void
  onRetryConnection: () => void
  runtimeReady: boolean
  /** Keep a settings escape hatch for model/provider failures while runtime is still healthy. */
  showSettingsAction?: boolean
  stageInsetClass: string
  t: (key: string) => string
}): ReactElement | null {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [logOpenError, setLogOpenError] = useState<string | null>(null)
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const cleanedLogPath = logPath?.trim() ?? ''
  const errorIdentity = [message, detail, code, cleanedLogPath, runtimeReady].join('\n')
  const technicalDetailText = [
    code ? `Code: ${code}` : '',
    detail?.trim() ?? ''
  ].filter(Boolean).join('\n\n')
  const detailText = [
    technicalDetailText,
    cleanedLogPath ? `${t('runtimeErrorLogPath')}: ${cleanedLogPath}` : ''
  ].filter(Boolean).join('\n\n')
  const hasDetail = technicalDetailText.trim().length > 0
  const toastTitle = runtimeReady ? message : t('runtimeErrorHeroTitle')
  const toastMessage = runtimeReady ? null : message

  const copyDetails = async (): Promise<void> => {
    if (!hasDetail || !navigator?.clipboard?.writeText) return
    await navigator.clipboard.writeText(detailText)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  const openLogDir = async (): Promise<void> => {
    if (!onOpenLogDir) return
    setLogOpenError(null)
    try {
      const result = await onOpenLogDir()
      if (!result.ok) setLogOpenError(result.message ?? t('runtimeErrorOpenLogsFailed'))
    } catch (error) {
      setLogOpenError(error instanceof Error ? error.message : String(error))
    }
  }

  if (dismissedError === errorIdentity) return null

  return (
    <div
      className={`ds-no-drag pointer-events-none absolute inset-x-0 top-3 z-[70] ${stageInsetClass}`}
    >
      <div className="flex w-full justify-center px-3 sm:px-4">
        <section
          className="ds-runtime-error-toast pointer-events-auto relative flex w-full max-w-[680px] items-start gap-3 rounded-[14px] border border-[#e8e1d7] bg-white/[0.96] px-4 py-3 text-ds-ink shadow-[0_16px_42px_rgba(30,43,66,0.16)] backdrop-blur-xl dark:border-amber-800/45 dark:bg-[#211d18]/[0.96] dark:shadow-[0_20px_52px_rgba(0,0,0,0.42)]"
          role="alert"
          aria-live="assertive"
        >
          <AlertCircle
            className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
            strokeWidth={2}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0 flex-1 pr-7 sm:pr-0">
                <p className="text-[13.5px] font-semibold leading-5 text-[#2d2924] dark:text-amber-50">
                  {toastTitle}
                </p>
                {toastMessage ? (
                  <p className="mt-0.5 break-words text-[12.5px] leading-5 text-[#756d64] dark:text-amber-100/70">
                    {toastMessage}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5 pr-7 sm:flex-nowrap">
                {!runtimeReady ? (
                  <button
                    type="button"
                    className="rounded-lg border border-amber-300/80 bg-white px-3 py-1.5 text-[12px] font-semibold text-amber-950 transition hover:border-amber-400 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 dark:border-amber-700/70 dark:bg-amber-900/20 dark:text-amber-100 dark:hover:bg-amber-900/40"
                    onClick={onRetryConnection}
                  >
                    {t('retryConnection')}
                  </button>
                ) : null}
                {!runtimeReady || showSettingsAction ? (
                  <button
                    type="button"
                    className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-[#655b50] transition hover:bg-amber-50 hover:text-amber-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 dark:text-amber-100/85 dark:hover:bg-amber-900/30 dark:hover:text-amber-50"
                    onClick={onOpenSettings}
                  >
                    {t('openSettings')}
                  </button>
                ) : null}
              </div>
            </div>
            {hasDetail || (cleanedLogPath && onOpenLogDir) ? (
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] leading-5 text-[#8a8177] dark:text-amber-100/60">
                {hasDetail ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 transition hover:bg-amber-50 hover:text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 dark:hover:bg-amber-900/30 dark:hover:text-amber-100"
                    onClick={() => setDetailsOpen((value) => !value)}
                    aria-expanded={detailsOpen}
                  >
                    {detailsOpen ? (
                      <ChevronDown className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                    ) : (
                      <ChevronRight className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                    )}
                    {t('runtimeErrorDetails')}
                  </button>
                ) : null}
                {cleanedLogPath && onOpenLogDir ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded px-1 py-0.5 transition hover:bg-amber-50 hover:text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 dark:hover:bg-amber-900/30 dark:hover:text-amber-100"
                    onClick={() => void openLogDir()}
                  >
                    <FolderOpen className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                    {t('runtimeErrorViewLogs')}
                  </button>
                ) : null}
                {logOpenError ? (
                  <span className="text-red-700 dark:text-red-300">{logOpenError}</span>
                ) : null}
              </div>
            ) : null}
            {hasDetail && detailsOpen ? (
              <div className="mt-2 rounded-lg border border-amber-200/70 bg-amber-50/55 p-3 dark:border-amber-800/50 dark:bg-amber-950/25">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-[12px] font-semibold text-amber-950 dark:text-amber-100">
                    {t('runtimeErrorTechnicalDetails')}
                  </span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-amber-900/80 transition hover:bg-amber-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 dark:text-amber-100 dark:hover:bg-amber-900/40"
                    onClick={() => void copyDetails()}
                  >
                    <Copy className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                    {copied ? t('copySuccess') : t('copyDetails')}
                  </button>
                </div>
                <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-amber-950 dark:text-amber-100">
                  {detailText}
                </pre>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            aria-label={t('close')}
            className="absolute right-2.5 top-2.5 inline-flex rounded-md p-1 text-[#999087] transition hover:bg-amber-50 hover:text-amber-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 dark:text-amber-100/55 dark:hover:bg-amber-900/30 dark:hover:text-amber-100"
            onClick={() => setDismissedError(errorIdentity)}
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          </button>
        </section>
      </div>
    </div>
  )
}
