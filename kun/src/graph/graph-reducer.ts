import { isDeepStrictEqual } from 'node:util'
import {
  GRAPH_CONTRACT_VERSION,
  GraphRunV1Schema,
  type GraphAttemptStatus,
  type GraphEventEnvelopeV1,
  type GraphNodeAttemptV1,
  type GraphNodeStatus,
  type GraphPatchV1,
  type GraphRunStatus,
  type GraphRunV1
} from '../contracts/graph.js'

const RUN_TRANSITIONS: Readonly<Record<GraphRunStatus, readonly GraphRunStatus[]>> = {
  draft: ['validating', 'cancelled'],
  validating: ['draft', 'ready', 'failed', 'cancelled'],
  ready: ['running', 'paused', 'cancelled'],
  running: ['pausing', 'paused', 'awaiting_supervision', 'awaiting_human', 'completing', 'failed', 'cancelled'],
  pausing: ['paused', 'awaiting_supervision', 'failed', 'cancelled'],
  paused: ['running', 'awaiting_supervision', 'awaiting_human', 'failed', 'cancelled'],
  awaiting_supervision: ['running', 'paused', 'awaiting_human', 'completing', 'failed', 'cancelled'],
  awaiting_human: ['running', 'paused', 'awaiting_supervision', 'completing', 'failed', 'cancelled'],
  completing: ['completed', 'paused', 'awaiting_supervision', 'awaiting_human', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: []
}

const NODE_TRANSITIONS: Readonly<Record<GraphNodeStatus, readonly GraphNodeStatus[]>> = {
  pending: ['blocked', 'ready', 'cancelled', 'skipped', 'superseded'],
  blocked: ['pending', 'ready', 'cancelled', 'skipped', 'superseded'],
  ready: ['queued', 'blocked', 'failed', 'cancelled', 'skipped', 'superseded'],
  queued: ['running', 'ready', 'failed', 'cancelled', 'superseded'],
  running: ['submitted', 'repair_required', 'failed', 'cancelled', 'superseded'],
  submitted: ['reviewing', 'accepted', 'repair_required', 'failed', 'cancelled', 'superseded'],
  reviewing: ['accepted', 'repair_required', 'failed', 'cancelled', 'superseded'],
  accepted: ['superseded'],
  repair_required: ['ready', 'queued', 'failed', 'cancelled', 'superseded'],
  failed: ['ready', 'queued', 'superseded'],
  cancelled: ['ready', 'superseded'],
  skipped: ['ready', 'superseded'],
  superseded: []
}

const ATTEMPT_TRANSITIONS: Readonly<Record<GraphAttemptStatus, readonly GraphAttemptStatus[]>> = {
  queued: ['running', 'interrupted', 'cancelled', 'orphaned'],
  running: ['waiting', 'submitted', 'repair_required', 'failed', 'interrupted', 'cancelled', 'orphaned'],
  waiting: ['running', 'submitted', 'repair_required', 'failed', 'interrupted', 'cancelled', 'orphaned'],
  submitted: ['reviewing', 'accepted', 'repair_required', 'failed', 'cancelled'],
  reviewing: ['accepted', 'repair_required', 'failed', 'cancelled'],
  accepted: [],
  repair_required: [],
  failed: [],
  interrupted: [],
  cancelled: [],
  orphaned: ['interrupted', 'cancelled']
}

export class GraphReducerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GraphReducerError'
  }
}

export function replayGraphEvents(events: readonly GraphEventEnvelopeV1[]): GraphRunV1 {
  let state: GraphRunV1 | undefined
  for (const event of [...events].sort((a, b) => a.graphSeq - b.graphSeq)) {
    state = applyGraphEvent(state, event)
  }
  if (!state) throw new GraphReducerError('cannot replay an empty Graph event stream')
  return state
}

export function applyGraphEvent(
  current: GraphRunV1 | undefined,
  envelope: GraphEventEnvelopeV1
): GraphRunV1 {
  if (!current) return createRun(envelope)
  if (envelope.runId !== current.id) {
    throw new GraphReducerError(`event run ${envelope.runId} does not match ${current.id}`)
  }
  if (envelope.threadId !== current.threadId) {
    throw new GraphReducerError(`event thread ${envelope.threadId} does not match ${current.threadId}`)
  }
  if (envelope.graphSeq <= current.lastEventSeq) return current
  if (envelope.graphSeq !== current.lastEventSeq + 1) {
    throw new GraphReducerError(
      `graph event sequence gap: expected ${current.lastEventSeq + 1}, got ${envelope.graphSeq}`
    )
  }
  if (envelope.event.type === 'run_created') {
    throw new GraphReducerError('run_created may only be the first graph event')
  }
  if (envelope.event.type === 'payload_externalized') {
    throw new GraphReducerError('externalized graph events must be hydrated before reduction')
  }

  const next = GraphRunV1Schema.parse(structuredClone(current))
  const event = envelope.event
  switch (event.type) {
    case 'plan_validated':
      if (event.payload.revision !== next.currentRevision) {
        throw new GraphReducerError('validation revision does not match current revision')
      }
      break
    case 'run_status_changed':
      assertTransition('run', next.status, event.payload.from, event.payload.to, RUN_TRANSITIONS)
      next.status = event.payload.to
      if (event.payload.to === 'running' && !next.startedAt) next.startedAt = envelope.timestamp
      if (isTerminalRunStatus(event.payload.to)) next.finishedAt = envelope.timestamp
      break
    case 'plan_revised':
      applyPlanRevision(
        next,
        event.payload.plan,
        event.payload.patch,
        event.payload.supersededNodeIds
      )
      break
    case 'node_status_changed': {
      const node = requireNode(next, event.payload.nodeId)
      assertTransition('node', node.status, event.payload.from, event.payload.to, NODE_TRANSITIONS)
      if (event.payload.to === 'accepted') {
        const attempt = node.attempts.at(-1)
        if (!attempt || attempt.status !== 'accepted') {
          throw new GraphReducerError(
            `node ${node.node.id} requires an accepted latest attempt before acceptance`
          )
        }
        node.acceptedAttemptId = attempt.id
      }
      node.status = event.payload.to
      if (event.payload.reason) node.lastTransitionReason = event.payload.reason
      else delete node.lastTransitionReason
      break
    }
    case 'loop_iteration_advanced': {
      const gate = requireNode(next, event.payload.gateNodeId)
      if (gate.node.kind !== 'loop_gate') {
        throw new GraphReducerError(`${event.payload.gateNodeId} is not a LoopGate`)
      }
      if (event.payload.iteration !== gate.loopIteration + 1) {
        throw new GraphReducerError(
          `LoopGate ${gate.node.id} expected iteration ${gate.loopIteration + 1}`
        )
      }
      if (!event.payload.resetNodeIds.includes(event.payload.continueTargetNodeId)) {
        throw new GraphReducerError('loop reset set must contain the continuation target')
      }
      for (const nodeId of event.payload.resetNodeIds) {
        const node = requireNode(next, nodeId)
        if (node.status === 'superseded') {
          throw new GraphReducerError(`cannot reset superseded loop node ${nodeId}`)
        }
        node.loopIteration = event.payload.iteration
        delete node.acceptedAttemptId
        delete node.lastTransitionReason
        node.status = nodeId === event.payload.continueTargetNodeId
          ? 'ready'
          : 'pending'
      }
      gate.loopIteration = event.payload.iteration
      gate.status = 'blocked'
      break
    }
    case 'attempt_created': {
      const node = requireNode(next, event.payload.attempt.nodeId)
      if (node.status !== 'ready') {
        throw new GraphReducerError(
          `attempt admission requires ready node ${node.node.id}; found ${node.status}`
        )
      }
      addAttempt(next, event.payload.attempt)
      delete node.lastTransitionReason
      node.status = 'queued'
      break
    }
    case 'attempt_status_changed': {
      const attempt = requireAttempt(next, event.payload.nodeId, event.payload.attemptId)
      assertTransition('attempt', attempt.status, event.payload.from, event.payload.to, ATTEMPT_TRANSITIONS)
      attempt.status = event.payload.to
      if (event.payload.childThreadId) attempt.childThreadId = event.payload.childThreadId
      if (event.payload.childTurnId) attempt.childTurnId = event.payload.childTurnId
      if (event.payload.failureClass) attempt.failureClass = event.payload.failureClass
      if (event.payload.normalizedFailure) {
        attempt.normalizedFailure = event.payload.normalizedFailure
      }
      if (event.payload.to === 'running' && !attempt.startedAt) attempt.startedAt = envelope.timestamp
      if (isTerminalAttemptStatus(event.payload.to)) attempt.finishedAt = envelope.timestamp
      break
    }
    case 'progress_reported':
      requireAttempt(next, event.payload.progress.nodeId, event.payload.progress.attemptId)
      requireNode(next, event.payload.progress.nodeId).lastProgress = event.payload.progress
      break
    case 'result_submitted': {
      const attempt = requireAttempt(next, event.payload.nodeId, event.payload.attemptId)
      attempt.result = event.payload.result
      attempt.validation = event.payload.validation
      attempt.tokenUsage = event.payload.tokenUsage
      attempt.elapsedMs = event.payload.elapsedMs
      break
    }
    case 'review_recorded':
      requireAttempt(next, event.payload.review.nodeId, event.payload.review.attemptId)
      if (!next.reviews.some((review) => review.reviewId === event.payload.review.reviewId)) {
        next.reviews.push(event.payload.review)
      }
      break
    case 'message_created':
      if (!next.messages.some((message) => message.id === event.payload.message.id)) {
        next.messages.push(event.payload.message)
      }
      break
    case 'message_status_changed': {
      const message = next.messages.find((entry) => entry.id === event.payload.messageId)
      if (!message) throw new GraphReducerError(`unknown graph message ${event.payload.messageId}`)
      message.status = event.payload.status
      if (event.payload.acknowledgedAt) message.acknowledgedAt = event.payload.acknowledgedAt
      break
    }
    case 'artifact_published':
      if (!next.artifacts.some((artifact) =>
        artifact.artifactId === event.payload.artifact.artifactId &&
        artifact.producerAttemptId === event.payload.artifact.producerAttemptId)) {
        next.artifacts.push(event.payload.artifact)
      }
      break
    case 'budget_updated':
    case 'budget_warning':
      assertNondecreasingLedger(next, event.payload.ledger)
      next.budget = event.payload.ledger
      break
    case 'steering_recorded':
      if (!next.steering.some((steering) => steering.steeringId === event.payload.steering.steeringId)) {
        next.steering.push(event.payload.steering)
      }
      break
    case 'steering_status_changed': {
      const steering = next.steering.find((entry) =>
        entry.steeringId === event.payload.steeringId)
      if (!steering) {
        throw new GraphReducerError(`unknown steering ${event.payload.steeringId}`)
      }
      if (steering.status !== event.payload.from) {
        throw new GraphReducerError(
          `steering transition expected persisted state ${event.payload.from}, found ${steering.status}`
        )
      }
      const transitions: Record<typeof steering.status, readonly typeof steering.status[]> = {
        persisted: ['delivered', 'handled', 'superseded'],
        delivered: ['handled', 'superseded'],
        handled: ['superseded'],
        superseded: []
      }
      if (!transitions[steering.status].includes(event.payload.to)) {
        throw new GraphReducerError(
          `illegal steering transition ${steering.status} -> ${event.payload.to}`
        )
      }
      steering.status = event.payload.to
      break
    }
    case 'cleanup_updated': {
      const index = next.cleanup.findIndex((cleanup) => cleanup.id === event.payload.cleanup.id)
      if (index >= 0) next.cleanup[index] = event.payload.cleanup
      else next.cleanup.push(event.payload.cleanup)
      break
    }
    case 'supervision_requested':
      break
    case 'supervision_obligation_opened':
    case 'supervision_delivery_started':
    case 'supervision_retry_scheduled':
    case 'supervision_obligation_resolved':
    case 'supervision_attention_required':
    case 'supervision_obligation_updated': {
      const obligation = event.payload.obligation
      const requiredState = event.type === 'supervision_obligation_opened'
        ? 'pending'
        : event.type === 'supervision_delivery_started'
          ? 'delivering'
          : event.type === 'supervision_retry_scheduled'
            ? 'retry_scheduled'
            : event.type === 'supervision_obligation_resolved'
              ? 'resolved'
              : event.type === 'supervision_attention_required'
                ? 'needs_attention'
                : undefined
      if (requiredState && obligation.state !== requiredState) {
        throw new GraphReducerError(
          `${event.type} requires obligation state ${requiredState}`
        )
      }
      const index = next.supervisionObligations.findIndex((entry) =>
        entry.id === obligation.id)
      if (index < 0) {
        if (obligation.state === 'resolved') {
          throw new GraphReducerError('a supervision obligation cannot be created as resolved')
        }
        next.supervisionObligations.push(obligation)
        break
      }
      const previous = next.supervisionObligations[index]!
      if (
        previous.kind !== obligation.kind ||
        previous.graphRevision !== obligation.graphRevision ||
        !isDeepStrictEqual(previous.nodeIds, obligation.nodeIds) ||
        !isDeepStrictEqual(previous.attemptIds, obligation.attemptIds)
      ) {
        throw new GraphReducerError(`supervision obligation subject changed: ${obligation.id}`)
      }
      const transitions: Record<typeof previous.state, readonly typeof obligation.state[]> = {
        pending: ['pending', 'delivering', 'retry_scheduled', 'resolved', 'needs_attention'],
        delivering: ['delivering', 'awaiting_action', 'retry_scheduled', 'resolved', 'needs_attention'],
        awaiting_action: ['awaiting_action', 'delivering', 'retry_scheduled', 'resolved', 'needs_attention'],
        retry_scheduled: ['retry_scheduled', 'pending', 'delivering', 'resolved', 'needs_attention'],
        needs_attention: ['needs_attention', 'pending', 'delivering', 'resolved'],
        // resolved is terminal for the obligation lifecycle. New writers must not
        // append resolved→resolved (manager guard + stable idempotency key +
        // store queue). The no-op branch below exists only so already-persisted
        // pre-fix journals that contain duplicate resolved events can still
        // replay without throwing.
        resolved: []
      }
      if (previous.state === 'resolved' && obligation.state === 'resolved') {
        // Compatibility no-op for historical #1082 journals: keep the first
        // resolvedAt/updatedAt projection. The reducer does not prevent durable
        // append — persistence happens outside reduce; lastEventSeq still advances
        // after this switch when the envelope is applied.
        break
      }
      if (!transitions[previous.state].includes(obligation.state)) {
        throw new GraphReducerError(
          `illegal supervision obligation transition ${previous.state} -> ${obligation.state}`
        )
      }
      next.supervisionObligations[index] = obligation
      break
    }
    case 'run_summary_recorded':
      next.summary = event.payload.summary
      break
  }
  next.lastEventSeq = envelope.graphSeq
  next.updatedAt = envelope.timestamp
  return GraphRunV1Schema.parse(next)
}

function createRun(envelope: GraphEventEnvelopeV1): GraphRunV1 {
  if (envelope.graphSeq !== 1 || envelope.event.type !== 'run_created') {
    throw new GraphReducerError('the first graph event must be run_created at sequence 1')
  }
  const { plan, projectId, sourceTurnId } = envelope.event.payload
  if (plan.revision !== envelope.graphRevision) {
    throw new GraphReducerError('initial plan revision does not match event revision')
  }
  return GraphRunV1Schema.parse({
    version: GRAPH_CONTRACT_VERSION,
    id: envelope.runId,
    projectId,
    threadId: envelope.threadId,
    sourceTurnId,
    status: 'draft',
    currentRevision: plan.revision,
    plans: [plan],
    nodes: Object.fromEntries(plan.nodes.map((node) => [
      node.id,
      { node, status: 'pending', attempts: [], loopIteration: 0 }
    ])),
    reviews: [],
    messages: [],
    artifacts: [],
    cleanup: [],
    steering: [],
    supervisionObligations: [],
    budget: {
      version: GRAPH_CONTRACT_VERSION,
      limits: plan.budget,
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
    lastEventSeq: envelope.graphSeq,
    createdAt: envelope.timestamp,
    updatedAt: envelope.timestamp
  })
}

function applyPlanRevision(
  run: GraphRunV1,
  plan: GraphRunV1['plans'][number],
  patch: GraphPatchV1,
  supersededNodeIds: readonly string[]
): void {
  const baseRevision = patch.baseRevision
  if (baseRevision !== run.currentRevision) {
    throw new GraphReducerError(`stale graph revision ${baseRevision}; current is ${run.currentRevision}`)
  }
  if (plan.revision !== run.currentRevision + 1) {
    throw new GraphReducerError(`new graph revision must be ${run.currentRevision + 1}`)
  }
  for (const node of plan.nodes) {
    const existing = run.nodes[node.id]
    if (!existing) {
      run.nodes[node.id] = { node, status: 'pending', attempts: [], loopIteration: 0 }
      continue
    }
    if (existing.status === 'accepted' && !isDeepStrictEqual(existing.node, node)) {
      throw new GraphReducerError(`revision cannot rewrite accepted node ${node.id}`)
    }
    if (existing.status !== 'accepted') existing.node = node
  }
  for (const nodeId of supersededNodeIds) {
    const node = requireNode(run, nodeId)
    const replacement = patch.operations.find((operation) =>
      operation.op === 'replace_node' &&
      operation.nodeId === nodeId &&
      operation.replacement.id !== nodeId)
    if (replacement?.op === 'replace_node') {
      node.supersededByNodeId = replacement.replacement.id
    }
    if (node.status !== 'superseded') {
      if (!NODE_TRANSITIONS[node.status].includes('superseded')) {
        throw new GraphReducerError(`node ${nodeId} cannot be superseded from ${node.status}`)
      }
      node.status = 'superseded'
    }
  }
  run.plans.push(plan)
  run.currentRevision = plan.revision
  run.budget.limits = plan.budget
  run.budget.revisions += 1
}

function addAttempt(run: GraphRunV1, attempt: GraphNodeAttemptV1): void {
  if (attempt.runId !== run.id) throw new GraphReducerError('attempt run id mismatch')
  if (attempt.revision > run.currentRevision) throw new GraphReducerError('attempt revision is in the future')
  for (const node of Object.values(run.nodes)) {
    if (node.attempts.some((existing) => existing.id === attempt.id)) {
      throw new GraphReducerError(`duplicate attempt id ${attempt.id}`)
    }
  }
  const node = requireNode(run, attempt.nodeId)
  const expectedAttemptNumber = node.attempts.length + 1
  if (attempt.attemptNumber !== expectedAttemptNumber) {
    throw new GraphReducerError(
      `attempt number for ${attempt.nodeId} must be ${expectedAttemptNumber}`
    )
  }
  node.attempts.push(attempt)
  node.loopIteration = Math.max(node.loopIteration, attempt.iteration)
  run.budget.attempts += 1
}

function requireNode(run: GraphRunV1, nodeId: string): GraphRunV1['nodes'][string] {
  const node = run.nodes[nodeId]
  if (!node) throw new GraphReducerError(`unknown graph node ${nodeId}`)
  return node
}

function requireAttempt(
  run: GraphRunV1,
  nodeId: string,
  attemptId: string
): GraphNodeAttemptV1 {
  const attempt = requireNode(run, nodeId).attempts.find((entry) => entry.id === attemptId)
  if (!attempt) throw new GraphReducerError(`unknown graph attempt ${attemptId}`)
  return attempt
}

function assertTransition<T extends string>(
  label: string,
  actual: T,
  declaredFrom: T,
  to: T,
  transitions: Readonly<Record<T, readonly T[]>>
): void {
  if (actual !== declaredFrom) {
    throw new GraphReducerError(
      `${label} transition expected persisted state ${declaredFrom}, found ${actual}`
    )
  }
  if (!transitions[actual].includes(to)) {
    throw new GraphReducerError(`illegal ${label} transition ${actual} -> ${to}`)
  }
}

function assertNondecreasingLedger(
  run: GraphRunV1,
  ledger: GraphRunV1['budget']
): void {
  for (const field of [
    'attempts',
    'revisions',
    'loopIterations',
    'elapsedMs',
    'totalTokens',
    'messages',
    'artifactBytes'
  ] as const) {
    if (ledger[field] < run.budget[field]) {
      throw new GraphReducerError(`budget ledger ${field} cannot decrease`)
    }
  }
}

function isTerminalRunStatus(status: GraphRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function isTerminalAttemptStatus(status: GraphAttemptStatus): boolean {
  return [
    'accepted',
    'repair_required',
    'failed',
    'interrupted',
    'cancelled',
    'orphaned'
  ].includes(status)
}
