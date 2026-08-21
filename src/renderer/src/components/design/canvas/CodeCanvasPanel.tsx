import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Maximize2, Minimize2, PanelRightClose, Shapes } from 'lucide-react'
import {
  useCanvasImageGenerationProgress,
  failedImageGenerationEntries,
  useImageGenerationProgressStore
} from '../../../design/canvas/canvas-image-generation-progress'
import { requestCodeCanvasPanelFocus } from '../../../lib/code-canvas-panel-event'
import { CanvasViewport } from './CanvasViewport'
import { PropertiesPanel } from './PropertiesPanel'
import {
  DesignDocumentCanvasSurface,
  type DesignDocumentCanvasSurfaceProps
} from './DesignDocumentCanvasSurface'
import { useApplyShapeOpsLive } from '../../../design/canvas/use-apply-shape-ops-live'
import type { ExecuteOpsOptions } from '../../../design/canvas/shape-ops'
import {
  CODE_CANVAS_DIR,
  codeCanvasArtifactId,
  codeCanvasErrorKey,
  codeCanvasThreadBaseDir
} from '../../../design/canvas/code-canvas'
import {
  exportActiveCodeCanvasToWorkspace,
  type CanvasAgentExportRequest
} from '../../../design/canvas/canvas-export'
import { canvasDocumentKey } from '../../../design/canvas/canvas-persistence'
import {
  useCodeCanvasDesignSurface,
  type CodeCanvasDesignSurface
} from '../../../design/code-canvas-design-surface'
import { useDesignWorkspaceStore } from '../../../design/design-workspace-store'
import { normalizeDesignWorkspaceRoot } from '../../../design/design-workspace-lifecycle'
import { displayDrawingTitle } from '../../../design/design-drawing-title'
import {
  findDesignBoardArtifact,
  findDesignBoardArtifactById
} from '../../../design/design-board'
import {
  cloneDesignDocumentForFork,
  type PreparedDesignDocumentFork
} from '../../../design/design-document-fork'

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

type Props = Pick<
  DesignDocumentCanvasSurfaceProps,
  | 'busy'
  | 'onOpenAgentSettings'
  | 'onImplementDesign'
  | 'onScreenCreated'
  | 'onSvgCreated'
  | 'onUseElementAsContext'
  | 'onRuntimeQualityFindings'
  | 'onRequestQualityRepair'
> & {
  workspaceRoot: string
  activeThreadId: string | null
  /** Authoritative bound Design document; keeps the panel off the empty Code canvas during hydration. */
  designDocumentId?: string
  /** Board within a multi-board Design document; completes the whiteboard host target. */
  boardArtifactId?: string
  /** Re-drive a failed image placeholder's original brief through the design sender. */
  onRequestImageRegenerate?: (prompt: string) => void
  /** Keeps a classified Design task on the full Design surface while its target hydrates. */
  designTaskActive?: boolean
  /** `docked` is the ordinary right-rail shell; `focused` is the stage-covering presentation. */
  presentation?: 'docked' | 'focused'
  onExitFocus?: () => void
  onCollapse: () => void
  className?: string
}

export function codeCanvasPanelShellClass(className?: string, presentation: 'docked' | 'focused' = 'docked'): string {
  return cx(
    'ds-no-drag relative flex min-h-0 flex-col overflow-hidden bg-[#f8fafc] dark:bg-[#111318]',
    presentation === 'docked' ? 'border-l border-ds-border-muted' : '',
    className
  )
}

export function codeCanvasPanelTitlebarClass(): string {
  return 'pointer-events-auto flex h-10 max-w-[calc(100%-72px)] min-w-0 items-center gap-1.5 rounded-full border border-ds-border bg-white/82 px-1.5 shadow-[0_16px_42px_rgba(20,47,95,0.13)] backdrop-blur-2xl dark:bg-ds-card/84 dark:shadow-none'
}

export function codeCanvasPanelDesignHostClass(): string {
  return 'relative flex min-h-0 flex-1 overflow-hidden'
}

export function resolveCodeCanvasDesignSurface(options: {
  surface: CodeCanvasDesignSurface
  workspaceRoot: string
  activeThreadId: string | null
  designTaskActive: boolean
  designDocumentId?: string
  boardArtifactId?: string
}): Exclude<CodeCanvasDesignSurface, null> | null {
  const { surface, workspaceRoot, activeThreadId, designTaskActive } = options
  if (!activeThreadId) return null
  const requestedDocumentId = options.designDocumentId?.trim()
  const browsingCanonicalDocument = Boolean(
    surface?.readOnly &&
    requestedDocumentId &&
    surface.canonicalDocumentId === requestedDocumentId
  )
  // Compare the complete whiteboard host target so a mode switch can never
  // remount a different (possibly blank) canvas under the same thread. When
  // the caller has no authoritative bound document (e.g. browsing a prototype
  // card without a locked profile), the thread-scoped surface is kept as-is.
  if (
    surface?.threadId === activeThreadId &&
    (surface.surfaceKind ?? 'kun-design') === 'kun-design' &&
    normalizeDesignWorkspaceRoot(surface.workspaceRoot) ===
      normalizeDesignWorkspaceRoot(workspaceRoot) &&
    (!requestedDocumentId ||
      surface.documentId === requestedDocumentId ||
      browsingCanonicalDocument) &&
    (browsingCanonicalDocument ||
      !options.boardArtifactId?.trim() ||
      surface.boardArtifactId === options.boardArtifactId.trim())
  ) return surface
  const documentId = requestedDocumentId
  return designTaskActive && documentId
    ? {
        surfaceKind: 'kun-design',
        threadId: activeThreadId,
        workspaceRoot,
        documentId,
        ...(options.boardArtifactId?.trim()
          ? { boardArtifactId: options.boardArtifactId.trim() }
          : {})
      }
    : null
}

export function shouldRehydrateCodeCanvasDesignDocument(
  documents: readonly { id: string }[],
  documentId: string
): boolean {
  return !documents.some((document) => document.id === documentId)
}

/**
 * Hosts the reusable {@link CanvasViewport} as a code-workspace right panel.
 * By default the canvas is per-thread (`code-<threadId>`), persisted under
 * {@link CODE_CANVAS_DIR}, and the main chat agent drives it via ShapeOps
 * (Block C).
 *
 * When the user asks to view a 设计稿 (prototype card "open in canvas", sidebar
 * design tree, or a design thread in the sidebar), the panel instead renders
 * that document's design board — a whiteboard-style space with the same
 * zoom/pan/grid tooling — without leaving the chat route.
 */
export function CodeCanvasPanel({
  workspaceRoot,
  activeThreadId,
  designDocumentId,
  boardArtifactId,
  onRequestImageRegenerate,
  designTaskActive = false,
  presentation = 'docked',
  onExitFocus,
  onCollapse,
  className,
  busy,
  onOpenAgentSettings,
  onImplementDesign,
  onScreenCreated,
  onSvgCreated,
  onUseElementAsContext,
  onRuntimeQualityFindings,
  onRequestQualityRepair
}: Props) {
  const { t } = useTranslation('common')
  const surface = useCodeCanvasDesignSurface((s) => s.surface)
  const designDocuments = useDesignWorkspaceStore((s) => s.documents)
  const [continuingHistorical, setContinuingHistorical] = useState(false)
  const activationGenerationRef = useRef(0)
  const activeThreadIdRef = useRef(activeThreadId)
  activeThreadIdRef.current = activeThreadId
  const activeDesignSurface = useMemo(() => resolveCodeCanvasDesignSurface({
    surface,
    workspaceRoot,
    activeThreadId,
    designTaskActive,
    designDocumentId,
    boardArtifactId
  }), [activeThreadId, boardArtifactId, designDocumentId, designTaskActive, surface, workspaceRoot])
  const designMode = Boolean(activeDesignSurface) || Boolean(designTaskActive && activeThreadId)

  // Activate the requested 设计稿 so the design store projects its artifacts
  // (the board + linked HTML frames for that document).
  useEffect(() => {
    if (!activeDesignSurface) return
    const target = activeDesignSurface
    const cached = useCodeCanvasDesignSurface.getState().surface
    if (
      cached?.threadId !== target.threadId ||
      cached.documentId !== target.documentId ||
      normalizeDesignWorkspaceRoot(cached.workspaceRoot) !==
        normalizeDesignWorkspaceRoot(target.workspaceRoot) ||
      (cached.boardArtifactId ?? undefined) !== (target.boardArtifactId ?? undefined)
    ) {
      useCodeCanvasDesignSurface.getState().showDesignDocument(
        target.threadId,
        target.workspaceRoot,
        target.documentId,
        {
          ...(target.boardArtifactId ? { boardArtifactId: target.boardArtifactId } : {}),
          ...(target.readOnly ? { readOnly: true } : {}),
          ...(target.canonicalDocumentId
            ? { canonicalDocumentId: target.canonicalDocumentId }
            : {}),
          ...(target.continuationOperationId
            ? { continuationOperationId: target.continuationOperationId }
            : {})
        }
      )
    }
    const generation = ++activationGenerationRef.current
    const restoreLatestSurface = (): void => {
      const latest = useCodeCanvasDesignSurface.getState().surface
      const expectedThreadId = generation === activationGenerationRef.current
        ? activeThreadId
        : activeThreadIdRef.current
      const resolved = latest?.threadId === expectedThreadId &&
        latest.documentId === target.documentId &&
        normalizeDesignWorkspaceRoot(latest.workspaceRoot) ===
          normalizeDesignWorkspaceRoot(target.workspaceRoot)
        ? latest
        : generation === activationGenerationRef.current
          ? target
          : null
      if (resolved) {
        const latestState = useDesignWorkspaceStore.getState()
        if (latestState.documents.some((document) => document.id === resolved.documentId)) {
          latestState.switchActiveDocument(resolved.documentId)
        }
      }
    }
    const state = useDesignWorkspaceStore.getState()
    if (
      normalizeDesignWorkspaceRoot(state.workspaceRoot) !==
      normalizeDesignWorkspaceRoot(target.workspaceRoot)
    ) {
      state.setWorkspaceRoot(target.workspaceRoot)
      void useDesignWorkspaceStore.getState().loadDesignSettings().then(restoreLatestSurface)
      return
    }
    const hasTargetDocument = !shouldRehydrateCodeCanvasDesignDocument(
      state.documents,
      target.documentId
    )
    if (state.activeDocumentId !== target.documentId && hasTargetDocument) {
      state.switchActiveDocument(target.documentId)
    } else if (!hasTargetDocument) {
      void state.rehydrateArtifacts().then(restoreLatestSurface)
    }
  }, [activeDesignSurface, activeThreadId])

  const ready = Boolean(workspaceRoot && activeThreadId)
  const artifactId = activeThreadId ? codeCanvasArtifactId(activeThreadId) : ''
  const designSystemBaseDir = activeThreadId ? codeCanvasThreadBaseDir(activeThreadId) : undefined
  const feedbackKey = activeThreadId ? codeCanvasErrorKey(activeThreadId) : undefined
  const expectedDocumentKey = ready
    ? canvasDocumentKey(workspaceRoot, artifactId, CODE_CANVAS_DIR)
    : undefined
  const executeOptions = useMemo<ExecuteOpsOptions>(
    () => ({
      screenFallback: 'plain-frame',
      shapePreset: 'diagram',
      ...(feedbackKey ? { lintFeedbackKey: feedbackKey } : {})
    }),
    [feedbackKey]
  )
  const exportCanvas = useCallback(
    (request: CanvasAgentExportRequest) => exportActiveCodeCanvasToWorkspace({
      request,
      workspaceRoot,
      artifactId,
      expectedDocumentKey
    }),
    [artifactId, expectedDocumentKey, workspaceRoot]
  )
  useApplyShapeOpsLive(
    !designMode && ready,
    undefined,
    executeOptions,
    feedbackKey,
    activeThreadId,
    undefined,
    exportCanvas,
    undefined,
    expectedDocumentKey,
    undefined,
    'code'
  )
  const designDoc = activeDesignSurface
    ? designDocuments.find((document) => document.id === activeDesignSurface.documentId) ?? null
    : null
  const designBoardArtifact = activeDesignSurface && designDoc
    ? activeDesignSurface.boardArtifactId
      ? findDesignBoardArtifactById(designDoc.artifacts, activeDesignSurface.boardArtifactId)
      : findDesignBoardArtifact(designDoc.artifacts)
    : null
  const expectedDesignCanvasDocumentKey = designDoc && designBoardArtifact
    ? canvasDocumentKey(
        workspaceRoot,
        designBoardArtifact.id,
        `.kun-design/${designDoc.id}`
      )
    : undefined
  useCanvasImageGenerationProgress(Boolean(activeDesignSurface && expectedDesignCanvasDocumentKey), {
    expectedCanvasDocumentKey: expectedDesignCanvasDocumentKey,
    onRetry: (prompt) => {
      if (prompt.trim()) onRequestImageRegenerate?.(prompt.trim())
    }
  })
  const failedGenerations = failedImageGenerationEntries()

  const designDocTitle = designDoc ? displayDrawingTitle(designDoc, t('designUntitledDrawing')) : ''
  const returnToCanonicalDocument = useCallback(() => {
    if (!activeDesignSurface?.canonicalDocumentId || !activeThreadId) return
    useCodeCanvasDesignSurface.getState().showDesignDocument(
      activeThreadId,
      workspaceRoot,
      activeDesignSurface.canonicalDocumentId,
      { canonicalDocumentId: activeDesignSurface.canonicalDocumentId }
    )
  }, [activeDesignSurface, activeThreadId, workspaceRoot])
  const continueHistoricalDocument = useCallback(() => {
    if (
      continuingHistorical || !activeDesignSurface?.readOnly ||
      activeDesignSurface.canonicalDocumentId ||
      !activeThreadId || !designDoc
    ) return
    const board = findDesignBoardArtifact(designDoc.artifacts)
    if (!board) {
      useDesignWorkspaceStore.getState().setFileError('The preview does not have a whiteboard to continue.')
      return
    }
    setContinuingHistorical(true)
    void (async () => {
      let prepared: PreparedDesignDocumentFork | null = null
      try {
        prepared = await cloneDesignDocumentForFork({
          workspaceRoot,
          sourceTarget: { documentId: designDoc.id, boardArtifactId: board.id },
          operation: { kind: 'bind', sourceId: activeThreadId, relation: 'bind' }
        })
        await useDesignWorkspaceStore.getState().rehydrateArtifacts()
        const target = prepared.designDocumentTarget
        const state = useDesignWorkspaceStore.getState()
        const cloned = state.documents.find((document) => document.id === target.documentId)
        if (!cloned || !cloned.artifacts.some(
          (artifact) => artifact.kind === 'canvas' && artifact.id === target.boardArtifactId
        )) throw new Error('The cloned whiteboard could not be loaded.')
        state.switchActiveDocument(target.documentId)
        useCodeCanvasDesignSurface.getState().showDesignDocument(
          activeThreadId,
          workspaceRoot,
          target.documentId,
          {
            canonicalDocumentId: target.documentId,
            ...(prepared.operationId
              ? { continuationOperationId: prepared.operationId }
              : {})
          }
        )
      } catch (error) {
        if (prepared) await prepared.cleanup().catch(() => undefined)
        useDesignWorkspaceStore.getState().setFileError(
          error instanceof Error ? error.message : String(error)
        )
      } finally {
        setContinuingHistorical(false)
      }
    })()
  }, [activeDesignSurface, activeThreadId, continuingHistorical, designDoc, workspaceRoot])

  if (designMode) {
    const focusedPresentation = presentation === 'focused'
    const onToggleFocus = focusedPresentation && onExitFocus ? onExitFocus : requestCodeCanvasPanelFocus
    return (
      <aside className={codeCanvasPanelShellClass(className, presentation)}>
        <div className="pointer-events-none absolute left-3 right-3 top-3 z-50 flex min-w-0 items-start">
          <div className={codeCanvasPanelTitlebarClass()} data-code-canvas-titlebar="true">
            {!focusedPresentation ? (
              <button
                type="button"
                onClick={onCollapse}
                className="ds-sidebar-toggle-button shrink-0"
                aria-label={t('rightPanelCollapse')}
                title={t('rightPanelCollapse')}
              >
                <PanelRightClose className="h-4 w-4" strokeWidth={1.85} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onToggleFocus}
              className="ds-sidebar-toggle-button shrink-0"
              aria-label={t(focusedPresentation ? 'designWhiteboardExitFocus' : 'designWhiteboardFocus', {
                defaultValue: focusedPresentation ? 'Exit focused whiteboard' : 'Focus whiteboard'
              })}
              title={t(focusedPresentation ? 'designWhiteboardExitFocus' : 'designWhiteboardFocus', {
                defaultValue: focusedPresentation ? 'Exit focused whiteboard' : 'Focus whiteboard'
              })}
            >
              {focusedPresentation ? (
                <Minimize2 className="h-4 w-4" strokeWidth={1.85} />
              ) : (
                <Maximize2 className="h-4 w-4" strokeWidth={1.85} />
              )}
            </button>
            <div className="flex min-w-0 items-center gap-1.5 pl-1 pr-2">
              <Shapes className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} />
              <span className="min-w-0 truncate text-[12.5px] font-medium text-ds-ink">
                {designDocTitle || t('rightPanelWhiteboard')}
              </span>
              {activeDesignSurface?.readOnly ? (
                <span className="shrink-0 rounded-full bg-ds-surface-subtle px-2 py-0.5 text-[10.5px] text-ds-muted">
                  {t('designViewPreview')}
                </span>
              ) : null}
              {activeDesignSurface?.readOnly && activeDesignSurface.canonicalDocumentId ? (
                <button
                  type="button"
                  onClick={returnToCanonicalDocument}
                  className="pointer-events-auto shrink-0 rounded-full px-2 py-1 text-[11px] font-medium text-accent hover:bg-ds-hover"
                >
                  {t('designReturnToTaskWhiteboard', { defaultValue: 'Return to task whiteboard' })}
                </button>
              ) : activeDesignSurface?.readOnly ? (
                <button
                  type="button"
                  disabled={continuingHistorical}
                  onClick={continueHistoricalDocument}
                  className="pointer-events-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-accent hover:bg-ds-hover disabled:opacity-50"
                >
                  {continuingHistorical ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  {t('designContinueInTask', { defaultValue: 'Continue in this task' })}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className={codeCanvasPanelDesignHostClass()}>
          {designDoc ? (
            <DesignDocumentCanvasSurface
              workspaceRoot={workspaceRoot}
              documentId={designDoc.id}
              activeThreadId={activeThreadId}
              boardArtifactId={activeDesignSurface?.boardArtifactId}
              readOnly={activeDesignSurface?.readOnly === true}
              busy={busy}
              onOpenAgentSettings={onOpenAgentSettings}
              onImplementDesign={onImplementDesign}
              onScreenCreated={onScreenCreated}
              onSvgCreated={onSvgCreated}
              onUseElementAsContext={onUseElementAsContext}
              onRuntimeQualityFindings={onRuntimeQualityFindings}
              onRequestQualityRepair={onRequestQualityRepair}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="rounded-full bg-ds-surface-subtle p-3 text-ds-faint dark:bg-white/6">
                <Shapes className="h-6 w-6" strokeWidth={1.65} />
              </div>
              <div className="max-w-64 text-[12px] leading-5 text-ds-muted">
                {t('designCanvasLoading')}
              </div>
            </div>
          )}
          {failedGenerations.length > 0 ? (
            <div className="pointer-events-none absolute bottom-3 left-3 z-40 flex max-w-[calc(100%-24px)] flex-col gap-1.5">
              {failedGenerations.map((entry) => (
                <div
                  key={entry.toolCallId}
                  className="pointer-events-auto flex max-w-full items-center gap-2 rounded-xl border border-red-500/30 bg-white/95 px-3 py-2 text-[12px] text-ds-ink shadow-lg backdrop-blur dark:bg-[#1b1d24]/95"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {t('designImageGenerationFailed', {
                      defaultValue: 'Image generation failed',
                      seconds: Math.max(1, Math.round((entry.elapsedMs ?? 0) / 1000))
                    })}
                  </span>
                  {entry.prompt ? (
                    <button
                      type="button"
                      onClick={() => {
                        useImageGenerationProgressStore.getState().replaceEntries(
                          Object.fromEntries(
                            Object.entries(useImageGenerationProgressStore.getState().entries)
                              .filter(([id]) => id !== entry.toolCallId)
                          )
                        )
                        onRequestImageRegenerate?.(entry.prompt ?? '')
                      }}
                      className="shrink-0 rounded-full bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90"
                      title={entry.prompt}
                    >
                      {t('designImageGenerationRetry', { defaultValue: 'Retry' })}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </aside>
    )
  }

  return (
    <aside className={codeCanvasPanelShellClass(className, presentation)}>
      <div className="pointer-events-none absolute left-3 right-3 top-3 z-50 flex min-w-0 items-start">
        <div className={codeCanvasPanelTitlebarClass()} data-code-canvas-titlebar="true">
          <button
            type="button"
            onClick={onCollapse}
            className="ds-sidebar-toggle-button shrink-0"
            aria-label={t('rightPanelCollapse')}
            title={t('rightPanelCollapse')}
          >
            <PanelRightClose className="h-4 w-4" strokeWidth={1.85} />
          </button>
          <div className="flex min-w-0 items-center gap-1.5 pl-1 pr-2">
            <Shapes className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} />
            <span className="min-w-0 truncate text-[12.5px] font-medium text-ds-ink">
              {t('rightPanelWhiteboard')}
            </span>
          </div>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {ready ? (
          <>
            <CanvasViewport
              workspaceRoot={workspaceRoot}
              artifactId={artifactId}
              baseDir={CODE_CANVAS_DIR}
              designSystemBaseDir={designSystemBaseDir}
              surface="code"
            />
            <PropertiesPanel surface="code" />
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="rounded-full bg-ds-surface-subtle p-3 text-ds-faint dark:bg-white/6">
              <Shapes className="h-6 w-6" strokeWidth={1.65} />
            </div>
            <div className="max-w-64 text-[12px] leading-5 text-ds-muted">
              {t('codeCanvasPanelNeedsThread')}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
