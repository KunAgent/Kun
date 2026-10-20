import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import type { AppSandboxCreateResult, AppSandboxInstanceInfo } from '@shared/app-sandbox'
import { appSandboxApi } from './app-sandbox-client'

type WebviewElement = HTMLElement & { reload?: () => void }

export type AppSandboxFrameStatus =
  | { kind: 'opening' }
  | { kind: 'ready'; instance: AppSandboxInstanceInfo }
  | { kind: 'failed'; message: string }

/** Track the document light/dark mode so pages can be rebuilt with fresh colors. */
export function useDocumentThemeMode(): 'light' | 'dark' {
  const read = (): 'light' | 'dark' =>
    typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  const [mode, setMode] = useState(read)
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(() => setMode(read()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
    return () => observer.disconnect()
  }, [])
  return mode
}

/**
 * Hosts one sandbox instance in a `<webview>`. The instance is created when
 * the component mounts (or `generation` changes) and disposed on unmount;
 * the page never outlives the card or panel that shows it.
 */
export function AppSandboxFrame({
  create,
  generation,
  height,
  className,
  title,
  onStatus,
  renderFailure
}: {
  create: () => Promise<AppSandboxCreateResult>
  /** Change to rebuild the page (theme switch, retry). */
  generation: string
  height: number | string
  className?: string
  title: string
  onStatus?: (status: AppSandboxFrameStatus) => void
  renderFailure: (message: string, retry: () => void) => ReactNode
}): ReactElement {
  const [status, setStatus] = useState<AppSandboxFrameStatus>({ kind: 'opening' })
  const [retry, setRetry] = useState(0)
  const createRef = useRef(create)
  createRef.current = create
  const statusRef = useRef(onStatus)
  statusRef.current = onStatus
  const webviewRef = useRef<WebviewElement | null>(null)

  useEffect(() => {
    let disposed = false
    let opened: AppSandboxInstanceInfo | null = null
    const update = (next: AppSandboxFrameStatus): void => {
      setStatus(next)
      statusRef.current?.(next)
    }
    update({ kind: 'opening' })
    void createRef.current().then((result) => {
      if (!result.ok) {
        if (!disposed) update({ kind: 'failed', message: result.message })
        return
      }
      if (disposed) {
        void appSandboxApi()?.dispose(result.instance.instanceId)
        return
      }
      opened = result.instance
      update({ kind: 'ready', instance: result.instance })
    }).catch((error: unknown) => {
      if (!disposed) update({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
    })
    return () => {
      disposed = true
      if (opened) void appSandboxApi()?.dispose(opened.instanceId)
    }
  }, [generation, retry])

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview || status.kind !== 'ready') return
    const onGone = (): void => {
      setStatus({ kind: 'failed', message: 'The page stopped responding.' })
      statusRef.current?.({ kind: 'failed', message: 'The page stopped responding.' })
    }
    const onFail = (event: Event): void => {
      const failure = event as Event & { errorCode?: number; errorDescription?: string }
      if (failure.errorCode === -3) return
      onGone()
    }
    webview.addEventListener('render-process-gone', onGone)
    webview.addEventListener('did-fail-load', onFail)
    return () => {
      webview.removeEventListener('render-process-gone', onGone)
      webview.removeEventListener('did-fail-load', onFail)
    }
  }, [status])

  if (status.kind === 'failed') return <>{renderFailure(status.message, () => setRetry((value) => value + 1))}</>
  if (status.kind === 'opening') {
    return (
      <div
        className={`${className ?? ''} animate-pulse rounded-lg bg-ds-subtle`}
        style={{ height: typeof height === 'number' ? Math.min(height, 240) : 160 }}
        role="status"
        aria-label={title}
      />
    )
  }
  return (
    <webview
      key={status.instance.instanceId}
      ref={webviewRef as never}
      src={status.instance.src}
      partition={status.instance.partition}
      webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
      title={title}
      data-app-sandbox-instance={status.instance.instanceId}
      // Keep the webview's own flex display: Electron sizes the guest frame with it.
      className={`ds-no-drag flex w-full ${className ?? ''}`}
      style={{ height, background: 'transparent' }}
    />
  )
}
