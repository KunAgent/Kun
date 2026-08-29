import { useCallback, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Maximize2 } from 'lucide-react'
import type { DiagramPrototypeMetadata, ToolBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { useCodeCanvasDesignSurface } from '../../design/code-canvas-design-surface'
import { importConversationHtmlToDesignCanvas } from '../../design/conversation-html-canvas-import'
import { requestCodeCanvasPanelOpen } from '../../lib/code-canvas-panel-event'
import { DesignHtmlPreviewHost } from '../design/DesignHtmlPreviewHost'

const DIAGRAM_PATH_RE = /^\.kun-design\/diagram-prototypes\/[^/]+\/diagram\.html$/i

export function diagramPrototypeFromBlock(block: ToolBlock): DiagramPrototypeMetadata | null {
  const value = block.meta?.diagramPrototype
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const status = raw.status
  const relativePath = typeof raw.relativePath === 'string'
    ? raw.relativePath.trim().replaceAll('\\', '/')
    : ''
  const viewport = raw.viewport && typeof raw.viewport === 'object' && !Array.isArray(raw.viewport)
    ? raw.viewport as Record<string, unknown>
    : null
  if (raw.version !== 1 || (
    status !== 'preparing' && status !== 'running' && status !== 'completed' && status !== 'failed'
  )) return null
  if (!DIAGRAM_PATH_RE.test(relativePath) || relativePath.split('/').includes('..')) return null
  if (
    typeof viewport?.width !== 'number' || !Number.isInteger(viewport.width) || viewport.width < 280 || viewport.width > 1_200 ||
    typeof viewport.height !== 'number' || !Number.isInteger(viewport.height) || viewport.height < 240 || viewport.height > 900
  ) return null
  const artifactId = typeof raw.artifactId === 'string' ? raw.artifactId.trim() : ''
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (!artifactId || !title) return null
  return {
    version: 1,
    status,
    artifactId,
    title,
    relativePath,
    viewport: { width: viewport.width, height: viewport.height },
    ...(typeof raw.summary === 'string' && raw.summary.trim() ? { summary: raw.summary.trim() } : {}),
    ...(typeof raw.error === 'string' && raw.error.trim() ? { error: raw.error.trim() } : {})
  }
}

export function DiagramPrototypeCard({ block, workspaceRoot }: {
  block: ToolBlock
  workspaceRoot: string
}): ReactElement | null {
  const { t } = useTranslation('common')
  const diagram = useMemo(() => diagramPrototypeFromBlock(block), [block])
  const [previewFailed, setPreviewFailed] = useState(false)
  const [openingCanvas, setOpeningCanvas] = useState(false)
  const running = diagram?.status === 'preparing' || diagram?.status === 'running'
  const onPreviewError = useCallback(() => {
    if (!running) setPreviewFailed(true)
  }, [running])

  if (!diagram || diagram.status === 'failed' || block.status === 'error' || previewFailed) return null

  const openInCanvas = (): void => {
    if (running || openingCanvas || !workspaceRoot) return
    setOpeningCanvas(true)
    void importConversationHtmlToDesignCanvas({
      workspaceRoot,
      source: diagram,
      allowedPath: DIAGRAM_PATH_RE
    }).then((imported) => {
      const threadId = useChatStore.getState().activeThreadId
      if (!imported || !threadId) return
      useCodeCanvasDesignSurface.getState().showDesignDocument(threadId, workspaceRoot, imported.documentId)
      requestCodeCanvasPanelOpen()
    }).finally(() => setOpeningCanvas(false))
  }

  return (
    <article
      className="mx-auto min-w-0 max-w-full rounded-[11px] border border-ds-border bg-ds-card/95 shadow-[0_5px_18px_rgba(36,68,112,0.06)]"
      style={{ width: Math.min(1_200, diagram.viewport.width) }}
      data-diagram-prototype-id={diagram.artifactId}
    >
      <header className="flex h-9 items-center justify-between gap-2 rounded-t-[11px] border-b border-ds-border-muted px-3">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-[12.5px] font-semibold text-ds-ink">{diagram.title}</h3>
          <span
            className={`h-1.5 w-1.5 rounded-full ${running ? 'bg-amber-500' : 'bg-emerald-500'}`}
            aria-label={running ? t('diagramPrototypeRendering') : t('diagramPrototypeReady')}
          />
        </div>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-ds-muted hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-50"
          onClick={openInCanvas}
          disabled={running || openingCanvas || !workspaceRoot}
        >
          {openingCanvas ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Maximize2 className="h-3.5 w-3.5" />}
          {t('diagramPrototypeOpenCanvas')}
        </button>
      </header>
      <div className="overflow-hidden bg-white" style={{ height: diagram.viewport.height }}>
        <DesignHtmlPreviewHost
          workspaceRoot={workspaceRoot}
          relativePath={diagram.relativePath}
          enabled={Boolean(workspaceRoot)}
          partition={`kun-diagram-prototype-${block.id.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80)}`}
          retryMissingFile={running}
          mountWhileSkeleton
          onError={onPreviewError}
        >
          {({ state, renderWebview }) => state.webviewUrl
            ? renderWebview({
                className: 'h-full w-full border-0 bg-white',
                style: { height: '100%', width: '100%' },
                title: diagram.title
              })
            : (
              <div className="flex h-full items-center justify-center text-[11.5px] text-ds-muted">
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-accent" />
                {t('diagramPrototypeRendering')}
              </div>
            )}
        </DesignHtmlPreviewHost>
      </div>
    </article>
  )
}
