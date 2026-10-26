import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Brush } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CanvasShape } from '../../../../design/canvas/canvas-types'
import { embeddedArtifactOf } from '../../../../design/canvas/canvas-types'
import { useCanvasMotionPortalStyle } from '../../../../design/motion/canvas-motion-preview'
import type { DesignHtmlElementContext } from '../../../../design/design-composer-context'
import { inferDesignArtifactFoundationRole } from '../../../../design/design-types'
import { useDesignWorkspaceStore } from '../../../../design/design-workspace-store'
import { useChatStore } from '../../../../store/chat-store'
import {
  type DesignRuntimeQualityPayload
} from '../../../../design/design-html-quality'
import { replaceHtmlElementTextInSource } from '../../../../design/design-html-element-edit'
import { writeDesignWorkspaceFile } from '../../../../design/design-persistence-coordinator'
import { useDesignHtmlPreview } from '../../DesignHtmlPreviewHost'
import { HtmlFrameAiCursorOverlay } from './HtmlFrameAiCursorOverlay'
import { HtmlFrameChrome, htmlFrameChromeOffset } from './HtmlFrameChrome'
import { HtmlFrameElementPickBar } from './HtmlFrameElementPickBar'
import { HtmlFrameLayerMenu } from './HtmlFrameLayerMenu'
import { HtmlFramePickOutline } from './HtmlFramePickOutline'
import { useCanvasViewportStore } from '../../../../design/canvas/canvas-viewport-store'
import { useHtmlFramePassivePick } from './use-html-frame-passive-pick'
import { focusActiveDesignComposer } from '../../useDesignComposerContextState'
import { HtmlFrameGeneratingCanvas } from './HtmlFrameGeneratingCanvas'
import { useKunPresenceStore } from '../../../../design/canvas/kun-presence-store'
import { GenerationFailedNotice, HtmlFramePlaceholder } from './HtmlFramePlaceholder'
import {
  chatBusyForArtifact,
  requestScreenGenerationRetry
} from '../../../../design/canvas/screen-generation-recovery'
import {
  htmlFrameDrawingActive,
  htmlFrameOverlayPointerEvents,
  htmlFrameShouldPromotePreviewToReady,
  htmlFrameShouldShowGeneratingCanvas,
  htmlFrameWebviewCanvasStyle,
  htmlFrameWebviewPartition,
  shouldAutoResizeHtmlFrame,
  type HtmlFramePreviewAsyncEpoch
} from './html-frame-helpers'
import { useHtmlFrameAutoSize } from './use-html-frame-auto-size'
import { useHtmlFrameAiCursor } from './use-html-frame-ai-cursor'
import { useHtmlFrameCodeBindings } from './use-html-frame-code-bindings'
import { useHtmlFrameElementSelection } from './use-html-frame-element-selection'
import { useHtmlFrameRuntimeQuality } from './use-html-frame-runtime-quality'
type ScreenOverlayProps = {
  shape: CanvasShape
  workspaceRoot: string
  screenX: number
  screenY: number
  screenWidth: number
  screenHeight: number
  zIndex: number
  zoom: number
  active: boolean
  interactive: boolean
  panning: boolean
  /** Element-pick ("修改") mode is on for this frame: clicking selects text/elements. */
  editing: boolean
  onDoubleClick: (shapeId: string) => void
  onToggleInteractive?: (shapeId: string) => void
  onToggleModify: (shapeId: string) => void
  onUseElementAsContext?: (context: DesignHtmlElementContext | null, promptSeed?: string) => void
  onRuntimeQualityFindings?: (payload: DesignRuntimeQualityPayload) => void
  onRequestQualityRepair?: (payload: DesignRuntimeQualityPayload) => void
  /** The whole canvas is read-only (browsing a historical drawing). */
  canvasReadOnly?: boolean
}
function ScreenOverlayInner({
  shape,
  workspaceRoot,
  screenX,
  screenY,
  screenWidth,
  screenHeight,
  zIndex,
  zoom,
  active,
  interactive,
  panning,
  editing,
  onDoubleClick,
  onToggleInteractive,
  onToggleModify,
  onUseElementAsContext,
  onRuntimeQualityFindings,
  onRequestQualityRepair,
  canvasReadOnly = false
}: ScreenOverlayProps): ReactElement {
  const [localPreviewError, setLocalPreviewError] = useState('')
  const previewAsyncEpochRef = useRef<HtmlFramePreviewAsyncEpoch | null>(null)
  const artifact = useDesignWorkspaceStore((s) =>
    s.artifacts.find((a) => a.id === shape.htmlArtifactId)
  )
  const artifactVersionId = embeddedArtifactOf(shape)?.versionId
  const artifactVersion = artifactVersionId
    ? artifact?.versions.find((version) => version.id === artifactVersionId)
    : undefined
  const artifactRelativePath = artifactVersion?.relativePath ?? artifact?.relativePath
  const renderedArtifact = artifact && artifactRelativePath && artifactRelativePath !== artifact.relativePath
    ? { ...artifact, relativePath: artifactRelativePath }
    : artifact
  const isHistoricalVersion = Boolean(
    artifactVersionId && artifactVersion?.relativePath && artifactVersion.relativePath !== artifact?.relativePath
  )
  const artifactKind = renderedArtifact?.kind
  const parallelState = useDesignWorkspaceStore((s) =>
    shape.htmlArtifactId ? s.parallelPageStates[shape.htmlArtifactId] : undefined
  )
  const pagesRun = useDesignWorkspaceStore((s) => s.pagesRun)
  const setFileError = useDesignWorkspaceStore((s) => s.setFileError)
  const setArtifactPreviewStatus = useDesignWorkspaceStore((s) => s.setArtifactPreviewStatus)
  // A design turn is in flight: the agent is still streaming HTML into the file.
  // Keep the frame in its transparent "generating" surface until the turn settles
  // so a half-written page never shows the opaque white frame band beneath it.
  const chatBusy = useChatStore((s) => chatBusyForArtifact(s, artifactRelativePath))
  const threadBusy = useChatStore((s) => s.busy)
  const canvasWidth = Math.max(1, shape.width)
  const canvasHeight = Math.max(1, shape.height)
  const foundationRole = renderedArtifact ? inferDesignArtifactFoundationRole(renderedArtifact) : undefined
  const drawingActive = !isHistoricalVersion && htmlFrameDrawingActive({
    foundationRole,
    previewStatus: artifact?.previewStatus,
    parallelStatus: parallelState?.status,
    pagesRunPhase: pagesRun?.phase,
    pagesRunStep: pagesRun?.step,
    chatBusy
  })
  const autoResizeEnabled = !isHistoricalVersion && shouldAutoResizeHtmlFrame({
    sizeMode: artifact?.node?.sizeMode,
    role: foundationRole,
    previewStatus: artifact?.previewStatus,
    parallelStatus: parallelState?.status
  })
  const reportPreviewError = useCallback((message: string): void => {
    setLocalPreviewError(message)
    setFileError(message)
    if (artifact?.id && !isHistoricalVersion) setArtifactPreviewStatus(artifact.id, 'error')
  }, [artifact?.id, isHistoricalVersion, setArtifactPreviewStatus, setFileError])
  const clearPreviewError = useCallback((): void => setLocalPreviewError(''), [])
  const {
    state: preview,
    webview,
    webviewMountNonce,
    executeScript,
    renderWebview
  } = useDesignHtmlPreview({
    workspaceRoot,
    relativePath: artifactKind === 'html' ? artifactRelativePath : undefined,
    enabled: Boolean(workspaceRoot && artifactKind === 'html' && artifactRelativePath),
    partition: htmlFrameWebviewPartition(shape.id),
    zoom: 1,
    // Canvas frames paint their own brush-sketch overlay while generating, so
    // the skeleton HTML file must never mount (it centered a small card and
    // fought the drawn frame height).
    mountWhileSkeleton: false,
    onError: reportPreviewError,
    onRevision: clearPreviewError
  })
  const previewAsyncEpoch = useMemo<HtmlFramePreviewAsyncEpoch | null>(() => {
    if (!artifact?.id || artifactKind !== 'html' || !artifactRelativePath || !preview.webviewUrl) return null
    if (preview.relativePath !== artifactRelativePath) return null
    return {
      shapeId: shape.id,
      artifactId: artifact.id,
      artifactRelativePath,
      previewWebviewUrl: preview.webviewUrl,
      previewRevision: preview.revision,
      webviewMountNonce
    }
  }, [
    artifact?.id,
    artifactKind,
    artifactRelativePath,
    preview.relativePath,
    preview.revision,
    preview.webviewUrl,
    shape.id,
    webviewMountNonce
  ])
  useHtmlFrameAutoSize({
    shape,
    artifact: renderedArtifact,
    artifactKind,
    foundationRole,
    autoResizeEnabled,
    drawingActive,
    previewWebviewUrl: preview.webviewUrl,
    previewRevision: preview.revision,
    webview,
    webviewMountNonce,
    currentRenderableContent: preview.renderState === 'renderable',
    executeScript
  })
  useHtmlFrameCodeBindings({
    shapeId: shape.id,
    artifactId: artifact?.id,
    artifactKind,
    artifactRelativePath,
    previewWebviewUrl: preview.webviewUrl,
    previewRevision: preview.revision,
    webview,
    webviewMountNonce,
    executeScript,
    previewAsyncEpochRef
  })
  useEffect(() => {
    previewAsyncEpochRef.current = previewAsyncEpoch
  }, [previewAsyncEpoch])
  const previewError = localPreviewError || preview.error
  const { t } = useTranslation('common')
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onDoubleClick(shape.id)
    },
    [shape.id, onDoubleClick]
  )
  // Hovering and clicking elements works without entering "修改": it only needs
  // the select tool. The explicit mode stays for a capturing pick layer.
  const activeTool = useCanvasViewportStore((s) => s.activeTool)
  const pickAvailable = !isHistoricalVersion && !canvasReadOnly && !panning && !drawingActive && !interactive
  const pickEnabled = pickAvailable && (editing || activeTool === 'select')
  const pickBodyRef = useRef<HTMLDivElement | null>(null)
  const {
    selectionError,
    hoverRect,
    hoverLabel,
    hoverSize,
    hoverParentRect,
    hoverIsSelection,
    selectedElementRect,
    selectedPadding,
    measureLines,
    crumbs,
    layerMenu,
    selectedElementContext,
    selectionLabel,
    selectionPath,
    canSelectParent,
    canDrillToHit,
    canEditText,
    hoverAt,
    hoverClient,
    leave,
    selectElementAt,
    selectClient,
    selectParentElement,
    selectHitElement,
    selectBreadcrumb,
    openLayerMenu,
    closeLayerMenu,
    previewLayer,
    chooseLayer,
    clearElementSelection,
    updateSelectedElementText
  } = useHtmlFrameElementSelection({
    artifact: renderedArtifact,
    canvasWidth,
    canvasHeight,
    editing: pickEnabled,
    executeScript,
    interactive,
    shapeId: shape.id,
    previewRevision: preview.revision,
    previewWebviewUrl: preview.webviewUrl,
    webviewMountNonce,
    setFileError,
    setLocalPreviewError,
    onUseElementAsContext
  })
  useHtmlFramePassivePick({
    enabled: pickEnabled && !editing,
    bodyRef: pickBodyRef,
    onHover: hoverClient,
    onLeave: leave,
    onClick: selectClient,
    onContextMenu: openLayerMenu
  })
  const frameTargeted = active || editing
  const toolCanPick = editing || activeTool === 'select'
  useEffect(() => {
    if (!frameTargeted || !toolCanPick) clearElementSelection()
  }, [frameTargeted, toolCanPick, clearElementSelection])
  useEffect(() => {
    if (!editing || selectedElementContext || canvasReadOnly) return
    const exit = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      onToggleModify(shape.id)
    }
    window.addEventListener('keydown', exit)
    return () => window.removeEventListener('keydown', exit)
  }, [editing, selectedElementContext, canvasReadOnly, onToggleModify, shape.id])

  const [elementTextDraft, setElementTextDraft] = useState('')
  const [elementTextOpen, setElementTextOpen] = useState(false)
  const [elementTextStatus, setElementTextStatus] =
    useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; message?: string }>({ kind: 'idle' })

  useEffect(() => {
    setElementTextDraft(selectedElementContext?.text ?? '')
    setElementTextOpen(false)
    setElementTextStatus({ kind: 'idle' })
  }, [selectedElementContext?.artifactId, selectedElementContext?.selector, selectedElementContext?.text])

  const commitSelectedElementText = useCallback((): void => {
    if (isHistoricalVersion || !artifact || artifact.kind !== 'html' || !artifactRelativePath || !selectedElementContext) return
    if (!workspaceRoot.trim()) {
      setElementTextStatus({ kind: 'error', message: 'Workspace root is missing.' })
      return
    }
    if (
      typeof window.kunGui?.readWorkspaceFile !== 'function' ||
      typeof window.kunGui?.writeWorkspaceFile !== 'function'
    ) {
      setElementTextStatus({ kind: 'error', message: 'Workspace file editing is unavailable.' })
      return
    }

    setElementTextStatus({ kind: 'saving' })
    void (async () => {
      const read = await window.kunGui.readWorkspaceFile({
        path: artifactRelativePath,
        workspaceRoot
      })
      if (!read.ok) throw new Error(read.message)
      if (read.truncated) throw new Error('HTML file is too large to edit directly.')

      const replaced = replaceHtmlElementTextInSource(read.content, selectedElementContext, elementTextDraft)
      if (!replaced.ok) throw new Error(replaced.message)

      if (replaced.content !== read.content) {
        setArtifactPreviewStatus(artifact.id, 'pending')
        const write = await writeDesignWorkspaceFile({
          path: artifactRelativePath,
          workspaceRoot,
          content: replaced.content
        })
        if (!write.ok) throw new Error(write.message)
      }

      const nextElementHtml = replaceHtmlElementTextInSource(
        selectedElementContext.html,
        selectedElementContext,
        elementTextDraft
      )
      updateSelectedElementText(
        elementTextDraft,
        nextElementHtml.ok ? nextElementHtml.content : selectedElementContext.html
      )
      setElementTextStatus({ kind: 'saved' })
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      setElementTextStatus({ kind: 'error', message })
      setFileError(message)
    })
  }, [
    artifact,
    artifactRelativePath,
    elementTextDraft,
    isHistoricalVersion,
    selectedElementContext,
    setArtifactPreviewStatus,
    setFileError,
    updateSelectedElementText,
    workspaceRoot
  ])
  const aiCursor = useHtmlFrameAiCursor({
    executeScript,
    previewAsyncEpochRef,
    previewFileUrl: preview.fileUrl,
    previewRevision: preview.revision
  })
  const {
    qualityChecked,
    qualityDetailsOpen,
    qualityFindings,
    setQualityDetailsOpen
  } = useHtmlFrameRuntimeQuality({
    active,
    artifactId: artifact?.id,
    artifactKind,
    artifactRelativePath,
    executeScript,
    interactive,
    previewAsyncEpochRef,
    previewRevision: preview.revision,
    previewWebviewUrl: preview.webviewUrl,
    shapeId: shape.id,
    webview,
    webviewMountNonce,
    onRuntimeQualityFindings
  })

  // Promote a pending preview to "ready" only once the turn has settled: the file
  // holds a complete standalone HTML document and the agent is no longer streaming.
  // This keeps the transparent generating surface up for the whole write so the
  // canvas updates live without an opaque white frame appearing mid-stream.
  useEffect(() => {
    if (isHistoricalVersion || !artifact?.id) return
    if (!htmlFrameShouldPromotePreviewToReady({
      previewStatus: artifact.previewStatus,
      previewRenderState: preview.renderState,
      drawingActive,
      artifactRelativePath,
      previewRelativePath: preview.relativePath
    })) {
      return
    }
    setArtifactPreviewStatus(artifact.id, 'ready')
  }, [
    artifact?.id,
    artifact?.previewStatus,
    artifactRelativePath,
    drawingActive,
    isHistoricalVersion,
    preview.relativePath,
    preview.renderState,
    setArtifactPreviewStatus
  ])

  const presenceState = drawingActive ? (parallelState?.status === 'queued' ? 'queued' : 'generating') : null
  const presenceName = shape.name
  useEffect(() => {
    const { report } = useKunPresenceStore.getState()
    report(shape.id, presenceState ? { state: presenceState, name: presenceName } : null)
    return () => report(shape.id, null)
  }, [shape.id, presenceState, presenceName])

  const motionStyle = useCanvasMotionPortalStyle(shape, zoom)
  if (screenWidth < 20 || screenHeight < 20) return <></>

  const drawingLabel = parallelState?.status === 'queued' ? 'AI 排队中…' : 'AI 正在绘制…'
  const failedMessage = parallelState?.status === 'failed'
    ? parallelState.error || '生成失败'
    : ''
  const frameRadius = Math.min(7, Math.max(3, screenWidth * 0.012))
  const chromeOffset = htmlFrameChromeOffset(screenWidth)
  // Labels stay readable at any zoom, like board names on a design canvas.
  const showChrome = screenWidth > 60
  const placeholderPreview = !preview.hasRenderableContent && preview.renderState !== 'renderable'
  const transparentGeneratingSurface = placeholderPreview || drawingActive
  const generationFailed =
    !isHistoricalVersion && !drawingActive && !previewError && !failedMessage &&
    artifact?.kind === 'html' && artifact.previewStatus === 'error' && placeholderPreview
  const retryGeneration = artifact?.id ? () => { requestScreenGenerationRetry(artifact.id) } : undefined
  const elementTextChanged = selectedElementContext ? elementTextDraft !== selectedElementContext.text : false
  const askKunAboutElement = (promptSeed?: string): void => {
    if (!selectedElementContext) return
    onUseElementAsContext?.(selectedElementContext, promptSeed)
    focusActiveDesignComposer()
  }
  return (
    <div
      className="absolute overflow-visible"
      data-canvas-motion-target={shape.id}
      data-canvas-motion-kind="portal"
      style={{
        left: screenX,
        top: screenY,
        width: screenWidth,
        height: screenHeight,
        zIndex,
        pointerEvents: htmlFrameOverlayPointerEvents({ panning, interactive, editing }),
        borderRadius: frameRadius,
        ...motionStyle
      }}
      onDoubleClick={handleDoubleClick}
    >
      {selectionError && pickEnabled ? <div role="status" className="absolute left-2 top-2 z-30 rounded bg-white px-2 py-1 text-xs text-ds-ink">{selectionError}</div> : null}
      {showChrome ? (
        <HtmlFrameChrome
          active={active}
          artifact={renderedArtifact}
          workspaceRoot={workspaceRoot}
          artifactId={artifact?.id}
          artifactRelativePath={artifactRelativePath}
          chromeOffset={chromeOffset}
          drawingActive={drawingActive}
          editing={editing && !isHistoricalVersion}
          crumbs={pickEnabled ? crumbs : undefined}
          onSelectCrumb={selectBreadcrumb}
          failedMessage={failedMessage}
          interactive={interactive}
          previewWebviewUrl={preview.webviewUrl}
          qualityChecked={qualityChecked}
          qualityDetailsOpen={qualityDetailsOpen}
          qualityFindings={qualityFindings}
          screenWidth={screenWidth}
          shapeId={shape.id}
          shapeName={shape.name}
          onQualityDetailsOpenChange={setQualityDetailsOpen}
          onRequestQualityRepair={isHistoricalVersion ? undefined : onRequestQualityRepair}
          readOnly={isHistoricalVersion || canvasReadOnly}
          onToggleInteractive={onToggleInteractive}
          onToggleModify={onToggleModify}
        />
      ) : null}

      <div
        className={`relative h-full w-full overflow-hidden border ${
          transparentGeneratingSurface
            ? active
              ? 'border-dashed border-accent bg-transparent shadow-none'
              : 'border-dashed border-black/15 bg-transparent shadow-none dark:border-white/20'
            : `bg-white dark:bg-[#101214] ${
                active
                  ? 'border-accent shadow-[0_0_0_1px_var(--ds-accent),0_16px_38px_rgba(15,23,42,0.14)]'
                  : 'border-black/[0.08] shadow-[0_1px_2px_rgba(15,23,42,0.05),0_10px_28px_rgba(15,23,42,0.07)] dark:border-white/12'
              }`
        }`}
        style={{ borderRadius: frameRadius }}
      >
        <div
          ref={pickBodyRef}
          className="absolute left-0 top-0 overflow-hidden"
          style={{
            width: screenWidth,
            height: screenHeight
          }}
        >
          {preview.webviewUrl ? (
            renderWebview({
              // No `block` here: the webview host must stay display:flex so its
              // shadow iframe (flex:1 1 auto, no height) fills the host. See
              // htmlFrameWebviewCanvasStyle.
              className: 'border-0',
              style: htmlFrameWebviewCanvasStyle({
                canvasWidth,
                // The page always fills the drawn frame: its viewport is the
                // full frame box, and streamed content paints top-down inside
                // it instead of revealing a cropped strip.
                visualCanvasHeight: canvasHeight,
                zoom,
                interactive
              })
            })
          ) : htmlFrameShouldShowGeneratingCanvas({
              webviewMounted: Boolean(preview.webviewUrl),
              hasArtifact: Boolean(artifact),
              transparentGeneratingSurface,
              drawingActive,
              previewError,
              failedMessage
            }) ? (
            <HtmlFrameGeneratingCanvas
              label={drawingActive ? drawingLabel : '正在生成设计…'}
              detail={shape.name}
              screenWidth={screenWidth}
            />
          ) : (
            <HtmlFramePlaceholder
              transparentGeneratingSurface={transparentGeneratingSurface}
              drawingActive={drawingActive}
              placeholderPreview={placeholderPreview}
              previewError={previewError}
              failedMessage={failedMessage}
              hasArtifact={Boolean(artifact)}
              drawingLabel={drawingLabel}
              screenWidth={screenWidth}
              generationFailed={generationFailed}
              onRetry={retryGeneration}
              retryDisabled={threadBusy}
            />
          )}
          {preview.webviewUrl && drawingActive && !aiCursor ? (
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute right-3 top-3 flex max-w-[70%] items-center gap-1.5 rounded-full border border-accent/30 bg-white/88 px-2.5 py-1.5 text-[11px] font-semibold text-accent shadow-[0_10px_30px_rgba(20,47,95,0.14)] backdrop-blur-md dark:border-accent/45 dark:bg-[#20252e] dark:text-[#aeb8ff]">
                <Brush className="h-3.5 w-3.5 animate-pulse" strokeWidth={1.8} aria-hidden="true" />
                <span className="min-w-0 truncate">{drawingLabel}</span>
              </div>
            </div>
          ) : null}
          {preview.webviewUrl && generationFailed ? (
            <div className="absolute inset-x-3 top-3 flex justify-center rounded-md bg-white/92 py-2 shadow-sm dark:bg-[#20252e]/92">
              <GenerationFailedNotice onRetry={retryGeneration} retryDisabled={threadBusy} />
            </div>
          ) : null}
          {preview.webviewUrl && failedMessage ? (
            <div className="pointer-events-none absolute inset-x-3 top-3 rounded-md border border-red-300/70 bg-white/92 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 shadow-sm dark:border-red-400/35 dark:bg-red-950/85 dark:text-red-200">
              {failedMessage}
            </div>
          ) : null}
          {preview.webviewUrl && editing && pickEnabled ? (
            <div
              className="absolute inset-0 cursor-crosshair"
              title={t('canvasBoardPickHint')}
              onPointerDown={selectElementAt}
              onPointerEnter={hoverAt}
              onPointerMove={hoverAt}
              onPointerLeave={leave}
              onDoubleClick={(event) => event.stopPropagation()}
              data-canvas-element-pick-layer="true"
            />
          ) : null}
          {preview.webviewUrl && pickEnabled ? (
            <HtmlFramePickOutline
              zoom={zoom}
              screenWidth={screenWidth}
              screenHeight={screenHeight}
              hoverRect={hoverRect}
              hoverParentRect={hoverParentRect}
              hoverLabel={hoverLabel}
              hoverSize={hoverSize}
              hoverIsSelection={hoverIsSelection}
              selectedRect={selectedElementRect}
              selectedPadding={selectedPadding}
              measureLines={measureLines}
            />
          ) : null}
          {layerMenu && pickEnabled ? (
            <HtmlFrameLayerMenu
              menu={layerMenu}
              screenWidth={screenWidth}
              screenHeight={screenHeight}
              onPreview={previewLayer}
              onChoose={chooseLayer}
              onClose={closeLayerMenu}
            />
          ) : null}
          <HtmlFrameAiCursorOverlay
            cursor={aiCursor}
            zoom={zoom}
            screenWidth={screenWidth}
            visualScreenHeight={screenHeight}
          />
        </div>
      </div>
          {selectedElementRect && selectedElementContext && pickEnabled ? (
            <HtmlFrameElementPickBar
              label={selectionLabel}
              path={selectionPath}
              rect={selectedElementRect}
              zoom={zoom}
              screenWidth={screenWidth}
              screenHeight={screenHeight}
              canSelectParent={canSelectParent}
              canDrillToHit={canDrillToHit}
              canEditText={canEditText}
              textEditorOpen={elementTextOpen}
              editor={{
                value: elementTextDraft,
                tagName: selectedElementContext.tagName,
                statusKind: elementTextStatus.kind,
                statusMessage: elementTextStatus.message,
                changed: elementTextChanged,
                onChange: (value) => {
                  setElementTextDraft(value)
                  if (elementTextStatus.kind !== 'idle') setElementTextStatus({ kind: 'idle' })
                },
                onReset: () => {
                  setElementTextDraft(selectedElementContext.text)
                  setElementTextStatus({ kind: 'idle' })
                },
                onSave: commitSelectedElementText
              }}
              onAskKun={askKunAboutElement}
              onSelectParent={selectParentElement}
              onSelectHit={selectHitElement}
              onToggleTextEditor={() => setElementTextOpen((open) => !open)}
              onClear={clearElementSelection}
            />
          ) : null}
    </div>
  )
}

export const ScreenOverlay = memo(ScreenOverlayInner)
