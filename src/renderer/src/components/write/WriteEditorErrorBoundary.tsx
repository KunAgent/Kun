import { Component, type ErrorInfo, type ReactNode } from 'react'
import i18n from 'i18next'

type Props = {
  /** Changes when the open document changes, so the next file starts clean. */
  resetKey: string
  children: ReactNode
}

type State = {
  error: Error | null
  attempt: number
}

/**
 * Keeps an editor failure inside the editor pane: the rest of the workbench
 * stays usable and the document (held by the workspace store, not the
 * editor) is re-mounted on retry instead of reloading the whole app.
 */
export class WriteEditorErrorBoundary extends Component<Props, State> {
  state: State = { error: null, attempt: 0 }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[WriteEditorErrorBoundary] editor render error:', error, info.componentStack)
    if (typeof window !== 'undefined' && typeof window.kunGui?.logError === 'function') {
      void window.kunGui.logError('renderer', 'Write editor render error', {
        name: error.name,
        // The message can quote document text; keep only its leading shape.
        message: error.message.replace(/\(.*\)\s*$/s, '(...)'),
        stack: error.stack,
        componentStack: info.componentStack
      }).catch(() => undefined)
    }
  }

  override componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  private retry = (): void => {
    this.setState((state) => ({ error: null, attempt: state.attempt + 1 }))
  }

  override render(): ReactNode {
    if (!this.state.error) {
      return <div key={this.state.attempt} className="h-full min-h-0 w-full min-w-0">{this.props.children}</div>
    }
    return (
      <div role="alert" className="flex h-full min-h-0 flex-col items-center justify-center px-6 text-center">
        <h2 className="text-[15px] font-semibold text-ds-ink">{i18n.t('appErrorTitle')}</h2>
        <p className="mt-2 max-w-md text-[13px] leading-5 text-ds-muted">{i18n.t('writeEditorErrorHint')}</p>
        <button
          type="button"
          onClick={this.retry}
          className="mt-4 rounded-full bg-ds-surface-hover px-5 py-2 text-[13px] font-medium text-ds-ink"
        >
          {i18n.t('writeEditorErrorRetry')}
        </button>
      </div>
    )
  }
}
