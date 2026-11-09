import type { NativeImage } from 'electron'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type Ref
} from 'react'
import {
  startDesignHtmlPreviewWatch,
  type DesignPreviewRenderState
} from '../../design/design-preview-file'

const PREVIEW_FAST_POLL_MS = 6_000
const PREVIEW_MAX_WAIT_MS = 300_000

export type DesignHtmlPreviewSizingPolicy = 'fixedViewport' | 'autoHeight' | 'autoBoth'

export type DesignHtmlPreviewWebviewElement = HTMLElement & {
  executeJavaScript?: (code: string) => Promise<unknown>
  loadURL?: (url: string) => Promise<void>
  reload?: () => void
  getURL?: () => string
  isLoading?: () => boolean
  setZoomFactor?: (factor: number) => void
  capturePage?: () => Promise<NativeImage>
}

export type DesignHtmlPreviewState = {
  relativePath: string
  fileUrl: string
  revision: number
  renderState: DesignPreviewRenderState
  hasRenderableContent: boolean
  error: string
  ready: boolean
  webviewUrl: string
}

export type DesignHtmlPreviewRenderWebviewOptions = {
  className?: string
  style?: CSSProperties
  title?: string
  webpreferences?: string
  extraProps?: Record<string, unknown>
}

export type DesignHtmlPreviewHostRenderProps = {
  state: DesignHtmlPreviewState
  webview: DesignHtmlPreviewWebviewElement | null
  webviewMountNonce: number
  executeScript: (code: string) => Promise<unknown> | null
  renderWebview: (options?: DesignHtmlPreviewRenderWebviewOptions) => ReactElement | null
}

export type DesignHtmlPreviewHostProps = {
  workspaceRoot: string
  relativePath?: string
  enabled?: boolean
  partition: string
  zoom?: number
  retryMissingFile?: boolean
  webpreferences?: string
  /** See shouldRenderDesignHtmlPreviewWebview. Defaults to true. */
  mountWhileSkeleton?: boolean
  onError?: (message: string) => void
  onRevision?: (revision: number) => void
  onRenderStateChange?: (state: DesignPreviewRenderState) => void
  onWebviewReady?: (webview: DesignHtmlPreviewWebviewElement) => void
  children: (props: DesignHtmlPreviewHostRenderProps) => ReactNode
}

export type UseDesignHtmlPreviewOptions = Omit<DesignHtmlPreviewHostProps, 'children'>

export function shouldRenderDesignHtmlPreviewWebview({
  fileUrl,
  renderState,
  hasRenderableContent,
  mountWhileSkeleton = true
}: {
  fileUrl: string
  renderState: DesignPreviewRenderState
  hasRenderableContent: boolean
  /**
   * Surfaces that render their own generating placeholder (e.g. the canvas
   * screen frames' brush-sketch overlay) pass false so the skeleton HTML file
   * never paints; the webview then mounts only once real content exists.
   */
  mountWhileSkeleton?: boolean
}): boolean {
  if (!fileUrl) return false
  if (hasRenderableContent) return true
  return mountWhileSkeleton && renderState === 'skeleton'
}

export function designHtmlPreviewWebviewStyle(style?: CSSProperties): CSSProperties {
  // Preview documents own their palette. A transparent/default HTML page needs
  // browser-like white paper, not the workbench's dark surface showing through.
  // This only paints the host; authored backgrounds and text stay untouched.
  return { backgroundColor: '#ffffff', colorScheme: 'light', ...style }
}

export function designHtmlPreviewWebviewZoomFactor(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return 1
  return Math.min(4, Math.max(0.05, zoom))
}

export function executeDesignHtmlPreviewScript(
  webview: Pick<DesignHtmlPreviewWebviewElement, 'executeJavaScript'> | null | undefined,
  code: string
): Promise<unknown> | null {
  if (typeof webview?.executeJavaScript !== 'function') return null
  try {
    return webview.executeJavaScript(code).catch(() => null)
  } catch {
    // Electron throws synchronously when a <webview> exists but is not attached
    // and dom-ready yet. Guest script failures are normalized to null above so
    // callers do not leak GUEST_VIEW_MANAGER_CALL errors while frames churn.
    return null
  }
}

export function designHtmlPreviewUrl(fileUrl: string, revision: number): string {
  if (!fileUrl) return ''
  return `${fileUrl}${fileUrl.includes('?') ? '&' : '?'}rev=${revision}`
}

export function useDesignHtmlPreview({
  workspaceRoot,
  relativePath,
  enabled = true,
  partition,
  zoom,
  retryMissingFile = true,
  webpreferences = 'contextIsolation=yes,nodeIntegration=no,sandbox=yes',
  mountWhileSkeleton = true,
  onError,
  onRevision,
  onRenderStateChange,
  onWebviewReady
}: UseDesignHtmlPreviewOptions): DesignHtmlPreviewHostRenderProps {
  const webviewRef = useRef<DesignHtmlPreviewWebviewElement | null>(null)
  const webviewReadyRef = useRef(false)
  const loadedFileRef = useRef('')
  const lastLoadedRevisionRef = useRef(-1)
  const zoomRef = useRef(zoom)
  const [webviewMountNonce, setWebviewMountNonce] = useState(0)
  const [previewRelativePath, setPreviewRelativePath] = useState('')
  const [fileUrl, setFileUrl] = useState('')
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [renderState, setRenderState] = useState<DesignPreviewRenderState>('transient')
  const [hasRenderableContent, setHasRenderableContent] = useState(false)
  const [ready, setReady] = useState(false)

  const reportError = useCallback((message: string): void => {
    setError(message)
    onError?.(message)
  }, [onError])

  const setWebviewNode = useCallback((node: DesignHtmlPreviewWebviewElement | null): void => {
    webviewRef.current = node
    webviewReadyRef.current = false
    setReady(false)
    if (node) setWebviewMountNonce((value) => value + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    let cleanupWatch: (() => void) | null = null
    let retryTimer = 0
    const startedAt = Date.now()

    setFileUrl('')
    setPreviewRelativePath('')
    setRevision(0)
    setError('')
    setRenderState('transient')
    setHasRenderableContent(false)
    setReady(false)
    webviewReadyRef.current = false
    loadedFileRef.current = ''
    lastLoadedRevisionRef.current = -1

    const path = relativePath?.trim()
    if (!enabled || !workspaceRoot || !path) return
    if (typeof window.kunGui?.authorizeWritePrototype !== 'function') {
      reportError('Prototype preview is unavailable.')
      return
    }

    const tryAuthorize = (): void => {
      void window.kunGui
        .authorizeWritePrototype({ path, workspaceRoot })
        .then((res) => {
          if (cancelled) return
          if (res.ok) {
            setError('')
            setPreviewRelativePath(path)
            setFileUrl(res.fileUrl)
            cleanupWatch?.()
            cleanupWatch = startDesignHtmlPreviewWatch({
              workspaceRoot,
              path,
              onRevision: (nextRevision) => {
                if (cancelled) return
                setError('')
                setRevision(nextRevision)
                onRevision?.(nextRevision)
              },
              onPreviewStateChange: (nextState) => {
                if (cancelled) return
                setRenderState(nextState)
                onRenderStateChange?.(nextState)
                if (nextState === 'renderable') setHasRenderableContent(true)
              },
              onError: reportError
            })
            return
          }
          if (retryMissingFile && res.message === 'prototype file not found') {
            const elapsed = Date.now() - startedAt
            if (elapsed <= PREVIEW_MAX_WAIT_MS) {
              retryTimer = window.setTimeout(
                tryAuthorize,
                elapsed < PREVIEW_FAST_POLL_MS ? 250 : 2000
              )
            }
            return
          }
          reportError(res.message)
        })
        .catch((err: unknown) => {
          if (!cancelled) reportError(err instanceof Error ? err.message : String(err))
        })
    }

    tryAuthorize()

    return () => {
      cancelled = true
      if (retryTimer) window.clearTimeout(retryTimer)
      cleanupWatch?.()
    }
  }, [
    enabled,
    onRenderStateChange,
    onRevision,
    relativePath,
    reportError,
    retryMissingFile,
    workspaceRoot
  ])

  const webviewUrl = shouldRenderDesignHtmlPreviewWebview({
    fileUrl,
    renderState,
    hasRenderableContent,
    mountWhileSkeleton
  })
    ? designHtmlPreviewUrl(fileUrl, revision)
    : ''

  useEffect(() => {
    if (fileUrl !== loadedFileRef.current) {
      webviewReadyRef.current = false
      setReady(false)
      loadedFileRef.current = fileUrl
      lastLoadedRevisionRef.current = -1
    }
    const webview = webviewRef.current
    if (!webview || !webviewUrl) return
    const target = webviewUrl
    const navigate = (): void => {
      if (lastLoadedRevisionRef.current === revision) return
      lastLoadedRevisionRef.current = revision
      if (typeof webview.loadURL === 'function') {
        try {
          void webview.loadURL(target).catch(() => undefined)
        } catch {
          /* webview may detach while React is swapping canvas state */
        }
      } else if (typeof webview.reload === 'function') {
        try {
          webview.reload()
        } catch {
          /* webview may detach while React is swapping canvas state */
        }
      }
    }
    if (webviewReadyRef.current) {
      navigate()
      return
    }
    const onReady = (): void => {
      webviewReadyRef.current = true
      setReady(true)
      onWebviewReady?.(webview)
      navigate()
    }
    webview.addEventListener('dom-ready', onReady)
    return () => webview.removeEventListener('dom-ready', onReady)
  }, [fileUrl, onWebviewReady, revision, webviewMountNonce, webviewUrl])

  const applyZoomFactor = useCallback((): void => {
    const webview = webviewRef.current
    if (typeof zoomRef.current !== 'number' || typeof webview?.setZoomFactor !== 'function') return
    try {
      webview.setZoomFactor(designHtmlPreviewWebviewZoomFactor(zoomRef.current))
    } catch {
      /* webview may be mid-navigation/detached */
    }
  }, [])

  useEffect(() => {
    zoomRef.current = zoom
    if (typeof zoom !== 'number') return
    const timer = window.setTimeout(applyZoomFactor, 120)
    return () => window.clearTimeout(timer)
  }, [applyZoomFactor, zoom])

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview || !webviewUrl || typeof zoom !== 'number') return
    applyZoomFactor()
    webview.addEventListener('dom-ready', applyZoomFactor)
    return () => webview.removeEventListener('dom-ready', applyZoomFactor)
  }, [applyZoomFactor, webviewMountNonce, webviewUrl, zoom])

  const state = useMemo<DesignHtmlPreviewState>(() => ({
    relativePath: previewRelativePath,
    fileUrl,
    revision,
    renderState,
    hasRenderableContent,
    error,
    ready,
    webviewUrl
  }), [error, fileUrl, hasRenderableContent, previewRelativePath, ready, renderState, revision, webviewUrl])

  const executeScript = useCallback((code: string): Promise<unknown> | null => {
    return executeDesignHtmlPreviewScript(webviewRef.current, code)
  }, [])

  const renderWebview = useCallback((options: DesignHtmlPreviewRenderWebviewOptions = {}): ReactElement | null => {
    if (!state.webviewUrl) return null
    const mergedWebpreferences = options.webpreferences ?? webpreferences
    return (
      <webview
        key={state.fileUrl}
        ref={setWebviewNode as Ref<DesignHtmlPreviewWebviewElement>}
        src={state.fileUrl}
        partition={partition}
        webpreferences={mergedWebpreferences}
        className={options.className}
        style={designHtmlPreviewWebviewStyle(options.style)}
        title={options.title}
        {...(options.extraProps ?? {})}
      />
    )
  }, [partition, setWebviewNode, state.fileUrl, state.webviewUrl, webpreferences])

  return {
    state,
    webview: webviewRef.current,
    webviewMountNonce,
    executeScript,
    renderWebview
  }
}

export function DesignHtmlPreviewHost(props: DesignHtmlPreviewHostProps): ReactElement {
  const { children, ...options } = props
  const preview = useDesignHtmlPreview(options)
  return <>{children(preview)}</>
}
