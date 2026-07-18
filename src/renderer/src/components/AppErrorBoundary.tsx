import { Component, type ErrorInfo, type ReactNode } from 'react'
import i18n from '../i18n'

type Props = {
  children: ReactNode
}

type State = {
  error: Error | null
}

type AppReloadWindow = {
  kunGui?: {
    runDesktopCommand?: (command: 'reload') => Promise<void>
  }
  location: {
    reload: () => void
  }
}

export function requestApplicationReload(target: AppReloadWindow = window): void {
  const runDesktopCommand = target.kunGui?.runDesktopCommand
  if (typeof runDesktopCommand !== 'function') {
    target.location.reload()
    return
  }
  try {
    void runDesktopCommand('reload').catch(() => target.location.reload())
  } catch {
    target.location.reload()
  }
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[AppErrorBoundary] uncaught render error:', error, info.componentStack)
    if (typeof window !== 'undefined' && typeof window.kunGui?.logError === 'function') {
      void window.kunGui.logError('renderer', 'Uncaught render error', {
        name: error.name,
        message: error.message,
        stack: error.stack,
        componentStack: info.componentStack
      }).catch(() => undefined)
    }
  }

  private handleReload = (): void => {
    requestApplicationReload()
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
            {this.state.error.message || String(this.state.error)}
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-4 rounded-full bg-amber-900/10 px-5 py-2 text-[13px] font-medium text-amber-900 transition hover:bg-amber-900/20 dark:bg-amber-100/10 dark:text-amber-100 dark:hover:bg-amber-100/20"
          >
            {i18n.t('appErrorReload')}
          </button>
        </div>
      </div>
    )
  }
}
