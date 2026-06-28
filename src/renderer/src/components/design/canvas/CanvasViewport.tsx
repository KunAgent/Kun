import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useCanvasViewportStore } from '../../../design/canvas/canvas-viewport-store'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { useCanvasUndoStore } from '../../../design/canvas/canvas-undo-store'
import { createSelectTool } from '../../../design/canvas/tools/select-tool'
import { createRectTool } from '../../../design/canvas/tools/rect-tool'
import { createEllipseTool } from '../../../design/canvas/tools/ellipse-tool'
import { createTextTool } from '../../../design/canvas/tools/text-tool'
import { createFrameTool } from '../../../design/canvas/tools/frame-tool'
import { createHandTool } from '../../../design/canvas/tools/hand-tool'
import { createScreenTool } from '../../../design/canvas/tools/screen-tool'
import { createArrowTool, createLineTool } from '../../../design/canvas/tools/linear-tool'
import { createDrawTool } from '../../../design/canvas/tools/draw-tool'
import type { CanvasToolHandler } from '../../../design/canvas/tools/tool-types'
import type { CanvasTool } from '../../../design/canvas/canvas-types'
import { createEmptyDocument } from '../../../design/canvas/canvas-types'
import { loadCanvasDocument, persistCanvasDocument } from '../../../design/canvas/canvas-persistence'
import { loadDesignSystem, persistDesignSystem } from '../../../design/canvas/design-system-persistence'
import { useDesignSystemStore } from '../../../design/canvas/design-system-store'
import { createEmptyDesignSystem } from '../../../design/canvas/design-system-types'
import { syncHtmlArtifactsToBoardDocument } from '../../../design/design-board'
import type { DesignArtifact } from '../../../design/design-types'
import type { DesignHtmlElementContext } from '../../../design/design-composer-context'
import { useDesignWorkspaceStore } from '../../../design/design-workspace-store'
import { CanvasWorkspaceContext } from '../../../design/canvas/canvas-workspace-context'
import {
  handleCanvasKeyDown,
  handleCanvasKeyUp,
  setCanvasPasteWorkspaceRoot
} from '../../../design/canvas/canvas-shortcuts'
import { hitTest } from '../../../design/canvas/canvas-hit-test'
import { ShapeDispatcher } from './shapes/ShapeDispatcher'
import { CanvasGrid } from './CanvasGrid'
import { CanvasToolbar } from './CanvasToolbar'
import { CanvasZoomBar } from './CanvasZoomBar'
import { SelectionOverlay } from './SelectionOverlay'
import { AlignmentToolbar } from './AlignmentToolbar'
import { HtmlFrameOverlay } from './HtmlFrameOverlay'
import { SidebarTitlebarToggleButton } from '../../sidebar/SidebarPrimitives'

const toolFactories: Record<CanvasTool, () => CanvasToolHandler> = {
  select: createSelectTool,
  rect: createRectTool,
  ellipse: createEllipseTool,
  text: createTextTool,
  frame: createFrameTool,
  screen: createScreenTool,
  image: createSelectTool,
  arrow: createArrowTool,
  line: createLineTool,
  draw: createDrawTool,
  hand: createHandTool
}

type Props = {
  workspaceRoot: string
  artifactId: string
  /** Workspace subdirectory the canvas doc persists under. Defaults to `.kun-design`. */
  baseDir?: string
  leftSidebarCollapsed?: boolean
  onToggleLeftSidebar?: () => void
  onOpenAgentSettings?: () => void
  syncHtmlScreens?: boolean
  onImplementDesign?: (artifact: DesignArtifact) => void
  onUseElementAsContext?: (context: DesignHtmlElementContext | null, promptSeed?: string) => void
}

export function CanvasViewport({
  workspaceRoot,
  artifactId,
  baseDir,
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  onOpenAgentSettings,
  syncHtmlScreens = false,
  onUseElementAsContext
}: Props) {
  const { t } = useTranslation('common')
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const document = useCanvasShapeStore((s) => s.document)
  const vbox = useCanvasViewportStore((s) => s.vbox)
  const activeTool = useCanvasViewportStore((s) => s.activeTool)
  const gridVisible = useCanvasViewportStore((s) => s.gridVisible)
  const containerWidth = useCanvasViewportStore((s) => s.containerWidth)
  const setContainerSize = useCanvasViewportStore((s) => s.setContainerSize)
  const designArtifacts = useDesignWorkspaceStore((s) => s.artifacts)

  const selectedIds = useCanvasSelectionStore((s) => s.selectedIds)
  const hoverTargetId = useCanvasSelectionStore((s) => s.hoverTargetId)
  const marqueeRect = useCanvasSelectionStore((s) => s.marqueeRect)
  const snapGuides = useCanvasSelectionStore((s) => s.activeSnapGuides)

  const [docLoaded, setDocLoaded] = useState(false)

  const zoom = containerWidth / vbox.width
  const tool = useMemo(() => toolFactories[activeTool](), [activeTool])
  const workspaceValue = useMemo(() => ({ workspaceRoot }), [workspaceRoot])

  // Container resize observer
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        setContainerSize(entry.contentRect.width, entry.contentRect.height)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [setContainerSize])

  // Data flow loop: load on artifact change, persist on doc change, reset on unmount/switch
  useEffect(() => {
    if (!artifactId || !workspaceRoot) {
      setDocLoaded(false)
      return
    }

    let cancelled = false
    setDocLoaded(false)

    // 1) Reset transient state for the new artifact
    useCanvasSelectionStore.getState().clearSelection()
    useCanvasSelectionStore.getState().setMarquee(null)
    useCanvasSelectionStore.getState().setHoverTarget(null)
    useCanvasViewportStore.getState().resetView()
    useCanvasUndoStore.getState().clear()

    // 2) Load from disk, fall back to empty document
    void loadCanvasDocument(workspaceRoot, artifactId, baseDir).then((loaded) => {
      if (cancelled) return
      let doc = loaded ?? createEmptyDocument()
      if (syncHtmlScreens) {
        const synced = syncHtmlArtifactsToBoardDocument(
          doc,
          useDesignWorkspaceStore.getState().artifacts
        )
        doc = synced.document
        if (synced.addedFrameIds.length > 0) {
          persistCanvasDocument(workspaceRoot, artifactId, doc, baseDir)
        }
      }
      useCanvasShapeStore.getState().loadDocument(doc)
      setDocLoaded(true)
    })

    // 2b) Load the doc-level design system (tokens + components), shared across
    // this document's artifacts. Reset to empty when none on disk.
    void loadDesignSystem(workspaceRoot, baseDir).then((system) => {
      if (cancelled) return
      useDesignSystemStore.getState().loadSystem(system ?? createEmptyDesignSystem())
    })

    // 3) Subscribe to document changes and persist (debounced by persistCanvasDocument)
    const unsubscribe = useCanvasShapeStore.subscribe((state, prev) => {
      if (cancelled) return
      if (state.document === prev.document) return
      persistCanvasDocument(workspaceRoot, artifactId, state.document, baseDir)
    })

    // 3b) Persist the design system when tokens/components change (debounced).
    const unsubscribeDesignSystem = useDesignSystemStore.subscribe((state, prev) => {
      if (cancelled) return
      if (state.system === prev.system) return
      persistDesignSystem(workspaceRoot, state.system, baseDir)
    })

    return () => {
      cancelled = true
      unsubscribe()
      unsubscribeDesignSystem()
    }
  }, [workspaceRoot, artifactId, baseDir, syncHtmlScreens])

  const htmlArtifactSyncKey = useMemo(() => {
    if (!syncHtmlScreens) return ''
    return designArtifacts
      .filter((artifact) => artifact.kind === 'html')
      .map((artifact) => {
        const node = artifact.node
        return [
          artifact.id,
          artifact.title,
          node?.x ?? '',
          node?.y ?? '',
          node?.width ?? '',
          node?.height ?? ''
        ].join(':')
      })
      .join('|')
  }, [designArtifacts, syncHtmlScreens])

  useEffect(() => {
    if (!docLoaded || !syncHtmlScreens || !artifactId || !workspaceRoot) return
    const current = useCanvasShapeStore.getState().document
    const synced = syncHtmlArtifactsToBoardDocument(current, useDesignWorkspaceStore.getState().artifacts)
    if (synced.addedFrameIds.length === 0) return
    useCanvasShapeStore.getState().loadDocument(synced.document)
    persistCanvasDocument(workspaceRoot, artifactId, synced.document, baseDir)
  }, [artifactId, baseDir, docLoaded, htmlArtifactSyncKey, syncHtmlScreens, workspaceRoot])

  const screenToCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current
      if (!svg) return { x: 0, y: 0 }
      const rect = svg.getBoundingClientRect()
      const sx = (clientX - rect.left) / rect.width
      const sy = (clientY - rect.top) / rect.height
      return {
        x: vbox.x + sx * vbox.width,
        y: vbox.y + sy * vbox.height
      }
    },
    [vbox]
  )

  const makePointerEvent = useCallback(
    (e: React.PointerEvent) => {
      const canvas = screenToCanvas(e.clientX, e.clientY)
      return {
        canvasX: canvas.x,
        canvasY: canvas.y,
        clientX: e.clientX,
        clientY: e.clientY,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        timeStamp: e.timeStamp
      }
    },
    [screenToCanvas]
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.currentTarget.setPointerCapture(e.pointerId)
      tool.onPointerDown(makePointerEvent(e))
    },
    [tool, makePointerEvent]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      tool.onPointerMove(makePointerEvent(e))
    },
    [tool, makePointerEvent]
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      tool.onPointerUp(makePointerEvent(e))
    },
    [tool, makePointerEvent]
  )

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const canvas = screenToCanvas(e.clientX, e.clientY)
      const doc = useCanvasShapeStore.getState().document
      const hitId = hitTest(doc, canvas.x, canvas.y)
      if (!hitId) return
      const shape = doc.objects[hitId]
      if (shape?.type === 'text') {
        useCanvasSelectionStore.getState().select([hitId])
        useCanvasSelectionStore.getState().setEditing(hitId)
      }
    },
    [screenToCanvas]
  )

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      const store = useCanvasViewportStore.getState()
      const canvas = screenToCanvas(e.clientX, e.clientY)

      if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY > 0 ? 0.9 : 1.1
        store.zoomTo(factor, canvas)
      } else {
        const scaleX = store.vbox.width / store.containerWidth
        const scaleY = store.vbox.height / store.containerHeight
        store.pan(e.deltaX * scaleX, e.deltaY * scaleY)
      }
    },
    [screenToCanvas]
  )

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const handler = (e: WheelEvent): void => e.preventDefault()
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  useEffect(() => {
    setCanvasPasteWorkspaceRoot(workspaceRoot || null)
    const onKeyDown = (e: KeyboardEvent): void => {
      handleCanvasKeyDown(e)
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      handleCanvasKeyUp(e)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      setCanvasPasteWorkspaceRoot(null)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [workspaceRoot])

  const viewBoxStr = `${vbox.x} ${vbox.y} ${vbox.width} ${vbox.height}`
  const cursor = activeTool === 'hand' ? 'grab' : tool.cursor

  const root = document?.objects?.[document?.rootId]

  return (
    <CanvasWorkspaceContext.Provider value={workspaceValue}>
      <div className="ds-no-drag relative h-full w-full overflow-hidden bg-ds-main">
        <div className="pointer-events-none absolute left-3 top-3 z-40 flex min-w-0 items-start">
          <div
            className={`pointer-events-auto flex min-w-0 items-center gap-2 ${
              leftSidebarCollapsed ? 'ds-window-controls-safe-inset' : ''
            }`}
          >
            {onToggleLeftSidebar ? (
              <SidebarTitlebarToggleButton
                onClick={onToggleLeftSidebar}
                title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
                ariaLabel={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
              />
            ) : null}
          </div>
        </div>
        <div className="pointer-events-none absolute right-3 top-1/2 z-40 -translate-y-1/2">
          <CanvasToolbar workspaceRoot={workspaceRoot} onOpenAgentSettings={onOpenAgentSettings} />
        </div>
        <div className="pointer-events-none absolute bottom-4 right-4 z-40 hidden lg:block">
          <div className="pointer-events-auto">
            <CanvasZoomBar />
          </div>
        </div>
        <div
          ref={containerRef}
          className="absolute inset-0 overflow-hidden bg-[color-mix(in_srgb,var(--ds-bg-main)_90%,white)] dark:bg-[color-mix(in_srgb,var(--ds-bg-main)_88%,black)]"
        >
          <AlignmentToolbar />
          {!docLoaded || !root ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-ds-faint">
              {t('designCanvasLoading')}
            </div>
          ) : (
            <svg
              ref={svgRef}
              className="absolute inset-0 h-full w-full"
              viewBox={viewBoxStr}
              xmlns="http://www.w3.org/2000/svg"
              style={{ cursor }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onDoubleClick={onDoubleClick}
              onWheel={onWheel}
            >
              {gridVisible && <CanvasGrid zoom={zoom} />}

              <g id="shape-layer">
                {root.children.map((childId) => {
                  const child = document.objects[childId]
                  if (!child || !child.visible) return null
                  return (
                    <ShapeDispatcher
                      key={childId}
                      shapeId={childId}
                      objects={document.objects}
                    />
                  )
                })}
              </g>

              <g id="overlay-layer">
                <SelectionOverlay
                  selectedIds={selectedIds}
                  hoverTargetId={hoverTargetId}
                  marqueeRect={marqueeRect}
                  snapGuides={snapGuides}
                  objects={document.objects}
                  zoom={zoom}
                  viewBox={vbox}
                />
              </g>
            </svg>
          )}
          <HtmlFrameOverlay
            workspaceRoot={workspaceRoot}
            onUseElementAsContext={onUseElementAsContext}
          />
        </div>
      </div>
    </CanvasWorkspaceContext.Provider>
  )
}
