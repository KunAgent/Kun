import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  act,
  create as createRenderer,
  type ReactTestRenderer
} from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  GraphAttempt,
  GraphChildRuntime,
  GraphPlanNode,
  GraphPlanningDraftView,
  GraphRun
} from '../../graph/graph-types'
import {
  criticalPathNodeIds,
  filterGraphElementsByPhases,
  graphElements,
  GRAPH_DASHBOARD_SNAPSHOT_REFRESH_INTERVAL_MS,
  graphDashboardNeedsSnapshotRefresh,
  graphProjectionOwnedByThread,
  plannedAssignmentLabel,
  runProgress,
  selectGraphPlanningDraft,
  useGraphDashboardSnapshotRefresh
} from './GraphModePanel'
import { reconcileInteractiveGraphNodes } from './graph-canvas-state'
import { clampGraphInspectorWidth } from './graph-workspace-layout'

const graphClient = vi.hoisted(() => ({
  listRuns: vi.fn(),
  listDrafts: vi.fn(),
  delegationDiagnostics: vi.fn()
}))

vi.mock('../../graph/graph-runtime-client', () => ({
  graphRuntimeClient: graphClient
}))

import { useGraphStore } from '../../graph/graph-store'

function node(id: string, phaseId: string): GraphPlanNode {
  return {
    id,
    phaseId,
    kind: 'work',
    title: id,
    objective: `Complete ${id}`,
    priority: 0,
    required: true,
    riskClass: 'low',
    readScopes: [],
    writeScopes: []
  }
}

function graphRun(nodes: GraphPlanNode[], edges: GraphRun['plans'][number]['edges']): GraphRun {
  return {
    version: 1,
    id: 'run_1',
    projectId: 'project_1',
    threadId: 'thread_1',
    sourceTurnId: 'turn_1',
    status: 'running',
    currentRevision: 1,
    plans: [{
      version: 1,
      revision: 1,
      title: 'Test graph',
      goal: 'Verify projection',
      workspaceRoot: '/repo',
      phases: [
        { id: 'phase_1', title: 'One', order: 1 },
        { id: 'phase_2', title: 'Two', order: 2 },
        { id: 'phase_3', title: 'Three', order: 3 }
      ],
      nodes,
      edges,
      completionNodeIds: [nodes.at(-1)!.id],
      createdAt: '2026-07-26T00:00:00.000Z'
    }],
    nodes: Object.fromEntries(nodes.map((item, index) => [
      item.id,
      {
        node: item,
        status: index === 0 ? 'accepted' : 'pending',
        attempts: [],
        loopIteration: 0
      }
    ])),
    reviews: [],
    messages: [],
    artifacts: [],
    cleanup: [],
    steering: [],
    budget: {
      limits: {
        maxWallTimeMs: 60_000,
        maxAttemptsPerNode: 3
      },
      attempts: 0,
      revisions: 0,
      loopIterations: 0,
      elapsedMs: 0,
      totalTokens: 0,
      messages: 0,
      artifactBytes: 0,
      warningKinds: [],
      closed: false
    },
    lastEventSeq: 1,
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z'
  }
}

function planningDraft(
  id: string,
  status: GraphPlanningDraftView['draft']['status']
): GraphPlanningDraftView {
  return {
    draft: {
      version: 1,
      id,
      reservedRunId: `run_${id}`,
      threadId: 'thread_1',
      sourceTurnId: `turn_${id}`,
      projectId: 'project_1',
      goal: 'Test planning projection.',
      revision: 1,
      status,
      issues: [],
      repairCount: 0,
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:00:00.000Z'
    },
    tasks: []
  }
}

function SnapshotRefreshHarness({
  active,
  shouldRefresh,
  refreshThread
}: {
  active: boolean
  shouldRefresh: boolean
  refreshThread: (threadId: string, options?: { silent?: boolean }) => Promise<void>
}): null {
  useGraphDashboardSnapshotRefresh({
    active,
    threadId: 'thread_1',
    shouldRefresh,
    refreshThread
  })
  return null
}

/**
 * Drives the real #1072 poll gate from store state — must not hard-code shouldRefresh.
 */
function StoreDrivenSnapshotRefreshHarness({
  active,
  sourceGraphTurnActive = false
}: {
  active: boolean
  sourceGraphTurnActive?: boolean
}): null {
  const threadId = useGraphStore((state) => state.threadId)
  const runs = useGraphStore((state) => state.runs)
  const drafts = useGraphStore((state) => state.drafts)
  const refreshThread = useGraphStore((state) => state.refreshThread)
  const shouldRefresh = graphDashboardNeedsSnapshotRefresh(
    runs,
    drafts,
    sourceGraphTurnActive
  )
  useGraphDashboardSnapshotRefresh({
    active,
    threadId,
    shouldRefresh,
    refreshThread
  })
  return null
}

describe('Graph Mode panel projection', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the v0.2.35 snapshot poll contract independent of SSE live status', () => {
    const liveRun = graphRun([node('work', 'phase_1')], [])
    const completed = { ...liveRun, status: 'completed' as const }
    const failed = { ...liveRun, status: 'failed' as const }
    const cancelled = { ...liveRun, status: 'cancelled' as const }
    const pausedRun = { ...liveRun, status: 'paused' as const }
    const awaitingHuman = { ...liveRun, status: 'awaiting_human' as const }

    // Non-terminal + SSE live must still poll (silent event bridge failure path).
    expect(graphDashboardNeedsSnapshotRefresh([liveRun], [], false)).toBe(true)
    expect(graphDashboardNeedsSnapshotRefresh([pausedRun], [], false)).toBe(true)
    expect(graphDashboardNeedsSnapshotRefresh([awaitingHuman], [], false)).toBe(true)

    // Hard terminals without live drafts / source turn stop poll.
    expect(graphDashboardNeedsSnapshotRefresh([completed], [], false)).toBe(false)
    expect(graphDashboardNeedsSnapshotRefresh([failed], [], false)).toBe(false)
    expect(graphDashboardNeedsSnapshotRefresh([cancelled], [], false)).toBe(false)

    // Planning draft / source turn still force poll with no runs.
    expect(graphDashboardNeedsSnapshotRefresh([], [planningDraft('draft_1', 'planning')], false))
      .toBe(true)
    expect(graphDashboardNeedsSnapshotRefresh([], [], true)).toBe(true)
  })

  it('gates rendered projection on store thread ownership', () => {
    expect(graphProjectionOwnedByThread('thread_a', 'thread_a')).toBe(true)
    expect(graphProjectionOwnedByThread('thread_a', 'thread_b')).toBe(false)
    expect(graphProjectionOwnedByThread(null, 'thread_b')).toBe(false)
    expect(graphProjectionOwnedByThread('thread_b', null)).toBe(false)
  })

  it('polls durable Graph snapshots without overlapping requests and stops when hidden', async () => {
    vi.useFakeTimers()
    const resolveRefreshes: Array<() => void> = []
    const refreshThread = vi.fn(() => new Promise<void>((resolve) => {
      resolveRefreshes.push(resolve)
    }))
    let renderer!: ReactTestRenderer

    await act(async () => {
      renderer = createRenderer(createElement(SnapshotRefreshHarness, {
        active: true,
        shouldRefresh: true,
        refreshThread
      }))
    })

    await act(async () => {
      vi.advanceTimersByTime(GRAPH_DASHBOARD_SNAPSHOT_REFRESH_INTERVAL_MS)
      await Promise.resolve()
    })
    expect(refreshThread).toHaveBeenCalledTimes(1)
    expect(refreshThread).toHaveBeenLastCalledWith('thread_1', { silent: true })

    await act(async () => {
      vi.advanceTimersByTime(GRAPH_DASHBOARD_SNAPSHOT_REFRESH_INTERVAL_MS * 3)
      await Promise.resolve()
    })
    expect(refreshThread).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveRefreshes.shift()?.()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      vi.advanceTimersByTime(GRAPH_DASHBOARD_SNAPSHOT_REFRESH_INTERVAL_MS)
      await Promise.resolve()
    })
    expect(refreshThread).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolveRefreshes.shift()?.()
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      renderer.update(createElement(SnapshotRefreshHarness, {
        active: false,
        shouldRefresh: true,
        refreshThread
      }))
    })
    await act(async () => {
      vi.advanceTimersByTime(GRAPH_DASHBOARD_SNAPSHOT_REFRESH_INTERVAL_MS * 2)
      await Promise.resolve()
    })
    expect(refreshThread).toHaveBeenCalledTimes(2)

    await act(async () => renderer.unmount())
  })

  it('covers fully missed SSE by low-frequency snapshot fallback (seq 2 → 5, fake timers)', async () => {
    vi.useFakeTimers()
    graphClient.listDrafts.mockResolvedValue([])
    graphClient.delegationDiagnostics.mockResolvedValue({
      enabled: true,
      active: 0,
      childRuns: []
    })
    const runAt = (seq: number): GraphRun => ({
      ...graphRun([node('work', 'phase_1')], []),
      lastEventSeq: seq,
      status: 'running'
    })

    useGraphStore.setState({
      threadId: 'thread_1',
      runs: [runAt(2)],
      drafts: [],
      childRuns: {},
      syncStatus: 'live',
      threadEventSeq: 40,
      loading: false,
      error: null
    })
    // Gate must be true from real contract math — not a hard-coded shouldRefresh.
    expect(graphDashboardNeedsSnapshotRefresh(
      useGraphStore.getState().runs,
      useGraphStore.getState().drafts,
      false
    )).toBe(true)
    expect(useGraphStore.getState().syncStatus).toBe('live')
    expect(useGraphStore.getState().runs[0]?.lastEventSeq).toBe(2)

    graphClient.listRuns.mockResolvedValue([runAt(5)])

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(StoreDrivenSnapshotRefreshHarness, {
        active: true
      }))
    })

    await act(async () => {
      vi.advanceTimersByTime(GRAPH_DASHBOARD_SNAPSHOT_REFRESH_INTERVAL_MS)
      await Promise.resolve()
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(useGraphStore.getState().runs[0]?.lastEventSeq).toBe(5)
    })
    expect(graphClient.listRuns).toHaveBeenCalled()
    // No SSE Graph events were delivered; snapshot alone converged the projection.
    expect(useGraphStore.getState().syncStatus).toBe('live')

    await act(async () => renderer.unmount())
  })

  it('never lets a terminal host error hide the current run or create a second error surface', () => {
    const hostError = planningDraft('draft_failed', 'host_error')
    const correction = planningDraft('draft_active', 'needs_correction')

    expect(selectGraphPlanningDraft([hostError], true)).toBeNull()
    expect(selectGraphPlanningDraft([hostError], false)).toBeNull()
    expect(selectGraphPlanningDraft([hostError, correction], true)).toBe(correction)
  })

  it('marks the longest forward dependency path as critical and ignores message edges', () => {
    const nodes = [
      node('start', 'phase_1'),
      node('middle', 'phase_2'),
      node('side', 'phase_2'),
      node('finish', 'phase_3')
    ]
    const run = graphRun(nodes, [
      { id: 'e1', kind: 'control', from: 'start', to: 'middle' },
      { id: 'e2', kind: 'control', from: 'middle', to: 'finish' },
      { id: 'e3', kind: 'message', from: 'side', to: 'finish' }
    ])

    run.nodes.middle!.status = 'skipped'
    run.nodes.side!.status = 'superseded'

    expect([...criticalPathNodeIds(run)]).toEqual(['finish', 'middle', 'start'])
    expect(runProgress(run)).toEqual({ completed: 1, total: 4 })
  })

  it('projects a large graph without truncating nodes or edges', () => {
    const nodes = Array.from({ length: 500 }, (_, index) =>
      node(`node_${index}`, `phase_${index % 3 + 1}`))
    const edges = nodes.slice(1).map((item, index) => ({
      id: `edge_${index}`,
      kind: 'control' as const,
      from: nodes[index]!.id,
      to: item.id
    }))

    const elements = graphElements(graphRun(nodes, edges))

    expect(elements.nodes).toHaveLength(500)
    expect(elements.edges).toHaveLength(499)
  })

  it('keeps node labels accessible and disables animated edges for reduced motion', () => {
    const nodes = [node('start', 'phase_1'), node('finish', 'phase_2')]
    const run = graphRun(nodes, [{
      id: 'edge_1',
      kind: 'control',
      from: 'start',
      to: 'finish'
    }])
    run.nodes.finish!.status = 'running'

    const animated = graphElements(run, false)
    const reduced = graphElements(run, true)

    expect(animated.edges[0]?.animated).toBe(true)
    expect(animated.edges[0]?.className).toBe('graph-flow-edge-processing')
    expect(reduced.edges[0]?.animated).toBe(false)
    expect(reduced.edges[0]?.className).toBe('graph-flow-edge-processing')
    expect(reduced.nodes.map((item) => item.ariaLabel)).toEqual([
      'start: accepted; Kun auto route',
      'finish: running; Kun auto route'
    ])
    expect(renderToStaticMarkup(animated.nodes[1]?.data.label as ReactElement))
      .toContain('ds-subagent-lane-sweep')
    expect(renderToStaticMarkup(reduced.nodes[1]?.data.label as ReactElement))
      .not.toContain('ds-subagent-lane-sweep')
  })

  it('keeps waiting review edges static until the Lead has an active lease', () => {
    const nodes = [
      node('start', 'phase_1'),
      node('side', 'phase_1'),
      node('working', 'phase_2'),
      node('waiting', 'phase_3')
    ]
    const run = graphRun(nodes, [
      { id: 'into_working', kind: 'control', from: 'start', to: 'working' },
      { id: 'side_into_working', kind: 'data', from: 'side', to: 'working' },
      { id: 'out_of_working', kind: 'control', from: 'working', to: 'waiting' }
    ])
    run.nodes.working!.status = 'reviewing'

    const waiting = graphElements(run)

    expect(waiting.edges.map((edge) => [edge.id, edge.animated])).toEqual([
      ['into_working', false],
      ['side_into_working', false],
      ['out_of_working', false]
    ])

    run.supervision = {
      version: 1,
      runId: run.id,
      lastEventSeq: run.lastEventSeq,
      leadActive: true,
      liveness: 'active_review',
      pendingActions: [{
        obligationId: 'obligation_review',
        pendingAction: 'review_required',
        nodeIds: ['working'],
        liveness: 'active_review',
        retryCount: 0,
        noProgressCount: 0,
        canWake: false
      }],
      canWake: false,
      updatedAt: run.updatedAt
    }

    const activeReview = graphElements(run)
    expect(activeReview.edges.map((edge) => [edge.id, edge.animated])).toEqual([
      ['into_working', true],
      ['side_into_working', true],
      ['out_of_working', false]
    ])
  })

  it('keeps all edges static after the Graph run becomes terminal', () => {
    const nodes = [node('start', 'phase_1'), node('finish', 'phase_2')]
    const run = graphRun(nodes, [{
      id: 'edge_1',
      kind: 'control',
      from: 'start',
      to: 'finish'
    }])
    run.nodes.finish!.status = 'running'
    run.status = 'completed'

    expect(graphElements(run).edges[0]).toMatchObject({
      animated: false,
      className: undefined
    })
  })

  it('animates into a ready node when its correlated child is already running', () => {
    const nodes = [node('start', 'phase_1'), node('finish', 'phase_2')]
    const run = graphRun(nodes, [{
      id: 'edge_1',
      kind: 'control',
      from: 'start',
      to: 'finish'
    }])
    run.nodes.finish!.status = 'ready'
    run.nodes.finish!.attempts = [{
      id: 'attempt_1',
      attemptNumber: 1,
      status: 'running',
      childThreadId: 'child_1',
      tokenUsage: 0,
      elapsedMs: 0,
      assignment: { name: 'Builder' } as GraphAttempt['assignment']
    }]
    const childRuns: Record<string, GraphChildRuntime> = {
      child_1: {
        childId: 'child_1',
        parentThreadId: 'thread_1',
        parentTurnId: 'turn_1',
        status: 'running',
        updatedAt: '2026-07-29T00:00:00.000Z'
      }
    }

    expect(graphElements(run, false, null, { childRuns }).edges[0]).toMatchObject({
      animated: true,
      className: 'graph-flow-edge-processing'
    })
  })

  it('uses neutral styling for ordinary dependency waiting', () => {
    const waiting = node('waiting', 'phase_1')
    const run = graphRun([waiting], [])
    run.nodes.waiting!.status = 'blocked'

    const projected = graphElements(run)

    expect(projected.nodes[0]?.style).toMatchObject({
      border: '1px solid var(--ds-border-muted)'
    })
    expect(renderToStaticMarkup(projected.nodes[0]?.data.label as ReactElement))
      .toContain('Waiting for upstream node')
  })

  it('collapses phases without leaving dangling edges and supports a bounded list fallback', () => {
    const nodes = [
      node('start', 'phase_1'),
      node('middle', 'phase_2'),
      node('finish', 'phase_3')
    ]
    const run = graphRun(nodes, [
      { id: 'e1', kind: 'control', from: 'start', to: 'middle' },
      { id: 'e2', kind: 'control', from: 'middle', to: 'finish' }
    ])

    const filtered = filterGraphElementsByPhases(
      run,
      graphElements(run),
      new Set(['phase_2'])
    )

    expect(filtered.nodes.map((item) => item.id)).toEqual(['start', 'finish'])
    expect(filtered.edges).toEqual([])
  })

  it('shows the planned subagent before dispatch and the selected node clearly', () => {
    const planned = {
      ...node('research', 'phase_1'),
      assignment: {
        kind: 'existing' as const,
        profileId: 'explore',
        profileVersion: 2
      }
    }
    const projected = graphElements(graphRun([planned], []), false, 'research')

    expect(plannedAssignmentLabel(planned)).toBe('explore@2')
    expect(projected.nodes[0]).toMatchObject({
      id: 'research',
      selected: true,
      ariaLabel: 'research: accepted; explore@2'
    })
  })

  it('preserves dragged positions while refreshing status and selection data', () => {
    const incoming = graphElements(graphRun([
      node('start', 'phase_1'),
      node('finish', 'phase_2')
    ], [])).nodes
    const current = [{
      ...incoming[0]!,
      position: { x: 812, y: 408 }
    }]

    const reconciled = reconcileInteractiveGraphNodes(current, incoming, 'start')

    expect(reconciled[0]?.position).toEqual({ x: 812, y: 408 })
    expect(reconciled[0]?.selected).toBe(true)
    expect(reconciled[1]?.position).toEqual(incoming[1]?.position)
  })

  it('bounds the inspector while reserving usable canvas space', () => {
    expect(clampGraphInspectorWidth(360, 900)).toBe(360)
    expect(clampGraphInspectorWidth(800, 900)).toBe(378)
    expect(clampGraphInspectorWidth(100, 900)).toBe(280)
    expect(clampGraphInspectorWidth(360, 760)).toBe(319)
  })
})
