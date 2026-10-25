import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import {
  handleCanvasKeyDown,
  handleCanvasKeyUp,
  setCanvasPasteWorkspaceRoot
} from '../../../design/canvas/canvas-shortcuts'
import { hitTest } from '../../../design/canvas/canvas-hit-test'
import { hasPrototypePlayback, resolvePreferredPrototypeArtifactId } from '../../../design/prototype-player'
import { ShapeDispatcher } from './shapes/ShapeDispatcher'
import { CanvasGrid } from './CanvasGrid'
import { CanvasContentOverlays } from './CanvasContentOverlays'
import { CanvasToolbar } from './CanvasToolbar'
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
import {
  canvasViewportStorageKey,
  createCanvasTool,
  shouldHandleCanvasKeyboardEvent,
  shouldHandleCanvasKeyboardRelease,
  shouldOpenImageAnnotation,
  shouldRenderCanvasMinimap,
  shouldRenderDesignArtifactOverlays,
  shouldSyncCanvasHtmlFrames,
  shouldEnterHtmlFrameComponentPickOnDoubleClick,
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
import type { CanvasSurface } from '../../../design/canvas/canvas-surface'
import {
  canvasSurfacePersistsDesignSystem,
  isDesignCanvasSurface,
  isDiagramCanvasSurface
} from '../../../design/canvas/canvas-surface'
import {
  projectCanvasMotionObjects,
  useCanvasMotionPreview
} from '../../../design/motion/canvas-motion-preview'
import { CanvasMotionDock } from './CanvasMotionDock'
import { PrototypeFlowOverlay } from './PrototypeFlowOverlay'
import { useCanvasViewportExports } from './canvas-viewport/canvas-viewport-export'
import { CanvasViewportChrome, type CanvasViewportChromeSlots } from './canvas-viewport/CanvasViewportChrome'
import { CanvasImageAnnotationAction } from './canvas-viewport/CanvasImageAnnotationAction'
import { CanvasViewControls } from './CanvasViewControls'
import { CanvasInspectorDrawer, useCanvasInspectorLayout } from './CanvasInspectorDrawer'
import { CanvasBoardFocusView } from './CanvasBoardFocusView'

export {
  resolveCanvasDesignSystemBaseDir,
  shouldHandleCanvasKeyboardEvent,
  shouldHandleCanvasKeyboardRelease,
  shouldOpenImageAnnotation,
  resolveSelectedImageAnnotationAction,
  shouldRenderCanvasMinimap,
  shouldRenderDesignArtifactOverlays,
  shouldSyncCanvasHtmlFrames,
  shouldEnterHtmlFrameComponentPickOnDoubleClick,
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
  surface?: CanvasSurface
  readOnly?: boolean
  leftSidebarCollapsed?: boolean
  onToggleLeftSidebar?: () => void
  busy?: boolean
  onOpenAgentSettings?: () => void
  syncHtmlScreens?: boolean
  onImplementDesign?: (artifact: DesignArtifact) => void
  onUseElementAsContext?: (context: DesignHtmlElementContext | null, promptSeed?: string) => void
  onRuntimeQualityFindings?: (payload: DesignRuntimeQualityPayload) => void
  onRequestQualityRepair?: (payload: DesignRuntimeQualityPayload) => void
  onRequestAssistant?: () => void
  /** Reports whether the current canvas document loaded safely for guarded actions. */
  onDocumentLoadStateChange?: (loaded: boolean) => void
  onError?: (message: string | null) => void
  chrome?: CanvasViewportChromeSlots
}

export function canvasViewportBackgroundFillClass(surface: CanvasSurface): string {
  return isDesignCanvasSurface(surface) ? 'ds-stage-design-canvas-fill' : ''
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
  readOnly = false,
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  busy = false,
  onOpenAgentSettings,
  syncHtmlScreens = false,
  onImplementDesign,
  onUseElementAsContext,
  onRuntimeQualityFindings,
  onRequestQualityRepair,
  onRequestAssistant,
  onDocumentLoadStateChange,
  onError,
  chrome
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
  const designMotionOpen = isDesignCanvasSurface(surface) && motionOpen
  const designMotionPlaying = designMotionOpen && motionPlaying
  const inspector = useCanvasInspectorLayout(rootRef, designMotionOpen || readOnly)
  const motionPreviewRefreshKey = `${[...selectedIds].sort().join(',')}:${vbox.x}:${vbox.y}:${vbox.width}:${vbox.height}:${designMotionOpen}`
  useCanvasMotionPreview(rootRef, document, zoom, isDesignCanvasSurface(surface), motionPreviewRefreshKey)

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

  const seedComposer = useCallback((promptSeed: string): void => {
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
  useProjectDesignSystemSync(workspaceRoot, isDesignCanvasSurface(surface))
  const uiScale = useCanvasUiScale()
  const tool = useMemo(
    () => createCanvasTool(activeTool, surface, { onRequestAssistant }),
    [activeTool, onRequestAssistant, surface]
  )
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
    designSystemPersistenceEnabled: canvasSurfacePersistsDesignSystem(surface),
    persistenceEnabled: !readOnly,
    onDocumentLoadStateChange,
    onError
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
  const { exportCanvas, exportPrototype } = useCanvasViewportExports({
    svgRef,
    containerRef,
    workspaceRoot,
    designArtifacts,
    initialPrototypeArtifactId
  })
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
    if (isDiagramCanvasSurface(surface) && activeTool === 'screen') {
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
      rootRef.current?.focus({ preventScroll: true })
      e.currentTarget.setPointerCapture(e.pointerId)
      const pointerTool = e.button === 1 ? middlePanTool : tool
      activePointerToolRef.current = pointerTool
      pointerTool.onPointerDown(makePointerEvent(e))
    },
    [middlePanTool, tool, makePointerEvent]
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
      const interactionDocument = isDesignCanvasSurface(surface) && motion.open && motion.activeFrameId
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
      if (shouldEnterHtmlFrameComponentPickOnDoubleClick(surface, shape)) {
        useCanvasSelectionStore.getState().select([hitId])
        toggleHtmlFrameModify(hitId)
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
    [screenToCanvas, surface, toggleHtmlFrameModify]
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
    setCanvasPasteWorkspaceRoot(readOnly ? null : workspaceRoot || null)
    const onKeyDown = (e: KeyboardEvent): void => {
      if (designMotionPlaying || readOnly) return
      if (!shouldHandleCanvasKeyboardEvent(surface, e.target, rootRef.current)) return
      handleCanvasKeyDown(e, {
        workspaceRoot,
        documentKey: useCanvasShapeStore.getState().documentKey
      })
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      // Always release the temporary Hand even if focus moved off-canvas.
      if (e.key === ' ') {
        handleCanvasKeyUp(e)
        return
      }
      if (designMotionPlaying || readOnly) return
      if (!shouldHandleCanvasKeyboardRelease(e.key, surface, e.target, rootRef.current)) return
      handleCanvasKeyUp(e)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      setCanvasPasteWorkspaceRoot(null)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [designMotionPlaying, readOnly, surface, workspaceRoot])

  const viewBoxStr = `${vbox.x} ${vbox.y} ${vbox.width} ${vbox.height}`
  const cursor = activeTool === 'hand' ? 'grab' : tool.cursor
  const root = document.objects[document.rootId]
  return (
    <CanvasWorkspaceContext.Provider value={workspaceValue}>
      <div
        ref={rootRef}
        tabIndex={-1}
        className={`ds-no-drag relative h-full w-full overflow-hidden bg-[#f4f4f2] text-[#1e1e1e] outline-none dark:bg-[#121315] dark:text-[#e9ecef] ${canvasViewportBackgroundFillClass(surface)}`}
        style={{
          '--canvas-motion-dock-height': '264px',
          '--canvas-bottom-ui-inset': designMotionOpen
            ? 'calc(var(--canvas-motion-dock-height) + 16px)'
            : `${inspector.height + 16}px`
        } as React.CSSProperties}
      >
        <CanvasViewportChrome
          leftSidebarCollapsed={leftSidebarCollapsed}
          onToggleLeftSidebar={onToggleLeftSidebar}
          sidebarExpandLabel={t('sidebarExpand')}
          sidebarCollapseLabel={t('sidebarCollapse')}
          minimapEnabled={minimapEnabled}
          uiScale={uiScale}
          bottomInset={designMotionOpen ? 276 : inspector.height}
          toolbar={!readOnly ? <CanvasToolbar
            workspaceRoot={workspaceRoot}
            surface={surface}
            documentTitle={chrome?.title}
            onRequestCanvasCritique={seedComposer}
            onExportCanvas={exportCanvas}
            onExportPrototype={isDesignCanvasSurface(surface) ? exportPrototype : undefined}
            onError={onError}
          /> : chrome?.notice}
          viewControls={<CanvasViewControls
            showPrototypePlay={designArtifactOverlaysEnabled}
            prototypePlayable={prototypePlayable}
            onOpenPrototypePlayer={() => {
              useCanvasMotionStore.getState().setPlaying(false)
              setPrototypePlayerOpen(true)
            }}
            minimapAvailable={minimapEnabled}
            inspectorAvailable={!readOnly}
            extraActions={chrome?.actions}
          />}
        />
        <div
          ref={containerRef}
          className={`absolute inset-0 overflow-hidden bg-[#f4f4f2] dark:bg-[#121315] ${canvasViewportBackgroundFillClass(surface)}`}
          style={{
            bottom: designMotionOpen
              ? 'calc(var(--canvas-motion-dock-height) + 12px)'
              : inspector.height
          }}
        >
          {isDesignCanvasSurface(surface) && !readOnly
            ? <DesignSystemInspector workspaceRoot={workspaceRoot} />
            : null}
          {!readOnly ? <AlignmentToolbar /> : null}
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
              onPointerDown={designMotionPlaying || readOnly ? undefined : onPointerDown}
              onPointerMove={designMotionPlaying || readOnly ? undefined : onPointerMove}
              onPointerUp={designMotionPlaying || readOnly ? undefined : onPointerUp}
              onPointerCancel={designMotionPlaying || readOnly ? undefined : onPointerCancel}
              onDoubleClick={designMotionPlaying || readOnly ? undefined : onDoubleClick}
              onWheel={onWheel}
            >
              {gridVisible && <CanvasGrid zoom={zoom} />}

              {isDesignCanvasSurface(surface) ? (
                <DesignSystemBoardOverlay
                  workspaceRoot={workspaceRoot}
                  documentKey={documentKey}
                  document={document}
                  viewBox={vbox}
                />
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
                {surface === 'design' ? (
                  <PrototypeFlowOverlay
                    artifacts={designArtifacts}
                    objects={document.objects}
                    zoom={zoom}
                  />
                ) : null}
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
          {!readOnly && selectedImageAnnotationAction ? (
            <CanvasImageAnnotationAction action={selectedImageAnnotationAction} onOpen={openImageAnnotation} />
          ) : null}
          {designArtifactOverlaysEnabled ? (
            <>
              <HtmlFrameOverlay
                workspaceRoot={workspaceRoot}
                readOnly={readOnly}
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
          <CanvasContentOverlays readOnly={Boolean(readOnly)} artifactOverlays={designArtifactOverlaysEnabled} onAskKun={seedComposer} />
        </div>
        {isDesignCanvasSurface(surface) && !readOnly ? <CanvasMotionDock /> : null}
        {inspector.visible ? (
          <CanvasInspectorDrawer
            surface={surface}
            workspaceRoot={workspaceRoot}
            height={inspector.height}
            hostHeight={inspector.hostHeight}
            onImplementDesign={onImplementDesign}
            onRequestModify={seedComposer}
            onOpenAgentSettings={onOpenAgentSettings}
            designTargetDisabled={busy || Boolean(pagesRun)}
          />
        ) : null}
        {designArtifactOverlaysEnabled ? <CanvasBoardFocusView workspaceRoot={workspaceRoot} /> : null}
        {designArtifactOverlaysEnabled ? (
          <PrototypePlayerOverlay
            open={prototypePlayerOpen}
            workspaceRoot={workspaceRoot}
            artifacts={designArtifacts}
            initialArtifactId={initialPrototypeArtifactId}
            designTarget={designTarget}
            onClose={() => setPrototypePlayerOpen(false)}
            onRequestMissingScreen={readOnly ? undefined : seedComposer}
          />
        ) : null}
      </div>
    </CanvasWorkspaceContext.Provider>
  )
}
