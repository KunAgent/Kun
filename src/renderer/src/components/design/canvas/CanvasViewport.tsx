import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PenLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useCanvasViewportStore } from '../../../design/canvas/canvas-viewport-store'
import { useCanvasUiScale } from '../../../design/canvas/canvas-ui-scale'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { useImageAnnotationStore } from '../../../design/canvas/image-annotation-store'
import { createHandTool } from '../../../design/canvas/tools/hand-tool'
import type { CanvasToolHandler } from '../../../design/canvas/tools/tool-types'
import { canvasDocumentKey } from '../../../design/canvas/canvas-persistence'
import type { DesignArtifact } from '../../../design/design-types'
import type { DesignHtmlElementContext } from '../../../design/design-composer-context'
import { useDesignWorkspaceStore } from '../../../design/design-workspace-store'
import type { DesignRuntimeQualityPayload } from '../../../design/design-html-quality'
import { CanvasWorkspaceContext } from '../../../design/canvas/canvas-workspace-context'
import { exportCanvasFromSvg, type CanvasExportFormat } from '../../../design/canvas/canvas-export'
import {
  handleCanvasKeyDown,
  handleCanvasKeyUp,
  setCanvasPasteWorkspaceRoot
} from '../../../design/canvas/canvas-shortcuts'
import { hitTest } from '../../../design/canvas/canvas-hit-test'
import { hasPrototypePlayback, resolvePreferredPrototypeArtifactId } from '../../../design/prototype-player'
import { ShapeDispatcher } from './shapes/ShapeDispatcher'
import { CanvasGrid } from './CanvasGrid'
import { CanvasToolbar } from './CanvasToolbar'
import { CanvasZoomBar } from './CanvasZoomBar'
import { CanvasMinimap } from './CanvasMinimap'
import { MotionSelectionOverlay } from './SelectionOverlay'
import { PrototypePlayerOverlay } from './PrototypePlayerOverlay'
import { AlignmentToolbar } from './AlignmentToolbar'
import {
  HtmlFrameOverlay,
  htmlFrameIntersectsViewport,
  htmlFramesInCanvasPaintOrder,
  selectHtmlFramesForOverlay
} from './HtmlFrameOverlay'
import { htmlFrameOverlayCanMountAtZoom } from './html-frame/html-frame-helpers'
import { SidebarTitlebarToggleButton } from '../../sidebar/SidebarPrimitives'
import {
  canvasViewportStorageKey,
  createCanvasTool,
  shouldHandleCanvasKeyboardEvent,
  shouldOpenImageAnnotation,
  shouldRenderCanvasMinimap,
  shouldRenderDesignArtifactOverlays,
  shouldSyncCanvasHtmlFrames,
  shouldToggleHtmlFrameInteractiveOnDoubleClick,
  resolveSelectedImageAnnotationAction,
  resolveCanvasDesignSystemBaseDir,
  resolveHtmlFrameOverlayInteractionState
} from './canvas-viewport/helpers'
import { useCanvasViewportDocumentSync } from './canvas-viewport/use-canvas-viewport-document-sync'
import { useProjectDesignSystemSync } from '../../../design/canvas/use-project-design-system-sync'
import { DesignSystemBoardOverlay } from './DesignSystemBoardOverlay'
import { DesignSystemInspector } from './DesignSystemInspector'
import { SvgFrameOverlay } from './SvgFrameOverlay'
import type { CanvasDocument } from '../../../design/canvas/canvas-types'
import { resolveOwningMotionFrameId } from '../../../design/motion'
import { useCanvasMotionStore } from '../../../design/motion/canvas-motion-store'
import {
  projectCanvasMotionObjects,
  useCanvasMotionPreview
} from '../../../design/motion/canvas-motion-preview'
import { CanvasMotionDock } from './CanvasMotionDock'

export {
  resolveCanvasDesignSystemBaseDir,
  shouldHandleCanvasKeyboardEvent,
  shouldOpenImageAnnotation,
  resolveSelectedImageAnnotationAction,
  shouldRenderCanvasMinimap,
  shouldRenderDesignArtifactOverlays,
  shouldSyncCanvasHtmlFrames,
  shouldToggleHtmlFrameInteractiveOnDoubleClick,
  resolveCanvasSelectionAfterDocumentSync,
  resolveHtmlFrameOverlayInteractionState,
  shouldResetCanvasTransientInteractionAfterDocumentSync,
  mergeLoadedCanvasDocumentWithLiveChanges
} from './canvas-viewport/helpers'

type Props = {
  workspaceRoot: string
  artifactId: string
  /** Workspace subdirectory the canvas doc persists under. Defaults to `.kun-design`. */
  baseDir?: string
  /** Optional design-system directory. Defaults to baseDir; Code canvases use a per-thread dir. */
  designSystemBaseDir?: string
  surface?: 'design' | 'code'
  leftSidebarCollapsed?: boolean
  onToggleLeftSidebar?: () => void
  busy?: boolean
  onOpenAgentSettings?: () => void
  syncHtmlScreens?: boolean
  onImplementDesign?: (artifact: DesignArtifact) => void
  onUseElementAsContext?: (context: DesignHtmlElementContext | null, promptSeed?: string) => void
  onRuntimeQualityFindings?: (payload: DesignRuntimeQualityPayload) => void
  onRequestQualityRepair?: (payload: DesignRuntimeQualityPayload) => void
}

export function canvasViewportBackgroundFillClass(surface: 'design' | 'code'): string {
  return surface === 'design' ? 'ds-stage-design-canvas-fill' : ''
}

export function shouldShowCanvasDocumentLoading(document: CanvasDocument): boolean {
  return !document.objects[document.rootId]
}

export function CanvasViewport({
  workspaceRoot,
  artifactId,
  baseDir,
  designSystemBaseDir,
  surface = 'design',
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  busy = false,
  onOpenAgentSettings,
  syncHtmlScreens = false,
  onUseElementAsContext,
  onRuntimeQualityFindings,
  onRequestQualityRepair
}: Props) {
  const { t } = useTranslation('common')
  const rootRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const activePointerToolRef = useRef<CanvasToolHandler | null>(null)

  const document = useCanvasShapeStore((s) => s.document)
  const vbox = useCanvasViewportStore((s) => s.vbox)
  const activeTool = useCanvasViewportStore((s) => s.activeTool)
  const setActiveTool = useCanvasViewportStore((s) => s.setActiveTool)
  const gridVisible = useCanvasViewportStore((s) => s.gridVisible)
  const containerWidth = useCanvasViewportStore((s) => s.containerWidth)
  const containerHeight = useCanvasViewportStore((s) => s.containerHeight)
  const setContainerSize = useCanvasViewportStore((s) => s.setContainerSize)
  const designArtifacts = useDesignWorkspaceStore((s) => s.artifacts)
  const activeArtifactId = useDesignWorkspaceStore((s) => s.activeArtifactId)
  const designTarget = useDesignWorkspaceStore((s) => s.designContext.designTarget ?? 'web')
  const pagesRun = useDesignWorkspaceStore((s) => s.pagesRun)

  const selectedIds = useCanvasSelectionStore((s) => s.selectedIds)
  const hoverTargetId = useCanvasSelectionStore((s) => s.hoverTargetId)
  const marqueeRect = useCanvasSelectionStore((s) => s.marqueeRect)
  const snapGuides = useCanvasSelectionStore((s) => s.activeSnapGuides)

  const [prototypePlayerOpen, setPrototypePlayerOpen] = useState(false)
  const [interactiveHtmlFrameId, setInteractiveHtmlFrameId] = useState<string | null>(null)
  const [editingHtmlFrameId, setEditingHtmlFrameId] = useState<string | null>(null)
  const zoom = containerWidth / vbox.width
  const motionOpen = useCanvasMotionStore((s) => s.open)
  const motionPlaying = useCanvasMotionStore((s) => s.playing)
  const motionFrameId = useCanvasMotionStore((s) => s.activeFrameId)
  // The annotation action is hidden during playback; avoid making the whole
  // viewport subscribe to the 60-Hz playhead just to position that button.
  const motionTimeMs = useCanvasMotionStore((s) => s.playing ? null : s.currentTimeMs)
  const motionGestureOverrides = useCanvasMotionStore((s) => s.gestureOverrides)
  const designMotionOpen = surface === 'design' && motionOpen
  const designMotionPlaying = designMotionOpen && motionPlaying
  const motionPreviewRefreshKey = `${[...selectedIds].sort().join(',')}:${vbox.x}:${vbox.y}:${vbox.width}:${vbox.height}:${designMotionOpen}`
  useCanvasMotionPreview(rootRef, document, zoom, surface === 'design', motionPreviewRefreshKey)

  useEffect(() => {
    if (!designMotionOpen) return
    const firstSelectedId = selectedIds.values().next().value as string | undefined
    const frameId = resolveOwningMotionFrameId(document, firstSelectedId)
    useCanvasMotionStore.getState().setActiveFrameId(frameId)
    setActiveTool('select')
    setInteractiveHtmlFrameId(null)
    setEditingHtmlFrameId(null)
  }, [designMotionOpen, document, selectedIds, setActiveTool])
  const htmlFrameOverlayMountableIds = useMemo(() => {
    if (!htmlFrameOverlayCanMountAtZoom(zoom)) return new Set<string>()
    const frames = htmlFramesInCanvasPaintOrder(document)
      .filter((shape) => htmlFrameIntersectsViewport(shape, vbox))
    return new Set(selectHtmlFramesForOverlay(frames, selectedIds).map((shape) => shape.id))
  }, [document, selectedIds, vbox, zoom])

  const requestCanvasCritique = useCallback((promptSeed: string): void => {
    onUseElementAsContext?.(null, promptSeed)
  }, [onUseElementAsContext])
  const requestMissingPrototypeScreen = useCallback((promptSeed: string): void => {
    onUseElementAsContext?.(null, promptSeed)
  }, [onUseElementAsContext])

  const toggleHtmlFrameInteractive = useCallback((shapeId: string): void => {
    setEditingHtmlFrameId(null)
    setInteractiveHtmlFrameId((prev) => (prev === shapeId ? null : shapeId))
  }, [])

  const toggleHtmlFrameModify = useCallback((shapeId: string): void => {
    setInteractiveHtmlFrameId(null)
    setEditingHtmlFrameId((prev) => (prev === shapeId ? null : shapeId))
  }, [])

  useEffect(() => {
    const next = resolveHtmlFrameOverlayInteractionState(document, selectedIds, {
      interactiveId: interactiveHtmlFrameId,
      editingId: editingHtmlFrameId,
      overlayAvailable: htmlFrameOverlayCanMountAtZoom(zoom),
      mountableFrameIds: htmlFrameOverlayMountableIds
    })
    if (next.interactiveId !== interactiveHtmlFrameId) {
      setInteractiveHtmlFrameId(next.interactiveId)
    }
    if (next.editingId !== editingHtmlFrameId) {
      setEditingHtmlFrameId(next.editingId)
      if (!next.editingId) onUseElementAsContext?.(null)
    }
  }, [
    document,
    editingHtmlFrameId,
    htmlFrameOverlayMountableIds,
    interactiveHtmlFrameId,
    onUseElementAsContext,
    selectedIds,
    zoom
  ])

  const designArtifactOverlaysEnabled = shouldRenderDesignArtifactOverlays(surface)
  const minimapEnabled = shouldRenderCanvasMinimap(surface)
  const htmlFrameSyncEnabled = shouldSyncCanvasHtmlFrames(surface, syncHtmlScreens)
  const resolvedDesignSystemBaseDir = resolveCanvasDesignSystemBaseDir(baseDir, designSystemBaseDir)
  useProjectDesignSystemSync(workspaceRoot, surface === 'design')
  const uiScale = useCanvasUiScale()
  const tool = useMemo(() => createCanvasTool(activeTool, surface), [activeTool, surface])
  const middlePanTool = useMemo(() => createHandTool(), [])
  const workspaceValue = useMemo(() => ({ workspaceRoot }), [workspaceRoot])
  const viewportStorageKey = useMemo(
    () => canvasViewportStorageKey(workspaceRoot, artifactId, baseDir),
    [artifactId, baseDir, workspaceRoot]
  )
  const documentKey = useMemo(
    () => canvasDocumentKey(workspaceRoot, artifactId, baseDir),
    [artifactId, baseDir, workspaceRoot]
  )
  useCanvasViewportDocumentSync({
    workspaceRoot,
    artifactId,
    baseDir,
    resolvedDesignSystemBaseDir,
    viewportStorageKey,
    documentKey,
    htmlFrameSyncEnabled,
    designArtifacts,
    designTarget,
    designSystemPersistenceEnabled: surface === 'code'
  })
  const selectedHtmlArtifactId = useMemo(() => {
    for (const id of selectedIds) {
      const shape = document.objects[id]
      if (shape?.htmlArtifactId) return shape.htmlArtifactId
    }
    return null
  }, [document.objects, selectedIds])
  const prototypePlayable = useMemo(
    () => hasPrototypePlayback(designArtifacts),
    [designArtifacts]
  )
  const initialPrototypeArtifactId = useMemo(
    () => resolvePreferredPrototypeArtifactId(designArtifacts, selectedHtmlArtifactId, activeArtifactId),
    [activeArtifactId, designArtifacts, selectedHtmlArtifactId]
  )
  const annotationDocument = useMemo(() => {
    if (!designMotionOpen || !motionFrameId || motionTimeMs === null) return document
    return {
      ...document,
      objects: projectCanvasMotionObjects(
        document,
        motionFrameId,
        motionTimeMs,
        motionGestureOverrides
      )
    }
  }, [designMotionOpen, document, motionFrameId, motionGestureOverrides, motionTimeMs])
  const selectedImageAnnotationAction = useMemo(
    () => designMotionPlaying
      ? null
      : resolveSelectedImageAnnotationAction(surface, annotationDocument, selectedIds, {
        vbox,
        containerWidth,
        containerHeight
      }),
    [annotationDocument, containerHeight, containerWidth, designMotionPlaying, selectedIds, surface, vbox]
  )

  const openImageAnnotation = useCallback((shapeId: string): void => {
    useCanvasSelectionStore.getState().select([shapeId])
    useImageAnnotationStore.getState().openImageAnnotation(shapeId)
  }, [])

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

  useEffect(() => {
    if (surface === 'code' && activeTool === 'screen') {
      setActiveTool('select')
    }
  }, [activeTool, setActiveTool, surface])

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
      if (e.button !== 0 && e.button !== 1) return
      e.preventDefault()
      if (surface === 'code') rootRef.current?.focus({ preventScroll: true })
      e.currentTarget.setPointerCapture(e.pointerId)
      const pointerTool = e.button === 1 ? middlePanTool : tool
      activePointerToolRef.current = pointerTool
      pointerTool.onPointerDown(makePointerEvent(e))
    },
    [middlePanTool, tool, makePointerEvent, surface]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const pointerTool = activePointerToolRef.current ?? tool
      pointerTool.onPointerMove(makePointerEvent(e))
    },
    [tool, makePointerEvent]
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const pointerTool = activePointerToolRef.current ?? tool
      pointerTool.onPointerUp(makePointerEvent(e))
      activePointerToolRef.current = null
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
    },
    [tool, makePointerEvent]
  )

  const onPointerCancel = useCallback(
    (e: React.PointerEvent) => {
      const pointerTool = activePointerToolRef.current
      pointerTool?.onPointerUp(makePointerEvent(e))
      activePointerToolRef.current = null
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
    },
    [makePointerEvent]
  )

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const canvas = screenToCanvas(e.clientX, e.clientY)
      const doc = useCanvasShapeStore.getState().document
      const motion = useCanvasMotionStore.getState()
      const interactionDocument = surface === 'design' && motion.open && motion.activeFrameId
        ? {
            ...doc,
            objects: projectCanvasMotionObjects(
              doc,
              motion.activeFrameId,
              motion.currentTimeMs,
              motion.gestureOverrides
            )
          }
        : doc
      const hitId = hitTest(interactionDocument, canvas.x, canvas.y)
      if (!hitId) return
      const shape = doc.objects[hitId]
      if (shouldToggleHtmlFrameInteractiveOnDoubleClick(surface, shape)) {
        useCanvasSelectionStore.getState().select([hitId])
        toggleHtmlFrameInteractive(hitId)
        return
      }
      if (shape?.type === 'text') {
        useCanvasSelectionStore.getState().select([hitId])
        useCanvasSelectionStore.getState().setEditing(hitId)
        return
      }
      // Double-clicking a filled image opens the annotation editor: draw markup
      // over the picture, then the agent re-edits it (image-to-image).
      if (shouldOpenImageAnnotation(surface, shape)) {
        useCanvasSelectionStore.getState().select([hitId])
        useImageAnnotationStore.getState().openImageAnnotation(hitId)
      }
    },
    [screenToCanvas, surface, toggleHtmlFrameInteractive]
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
      if (designMotionPlaying) return
      if (!shouldHandleCanvasKeyboardEvent(surface, e.target, rootRef.current)) return
      handleCanvasKeyDown(e)
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (designMotionPlaying) return
      if (!shouldHandleCanvasKeyboardEvent(surface, e.target, rootRef.current)) return
      handleCanvasKeyUp(e)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      setCanvasPasteWorkspaceRoot(null)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [designMotionPlaying, surface, workspaceRoot])

  const viewBoxStr = `${vbox.x} ${vbox.y} ${vbox.width} ${vbox.height}`
  const cursor = activeTool === 'hand' ? 'grab' : tool.cursor
  const root = document.objects[document.rootId]
  const exportCanvas = useCallback(async (format: CanvasExportFormat): Promise<void> => {
    const sourceSvg = svgRef.current
    if (!sourceSvg) throw new Error(t('canvasExportUnavailable'))
    const backgroundColor = containerRef.current
      ? getComputedStyle(containerRef.current).backgroundColor
      : '#ffffff'
    await exportCanvasFromSvg({
      sourceSvg,
      document: useCanvasShapeStore.getState().document,
      format,
      workspaceRoot,
      filename: 'kun-whiteboard',
      backgroundColor
    })
  }, [t, workspaceRoot])

  return (
    <CanvasWorkspaceContext.Provider value={workspaceValue}>
      <div
        ref={rootRef}
        tabIndex={surface === 'code' ? -1 : undefined}
        className={`ds-no-drag relative h-full w-full overflow-hidden bg-[#f8fafc] text-[#1e1e1e] outline-none dark:bg-[#111318] dark:text-[#e9ecef] ${canvasViewportBackgroundFillClass(surface)}`}
        style={{
          '--canvas-motion-dock-height': '264px',
          '--canvas-bottom-ui-inset': designMotionOpen
            ? 'calc(var(--canvas-motion-dock-height) + 16px)'
            : '16px'
        } as React.CSSProperties}
      >
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
        <div
          className="pointer-events-none absolute right-3 top-1/2 z-40 -translate-y-1/2"
          style={{ transform: `translateY(-50%) scale(${uiScale})`, transformOrigin: 'right center' }}
        >
          <CanvasToolbar
            workspaceRoot={workspaceRoot}
            surface={surface}
            designTargetDisabled={busy || Boolean(pagesRun)}
            prototypePlayable={prototypePlayable}
            onOpenPrototypePlayer={() => {
              useCanvasMotionStore.getState().setPlaying(false)
              setPrototypePlayerOpen(true)
            }}
            onOpenAgentSettings={onOpenAgentSettings}
            onRequestCanvasCritique={requestCanvasCritique}
            onExportCanvas={surface === 'code' ? exportCanvas : undefined}
          />
        </div>
        <div
          className="pointer-events-none absolute right-4 z-40 hidden lg:block"
          style={{ bottom: 'var(--canvas-bottom-ui-inset)', transform: `scale(${uiScale})`, transformOrigin: 'bottom right' }}
        >
          <div className="pointer-events-auto">
            <CanvasZoomBar />
          </div>
        </div>
        {minimapEnabled ? (
          <div
            className="pointer-events-none absolute left-4 z-40 hidden md:block"
            style={{ bottom: 'var(--canvas-bottom-ui-inset)', transform: `scale(${uiScale})`, transformOrigin: 'bottom left' }}
          >
            <div className="pointer-events-auto">
              <CanvasMinimap />
            </div>
          </div>
        ) : null}
        <div
          ref={containerRef}
          className={`absolute inset-0 overflow-hidden bg-[#f8fafc] dark:bg-[#111318] ${canvasViewportBackgroundFillClass(surface)}`}
          style={{
            bottom: designMotionOpen
              ? 'calc(var(--canvas-motion-dock-height) + 12px)'
              : 0
          }}
        >
          {surface === 'design' ? <DesignSystemInspector workspaceRoot={workspaceRoot} /> : null}
          <AlignmentToolbar />
          {shouldShowCanvasDocumentLoading(document) ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-ds-faint">
              {t('designCanvasLoading')}
            </div>
          ) : (
            <svg
              ref={svgRef}
              className="absolute inset-0 h-full w-full"
              data-canvas-surface={surface}
              data-canvas-artifact-id={artifactId}
              viewBox={viewBoxStr}
              xmlns="http://www.w3.org/2000/svg"
              style={{ cursor }}
              onPointerDown={designMotionPlaying ? undefined : onPointerDown}
              onPointerMove={designMotionPlaying ? undefined : onPointerMove}
              onPointerUp={designMotionPlaying ? undefined : onPointerUp}
              onPointerCancel={designMotionPlaying ? undefined : onPointerCancel}
              onDoubleClick={designMotionPlaying ? undefined : onDoubleClick}
              onWheel={onWheel}
            >
              {gridVisible && <CanvasGrid zoom={zoom} />}

              {surface === 'design' ? (
                <DesignSystemBoardOverlay workspaceRoot={workspaceRoot} document={document} viewBox={vbox} />
              ) : null}

              <g id="shape-layer">
                {root?.children.map((childId) => {
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

              {!designMotionPlaying ? (
                <g
                  key={selectedIds.size === 1 ? `selection-${selectedIds.values().next().value as string}` : 'selection-multi'}
                  id="overlay-layer"
                >
                  <MotionSelectionOverlay
                    document={document}
                    selectedIds={selectedIds}
                    hoverTargetId={hoverTargetId}
                    marqueeRect={marqueeRect}
                    snapGuides={snapGuides}
                    zoom={zoom}
                    viewBox={vbox}
                  />
                </g>
              ) : null}
            </svg>
          )}
          {selectedImageAnnotationAction ? (
            <button
              type="button"
              className="ds-no-drag absolute z-30 flex items-center justify-center gap-1.5 rounded-full border border-accent/20 bg-white/95 px-3 text-[12px] font-medium text-accent shadow-[0_8px_24px_rgba(15,23,42,0.14)] backdrop-blur transition hover:bg-accent-soft hover:shadow-[0_10px_28px_rgba(15,23,42,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 dark:bg-[#1f2430]/95"
              style={{
                left: selectedImageAnnotationAction.left,
                top: selectedImageAnnotationAction.top,
                width: selectedImageAnnotationAction.width,
                height: selectedImageAnnotationAction.height
              }}
              title={t('canvasInspectorAnnotateOpen', '在图片上标注修改')}
              aria-label={t('canvasInspectorAnnotate', 'AI 修改图片')}
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                openImageAnnotation(selectedImageAnnotationAction.shapeId)
              }}
            >
              <PenLine className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
              <span className="whitespace-nowrap">{t('canvasInspectorAnnotate', 'AI 修改图片')}</span>
            </button>
          ) : null}
          {designArtifactOverlaysEnabled ? (
            <>
              <HtmlFrameOverlay
                workspaceRoot={workspaceRoot}
                interactiveId={interactiveHtmlFrameId}
                editingId={editingHtmlFrameId}
                onToggleInteractive={toggleHtmlFrameInteractive}
                onToggleModify={toggleHtmlFrameModify}
                onUseElementAsContext={onUseElementAsContext}
                onRuntimeQualityFindings={onRuntimeQualityFindings}
                onRequestQualityRepair={onRequestQualityRepair}
              />
              <SvgFrameOverlay workspaceRoot={workspaceRoot} />
            </>
          ) : null}
        </div>
        {surface === 'design' ? <CanvasMotionDock /> : null}
        {designArtifactOverlaysEnabled ? (
          <PrototypePlayerOverlay
            open={prototypePlayerOpen}
            workspaceRoot={workspaceRoot}
            artifacts={designArtifacts}
            initialArtifactId={initialPrototypeArtifactId}
            designTarget={designTarget}
            onClose={() => setPrototypePlayerOpen(false)}
            onRequestMissingScreen={requestMissingPrototypeScreen}
          />
        ) : null}
      </div>
    </CanvasWorkspaceContext.Provider>
  )
}
