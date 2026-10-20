import { useEffect, type ReactElement } from 'react'
import { AppWindow } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ensureAppSurfaceFlags, useAppSurfaceStore } from './app-surface-store'
import { GenUiSurface } from './gen-ui/GenUiSurface'
import { McpAppSurface } from './mcp-apps/McpAppSurface'

/**
 * Content of the App right-panel tab: an expanded Gen UI widget or an MCP App
 * surface (for example the editable canvas). It lives in the workbench right
 * panel, beside the conversation, so timeline scrolling never tears it down.
 */
export function AppSurfacePanelContent({
  onTitleChange
}: {
  onTitleChange: (title: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const panel = useAppSurfaceStore((state) => state.panel)
  const closePanel = useAppSurfaceStore((state) => state.closePanel)

  useEffect(() => { ensureAppSurfaceFlags() }, [])
  useEffect(() => {
    if (panel) onTitleChange(panel.title)
  }, [onTitleChange, panel])

  if (!panel) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-ds-sidebar px-6 text-center text-[12px] text-ds-muted">
        <AppWindow className="h-6 w-6 text-ds-faint" aria-hidden />
        {t('appSurfacePanelEmpty')}
      </div>
    )
  }
  const surfaceKey = panel.kind === 'gen-ui'
    ? `gen-ui:${panel.threadId}:${panel.widgetId}`
    : `mcp-app:${panel.threadId}:${panel.serverId}:${panel.resourceUri}`
  return (
    <div className="flex h-full min-h-0 flex-col bg-ds-main p-1.5" data-app-surface-panel={panel.kind}>
      {panel.kind === 'gen-ui' ? (
        <GenUiSurface key={surfaceKey} threadId={panel.threadId} widgetId={panel.widgetId} title={panel.title} fill />
      ) : (
        <McpAppSurface
          key={surfaceKey}
          threadId={panel.threadId}
          serverId={panel.serverId}
          resourceUri={panel.resourceUri}
          title={panel.title}
          displayMode="fullscreen"
          {...(panel.toolCall ? { toolCall: panel.toolCall } : {})}
          onRequestDisplayMode={(mode) => {
            if (mode === 'inline') closePanel()
            return mode
          }}
        />
      )}
    </div>
  )
}
