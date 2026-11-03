import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AppSandboxInstanceInfo, AppSandboxTheme } from '@shared/app-sandbox'
import { appSandboxApi, resolveAppSandboxTheme } from '../app-sandbox-client'
import { AppSandboxFrame, useDocumentThemeMode, type AppSandboxFrameStatus } from '../AppSandboxFrame'
import type { McpAppToolCallSnapshot } from '../app-surface-store'
import { attachMcpAppPageHost, type McpAppDisplayMode, type McpAppPageHost } from './mcp-app-page-host'

const INITIAL_HEIGHT = 240
const MIN_HEIGHT = 80
const MAX_HEIGHT = 1_200

/** One live MCP App page bound to a thread, server and `ui://` resource. */
export function McpAppSurface({
  threadId,
  serverId,
  resourceUri,
  title,
  displayMode,
  toolCall,
  onRequestDisplayMode,
  onInstance
}: {
  threadId: string
  serverId: string
  resourceUri: string
  title: string
  displayMode: McpAppDisplayMode
  toolCall?: McpAppToolCallSnapshot
  onRequestDisplayMode: (mode: McpAppDisplayMode) => McpAppDisplayMode
  onInstance?: (instance: AppSandboxInstanceInfo | null) => void
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const themeMode = useDocumentThemeMode()
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const themeRef = useRef<AppSandboxTheme | null>(null)
  const [height, setHeight] = useState(INITIAL_HEIGHT)
  const [instance, setInstance] = useState<AppSandboxInstanceInfo | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const onInstanceRef = useRef(onInstance)
  onInstanceRef.current = onInstance
  const displayModeRef = useRef(onRequestDisplayMode)
  displayModeRef.current = onRequestDisplayMode
  const toolCallRef = useRef(toolCall)
  toolCallRef.current = toolCall
  // The page connects once per instance; later title changes must not rebuild its bridge.
  const titleRef = useRef(title)
  titleRef.current = title
  const hostRef = useRef<McpAppPageHost | null>(null)
  const deliveredCallRef = useRef<McpAppToolCallSnapshot | undefined>(toolCall)
  const fill = displayMode === 'fullscreen'

  const create = useCallback(() => {
    const api = appSandboxApi()
    if (!api) return Promise.resolve({ ok: false as const, code: 'UNAVAILABLE', message: t('appSurfaceDesktopOnly') })
    const theme = resolveAppSandboxTheme(anchorRef.current, i18n.language)
    themeRef.current = theme
    return api.createMcpApp({ threadId, serverId, resourceUri, theme })
  }, [i18n.language, resourceUri, serverId, t, threadId])

  const onStatus = useCallback((status: AppSandboxFrameStatus) => {
    const next = status.kind === 'ready' ? status.instance : null
    setInstance(next)
    onInstanceRef.current?.(next)
    if (status.kind !== 'ready') setPageError(null)
  }, [])

  useEffect(() => {
    if (!instance || !themeRef.current) return
    deliveredCallRef.current = toolCallRef.current
    const host = attachMcpAppPageHost({
      instanceId: instance.instanceId,
      threadId,
      serverId,
      title: titleRef.current,
      theme: themeRef.current,
      displayMode,
      ...(toolCallRef.current ? { toolCall: toolCallRef.current } : {}),
      onHeight: (next) => setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(next)))),
      onRequestDisplayMode: (mode) => displayModeRef.current(mode),
      onPageError: setPageError
    })
    hostRef.current = host
    return () => {
      hostRef.current = null
      host.dispose()
    }
  }, [displayMode, instance, serverId, threadId])

  useEffect(() => {
    if (!toolCall || !hostRef.current || deliveredCallRef.current === toolCall) return
    deliveredCallRef.current = toolCall
    hostRef.current.pushToolCall(toolCall)
  }, [toolCall])

  return (
    <div ref={anchorRef} className={fill ? 'flex h-full min-h-0 flex-col' : 'relative'}>
      <AppSandboxFrame
        create={create}
        generation={`${serverId}:${resourceUri}:${themeMode}`}
        height={fill ? '100%' : height}
        className={fill ? 'min-h-0 flex-1' : 'rounded-lg'}
        title={title}
        onStatus={onStatus}
        renderFailure={(message, retry) => (
          <div role="alert" className="flex items-center gap-2 rounded-lg border border-ds-border-muted bg-ds-subtle px-3 py-2 text-[12px] text-ds-muted">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{message}</span>
            <button type="button" onClick={retry} className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-ds-ink hover:bg-ds-hover">
              <RotateCw className="h-3 w-3" aria-hidden />
              {t('appSurfaceRetry')}
            </button>
          </div>
        )}
      />
      {pageError ? (
        <div className="mt-1 truncate text-[11px] text-amber-600 dark:text-amber-300" title={pageError}>
          {t('appSurfacePageError', { message: pageError })}
        </div>
      ) : null}
    </div>
  )
}
