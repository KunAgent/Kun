import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  GraphEventEnvelope,
  GraphPlanNode,
  GraphPlanningDraftView,
  GraphRun
} from './graph-types'

const client = vi.hoisted(() => ({
  delegationDiagnostics: vi.fn(),
  listRuns: vi.fn(),
  listDrafts: vi.fn(),
  resumeDraft: vi.fn(),
  cancelDraft: vi.fn(),
  getDraft: vi.fn(),
  getRun: vi.fn(),
  identity: vi.fn(),
  listProfiles: vi.fn(),
  listEvidence: vi.fn(),
  listScores: vi.fn(),
  listAudit: vi.fn(),
  listCandidates: vi.fn(),
  listJobs: vi.fn(),
  patch: vi.fn(),
  steer: vi.fn(),
  readArtifact: vi.fn()
}))

vi.mock('./graph-runtime-client', () => ({
  graphRuntimeClient: client
}))

import {
  receiveGraphChildRuntimeEvent,
  receiveGraphPlanningRuntimeEvent,
  receiveGraphRuntimeEvent,
  selectGraphPlanningCorrectionDraft,
  useGraphStore
} from './graph-store'

function run(id: string, seq: number): GraphRun {
  return {
    version: 1,
    id,
    projectId: 'project_1',
    threadId: 'thread_1',
    sourceTurnId: 'turn_1',
    status: 'running',
    currentRevision: 1,
    plans: [],
    nodes: {},
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
    lastEventSeq: seq,
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z'
  }
}

function runWithNode(id: string, seq: number, nodeId: string): GraphRun {
  const node: GraphPlanNode = {
    id: nodeId,
    phaseId: 'phase_1',
    kind: 'work',
    title: 'Selected node',
    objective: 'Keep the selected inspector visible.',
    priority: 1,
    required: true,
    riskClass: 'low',
    readScopes: [],
    writeScopes: []
  }
  return {
    ...run(id, seq),
    plans: [{
      version: 1,
      revision: 1,
      title: 'Selection test',
      goal: 'Preserve durable selection',
      workspaceRoot: '/repo',
      phases: [{ id: 'phase_1', title: 'Phase', order: 1 }],
      nodes: [node],
      edges: [],
      completionNodeIds: [nodeId],
      createdAt: '2026-07-26T00:00:00.000Z'
    }],
    nodes: {
      [nodeId]: {
        node,
        status: 'running',
        attempts: [],
        loopIteration: 0
      }
    }
  }
}

function planningDraft(
  status: GraphPlanningDraftView['draft']['status'] = 'needs_correction',
  revision = 1
): GraphPlanningDraftView {
  return {
    draft: {
      version: 1,
      id: 'draft_1',
      reservedRunId: 'run_reserved_1',
      threadId: 'thread_1',
      sourceTurnId: 'turn_1',
      projectId: 'project_1',
      goal: 'Implement the requested change.',
      revision,
      status,
      issues: [],
      repairCount: status === 'planning' ? 0 : 1,
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:01.000Z'
    },
    tasks: []
  }
}

describe('Graph renderer store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGraphStore.setState({
      threadId: null,
      workspace: '',
      runs: [],
      drafts: [],
      childRuns: {},
      childReturnTarget: null,
      selectedRunId: null,
      selectedNodeId: null,
      identity: null,
      profiles: [],
      evidence: [],
      scores: [],
      audit: [],
      candidates: [],
      jobs: [],
      artifactPage: null,
      artifactContent: '',
      artifactLoading: false,
      wakingObligationId: null,
      loading: false,
      error: null,
      syncStatus: 'idle',
      threadEventSeq: 0
    })
    client.delegationDiagnostics.mockResolvedValue({
      enabled: true,
      active: 0,
      childRuns: []
    })
    client.listDrafts.mockResolvedValue([])
  })

  it('selects only a paused correction draft for the active thread', () => {
    const correcting = planningDraft('needs_correction', 2)
    const repairing = planningDraft('repairing', 3)
    repairing.draft.id = 'draft_repairing'
    repairing.draft.threadId = 'thread_2'

    expect(selectGraphPlanningCorrectionDraft(
      [repairing, correcting],
      'thread_1'
    )).toBe(correcting)
    expect(selectGraphPlanningCorrectionDraft([repairing], 'thread_2')).toBeNull()
    expect(selectGraphPlanningCorrectionDraft([correcting], null)).toBeNull()
  })

  it('reconciles an SSE hint against durable HTTP truth without optimistic mutation', async () => {
    client.listRuns.mockResolvedValueOnce([run('run_1', 1)])
    await useGraphStore.getState().refreshThread('thread_1')
    expect(useGraphStore.getState().runs[0]?.lastEventSeq).toBe(1)

    client.listRuns.mockResolvedValueOnce([run('run_1', 2)])
    receiveGraphRuntimeEvent({
      version: 1,
      eventId: 'event_2',
      runId: 'run_1',
      threadId: 'thread_1',
      graphSeq: 2,
      graphRevision: 1,
      timestamp: '2026-07-26T00:00:01.000Z',
      event: { type: 'node_status_changed', payload: {} }
    } satisfies GraphEventEnvelope)

    await vi.waitFor(() => {
      expect(useGraphStore.getState().runs[0]?.lastEventSeq).toBe(2)
    })
    expect(client.listRuns).toHaveBeenCalledTimes(2)
  })

  it('keeps periodic Graph snapshot reconciliation silent', async () => {
    let resolveRuns!: (runs: GraphRun[]) => void
    client.listRuns.mockReturnValueOnce(new Promise<GraphRun[]>((resolve) => {
      resolveRuns = resolve
    }))
    useGraphStore.setState({
      threadId: 'thread_1',
      loading: false,
      error: 'Keep an unrelated action error visible.'
    })

    const refresh = useGraphStore.getState().refreshThread('thread_1', { silent: true })
    expect(useGraphStore.getState()).toMatchObject({
      loading: false,
      error: 'Keep an unrelated action error visible.'
    })

    resolveRuns([run('run_1', 2)])
    await refresh

    expect(useGraphStore.getState()).toMatchObject({
      loading: false,
      error: 'Keep an unrelated action error visible.',
      runs: [{ id: 'run_1', lastEventSeq: 2 }]
    })
  })

  it('reconciles planning events and resumes with the current draft revision', async () => {
    useGraphStore.setState({
      threadId: 'thread_1',
      drafts: [planningDraft('repairing', 1)]
    })
    receiveGraphPlanningRuntimeEvent({
      version: 1,
      event: 'needs_correction',
      draftId: 'draft_1',
      reservedRunId: 'run_reserved_1',
      sourceTurnId: 'turn_1',
      revision: 2,
      state: 'needs_correction',
      issues: [{
        code: 'invalid_plan',
        path: ['tasks', 0, 'loop'],
        message: 'ordinary tasks cannot contain loop',
        repairHint: 'Remove loop from this task.'
      }],
      tasks: [{ key: 'work', kind: 'work', title: 'Implement' }]
    })
    expect(useGraphStore.getState().drafts[0]).toMatchObject({
      draft: {
        revision: 2,
        status: 'needs_correction',
        issues: [expect.objectContaining({ code: 'invalid_plan' })]
      },
      tasks: [{ key: 'work' }]
    })

    const resumed = planningDraft('planning', 3)
    client.resumeDraft.mockResolvedValueOnce(resumed)
    await useGraphStore.getState().resumeDraft('draft_1')

    expect(client.resumeDraft).toHaveBeenCalledWith('draft_1', 2)
    expect(useGraphStore.getState().drafts[0]?.draft).toMatchObject({
      revision: 3,
      status: 'planning'
    })
  })

  it('reloads the compensated revision after resume fails so Continue can retry', async () => {
    useGraphStore.setState({
      threadId: 'thread_1',
      drafts: [planningDraft('needs_correction', 2)]
    })
    client.resumeDraft.mockRejectedValueOnce(
      new Error('runtime turn capacity reached; retry after a turn finishes')
    )
    client.getDraft.mockResolvedValueOnce(planningDraft('needs_correction', 4))

    await useGraphStore.getState().resumeDraft('draft_1')

    expect(client.resumeDraft).toHaveBeenCalledWith('draft_1', 2)
    expect(client.getDraft).toHaveBeenCalledWith('draft_1')
    expect(useGraphStore.getState()).toMatchObject({
      drafts: [{
        draft: {
          revision: 4,
          status: 'needs_correction'
        }
      }],
      error: expect.stringContaining('capacity reached')
    })

    client.resumeDraft.mockResolvedValueOnce(planningDraft('planning', 5))
    await useGraphStore.getState().resumeDraft('draft_1')
    expect(client.resumeDraft).toHaveBeenLastCalledWith('draft_1', 4)
  })

  it('coalesces concurrent refreshThread calls and never regresses lastEventSeq', async () => {
    let resolveFirst!: (runs: GraphRun[]) => void
    let resolveSecond!: (runs: GraphRun[]) => void
    client.listRuns
      .mockReturnValueOnce(new Promise<GraphRun[]>((resolve) => { resolveFirst = resolve }))
      .mockReturnValueOnce(new Promise<GraphRun[]>((resolve) => { resolveSecond = resolve }))

    const first = useGraphStore.getState().refreshThread('thread_1')
    const second = useGraphStore.getState().refreshThread('thread_1', { silent: true })
    // Single-flight: only one HTTP snapshot is in flight until it settles.
    expect(client.listRuns).toHaveBeenCalledTimes(1)

    resolveFirst([run('run_1', 2)])
    await Promise.resolve()
    await Promise.resolve()
    // Pending request starts after the leader finishes.
    await vi.waitFor(() => expect(client.listRuns).toHaveBeenCalledTimes(2))
    resolveSecond([runWithNode('run_1', 5, 'node_1')])
    await Promise.all([first, second])

    expect(useGraphStore.getState().runs[0]).toMatchObject({
      lastEventSeq: 5,
      nodes: { node_1: { status: 'running' } }
    })

    // A late, weaker snapshot still cannot move lastEventSeq backwards.
    client.listRuns.mockResolvedValueOnce([run('run_1', 3)])
    await useGraphStore.getState().refreshThread('thread_1', { silent: true })
    expect(useGraphStore.getState().runs[0]?.lastEventSeq).toBe(5)
  })

  it('backfills via snapshot when graphSeq jumps ahead of lastEventSeq (gap)', async () => {
    client.listRuns.mockResolvedValueOnce([run('run_1', 2)])
    await useGraphStore.getState().refreshThread('thread_1')
    expect(useGraphStore.getState().runs[0]?.lastEventSeq).toBe(2)

    client.listRuns.mockResolvedValueOnce([run('run_1', 4)])
    receiveGraphRuntimeEvent({
      version: 1,
      eventId: 'event_4',
      runId: 'run_1',
      threadId: 'thread_1',
      graphSeq: 4,
      graphRevision: 1,
      timestamp: '2026-07-26T00:00:04.000Z',
      event: { type: 'node_status_changed', payload: {} }
    } satisfies GraphEventEnvelope)

    await vi.waitFor(() => {
      expect(useGraphStore.getState().runs[0]?.lastEventSeq).toBe(4)
    })
    // Snapshot recovery — listEvents is intentionally not used for projection.
    expect(client.listRuns).toHaveBeenCalledTimes(2)
    expect(useGraphStore.getState().runs).toHaveLength(1)
  })

  it('drops a late refresh from a previous thread after a thread switch', async () => {
    let resolveOld!: (runs: GraphRun[]) => void
    client.listRuns
      .mockReturnValueOnce(new Promise<GraphRun[]>((resolve) => { resolveOld = resolve }))
      .mockResolvedValueOnce([run('run_new', 1)])

    const oldRefresh = useGraphStore.getState().refreshThread('thread_old')
    await useGraphStore.getState().refreshThread('thread_new')
    expect(useGraphStore.getState().threadId).toBe('thread_new')
    expect(useGraphStore.getState().runs[0]?.id).toBe('run_new')

    resolveOld([run('run_old', 9)])
    await oldRefresh

    expect(useGraphStore.getState().threadId).toBe('thread_new')
    expect(useGraphStore.getState().runs[0]?.id).toBe('run_new')
    expect(useGraphStore.getState().runs.some((item) => item.id === 'run_old')).toBe(false)
  })

  it('atomically clears thread-scoped projection when binding a different thread', async () => {
    useGraphStore.setState({
      threadId: 'thread_a',
      threadEventSeq: 100,
      runs: [runWithNode('run_a', 8, 'node_a')],
      drafts: [planningDraft('needs_correction', 1)],
      childRuns: {
        child_a: {
          childId: 'child_a',
          parentThreadId: 'thread_a',
          parentTurnId: 'turn_a',
          status: 'running',
          updatedAt: '2026-07-26T00:00:00.000Z'
        }
      },
      selectedRunId: 'run_a',
      selectedNodeId: 'node_a',
      artifactPage: null,
      artifactContent: 'artifact from A',
      artifactLoading: true,
      syncStatus: 'live'
    })

    const { switched } = useGraphStore.getState().bindGraphThread('thread_b')
    expect(switched).toBe(true)
    expect(useGraphStore.getState()).toMatchObject({
      threadId: 'thread_b',
      threadEventSeq: 0,
      runs: [],
      drafts: [],
      childRuns: {},
      selectedRunId: null,
      selectedNodeId: null,
      artifactContent: '',
      artifactLoading: false,
      artifactPage: null,
      loading: true,
      syncStatus: 'connecting'
    })

    // Failed snapshot for B must not resurrect A.
    client.listRuns.mockRejectedValueOnce(new Error('network down'))
    client.listDrafts.mockRejectedValueOnce(new Error('network down'))
    await useGraphStore.getState().refreshThread('thread_b')
    expect(useGraphStore.getState().runs).toEqual([])
    expect(useGraphStore.getState().drafts).toEqual([])
    expect(useGraphStore.getState().runs.some((item) => item.id === 'run_a')).toBe(false)
  })

  it('keeps the same-thread snapshot across reconnect binds', () => {
    useGraphStore.setState({
      threadId: 'thread_1',
      threadEventSeq: 12,
      runs: [run('run_1', 12)],
      syncStatus: 'live'
    })
    const { switched } = useGraphStore.getState().bindGraphThread('thread_1')
    expect(switched).toBe(false)
    expect(useGraphStore.getState()).toMatchObject({
      threadId: 'thread_1',
      threadEventSeq: 12,
      runs: [{ id: 'run_1', lastEventSeq: 12 }],
      syncStatus: 'live'
    })
  })

  it('advances threadEventSeq monotonically only for the owning thread', () => {
    useGraphStore.setState({ threadId: 'thread_a', threadEventSeq: 0 })
    useGraphStore.getState().advanceThreadEventSeq(2, 'thread_a')
    useGraphStore.getState().advanceThreadEventSeq(5, 'thread_a')
    useGraphStore.getState().advanceThreadEventSeq(4, 'thread_a')
    expect(useGraphStore.getState().threadEventSeq).toBe(5)

    useGraphStore.getState().bindGraphThread('thread_b')
    useGraphStore.getState().advanceThreadEventSeq(99, 'thread_a')
    useGraphStore.getState().setSyncStatus('live', 'thread_a')
    expect(useGraphStore.getState()).toMatchObject({
      threadId: 'thread_b',
      threadEventSeq: 0,
      syncStatus: 'connecting'
    })
    useGraphStore.getState().advanceThreadEventSeq(3, 'thread_b')
    expect(useGraphStore.getState().threadEventSeq).toBe(3)
  })

  it('preserves a durable node selection when the selected run refreshes', async () => {
    useGraphStore.setState({
      threadId: 'thread_1',
      runs: [runWithNode('run_1', 1, 'node_1')],
      selectedRunId: 'run_1',
      selectedNodeId: 'node_1'
    })
    client.listRuns.mockResolvedValueOnce([runWithNode('run_1', 2, 'node_1')])

    await useGraphStore.getState().refreshThread('thread_1')

    expect(useGraphStore.getState()).toMatchObject({
      selectedRunId: 'run_1',
      selectedNodeId: 'node_1'
    })
  })

  it('ignores stale, malformed, and unrelated runtime events', async () => {
    client.listRuns.mockResolvedValue([run('run_1', 3)])
    await useGraphStore.getState().refreshThread('thread_1')

    receiveGraphRuntimeEvent({ version: 1, graphSeq: 4 })
    receiveGraphRuntimeEvent({
      version: 1,
      eventId: 'event_4',
      runId: 'run_1',
      threadId: 'thread_other',
      graphSeq: 4,
      graphRevision: 1,
      timestamp: '2026-07-26T00:00:01.000Z',
      event: { type: 'node_status_changed', payload: {} }
    })
    receiveGraphRuntimeEvent({
      version: 1,
      eventId: 'event_2',
      runId: 'run_1',
      threadId: 'thread_1',
      graphSeq: 2,
      graphRevision: 1,
      timestamp: '2026-07-26T00:00:01.000Z',
      event: { type: 'node_status_changed', payload: {} }
    })

    await Promise.resolve()
    expect(client.listRuns).toHaveBeenCalledTimes(1)
  })

  it('hydrates child activity from diagnostics without changing durable graph state', async () => {
    client.listRuns.mockResolvedValueOnce([run('run_1', 1)])
    client.delegationDiagnostics.mockResolvedValueOnce({
      enabled: true,
      active: 1,
      childRuns: [{
        id: 'child_1',
        parentThreadId: 'thread_1',
        parentTurnId: 'turn_1',
        childSeq: 1,
        label: 'Inspect Geo',
        profile: 'explore',
        profileSnapshot: { name: 'Explorer' },
        status: 'running',
        activity: {
          phase: 'tool',
          label: 'Scanning the repository',
          toolName: 'repo_map',
          startedAt: '2026-07-26T00:00:00.000Z',
          updatedAt: '2026-07-26T00:00:10.000Z'
        },
        usage: { totalTokens: 42 },
        startedAt: '2026-07-26T00:00:00.000Z',
        updatedAt: '2026-07-26T00:00:10.000Z'
      }]
    })

    await useGraphStore.getState().refreshThread('thread_1')

    expect(useGraphStore.getState().runs[0]?.lastEventSeq).toBe(1)
    expect(useGraphStore.getState().childRuns.child_1).toMatchObject({
      childId: 'child_1',
      status: 'running',
      profileName: 'Explorer',
      totalTokens: 42,
      activity: {
        phase: 'tool',
        label: 'Scanning the repository',
        toolName: 'repo_map'
      }
    })
  })

  it('deduplicates and rejects out-of-order child activity events', () => {
    useGraphStore.setState({ threadId: 'thread_1' })
    receiveGraphChildRuntimeEvent({
      seq: 12,
      timestamp: '2026-07-26T00:00:12.000Z',
      child: {
        parentThreadId: 'thread_1',
        parentTurnId: 'turn_1',
        childId: 'child_1',
        childStatus: 'running',
        childSeq: 1,
        activity: {
          phase: 'tool',
          label: 'Reading current files',
          toolName: 'read_file',
          startedAt: '2026-07-26T00:00:00.000Z',
          updatedAt: '2026-07-26T00:00:12.000Z'
        }
      }
    })
    receiveGraphChildRuntimeEvent({
      seq: 11,
      timestamp: '2026-07-26T00:00:11.000Z',
      child: {
        parentThreadId: 'thread_1',
        parentTurnId: 'turn_1',
        childId: 'child_1',
        childStatus: 'running',
        childSeq: 1,
        activity: {
          phase: 'thinking',
          label: 'Older activity',
          startedAt: '2026-07-26T00:00:00.000Z',
          updatedAt: '2026-07-26T00:00:11.000Z'
        }
      }
    })

    expect(useGraphStore.getState().childRuns.child_1).toMatchObject({
      eventSeq: 12,
      activity: {
        phase: 'tool',
        label: 'Reading current files'
      }
    })
  })

  it('keeps Graph loading successful when optional diagnostics are unavailable', async () => {
    client.listRuns.mockResolvedValueOnce([run('run_1', 1)])
    client.delegationDiagnostics.mockRejectedValueOnce(new Error('diagnostics offline'))

    await useGraphStore.getState().refreshThread('thread_1')

    expect(useGraphStore.getState()).toMatchObject({
      loading: false,
      error: null,
      runs: [{ id: 'run_1' }]
    })
  })

  it('keeps a newer live child event when refresh diagnostics arrive out of order', async () => {
    useGraphStore.setState({ threadId: 'thread_1' })
    receiveGraphChildRuntimeEvent({
      seq: 20,
      timestamp: '2026-07-26T00:00:20.000Z',
      child: {
        parentThreadId: 'thread_1',
        parentTurnId: 'turn_1',
        childId: 'child_1',
        childStatus: 'running',
        childSeq: 1,
        activity: {
          phase: 'tool',
          label: 'Newest live activity',
          startedAt: '2026-07-26T00:00:00.000Z',
          updatedAt: '2026-07-26T00:00:20.000Z'
        }
      }
    })
    client.listRuns.mockResolvedValueOnce([run('run_1', 1)])
    client.delegationDiagnostics.mockResolvedValueOnce({
      enabled: true,
      active: 1,
      childRuns: [{
        id: 'child_1',
        parentThreadId: 'thread_1',
        parentTurnId: 'turn_1',
        status: 'running',
        activity: {
          phase: 'thinking',
          label: 'Older diagnostic activity',
          startedAt: '2026-07-26T00:00:00.000Z',
          updatedAt: '2026-07-26T00:00:10.000Z'
        },
        updatedAt: '2026-07-26T00:00:10.000Z'
      }]
    })

    await useGraphStore.getState().refreshThread('thread_1')

    expect(useGraphStore.getState().childRuns.child_1?.activity?.label)
      .toBe('Newest live activity')
  })

  it('persists and clears a Graph child return target without resetting selection', () => {
    useGraphStore.getState().setChildReturnTarget({
      parentThreadId: 'thread_1',
      childThreadId: 'child_1',
      runId: 'run_1',
      nodeId: 'node_1',
      attemptId: 'attempt_1',
      parentEventSeq: 10,
      childSessionStatus: 'creating',
      observerStatus: 'connecting',
      openedAt: '2026-07-26T00:00:00.000Z'
    })

    expect(useGraphStore.getState()).toMatchObject({
      selectedRunId: 'run_1',
      selectedNodeId: 'node_1',
      childReturnTarget: {
        childThreadId: 'child_1',
        childSessionStatus: 'creating'
      }
    })

    useGraphStore.getState().clearChildReturnTarget()
    expect(useGraphStore.getState()).toMatchObject({
      selectedRunId: 'run_1',
      selectedNodeId: 'node_1',
      childReturnTarget: null
    })
  })

  it('loads project agents, scores, governance and learning state together', async () => {
    client.identity.mockResolvedValue({
      version: 1,
      projectId: 'project_1',
      canonicalWorkspaceRoot: '/repo',
      source: 'workspace_root',
      resolvedAt: '2026-07-26T00:00:00.000Z'
    })
    client.listProfiles.mockResolvedValue([])
    client.listEvidence.mockResolvedValue([])
    client.listScores.mockResolvedValue([{ profileId: 'agent_1', aggregate: 0.8 }])
    client.listAudit.mockResolvedValue([{ auditId: 'audit_1' }])
    client.listCandidates.mockResolvedValue([])
    client.listJobs.mockResolvedValue([])

    await useGraphStore.getState().refreshProject('/repo')

    expect(useGraphStore.getState()).toMatchObject({
      identity: { projectId: 'project_1' },
      scores: [{ profileId: 'agent_1', aggregate: 0.8 }],
      audit: [{ auditId: 'audit_1' }]
    })
  })

  it('applies rebind patches only from durable server truth', async () => {
    const current = run('run_1', 3)
    const revised = { ...current, currentRevision: 2, lastEventSeq: 4 }
    useGraphStore.setState({ runs: [current], selectedRunId: current.id })
    client.patch.mockResolvedValue(revised)

    await useGraphStore.getState().rebindNode('node_1', 'profile_1')

    expect(client.patch).toHaveBeenCalledWith(
      current,
      [{
        op: 'rebind_node',
        nodeId: 'node_1',
        assignment: { kind: 'existing', profileId: 'profile_1' }
      }],
      expect.stringContaining('node_1')
    )
    expect(useGraphStore.getState().runs[0]).toBe(revised)
  })

  it('routes active source-turn guidance to the owning GraphRun Lead', async () => {
    const current = run('run_1', 3)
    const steered = {
      ...current,
      lastEventSeq: 4,
      steering: [{
        steeringId: 'steering_1',
        target: { kind: 'lead' },
        text: 'Inspect the failing check.',
        status: 'persisted',
        createdAt: '2026-07-26T00:00:01.000Z'
      }]
    } as GraphRun
    useGraphStore.setState({
      threadId: current.threadId,
      runs: [current],
      selectedRunId: current.id
    })
    client.steer.mockResolvedValue(steered)

    await expect(useGraphStore.getState().steerSourceTurn(
      current.threadId,
      current.sourceTurnId,
      'Inspect the failing check.'
    )).resolves.toBe(true)

    expect(client.steer).toHaveBeenCalledWith(
      current.id,
      'Inspect the failing check.',
      { kind: 'lead' }
    )
    expect(useGraphStore.getState().runs[0]).toBe(steered)
  })

  it('pages artifact previews without requesting unbounded content', async () => {
    const current = run('run_1', 3)
    useGraphStore.setState({ runs: [current], selectedRunId: current.id })
    client.readArtifact
      .mockResolvedValueOnce({
        reference: {
          artifactId: 'art_abcdef',
          summary: 'output',
          mimeType: 'text/plain',
          byteLength: 6
        },
        meta: { byteSize: 6, lineCount: 1, mimeType: 'text/plain' },
        content: 'abc',
        range: { offset: 0, length: 3 },
        truncated: true,
        nextOffset: 3
      })
      .mockResolvedValueOnce({
        reference: {
          artifactId: 'art_abcdef',
          summary: 'output',
          mimeType: 'text/plain',
          byteLength: 6
        },
        meta: { byteSize: 6, lineCount: 1, mimeType: 'text/plain' },
        content: 'def',
        range: { offset: 3, length: 3 },
        truncated: false
      })

    await useGraphStore.getState().loadArtifact('art_abcdef')
    await useGraphStore.getState().loadNextArtifactPage()

    expect(client.readArtifact).toHaveBeenNthCalledWith(1, 'run_1', 'art_abcdef')
    expect(client.readArtifact).toHaveBeenNthCalledWith(
      2,
      'run_1',
      'art_abcdef',
      { offset: 3 }
    )
    expect(useGraphStore.getState().artifactContent).toBe('def')
  })
})
