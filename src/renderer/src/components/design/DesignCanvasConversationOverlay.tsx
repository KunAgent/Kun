import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement
} from 'react'
import { GripVertical, MessageCircleMore, Minus, PanelTop, Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  DesignConversationContent,
  DesignConversationHistoryHeader
} from './DesignConversationContent'
import {
  CANVAS_CONVERSATION_EDGE_MARGIN,
  CANVAS_CONVERSATION_TOP_MARGIN,
  canvasConversationLayoutKey,
  canvasConversationPanelSize,
  canvasConversationResponsiveMode,
  clampCanvasConversationLayout,
  defaultCanvasConversationLayout,
  readCanvasConversationLayout,
  readCanvasConversationTopInset,
  writeCanvasConversationLayout,
  type CanvasConversationLayout
} from './design-canvas-conversation-layout'

export type DesignCanvasConversationOverlayConversationProps = Parameters<
  typeof DesignConversationContent
>[0]

type PanelDragState = {
  pointerId: number
  clientX: number
  clientY: number
  originX: number
  originY: number
}

type PanelResizeState = {
  pointerId: number
  clientX: number
  clientY: number
  originWidth: number
  originHeight: number
}

type Props = {
  hostBounds: { width: number; height: number }
  workspaceRoot: string
  documentId: string | null
  drawingTitle: string
  running: boolean
  /** Conversation props shared with the docked DesignAIRail. */
  conversation: DesignCanvasConversationOverlayConversationProps
  onClearHistory: () => void | Promise<void>
  onNewConversation: () => void | Promise<void>
  className?: string
}

export function DesignCanvasConversationOverlay({
  hostBounds,
  workspaceRoot,
  documentId,
  drawingTitle,
  running,
  conversation,
  onClearHistory,
  onNewConversation,
  className = ''
}: Props): ReactElement | null {
  const { t } = useTranslation('common')
  const mode = useMemo(
    () => canvasConversationResponsiveMode(hostBounds.width),
    [hostBounds.width]
  )
  const storageKey = useMemo(
    () => canvasConversationLayoutKey(workspaceRoot, documentId ?? ''),
    [documentId, workspaceRoot]
  )
  const [topInset] = useState(() => readCanvasConversationTopInset())
  const [layout, setLayout] = useState<CanvasConversationLayout>(() =>
    readCanvasConversationLayout(storageKey, hostBounds, mode, topInset)
  )
  const dragRef = useRef<PanelDragState | null>(null)
  const resizeRef = useRef<PanelResizeState | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const launcherRef = useRef<HTMLButtonElement | null>(null)
  const conversationOpen = layout.open && !layout.minimized

  useEffect(() => {
    setLayout(readCanvasConversationLayout(storageKey, hostBounds, mode, topInset))
  }, [hostBounds, mode, storageKey, topInset])

  useEffect(() => {
    const next = clampCanvasConversationLayout(layout, hostBounds, mode, topInset)
    if (
      next.x === layout.x && next.y === layout.y &&
      next.width === layout.width && next.height === layout.height
    ) return
    setLayout(next)
    // Intentionally not persisted: a resize clamp is a transient correction.
  }, [hostBounds, layout, mode, topInset])

  const persist = useCallback((next: CanvasConversationLayout): void => {
    setLayout(next)
    writeCanvasConversationLayout(storageKey, next)
  }, [storageKey])

  const openPanel = useCallback((): void => {
    persist({ ...layout, open: true, minimized: false })
  }, [layout, persist])

  const closePanel = useCallback((): void => {
    persist({ ...layout, open: false, minimized: false })
    launcherRef.current?.focus()
  }, [layout, persist])

  const minimizePanel = useCallback((): void => {
    persist({ ...layout, open: true, minimized: true })
    launcherRef.current?.focus()
  }, [layout, persist])

  const resetPosition = useCallback((): void => {
    persist({
      ...defaultCanvasConversationLayout(hostBounds, mode, topInset),
      open: true,
      minimized: false
    })
  }, [hostBounds, mode, persist, topInset])

  useEffect(() => {
    if (!conversationOpen) return
    const focusId = globalThis.setTimeout(() => {
      panelRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
    }, 0)
    return () => globalThis.clearTimeout(focusId)
  }, [conversationOpen])

  useEffect(() => {
    if (!conversationOpen || typeof window === 'undefined') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // Escape closes the floating conversation before the focused canvas
      // receives it and exits presentation mode.
      event.preventDefault()
      event.stopImmediatePropagation()
      minimizePanel()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [conversationOpen, minimizePanel])

  const beginDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    if (mode === 'sheet') return
    if (event.button !== 0) return
    // Only the header handle starts a drag; interactive children are excluded
    // by data attributes on the buttons themselves.
    const target = event.target as HTMLElement | null
    if (target?.closest('button,input,textarea,select,[role="button"],a')) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      originX: layout.x,
      originY: layout.y
    }
  }

  const moveDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    const next = clampCanvasConversationLayout(
      {
        ...layout,
        x: drag.originX + (event.clientX - drag.clientX),
        y: drag.originY + (event.clientY - drag.clientY)
      },
      hostBounds,
      mode,
      topInset
    )
    setLayout(next)
  }

  const endDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    const next = clampCanvasConversationLayout(
      {
        ...layout,
        x: drag.originX + (event.clientX - drag.clientX),
        y: drag.originY + (event.clientY - drag.clientY)
      },
      hostBounds,
      mode,
      topInset
    )
    persist(next)
  }

  const beginResize = (event: ReactPointerEvent<HTMLElement>): void => {
    if (mode === 'sheet') return
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    resizeRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      originWidth: layout.width,
      originHeight: layout.height
    }
  }

  const resizedLayout = (event: ReactPointerEvent<HTMLElement>): CanvasConversationLayout | null => {
    const resize = resizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) return null
    event.preventDefault()
    return clampCanvasConversationLayout(
      {
        ...layout,
        width: resize.originWidth + (event.clientX - resize.clientX),
        height: resize.originHeight + (event.clientY - resize.clientY)
      },
      hostBounds,
      mode,
      topInset
    )
  }

  const moveResize = (event: ReactPointerEvent<HTMLElement>): void => {
    const next = resizedLayout(event)
    if (next) setLayout(next)
  }

  const endResize = (event: ReactPointerEvent<HTMLElement>): void => {
    const next = resizedLayout(event)
    if (!next) return
    resizeRef.current = null
    persist(next)
  }

  const panelSize = canvasConversationPanelSize(hostBounds, mode, layout, topInset)
  const panelStyle =
    mode === 'sheet'
      ? {
          left: CANVAS_CONVERSATION_EDGE_MARGIN,
          right: CANVAS_CONVERSATION_EDGE_MARGIN,
          bottom: CANVAS_CONVERSATION_EDGE_MARGIN,
          width: panelSize.width,
          height: panelSize.height
        }
      : {
          left: layout.x,
          top: layout.y,
          width: panelSize.width,
          height: panelSize.height
        }

  return (
    <div className={`pointer-events-none absolute inset-0 z-40 ${className}`} aria-hidden={false}>
      <button
        ref={launcherRef}
        type="button"
        onClick={conversationOpen ? minimizePanel : openPanel}
        className={`pointer-events-auto absolute flex h-9 items-center justify-center gap-2 rounded-full border border-ds-border bg-ds-card/95 px-3 text-[12px] font-medium text-ds-ink shadow-[0_12px_32px_rgba(20,47,95,0.14)] transition hover:bg-ds-card motion-reduce:transition-none dark:bg-ds-card/95 ${conversationOpen ? 'invisible' : ''}`}
        style={{
          left: 'calc(1.5rem + var(--ds-window-controls-safe-inset))',
          top: `calc(${CANVAS_CONVERSATION_TOP_MARGIN}px + var(--ds-window-controls-safe-block))`
        }}
        aria-label={t('designCanvasConversationOpen')}
        title={t('designCanvasConversationOpen')}
        aria-expanded={conversationOpen}
      >
        <MessageCircleMore className="h-4 w-4" strokeWidth={1.85} />
        <span>{t('designCanvasConversationOpen')}</span>
        {running ? (
          <span
            className="absolute -right-0.5 -top-0.5 h-3 w-3 animate-pulse rounded-full border-2 border-ds-card bg-emerald-500 motion-reduce:animate-none"
            role="status"
            aria-label={t('designCanvasConversationRunning')}
          />
        ) : null}
      </button>

      {conversationOpen ? (
        <div
          ref={panelRef}
          role="complementary"
          aria-label={t('designCanvasConversationPanelLabel', { title: drawingTitle })}
          className="pointer-events-auto absolute flex flex-col overflow-hidden rounded-[16px] border border-ds-border bg-ds-card/98 text-ds-ink shadow-[0_22px_64px_rgba(20,47,95,0.24)] transition-opacity motion-reduce:transition-none dark:shadow-[0_24px_72px_rgba(0,0,0,0.5)]"
          style={panelStyle}
          data-design-canvas-conversation-panel
          data-resizable={mode === 'sheet' ? 'false' : 'true'}
        >
          <div
            className="flex h-11 shrink-0 cursor-grab select-none items-center gap-1.5 border-b border-ds-border-muted bg-ds-surface-subtle/60 px-2 active:cursor-grabbing"
            onPointerDown={mode === 'sheet' ? undefined : beginDrag}
            onPointerMove={mode === 'sheet' ? undefined : moveDrag}
            onPointerUp={mode === 'sheet' ? undefined : endDrag}
            onPointerCancel={mode === 'sheet' ? undefined : endDrag}
            onDoubleClick={resetPosition}
            data-design-canvas-conversation-drag-handle
            title={t('designCanvasConversationDragHint')}
          >
            <GripVertical
              className="h-4 w-4 shrink-0 text-ds-faint"
              strokeWidth={1.8}
              aria-hidden
            />
            <DesignConversationHistoryHeader
              drawingTitle={drawingTitle}
              designThreads={conversation.designThreads}
              designHistoryThreadIds={conversation.designHistoryThreadIds}
              activeThreadId={conversation.activeThreadId}
              onSwitchThread={conversation.onSwitchThread}
              onClearHistory={onClearHistory}
              canClearHistory={false}
              historyLocked
              showClearHistory={false}
            />
            {running ? (
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center"
                role="status"
                title={t('designCanvasConversationRunning')}
                aria-label={t('designCanvasConversationRunning')}
              >
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500 motion-reduce:animate-none" />
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void onNewConversation()}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
              aria-label={t('designCanvasConversationNew')}
              title={t('designCanvasConversationNew')}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />
            </button>
            {mode !== 'sheet' ? (
              <button
                type="button"
                onClick={resetPosition}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                aria-label={t('designCanvasConversationResetPosition')}
                title={t('designCanvasConversationResetPosition')}
              >
                <PanelTop className="h-3.5 w-3.5" strokeWidth={1.9} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={minimizePanel}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
              aria-label={t('designCanvasConversationCollapse')}
              title={t('designCanvasConversationCollapse')}
            >
              <Minus className="h-3.5 w-3.5" strokeWidth={1.9} />
            </button>
            <button
              type="button"
              onClick={closePanel}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
              aria-label={t('designCanvasConversationClose')}
              title={t('designCanvasConversationClose')}
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.9} />
            </button>
          </div>
          <DesignConversationContent {...conversation} showActiveThreadConversation />
          {mode !== 'sheet' ? (
            <div
              role="separator"
              aria-label={t('designCanvasConversationResize')}
              title={t('designCanvasConversationResize')}
              className="absolute bottom-0 right-0 z-10 flex h-6 w-6 cursor-nwse-resize touch-none items-center justify-center text-ds-faint transition hover:text-ds-ink"
              onPointerDown={beginResize}
              onPointerMove={moveResize}
              onPointerUp={endResize}
              onPointerCancel={endResize}
              data-design-canvas-conversation-resize-handle
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="shrink-0">
                <path
                  d="M1.5 9L9 1.5M5 9L9 5M8.5 9L9 8.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
