import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { AlertTriangle, ChevronUp, ExternalLink, GitBranch, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { graphNodeLiveness } from '../../graph/graph-liveness'
import { selectGraphPlanningCorrectionDraft, useGraphStore } from '../../graph/graph-store'
import { formatSubagentElapsed, useSubagentReducedMotion } from '../subagents/SubagentLiveness'
import { getComposerGraphProgress, selectComposerGraphRun } from './composer-graph-preview'
import { AgentStack, FloatingComposerGraphPreview } from './FloatingComposerGraphPreview'
import {
  calculateComposerPopoverPlacement,
  currentComposerBodyZoom,
  type ComposerPopoverPlacement
} from './floating-composer-popover-placement'

const GRAPH_POPOVER_WIDTH = 680
const GRAPH_POPOVER_MAX_HEIGHT = 420
const GRAPH_POPOVER_ESTIMATED_HEIGHT = 390

export { FloatingComposerGraphPreview } from './FloatingComposerGraphPreview'

export function FloatingComposerGraphProgress({
  threadId,
  enabled,
  onOpenGraph,
  onOpenChild
}: {
  threadId: string | null
  enabled: boolean
  onOpenGraph?: (runId: string, nodeId?: string) => void
  onOpenChild?: (
    runId: string,
    nodeId: string,
    attemptId: string,
    childThreadId: string
  ) => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  const reducedMotion = useSubagentReducedMotion()
  const runs = useGraphStore((state) => state.runs)
  const drafts = useGraphStore((state) => state.drafts)
  const childRuns = useGraphStore((state) => state.childRuns)
  const selectedRunId = useGraphStore((state) => state.selectedRunId)
  const refreshThread = useGraphStore((state) => state.refreshThread)
  const resumeDraft = useGraphStore((state) => state.resumeDraft)
  const cancelDraft = useGraphStore((state) => state.cancelDraft)
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [placement, setPlacement] = useState<ComposerPopoverPlacement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const hoverCloseTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled || !threadId) return
    void refreshThread(threadId)
  }, [enabled, refreshThread, threadId])

  useEffect(() => {
    setOpen(false)
  }, [enabled, threadId])

  const threadRuns = threadId ? runs.filter((candidate) => candidate.threadId === threadId) : []
  const run = enabled ? selectComposerGraphRun(threadRuns, selectedRunId) : null
  const correctionDraft = enabled
    ? selectGraphPlanningCorrectionDraft(drafts, threadId)
    : null
  const progress = run ? getComposerGraphProgress(run, childRuns) : null
  const currentProjection = run && progress?.currentNodeId
    ? run.nodes[progress.currentNodeId]
    : undefined
  const currentLiveness = currentProjection
    ? graphNodeLiveness(currentProjection, childRuns, now, run?.supervision)
    : null

  useEffect(() => {
    if (!run || !progress?.activeCount || typeof window === 'undefined') return
    const id = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(id)
  }, [progress?.activeCount, run])

  useEffect(() => {
    if (!open || !run || typeof window === 'undefined') {
      setPlacement(null)
      return
    }
    const updatePlacement = (): void => {
      const button = buttonRef.current
      if (!button) return
      setPlacement(calculateComposerPopoverPlacement({
        anchorRect: button.getBoundingClientRect(),
        popoverHeight: popoverRef.current?.offsetHeight ?? GRAPH_POPOVER_ESTIMATED_HEIGHT,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        coordinateScale: currentComposerBodyZoom(),
        preferredWidth: GRAPH_POPOVER_WIDTH,
        maximumHeight: GRAPH_POPOVER_MAX_HEIGHT
      }))
    }
    updatePlacement()
    const frame = window.requestAnimationFrame(updatePlacement)
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [open, run])

  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => () => {
    if (hoverCloseTimerRef.current != null && typeof window !== 'undefined') {
      window.clearTimeout(hoverCloseTimerRef.current)
    }
  }, [])

  if (!run && correctionDraft) {
    const issue = correctionDraft.draft.issues[0]
    return (
      <div
        data-composer-stack-item="graph"
        data-graph-planning-correction
        className="ds-composer-status-glass ds-composer-status-glass--warning pointer-events-auto flex min-h-12 w-full max-w-[46rem] shrink-0 items-center gap-3 rounded-2xl border px-3 py-2 text-left"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4" strokeWidth={1.9} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-semibold text-ds-ink">
            {t('graphPlanningStatus_needs_correction')}
          </span>
          <span className="mt-0.5 block truncate text-[10px] text-ds-muted">
            {issue
              ? `${issue.path.length ? `${issue.path.join('.')}: ` : ''}${issue.message}`
              : t('graphPlanningCorrectionBody')}
          </span>
        </span>
        <button
          type="button"
          data-graph-planning-cancel
          onClick={() => void cancelDraft(correctionDraft.draft.id)}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[10px] font-semibold text-ds-muted transition hover:bg-amber-500/10 hover:text-ds-ink"
        >
          <X className="h-3.5 w-3.5" />
          {t('graphPlanningCancel')}
        </button>
        <button
          type="button"
          data-graph-planning-resume
          onClick={() => void resumeDraft(correctionDraft.draft.id)}
          className="h-8 shrink-0 rounded-lg bg-indigo-600 px-3 text-[10px] font-semibold text-white transition hover:bg-indigo-500"
        >
          {t('graphPlanningContinue')}
        </button>
      </div>
    )
  }

  if (!run || !progress) return null

  const cancelClose = (): void => {
    if (hoverCloseTimerRef.current == null || typeof window === 'undefined') return
    window.clearTimeout(hoverCloseTimerRef.current)
    hoverCloseTimerRef.current = null
  }
  const openDetails = (): void => {
    cancelClose()
    setOpen(true)
  }
  const closeDetailsSoon = (): void => {
    cancelClose()
    if (typeof window === 'undefined') {
      setOpen(false)
      return
    }
    hoverCloseTimerRef.current = window.setTimeout(() => {
      hoverCloseTimerRef.current = null
      setOpen(false)
    }, 140)
  }
  const openFullGraph = (runId: string, nodeId?: string): void => {
    setOpen(false)
    onOpenGraph?.(runId, nodeId)
  }
  const popoverStyle: CSSProperties = placement
    ? {
        left: `${placement.left}px`,
        top: `${placement.top}px`,
        width: `${placement.width}px`,
        maxHeight: `${placement.maxHeight}px`
      }
    : {
        left: 0,
        top: 0,
        width: `${GRAPH_POPOVER_WIDTH}px`,
        maxHeight: `${GRAPH_POPOVER_MAX_HEIGHT}px`,
        visibility: 'hidden'
      }
  const statusLabel = t(`graphStatus_${run.status}`, { defaultValue: run.status })

  return (
    <>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              aria-label={t('graphComposerPreview')}
              className="ds-no-drag fixed z-[1000] flex flex-col gap-2.5 overflow-y-auto rounded-[22px] border border-ds-border bg-white p-3 text-ds-ink shadow-[0_20px_54px_rgba(20,47,95,0.18)] dark:bg-ds-card"
              style={popoverStyle}
              data-graph-composer-popover
              onPointerEnter={cancelClose}
              onPointerLeave={closeDetailsSoon}
              onFocus={cancelClose}
              onBlur={closeDetailsSoon}
            >
              <div className="flex shrink-0 items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <GitBranch className="h-4 w-4" strokeWidth={1.9} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-semibold text-ds-ink">
                    {run.plans.at(-1)?.title ?? t('graphPanelTitle')}
                  </div>
                  <div className="text-[10px] text-ds-faint">
                    {t('graphComposerProgress', {
                      completed: progress.completed,
                      total: progress.total,
                      status: statusLabel
                    })}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openFullGraph(run.id)}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-ds-border-muted px-2.5 text-[10px] font-semibold text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                >
                  {t('graphComposerOpenFull')}
                  <ExternalLink className="h-3 w-3" />
                </button>
              </div>
              <FloatingComposerGraphPreview
                run={run}
                childRuns={childRuns}
                now={now}
                reducedMotion={reducedMotion}
                onOpenGraph={openFullGraph}
                onOpenChild={onOpenChild}
              />
            </div>,
            document.body
          )
        : null}
      <div
        ref={rootRef}
        data-composer-stack-item="graph"
        className="pointer-events-auto w-full max-w-[46rem] shrink-0"
      >
        <button
          ref={buttonRef}
          type="button"
          onClick={openDetails}
          onFocus={openDetails}
          onBlur={closeDetailsSoon}
          onPointerEnter={openDetails}
          onPointerLeave={closeDetailsSoon}
          className="ds-no-drag ds-composer-status-glass flex min-h-11 w-full items-center gap-3 rounded-2xl border px-3 py-2 text-left transition hover:border-ds-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          aria-label={t('graphComposerAria', {
            completed: progress.completed,
            total: progress.total,
            status: statusLabel
          })}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <GitBranch className="h-4 w-4" strokeWidth={1.9} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="text-[12px] font-semibold text-ds-ink">Graph</span>
              <span className="truncate text-[11px] text-ds-muted">
                {currentLiveness?.quiet
                  ? t('graphStillWaiting', {
                      seconds: Math.floor((currentLiveness.lastActivityAgeMs ?? 0) / 1_000)
                    })
                  : currentLiveness?.activityLabel ??
                    t(`graphLiveness_${currentLiveness?.kind ?? 'idle'}`, {
                      defaultValue: progress.currentNodeTitle ?? statusLabel
                    })}
              </span>
              <span className="ml-auto shrink-0 text-[10px] font-semibold text-ds-faint">
                {t('graphCompletedAndRunning', {
                  completed: progress.completed,
                  total: progress.total,
                  running: progress.activeCount
                })}
              </span>
            </span>
            <span className="mt-0.5 flex items-center gap-2 text-[9px] text-ds-faint">
              <span className="truncate">
                {progress.currentNodeTitle ?? statusLabel}
                {progress.currentAgent ? ` · ${progress.currentAgent}` : ''}
                {progress.attemptNumber ? ` · #${progress.attemptNumber}` : ''}
              </span>
              {currentLiveness?.elapsedMs ? (
                <span className="ml-auto shrink-0 tabular-nums">
                  {formatSubagentElapsed(currentLiveness.elapsedMs)}
                </span>
              ) : null}
            </span>
            <span className="relative mt-1 block h-1 overflow-hidden rounded-full bg-ds-border-muted">
              <span
                className="block h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${Math.round(progress.fraction * 100)}%` }}
              />
              {progress.activeCount > 0 ? (
                <span
                  className={
                    reducedMotion
                      ? 'absolute inset-y-0 left-0 w-1/3 bg-accent/45'
                      : 'ds-subagent-lane-sweep absolute inset-y-0 w-2/5'
                  }
                  aria-hidden
                />
              ) : null}
            </span>
          </span>
          <AgentStack names={progress.activeAgents} />
          <ChevronUp
            className={`h-3.5 w-3.5 shrink-0 text-ds-faint transition-transform ${
              open ? 'rotate-180' : ''
            }`}
          />
        </button>
      </div>
    </>
  )
}
