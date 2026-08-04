import type {
  GraphNodeAttemptV1,
  GraphNodeProjectionV1,
  GraphReviewResultV1,
  GraphRunSummaryV1,
  GraphRunV1,
  GraphVerifiedCheckResultV1
} from '../contracts/graph.js'
import type { GraphRuntimeConfig } from '../config/kun-config.js'
import type { ArtifactStore } from '../artifacts/artifact-store.js'
import type { DelegationRuntime } from '../delegation/delegation-runtime.js'
import type { GraphParentAuthority } from './graph-assignment.js'
import type { GraphAssignmentResolver } from './graph-assignment.js'
import type { GraphMailbox } from './graph-mailbox.js'
import type { ProjectAgentRegistry } from './project-agent-registry.js'
import type { GraphRunStore } from './graph-run-store.js'
import type { FileGraphWriteCoordinator } from './graph-write-coordinator.js'
import type { GraphWorkerSessionRegistry } from './graph-worker-sessions.js'

export type GraphLeadDeliveryResult =
  | {
      status: 'delivered'
      sourceTurnId: string
      deliveredSeq: number
      executionActive: boolean
      parkedWithPendingSupervision?: boolean
    }
  | { status: 'deferred'; reason: string; retryAfterMs: number }
  | { status: 'orphaned'; reason: string }
  | { status: 'terminal' }

export type GraphSchedulerDiagnostics = {
  active: Array<{ runId: string; nodeId: string; attemptId: string }>
  fairCursor: number
}

export type GraphSupervisionPort = {
  signal(input: {
    runId: string
    reason: 'submitted' | 'failure' | 'stall' | 'conflict' | 'budget' | 'help' | 'recovery' | 'completion' | 'user_steering' | 'worker_report' | 'scheduler_error'
    nodeIds: string[]
    digest: string
  }): Promise<void> | void
  review?(input: {
    run: GraphRunV1
    node: GraphNodeProjectionV1
    attempt: GraphNodeAttemptV1
    kind: 'peer' | 'lead'
    signal?: AbortSignal
  }): Promise<GraphReviewResultV1>
  synthesize?(run: GraphRunV1): Promise<GraphRunSummaryV1>
}

export type GraphSchedulerOptions = {
  store: GraphRunStore
  config: () => GraphRuntimeConfig
  delegation: () => DelegationRuntime | undefined
  registry: ProjectAgentRegistry
  assignments: GraphAssignmentResolver
  mailbox: GraphMailbox
  writes: FileGraphWriteCoordinator
  workerSessions: GraphWorkerSessionRegistry
  authorityForRun: (run: GraphRunV1) => Promise<GraphParentAuthority> | GraphParentAuthority
  artifactStore?: ArtifactStore
  verifyChecks?: (input: {
    run: GraphRunV1
    node: GraphNodeProjectionV1
    attempt: GraphNodeAttemptV1
    checkNames: readonly string[]
  }) => Promise<GraphVerifiedCheckResultV1[]>
  supervision?: () => GraphSupervisionPort | undefined
  nowIso?: () => string
  nextId?: (prefix: string) => string
  tickIntervalMs?: number
  onTerminal?: (run: GraphRunV1) => Promise<void> | void
}
