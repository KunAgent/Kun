import type {
  GraphAttempt,
  GraphChildRuntime,
  GraphPlanNode,
  GraphPlanningDraftView,
  GraphRun
} from '../../../graph/graph-types'

/*
 * Graph run fixtures shared by the Graph tray tests (progress logic, node
 * map, sheet, kind hook). Test-only: never import from product code.
 */

export function graphTestNode(id: string, phaseId: string, assignmentName?: string): GraphPlanNode {
  return {
    id,
    phaseId,
    kind: 'work',
    title: `Node ${id}`,
    objective: `Complete the detailed objective for ${id}.`,
    priority: 1,
    required: true,
    riskClass: 'low',
    assignment: assignmentName
      ? { kind: 'ephemeral', name: assignmentName, systemPrompt: `Own ${id}.` }
      : undefined,
    readScopes: [],
    writeScopes: []
  }
}

export function graphTestAttempt({
  id = 'attempt_1',
  attemptNumber = 1,
  name = 'Runtime Inspector',
  childThreadId = 'child_1'
}: {
  id?: string
  attemptNumber?: number
  name?: string
  childThreadId?: string
} = {}): GraphAttempt {
  return {
    id,
    attemptNumber,
    status: 'running',
    assignment: {
      profileId: 'runtime-inspector',
      profileVersion: 1,
      profileOrigin: 'ephemeral',
      name,
      model: 'model',
      providerId: 'provider',
      allowedModelProviderIds: ['provider'],
      allowedModels: ['model'],
      allowedProviderIds: ['builtin'],
      reasoningEffort: 'medium',
      systemPrompt: 'Inspect.',
      toolPolicy: 'readOnly',
      allowedTools: [],
      blockedTools: [],
      allowedSkills: [],
      blockedSkills: [],
      allowedMcpServers: [],
      blockedMcpServers: [],
      approvalPolicy: 'never',
      sandboxMode: 'read-only',
      workspaceRoot: '/repo',
      readScopes: [],
      writeScopes: [],
      networkAllowed: false,
      maxWallTimeMs: 86_400_000,
      capturedAt: '2026-07-28T00:00:00.000Z'
    },
    childThreadId,
    queuedAt: '2026-07-28T00:00:00.000Z',
    startedAt: '2026-07-28T00:00:01.000Z',
    tokenUsage: 0,
    elapsedMs: 0
  }
}

export function graphTestChild(
  status: GraphChildRuntime['status'],
  updatedAt = '2026-07-28T00:00:02.000Z',
  childId = 'child_1'
): GraphChildRuntime {
  return {
    childId,
    parentThreadId: 'thread_1',
    parentTurnId: 'turn_1',
    status,
    updatedAt
  }
}

/**
 * Three phases (declared out of order) with one node each:
 * audit (accepted, Explorer) → implement (running, Builder) → review (pending, Reviewer).
 */
export function graphTestRun({
  id = 'run_1',
  status = 'running',
  threadId = 'thread_1'
}: {
  id?: string
  status?: GraphRun['status']
  threadId?: string
} = {}): GraphRun {
  const nodes = [
    graphTestNode('audit', 'discover', 'Explorer'),
    graphTestNode('implement', 'build', 'Builder'),
    graphTestNode('review', 'verify', 'Reviewer')
  ]
  return {
    version: 1,
    id,
    projectId: 'project_1',
    threadId,
    sourceTurnId: 'turn_1',
    status,
    currentRevision: 1,
    plans: [{
      version: 1,
      revision: 1,
      title: 'Ship a usable Graph experience',
      goal: 'Plan, implement, and verify the feature.',
      workspaceRoot: '/repo',
      phases: [
        { id: 'verify', title: 'Verify', order: 3 },
        { id: 'discover', title: 'Discover', order: 1 },
        { id: 'build', title: 'Build', order: 2 }
      ],
      nodes,
      edges: [
        { id: 'edge_audit_build', kind: 'control', from: 'audit', to: 'implement' },
        { id: 'edge_build_review', kind: 'control', from: 'implement', to: 'review' }
      ],
      completionNodeIds: ['review'],
      createdAt: '2026-07-27T00:00:00.000Z'
    }],
    nodes: {
      audit: { node: nodes[0]!, status: 'accepted', attempts: [], loopIteration: 0 },
      implement: { node: nodes[1]!, status: 'running', attempts: [], loopIteration: 0 },
      review: { node: nodes[2]!, status: 'pending', attempts: [], loopIteration: 0 }
    },
    reviews: [],
    messages: [],
    artifacts: [],
    cleanup: [],
    steering: [],
    budget: {
      limits: { maxWallTimeMs: 60_000, maxAttemptsPerNode: 3 },
      attempts: 1,
      revisions: 0,
      loopIterations: 0,
      elapsedMs: 1_000,
      totalTokens: 500,
      messages: 0,
      artifactBytes: 0,
      warningKinds: [],
      closed: false
    },
    lastEventSeq: 5,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:01:00.000Z'
  }
}

/** graphTestRun with a live child session on the running `implement` node. */
export function graphTestRunWithChild(
  childUpdatedAt: string,
  options: { attemptNumber?: number } = {}
): { run: GraphRun; childRuns: Record<string, GraphChildRuntime> } {
  const run = graphTestRun()
  run.nodes.implement!.attempts = [graphTestAttempt({
    id: 'attempt_implement',
    attemptNumber: options.attemptNumber ?? 1,
    name: 'Builder',
    childThreadId: 'child_implement'
  })]
  return {
    run,
    childRuns: { child_implement: graphTestChild('running', childUpdatedAt, 'child_implement') }
  }
}

export function graphTestCorrection(issueCount = 1): GraphPlanningDraftView {
  return {
    draft: {
      version: 1,
      id: 'draft_correction',
      reservedRunId: 'run_reserved',
      threadId: 'thread_1',
      sourceTurnId: 'turn_1',
      projectId: 'project_1',
      goal: 'Implement and verify TimeKV.',
      revision: 3,
      status: 'needs_correction',
      issues: Array.from({ length: issueCount }, (_unused, index) => ({
        code: 'invalid_type',
        path: ['plan', 'tasks', index, 'title'],
        message: index === 0 ? 'Expected string, received undefined' : `Issue ${index + 1}`,
        repairHint: index === 0 ? 'Restore the task title.' : ''
      })),
      repairCount: 1,
      createdAt: '2026-07-31T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:01.000Z'
    },
    tasks: []
  }
}
