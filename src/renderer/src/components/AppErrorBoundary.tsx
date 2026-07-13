import { Component, type ErrorInfo, type ReactNode } from 'react'
import i18n from '../i18n'
import { redactSecretText } from '@shared/secret-redaction'

const MAX_LOG_TEXT = 4_000

function boundedRedactedText(value: unknown, maxLength = MAX_LOG_TEXT): string {
  const text = redactSecretText(String(value ?? ''))
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

function createErrorId(): string {
  const randomUuid = globalThis.crypto?.randomUUID
  if (typeof randomUuid === 'function') return randomUuid.call(globalThis.crypto)
  return `renderer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

type Props = {
  children: ReactNode
}

type State = {
  error: Error | null
  errorId: string | null
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorId: null }

  static getDerivedStateFromError(error: Error): State {
    return { error, errorId: createErrorId() }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const errorId = this.state.errorId ?? createErrorId()
    const detail = {
      errorId,
      name: boundedRedactedText(error.name, 128),
      message: boundedRedactedText(error.message, 1_024),
      stack: boundedRedactedText(error.stack),
      componentStack: boundedRedactedText(info.componentStack)
    }
    console.error('[AppErrorBoundary] uncaught render error', detail)
    if (typeof window !== 'undefined' && typeof window.kunGui?.logError === 'function') {
      void window.kunGui.logError('renderer', 'Uncaught render error', detail).catch(() => undefined)
    }
  }

  private handleReload = (): void => {
    if (typeof window.kunGui?.runDesktopCommand === 'function') {
      void window.kunGui.runDesktopCommand('reload').catch(() => window.location.reload())
      return
    }
    window.location.reload()
  }

  private handleCopyErrorId = (): void => {
    const errorId = this.state.errorId
    if (!errorId || typeof navigator?.clipboard?.writeText !== 'function') return
    void navigator.clipboard.writeText(errorId).catch(() => undefined)
  }

  private handleOpenLogs = (): void => {
    if (typeof window.kunGui?.openLogDir !== 'function') return
    void window.kunGui.openLogDir().catch(() => undefined)
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center bg-ds-main px-6">
        <div className="w-full max-w-md rounded-2xl border border-amber-200/80 bg-amber-50/90 p-6 text-center shadow-[0_14px_32px_rgba(20,47,95,0.08)] dark:border-amber-800/60 dark:bg-amber-950/35">
          <h2 className="text-[16px] font-semibold text-amber-900 dark:text-amber-100">
            {i18n.t('appErrorTitle')}
          </h2>
          <p className="mt-2 text-[13px] leading-5 text-amber-800/80 dark:text-amber-100/80">
            {i18n.t('appErrorDescription')}
          </p>
          {this.state.errorId ? (
            <p className="mt-2 break-all font-mono text-[11px] text-amber-800/70 dark:text-amber-100/70">
              {i18n.t('appErrorId', { id: this.state.errorId })}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-full bg-amber-900/10 px-5 py-2 text-[13px] font-medium text-amber-900 transition hover:bg-amber-900/20 dark:bg-amber-100/10 dark:text-amber-100 dark:hover:bg-amber-100/20"
            >
              {i18n.t('appErrorReload')}
            </button>
            <button
              type="button"
              onClick={this.handleCopyErrorId}
              className="rounded-full border border-amber-900/15 px-4 py-2 text-[13px] font-medium text-amber-900 transition hover:bg-amber-900/10 dark:border-amber-100/20 dark:text-amber-100 dark:hover:bg-amber-100/10"
            >
              {i18n.t('appErrorCopyId')}
            </button>
            <button
              type="button"
              onClick={this.handleOpenLogs}
              disabled={typeof window.kunGui?.openLogDir !== 'function'}
              className="rounded-full border border-amber-900/15 px-4 py-2 text-[13px] font-medium text-amber-900 transition hover:bg-amber-900/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-100/20 dark:text-amber-100 dark:hover:bg-amber-100/10"
            >
              {i18n.t('appErrorOpenLogs')}
            </button>
          </div>
        </div>
      </div>
    )
  }
}
