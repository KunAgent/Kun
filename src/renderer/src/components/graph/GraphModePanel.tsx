import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import {
  BrainCircuit,
  GitBranch,
  RefreshCw,
  Users
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'
import { openGraphChildThread } from '../../graph/graph-child-navigation'
import { useGraphStore } from '../../graph/graph-store'
import { useGraphThreadObserver } from '../../graph/use-graph-thread-observer'
import type { GraphPlanningDraftView, GraphRun, GraphRunStatus } from '../../graph/graph-types'
import { GraphAgentsView } from './GraphAgentsView'
import { GraphLearningView } from './GraphLearningView'
import { GraphPlanningCard } from './GraphPlanningCard'
import { GraphRunView } from './GraphRunView'
import {
  criticalPathNodeIds,
  filterGraphElementsByPhases,
  graphElements,
  plannedAssignmentLabel,
  runProgress
} from './graph-elements'
import { usePrefersReducedMotion } from './graph-panel-shared'

export {
  criticalPathNodeIds,
  filterGraphElementsByPhases,
  graphElements,
  plannedAssignmentLabel,
  runProgress
} from './graph-elements'

type View = 'run' | 'agents' | 'learning'

export const GRAPH_DASHBOARD_SNAPSHOT_REFRESH_INTERVAL_MS = 5_000

/** Hard terminal Graph run statuses — only these may stop fallback polling. */
export const GRAPH_RUN_TERMINAL_STATUSES = new Set<GraphRunStatus>([
  'completed',
  'failed',
  'cancelled'
])

export function graphRunStatusIsTerminal(status: GraphRunStatus): boolean {
  return GRAPH_RUN_TERMINAL_STATUSES.has(status)
}

const livePlanningDraftStatuses = new Set<GraphPlanningDraftView['draft']['status']>([
  'planning',
  'validating',
  'repairing',
  'committing'
])

/**
 * v0.2.35 / #1072 contract: while any non-terminal run, live planning draft, or
 * active Graph source turn exists, poll durable snapshots every 5s — independent
 * of SSE syncStatus. Live SSE is the low-latency path; HTTP snapshot is the
 * reliability backstop when the event bridge is silently stuck.
 */
export function graphDashboardNeedsSnapshotRefresh(
  runs: readonly Pick<GraphRun, 'status'>[],
  drafts: readonly Pick<GraphPlanningDraftView, 'draft'>[],
  sourceGraphTurnActive: boolean
): boolean {
  if (sourceGraphTurnActive) return true
  if (drafts.some((draft) => livePlanningDraftStatuses.has(draft.draft.status))) {
    return true
  }
  return runs.some((run) => !graphRunStatusIsTerminal(run.status))
}

/** True only when the store binding matches the panel's target thread. */
export function graphProjectionOwnedByThread(
  storeThreadId: string | null,
  graphThreadId: string | null
): boolean {
  return Boolean(graphThreadId) && storeThreadId === graphThreadId
}

export function useGraphDashboardSnapshotRefresh({
  active,
  threadId,
  shouldRefresh,
  refreshThread
}: {
  active: boolean
  threadId: string | null
  shouldRefresh: boolean
  refreshThread: (threadId: string, options?: { silent?: boolean }) => Promise<void>
}): void {
  useEffect(() => {
    if (!active || !threadId || !shouldRefresh) return
    let disposed = false
    let timeout: ReturnType<typeof globalThis.setTimeout> | null = null
    const scheduleRefresh = (): void => {
      timeout = globalThis.setTimeout(() => {
        void refreshThread(threadId, { silent: true })
        .catch(() => undefined)
        .finally(() => {
          if (!disposed) scheduleRefresh()
        })
      }, GRAPH_DASHBOARD_SNAPSHOT_REFRESH_INTERVAL_MS)
    }
    scheduleRefresh()
    return () => {
      disposed = true
      if (timeout !== null) globalThis.clearTimeout(timeout)
    }
  }, [active, refreshThread, shouldRefresh, threadId])
}

export function selectGraphPlanningDraft(
  drafts: readonly GraphPlanningDraftView[],
  hasRun: boolean
): GraphPlanningDraftView | null {
  const active = drafts.find((item) =>
    !['committed', 'cancelled', 'host_error'].includes(item.draft.status))
  if (active) return active
  if (hasRun) return null
  // A host failure is rendered once by TurnService in the chat timeline.
  // Keep the durable draft queryable by id without creating a second error surface here.
  return drafts.find((item) => item.draft.status !== 'host_error') ?? null
}

export function GraphModePanel({
  className = '',
  onCollapse,
  active = true
}: {
  className?: string
  onCollapse?: () => void
  active?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const reducedMotion = usePrefersReducedMotion()
  const activeThreadId = useChatStore((state) => state.activeThreadId)
  const workspaceRoot = useChatStore((state) => state.workspaceRoot)
  const threadBusy = useChatStore((state) => state.busy)
  const currentTurnOrchestration = useChatStore((state) => state.currentTurnOrchestration)
  const [view, setView] = useState<View>('run')
  const [steering, setSteering] = useState('')
  const {
    threadId: storeThreadId,
    runs: storeRuns,
    drafts: storeDrafts,
    childRuns: storeChildRuns,
    childReturnTarget,
    selectedRunId,
    selectedNodeId,
    profiles,
    evidence,
    scores,
    audit,
    candidates,
    jobs,
    exportedProfile,
    artifactPage,
    artifactContent,
    artifactLoading,
    identity,
    loading,
    error,
    syncStatus,
    refreshThread,
    refreshProject,
    refreshSelectedRun,
    selectRun,
    selectNode,
    setChildReturnTarget,
    command,
    cancel,
    resumeDraft,
    cancelDraft,
    retryNode,
    reviewNode,
    wakeLead,
    wakingObligationId,
    patch,
    rebindNode,
    steer,
    loadArtifact,
    loadNextArtifactPage,
    clearArtifact,
    transitionProfile,
    exportProfile,
    importProfile,
    mergeProfiles,
    governCandidate,
    consolidate
  } = useGraphStore()
  const [now, setNow] = useState(() => Date.now())
  const graphThreadId = childReturnTarget?.childThreadId === activeThreadId
    ? childReturnTarget.parentThreadId
    : activeThreadId
  // Render gate: never show thread-A projection under thread-B before bind runs.
  const projectionOwned = graphProjectionOwnedByThread(storeThreadId, graphThreadId)
  const runs = projectionOwned ? storeRuns : []
  const drafts = projectionOwned ? storeDrafts : []
  const childRuns = projectionOwned ? storeChildRuns : {}
  const sourceGraphTurnActive = graphThreadId === activeThreadId &&
    threadBusy && currentTurnOrchestration === 'graph'
  // Polling decision uses owned projection only; syncStatus is display-only.
  const shouldRefreshSnapshot = graphDashboardNeedsSnapshotRefresh(
    runs,
    drafts,
    sourceGraphTurnActive
  )

  // Independent of chat busy: Graph SSE keeps projecting after Lead settles.
  // Ownership is atomic via bindGraphThread (not effect order with refreshThread).
  useGraphThreadObserver(graphThreadId, active)

  useEffect(() => {
    if (!active) return
    void refreshThread(graphThreadId)
  }, [active, graphThreadId, refreshThread])

  useGraphDashboardSnapshotRefresh({
    active,
    threadId: graphThreadId,
    shouldRefresh: shouldRefreshSnapshot,
    refreshThread
  })

  useEffect(() => {
    void refreshProject(workspaceRoot)
  }, [refreshProject, workspaceRoot])

  const run = projectionOwned
    ? (runs.find((item) => item.id === selectedRunId) ?? runs[0] ?? null)
    : null
  const planningDraft = selectGraphPlanningDraft(drafts, Boolean(run))
  const selectedNode = run && selectedNodeId ? run.nodes[selectedNodeId] : undefined
  const canvasFocusRequestKey = run && selectedNodeId
    ? `${activeThreadId ?? ''}:${run.id}:${selectedNodeId}`
    : null
  const hasActiveNode = Boolean(run && Object.values(run.nodes).some((node) =>
    ['queued', 'running', 'submitted', 'reviewing', 'repair_required'].includes(node.status)))
  useEffect(() => {
    if (!hasActiveNode) return
    const id = globalThis.setInterval(() => setNow(Date.now()), 1_000)
    return () => globalThis.clearInterval(id)
  }, [hasActiveNode])

  const openChild = useCallback((
    threadId: string,
    nodeId: string,
    attemptId: string
  ): void => {
    if (!run) return
    setChildReturnTarget({
      parentThreadId: run.threadId,
      childThreadId: threadId,
      runId: run.id,
      nodeId,
      attemptId,
      parentEventSeq: useChatStore.getState().lastSeq,
      childSessionStatus: 'creating',
      observerStatus: 'connecting',
      openedAt: new Date().toISOString()
    })
    void openGraphChildThread(threadId)
  }, [run, setChildReturnTarget])
  const elements = useMemo(
    () => run
      ? graphElements(run, reducedMotion, selectedNodeId, {
          childRuns,
          now,
          onOpenChild: (nodeId, attemptId, threadId) => {
            openChild(threadId, nodeId, attemptId)
          },
          waitingUpstreamLabel: t('graphWaitingUpstream'),
          viewLiveWorkLabel: t('graphViewLiveWork')
        })
      : { nodes: [], edges: [] },
    [childRuns, now, openChild, reducedMotion, run, selectedNodeId, t]
  )
  const progress = run ? runProgress(run) : { completed: 0, total: 0 }

  const sendSteering = (): void => {
    const value = steering.trim()
    if (!value || !run) return
    setSteering('')
    void steer(value, selectedNode?.node.id)
  }

  return (
    <section
      className={`${className} graph-mode-panel ds-no-drag flex min-h-0 flex-col bg-ds-sidebar`}
      data-graph-mode-panel
    >
      <header className="flex shrink-0 items-center justify-between border-b border-ds-border-muted px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/12 text-indigo-600 dark:text-indigo-200">
            <GitBranch className="h-4 w-4" strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-ds-ink">
              {t('graphPanelTitle', { defaultValue: 'Graph Mode' })}
            </div>
            <div className="truncate text-[10px] text-ds-faint">
              {identity?.source.replaceAll('_', ' ') ?? 'project orchestration'}
              {syncStatus === 'live'
                ? ` · ${t('graphObserver_live')}`
                : null}
              {syncStatus === 'connecting'
                ? ` · ${t('graphObserver_connecting')}`
                : null}
              {syncStatus === 'reconnecting'
                ? ` · ${t('graphObserver_reconnecting')}`
                : null}
              {syncStatus === 'stopped'
                ? ` · ${t('graphObserver_stopped')}`
                : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              void refreshThread(graphThreadId)
              void refreshProject(workspaceRoot)
            }}
            className="rounded-lg p-2 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('refresh', { defaultValue: 'Refresh' })}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {onCollapse ? (
            <button
              type="button"
              onClick={onCollapse}
              className="rounded-lg px-2 py-1 text-[11px] text-ds-muted transition hover:bg-ds-hover"
            >
              {t('close', { defaultValue: 'Close' })}
            </button>
          ) : null}
        </div>
      </header>

      <nav className="flex shrink-0 gap-1 border-b border-ds-border-muted px-3 py-2">
        {([
          ['run', GitBranch, t('graphPanelRun', { defaultValue: 'Run' })],
          ['agents', Users, t('graphPanelAgents', { defaultValue: 'Project Agents' })],
          ['learning', BrainCircuit, t('graphPanelLearning', { defaultValue: 'Learning' })]
        ] as const).map(([id, Icon, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold transition ${
              view === id ? 'bg-ds-hover text-ds-ink' : 'text-ds-faint hover:text-ds-muted'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </nav>

      {error ? (
        <div role="alert" className="mx-3 mt-2 rounded-lg border border-red-400/30 bg-red-500/8 px-3 py-2 text-[11px] text-red-700 dark:text-red-200">
          {error}
        </div>
      ) : null}

      {view === 'run' ? (
        planningDraft ? (
          <GraphPlanningCard
            view={planningDraft}
            onResume={() => void resumeDraft(planningDraft.draft.id)}
            onCancel={() => void cancelDraft(planningDraft.draft.id)}
          />
        ) : <GraphRunView
          run={run}
          runs={runs}
          elements={elements}
          progress={progress}
          selectedNode={selectedNode}
          selectedNodeId={selectedNodeId}
          canvasFocusRequestKey={canvasFocusRequestKey}
          steering={steering}
          onSteeringChange={setSteering}
          onSendSteering={sendSteering}
          onSelectRun={selectRun}
          onSelectNode={selectNode}
          onRefresh={() => void refreshSelectedRun()}
          onCommand={(action) => void command(action)}
          onCancel={() => void cancel()}
          wakingObligationId={wakingObligationId}
          onWakeLead={(obligationId) => void wakeLead(obligationId)}
          onRetry={(nodeId) => void retryNode(nodeId)}
          onReview={(nodeId, outcome) => void reviewNode(nodeId, outcome)}
          onPatch={(operations, reason) => patch(operations, reason)}
          onRebind={(nodeId, profileId) => void rebindNode(nodeId, profileId)}
          onOpenChild={openChild}
          artifactPage={artifactPage}
          artifactContent={artifactContent}
          artifactLoading={artifactLoading}
          onOpenArtifact={(artifactId) => void loadArtifact(artifactId)}
          onNextArtifactPage={() => void loadNextArtifactPage()}
          onCloseArtifact={clearArtifact}
        />
      ) : view === 'agents' ? (
        <GraphAgentsView
          profiles={profiles}
          evidence={evidence}
          scores={scores}
          audit={audit}
          exportedProfile={exportedProfile}
          onTransition={(profileId, lifecycle) => void transitionProfile(profileId, lifecycle)}
          onExport={(profileId) => void exportProfile(profileId)}
          onImport={(value) => void importProfile(value)}
          onMerge={(sourceProfileIds, targetProfileId, name) =>
            void mergeProfiles(sourceProfileIds, targetProfileId, name)}
        />
      ) : (
        <GraphLearningView
          candidates={candidates}
          jobs={jobs}
          onConsolidate={() => void consolidate()}
          onAction={(candidateId, action) => void governCandidate(candidateId, action)}
        />
      )}
    </section>
  )
}
