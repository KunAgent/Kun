import { useEffect, useMemo, type ReactElement } from 'react'
import { AppWindow, Maximize2, PanelRightOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ToolBlock } from '../../agent/types'
import { mcpAppArgumentsFromBlock, mcpAppFromBlock } from '../app-surface-tool-meta'
import { useAppSurfaceStore, type AppSurfacePanel } from '../app-surface-store'
import { McpAppSurface } from './McpAppSurface'

/** Fullscreen/surface results only auto-open the App panel while they are fresh. */
const AUTO_OPEN_WINDOW_MS = 120_000

export function mcpAppTitle(serverId: string, toolName: string): string {
  return `${serverId} · ${toolName}`
}

/** Panel pages are shared by every tool of one surface, so their title names the surface. */
export function mcpAppPanelTitle(serverId: string, surface: string | undefined, toolName: string): string {
  return `${serverId} · ${surface ?? toolName}`
}

export function McpAppCard({ threadId, block }: { threadId: string; block: ToolBlock }): ReactElement | null {
  const { t } = useTranslation('common')
  const openPanel = useAppSurfaceStore((state) => state.openPanel)
  const consumeFullscreen = useAppSurfaceStore((state) => state.consumeFullscreen)
  const app = useMemo(() => mcpAppFromBlock(block), [block])
  const args = useMemo(() => mcpAppArgumentsFromBlock(block), [block])

  const panel = useMemo((): AppSurfacePanel | null => app ? {
    kind: 'mcp-app',
    key: `mcp-app:${threadId}:${block.id}`,
    threadId,
    serverId: app.serverId,
    resourceUri: app.resourceUri,
    title: mcpAppPanelTitle(app.serverId, app.surface, app.toolName),
    toolCall: {
      toolName: app.toolName,
      arguments: args,
      ...(app.result ? { result: app.result } : {})
    }
  } : null, [app, args, block.id, threadId])

  const prefersPanel = Boolean(app?.surface) || app?.preferredDisplayMode === 'fullscreen'

  useEffect(() => {
    if (!panel || !prefersPanel) return
    const created = block.createdAt ? Date.parse(block.createdAt) : Number.NaN
    if (!Number.isFinite(created) || Date.now() - created > AUTO_OPEN_WINDOW_MS) return
    if (consumeFullscreen(panel.key)) openPanel(panel)
  }, [block.createdAt, consumeFullscreen, openPanel, panel, prefersPanel])

  if (!app || !panel) return null
  if (prefersPanel) {
    return (
      <button
        type="button"
        onClick={() => openPanel(panel)}
        className="my-2 flex w-full items-center gap-2 rounded-lg border border-ds-border-muted bg-ds-subtle px-3 py-2 text-left text-[12px] text-ds-muted hover:bg-ds-hover"
      >
        <PanelRightOpen className="h-4 w-4 shrink-0 text-ds-faint" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-ds-ink">{mcpAppTitle(app.serverId, app.toolName)}</span>
          <span className="ml-2">{t('appSurfaceOpenInPanel')}</span>
        </span>
      </button>
    )
  }
  return (
    <section className="group/mcp-app my-2 w-full" aria-label={panel.title} data-mcp-app-server={app.serverId}>
      <header className="mb-1 flex items-center gap-1.5 text-[12px] text-ds-muted">
        <AppWindow className="h-3.5 w-3.5 shrink-0 text-ds-faint" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-medium text-ds-ink">{mcpAppTitle(app.serverId, app.toolName)}</span>
        <button
          type="button"
          onClick={() => openPanel(panel)}
          className="rounded-md p-1 text-ds-faint opacity-0 transition hover:bg-ds-hover hover:text-ds-ink focus-visible:opacity-100 group-hover/mcp-app:opacity-100"
          aria-label={t('appSurfaceExpand')}
          title={t('appSurfaceExpand')}
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </header>
      <McpAppSurface
        threadId={threadId}
        serverId={app.serverId}
        resourceUri={app.resourceUri}
        title={panel.title}
        displayMode="inline"
        toolCall={panel.kind === 'mcp-app' ? panel.toolCall : undefined}
        onRequestDisplayMode={(mode) => {
          if (mode === 'fullscreen') openPanel(panel)
          return 'inline'
        }}
      />
    </section>
  )
}
