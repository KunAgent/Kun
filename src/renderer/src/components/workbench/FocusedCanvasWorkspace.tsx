import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { displayDrawingTitle } from '../../design/design-drawing-title'
import { CodeCanvasPanel } from '../design/canvas/CodeCanvasPanel'
import { DesignCanvasConversationOverlay } from '../design/DesignCanvasConversationOverlay'
import type { DesignCanvasConversationOverlayConversationProps } from '../design/DesignCanvasConversationOverlay'
import type { CodeCanvasPanelProps } from './useWorkbenchRightPanelElement'

type Props = {
  canvas: CodeCanvasPanelProps
  conversation: DesignCanvasConversationOverlayConversationProps
  onClearHistory: () => void | Promise<void>
  onNewConversation: () => void | Promise<void>
  onExitFocus: () => void
  leftSidebarCollapsed?: boolean
  onToggleLeftSidebar?: () => void
}

/**
 * Focused whiteboard presentation: the canvas moves from the right rail to
 * the stage while reusing the same document, viewport, and selection stores.
 * The conversation overlay renders the primary design conversation, not a
 * parallel branch.
 */
export function FocusedCanvasWorkspace({
  canvas,
  conversation,
  onClearHistory,
  onNewConversation,
  onExitFocus,
  leftSidebarCollapsed = false,
  onToggleLeftSidebar
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [hostBounds, setHostBounds] = useState({ width: 1280, height: 800 })
  const designDocumentId = canvas.designDocumentId ?? null
  const designWorkspaceRoot = normalizeDesignWorkspaceRootRoot(canvas.workspaceRoot)
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const designRunning = useChatStore((s) => s.busy)
  const designDocuments = useDesignWorkspaceStore((s) => s.documents)
  const drawingTitle = designDocumentId
    ? (() => {
        const drawing = designDocuments.find((document) => document.id === designDocumentId)
        return drawing ? displayDrawingTitle(drawing, t('designUntitledDrawing')) : t('designRailTitle')
      })()
    : t('designRailTitle')

  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(() => {
      const rect = host.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        setHostBounds({ width: Math.round(rect.width), height: Math.round(rect.height) })
      }
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const exitOnEscape = useCallback(
    (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // Menu/panel-level Escape handling happens in their own components
      // first; this listener only runs when nothing else consumed the key.
      if (event.defaultPrevented) return
      onExitFocus()
    },
    [onExitFocus]
  )

  useEffect(() => {
    window.addEventListener('keydown', exitOnEscape)
    return () => window.removeEventListener('keydown', exitOnEscape)
  }, [exitOnEscape])

  const running = designRunning && conversation.activeThreadId === activeThreadId

  return (
    <div
      ref={hostRef}
      className="ds-no-drag absolute inset-0 z-30 flex min-h-0 min-w-0 flex-col overflow-hidden bg-ds-main"
      data-focused-canvas-workspace
    >
      <CodeCanvasPanel
        {...canvas}
        presentation="focused"
        onExitFocus={onExitFocus}
        leftSidebarCollapsed={leftSidebarCollapsed}
        onToggleLeftSidebar={onToggleLeftSidebar}
        sidebarExpandLabel={t('sidebarExpand')}
        sidebarCollapseLabel={t('sidebarCollapse')}
        className="h-full max-h-full w-full flex-1 border-l-0"
      />
      <DesignCanvasConversationOverlay
        hostBounds={hostBounds}
        workspaceRoot={designWorkspaceRoot}
        documentId={designDocumentId}
        drawingTitle={drawingTitle}
        running={running}
        conversation={conversation}
        onClearHistory={onClearHistory}
        onNewConversation={onNewConversation}
      />
    </div>
  )
}

function normalizeDesignWorkspaceRootRoot(workspaceRoot: string): string {
  return normalizeWorkspaceRoot(workspaceRoot) || workspaceRoot
}
