import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactElement
} from 'react'
import { Check, ExternalLink, FileText, RefreshCw, Shapes, Sparkles, WandSparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  WorkWhiteboard,
  WorkWhiteboardPhase
} from '../../write/write-workspace-store'
import { CanvasViewport } from '../design/canvas/CanvasViewport'
import { PropertiesPanel } from '../design/canvas/PropertiesPanel'
import { useApplyShapeOpsLive } from '../../design/canvas/use-apply-shape-ops-live'
import type { PptCanvasProjectionOpenRequest } from '../../design/canvas/use-apply-shape-ops-live'
import type { ExecuteOpsOptions } from '../../design/canvas/shape-ops'
import { flushPendingCanvasDocuments } from '../../design/canvas/canvas-persistence'
import { useCanvasShapeStore } from '../../design/canvas/canvas-shape-store'
import { useCanvasSelectionStore } from '../../design/canvas/canvas-selection-store'
import {
  claimWritableWorkCanvas,
  releaseWritableWorkCanvas,
  resolveWorkCanvasIdentity,
  workCanvasHasBlockingQaNotes,
  workCanvasHasCompletePptReviewProjection,
  workCanvasPptSelectionState,
  workCanvasPptWorkflowGate
} from '../../design/canvas/work-canvas'
import { useWorkWhiteboardRenameLive } from './use-work-whiteboard-rename-live'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'

export type WorkWhiteboardSurfaceProps = {
  workspaceRoot: string
  boardId: string
  activeThreadId: string | null
  writable: boolean
  title?: string
  sourcePath?: string
  workflowId?: string
  childId?: string
  phase?: WorkWhiteboardPhase
  outputPath?: string
  onActivate?: () => void
  onRequestAssistant?: (prompt: string) => void
  onPptProjectionOpenRequested?: (request: PptCanvasProjectionOpenRequest) => void
  onOpenOutput?: (path: string) => void
  onError?: (message: string | null) => void
}

type ReviewAction = {
  labelKey: string
  prompt: string
  fallbackLabelKey?: string
  fallbackPrompt?: string
  icon: typeof Sparkles
  primary?: boolean
}

const REVIEW_ACTIONS: Partial<Record<WorkWhiteboardPhase, ReviewAction[]>> = {
  directions: [{
    labelKey: 'workWhiteboardRegenerateDirections',
    prompt: '重新生成当前 PPT 工作流的三个视觉方向，并更新此白板中的方向卡片。',
    icon: RefreshCw
  }, {
    labelKey: 'workWhiteboardAdoptDirection',
    prompt: '采用此白板中当前选中的视觉方向，并继续生成逐页演示稿。',
    fallbackLabelKey: 'workWhiteboardAdoptRecommendedDirection',
    fallbackPrompt: '采用当前 PPT 工作流的推荐视觉方向，并继续生成逐页演示稿。',
    icon: Check,
    primary: true
  }],
  review: [{
    labelKey: 'workWhiteboardModifySlides',
    prompt: '根据此白板中当前选中的幻灯片和批注修改这些页面，并返回更新后的逐页预览。',
    icon: WandSparkles
  }, {
    labelKey: 'workWhiteboardApproveExport',
    prompt: '当前逐页评审已通过，请运行最终 QA，修复阻断项，并导出 PPTX。',
    icon: Check,
    primary: true
  }]
}

export function workWhiteboardPhaseLabelKey(phase: WorkWhiteboardPhase): string {
  if (phase === 'directions') return 'workWhiteboardPhaseDirections'
  if (phase === 'review') return 'workWhiteboardPhaseReview'
  if (phase === 'complete') return 'workWhiteboardPhaseComplete'
  return 'workWhiteboardPhaseBlank'
}

export function workWhiteboardSourceLabel(sourcePath?: string): string | null {
  const normalized = sourcePath?.replace(/\\/g, '/').trim()
  if (!normalized) return null
  return normalized.split('/').filter(Boolean).pop() ?? null
}

function InactiveWorkWhiteboard({
  title,
  busy = false,
  onActivate
}: {
  title: string
  busy?: boolean
  onActivate?: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div
      className="flex h-full min-h-0 w-full items-center justify-center bg-[#f8fafc] p-6 dark:bg-[#111318]"
      data-work-whiteboard-placeholder="true"
    >
      <div className="flex max-w-sm flex-col items-center text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-accent/20 bg-accent-soft text-accent">
          <Shapes className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <h2 className="max-w-full truncate text-sm font-semibold text-ds-ink">{title}</h2>
        <p className="mt-1.5 text-xs leading-5 text-ds-muted">
          {t(busy ? 'workWhiteboardLeaseHint' : 'workWhiteboardInactiveHint')}
        </p>
        {onActivate ? (
          <button
            type="button"
            className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-white shadow-sm transition hover:brightness-105"
            onClick={onActivate}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t('workWhiteboardActivate')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function WorkWhiteboardStatus({ board }: { board: Pick<WorkWhiteboard, 'title' | 'phase' | 'sourcePath'> }): ReactElement {
  const { t } = useTranslation('common')
  const source = workWhiteboardSourceLabel(board.sourcePath)
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-50 flex max-w-[min(480px,calc(100%-96px))] items-center gap-2 rounded-full border border-ds-border-muted bg-white/88 px-3 py-1.5 shadow-[0_10px_28px_rgba(20,47,95,0.1)] backdrop-blur-2xl dark:bg-ds-canvas/90">
      <Shapes className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.9} />
      <span className="min-w-0 truncate text-xs font-semibold text-ds-ink">{board.title}</span>
      <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent">
        {t(workWhiteboardPhaseLabelKey(board.phase))}
      </span>
      {source ? (
        <span className="hidden min-w-0 items-center gap-1 truncate text-[10px] text-ds-faint sm:flex">
          <FileText className="h-3 w-3 shrink-0" />
          {t('workWhiteboardSource', { name: source })}
        </span>
      ) : null}
    </div>
  )
}

function WorkWhiteboardActions({
  phase,
  outputPath,
  approvalReady = false,
  approveBlocked,
  hasSelectedDirection,
  hasSelectedSlides,
  onRequestAssistant,
  onOpenOutput
}: {
  phase: WorkWhiteboardPhase
  outputPath?: string
  approvalReady?: boolean
  approveBlocked?: boolean
  hasSelectedDirection?: boolean
  hasSelectedSlides?: boolean
  onRequestAssistant?: (prompt: string) => void
  onOpenOutput?: (path: string) => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  const actions = REVIEW_ACTIONS[phase]
  if (phase === 'complete' && outputPath && onOpenOutput) {
    return (
      <div className="pointer-events-none absolute bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-2xl border border-ds-border-muted bg-white/90 p-1.5 shadow-[0_14px_34px_rgba(20,47,95,0.13)] backdrop-blur-2xl dark:bg-ds-canvas/92">
        <button
          type="button"
          className="pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-xl bg-accent-soft px-3 text-xs font-medium text-accent transition hover:brightness-95"
          onClick={() => onOpenOutput(outputPath)}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t('workWhiteboardOpenPptx')}
        </button>
      </div>
    )
  }
  if (!actions?.length || !onRequestAssistant) return null
  return (
    <div className="pointer-events-none absolute bottom-4 left-1/2 z-50 flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-1.5 rounded-2xl border border-ds-border-muted bg-white/90 p-1.5 shadow-[0_14px_34px_rgba(20,47,95,0.13)] backdrop-blur-2xl dark:bg-ds-canvas/92">
      {actions.map((action) => {
        const Icon = action.icon
        const isApproveAction = action.labelKey === 'workWhiteboardApproveExport'
        const usesDirectionFallback = action.labelKey === 'workWhiteboardAdoptDirection' && !hasSelectedDirection
        const missingSlides = action.labelKey === 'workWhiteboardModifySlides' && !hasSelectedSlides
        const approvalBlocked = isApproveAction && (!approvalReady || approveBlocked)
        const disabled = approvalBlocked || missingSlides
        const disabledTitle = isApproveAction && !approvalReady
          ? t('workWhiteboardCanvasLoadingHint')
          : isApproveAction && approveBlocked
            ? t('workWhiteboardQaBlockingHint')
          : missingSlides ? t('workWhiteboardSelectSlidesHint') : undefined
        const labelKey = usesDirectionFallback && action.fallbackLabelKey
          ? action.fallbackLabelKey
          : action.labelKey
        const prompt = usesDirectionFallback && action.fallbackPrompt
          ? action.fallbackPrompt
          : action.prompt
        return (
          <button
            key={action.labelKey}
            type="button"
            data-work-whiteboard-action={action.labelKey}
            className={`pointer-events-auto inline-flex h-8 min-w-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-45 ${
              action.primary
                ? 'bg-accent-soft text-accent hover:brightness-95'
                : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:hover:bg-transparent'
            }`}
            disabled={disabled}
            title={disabledTitle}
            onClick={() => {
              if (!disabled) onRequestAssistant(prompt)
            }}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
            <span className="truncate">{t(labelKey)}</span>
          </button>
        )
      })}
    </div>
  )
}

function MountedWorkWhiteboard(props: WorkWhiteboardSurfaceProps): ReactElement {
  const { t } = useTranslation('common')
  const phase = props.phase ?? 'blank'
  const identity = useMemo(
    () => resolveWorkCanvasIdentity(props.workspaceRoot, props.boardId),
    [props.boardId, props.workspaceRoot]
  )
  const document = useCanvasShapeStore((state) => state.document)
  const documentKey = useCanvasShapeStore((state) => state.documentKey)
  const selectedIds = useCanvasSelectionStore((state) => state.selectedIds)
  const [canvasDocumentLoaded, setCanvasDocumentLoaded] = useState(false)
  useWorkWhiteboardRenameLive({ boardId: props.boardId, threadId: props.activeThreadId })
  const activeDocument = documentKey === identity.documentKey
  const approveBlocked = activeDocument && workCanvasHasBlockingQaNotes(document, props.workflowId)
  const reviewProjectionReady = activeDocument && workCanvasHasCompletePptReviewProjection(
    document,
    props.workflowId,
    props.childId
  )
  const approvalReady = canvasDocumentLoaded && activeDocument &&
    (phase !== 'review' || reviewProjectionReady)
  useEffect(() => {
    setCanvasDocumentLoaded(false)
  }, [identity.documentKey])
  const pptSelection = useMemo(
    () => activeDocument
      ? workCanvasPptSelectionState(document, selectedIds, props.workflowId)
      : { direction: false, slides: false },
    [activeDocument, document, props.workflowId, selectedIds]
  )
  const executeOptions = useMemo<ExecuteOpsOptions>(() => ({
    screenFallback: 'plain-frame',
    shapePreset: 'diagram',
    lintFeedbackKey: identity.errorKey
  }), [identity.errorKey])
  const requestAssistant = props.onRequestAssistant
  const handleImageAssistant = useCallback(() => {
    requestAssistant?.(t('workWhiteboardImagePrompt'))
  }, [requestAssistant, t])
  const handleDocumentLoadStateChange = useCallback((loaded: boolean) => {
    setCanvasDocumentLoaded(loaded)
  }, [])
  const projectionOpenRequested = props.onPptProjectionOpenRequested
  const reportProjectionError = props.onError
  const projectionBoardId = props.boardId
  const handlePptProjectionOpenRequested = useCallback((request: PptCanvasProjectionOpenRequest) => {
    projectionOpenRequested?.(request)
    void flushPendingCanvasDocuments(identity.workspaceRoot).then(async () => {
      await useWriteWorkspaceStore.getState().updateWhiteboardPptState(
        projectionBoardId,
        { ...request.pptState, childId: request.childId }
      )
    }).catch((error: unknown) => {
      reportProjectionError?.(error instanceof Error ? error.message : String(error))
    })
  }, [identity.workspaceRoot, projectionBoardId, projectionOpenRequested, reportProjectionError])
  useApplyShapeOpsLive(
    Boolean(props.activeThreadId),
    undefined,
    executeOptions,
    identity.errorKey,
    props.activeThreadId,
    undefined,
    undefined,
    undefined,
    identity.documentKey,
    {
      workflowId: workCanvasPptWorkflowGate(props.boardId, props.workflowId),
      childId: props.childId,
      onOpenRequested: handlePptProjectionOpenRequested
    },
    'work'
  )

  return (
    <div className="relative h-full min-h-0 w-full" data-work-whiteboard-mounted={props.boardId}>
      <CanvasViewport
        workspaceRoot={identity.workspaceRoot}
        artifactId={identity.artifactId}
        baseDir={identity.baseDir}
        designSystemBaseDir={identity.designSystemBaseDir}
        surface="work"
        onRequestAssistant={handleImageAssistant}
        onDocumentLoadStateChange={handleDocumentLoadStateChange}
        onError={props.onError}
      />
      <PropertiesPanel surface="work" />
      <WorkWhiteboardStatus board={{
        title: props.title ?? t('writeUntitledWhiteboard'),
        phase,
        ...(props.sourcePath ? { sourcePath: props.sourcePath } : {})
      }} />
      <WorkWhiteboardActions
        phase={phase}
        outputPath={props.outputPath}
        approvalReady={approvalReady}
        approveBlocked={approveBlocked}
        hasSelectedDirection={pptSelection.direction}
        hasSelectedSlides={pptSelection.slides}
        onRequestAssistant={props.onRequestAssistant}
        onOpenOutput={props.onOpenOutput}
      />
    </div>
  )
}

function WritableWorkWhiteboard(props: WorkWhiteboardSurfaceProps): ReactElement {
  const ownerId = useId()
  const [ownsLease, setOwnsLease] = useState(false)
  useLayoutEffect(() => {
    let cancelled = false
    setOwnsLease(false)
    void flushPendingCanvasDocuments(props.workspaceRoot).then(() => {
      if (!cancelled) setOwnsLease(claimWritableWorkCanvas(ownerId, props.boardId))
    })
    return () => {
      cancelled = true
      void flushPendingCanvasDocuments(props.workspaceRoot)
      releaseWritableWorkCanvas(ownerId)
    }
  }, [ownerId, props.boardId, props.workspaceRoot])
  if (!ownsLease) {
    return (
      <InactiveWorkWhiteboard
        title={props.title ?? props.boardId}
        busy
        onActivate={props.onActivate}
      />
    )
  }
  return <MountedWorkWhiteboard {...props} />
}

/** Only the focused Work editor group is allowed to mount the singleton canvas stores. */
export function WorkWhiteboardSurface(props: WorkWhiteboardSurfaceProps): ReactElement {
  if (!props.writable) {
    return (
      <InactiveWorkWhiteboard
        title={props.title ?? props.boardId}
        onActivate={props.onActivate}
      />
    )
  }
  return <WritableWorkWhiteboard key={props.boardId} {...props} />
}
