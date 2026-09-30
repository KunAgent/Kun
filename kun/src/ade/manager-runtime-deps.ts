import type { TeamRecord } from '../contracts/ade.js'
import type {
  HarnessDefinition,
  HarnessId,
  HarnessRoute
} from '../contracts/harness.js'
import type { HarnessDefaultsEntry } from '../config/kun-config-application.js'
import type { HarnessCapabilities } from '../contracts/harness-capabilities.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { SessionStore } from '../ports/session-store.js'
import type { TurnService } from '../services/turn-service.js'
import type { HarnessCatalog } from '../harness/harness-catalog.js'
import type { HarnessDetector } from '../harness/harness-detector.js'
import type { TaskWorkspaceService } from '../workspace-tasks/task-workspace-service.js'
import type { FileDelegationStore } from '../delegation/delegation-runtime-contracts.js'
import type { FileTeamStore } from './team-store.js'
import type { FileDispatchStore } from './dispatch-store.js'
import type { FileQuestionStore } from './question-store.js'
import type { WorkerNoticeSink } from './worker-notice-store.js'
import type {
  DelivererDelegation,
  DispatchDeliverer
} from './dispatch-deliverer.js'
import type { ApprovalGate } from '../ports/approval-gate.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { UsageService } from '../services/usage-service-core.js'
import type { WorkerCallbackService } from '../services/worker-callback-service.js'
import type { ActivityStore } from '../services/activity-store.js'
import type { WorkerSelectorDeps } from './worker-selector.js'
import type { WorkerProviderPoolEntry } from './worker-route.js'
import type { ManagerAuthority } from './permission-clamp.js'
import type { EscalationApprovalContext } from './escalation-approval.js'

/** What a manager tool needs from the calling turn (09 §4.2 ctx). */
export type ManagerToolContext = {
  /** Manager thread id — also the team id. */
  threadId: string
  turnId: string
  /** Manager thread's workspace root; task workspaces fork from it. */
  workspace: string
  authority: ManagerAuthority
  signal: AbortSignal
  /** User-only escalation channel (09 §7.2); see escalation-approval.ts. */
  awaitApproval: EscalationApprovalContext['awaitApproval']
}

export type ManagerRuntimeDeps = {
  teams: FileTeamStore
  dispatches: FileDispatchStore
  questions: FileQuestionStore
  /** Same-task race records (10 §6); absent disables the worker_race tool. */
  races?: import('./race.js').FileRaceStore
  /** Raw store or the wake-up coordinator wrapping it (09 §6.2). */
  notices: WorkerNoticeSink
  threads: ThreadStore
  turns: Pick<TurnService, 'getTurn'>
  sessionStore: Pick<SessionStore, 'loadItems'>
  taskWorkspaces?: TaskWorkspaceService
  activity?: ActivityStore
  /** Absent when subagents are disabled; worker creation then refuses. */
  delegation?: DelivererDelegation
  childRuns: FileDelegationStore
  catalog: HarnessCatalog
  detector: HarnessDetector
  /** Effective capabilities for a route (harnessRuntimeMap + static facts). */
  capabilitiesForRoute(route: HarnessRoute): Promise<HarnessCapabilities>
  deliverer: DispatchDeliverer
  ids: { next(prefix: string): string }
  nowIso: () => string
  /** Manager UI language for fixed-sentence reports (zh* → zh, else en). */
  language?: () => string | undefined
  allowUnattendedFullAccess?: () => boolean
  teamLimits?: () => Partial<{ softWorkers: number; hardWorkers: number }> | undefined
  /** Delay before an ephemeral worker is released after completion (default 30s). */
  ephemeralReleaseDelayMs?: () => number
  /** worker_answer / GUI question answers (09 §6.4); absent → answer refuses. */
  workerCallbacks?: Pick<WorkerCallbackService, 'answerQuestion'>
  /** worker_approve decision channel (09 §6.5); gated by managerMayApprove. */
  approvalGate?: Pick<
    ApprovalGate,
    'get' | 'reserveDecision' | 'commitDecision' | 'rollbackDecision'
  >
  /** Audit sink for manager-resolved approvals (09 §6.5). */
  approvalEvents?: Pick<RuntimeEventRecorder, 'record'>
  /** `agents.kun.ade.managerMayApprove` — gates the worker_approve tool. */
  managerMayApprove?: () => boolean
  /** Per-worker usage rollup for race compare (11 §5). */
  usage?: Pick<UsageService, 'forThread'>
  /** Team-token budget gate (P3-15); absent → budget unenforced. */
  teamBudget?: import('./team-budget.js').TeamBudgetGate
  /** Configured team budget written into newly ensured teams (P3-15). */
  teamBudgetPolicy?: () => TeamRecord['budget'] | undefined
  /** Approved `worktree.checks` inputs (10 §4.2); absent hides the tool. */
  checks?: Pick<
    import('./check-runner.js').WorkspaceCheckRunnerDeps,
    'approvedChecks' | 'artifacts' | 'spawn' | 'env'
  >
  /** Provider pool for provider/gateway route validation (P3-06). */
  providerPool?: (providerId: string) => Promise<WorkerProviderPoolEntry | undefined>
  /** Last cached model-probe list per harness; absent → static list. */
  probedModels?: (definition: HarnessDefinition) => string[] | undefined
  /**
   * `agents.kun.harnesses.defaults` lookup (p4 §3.6, P4-11): route fields,
   * `permissionMode`, and `isolation` the caller did not pin fall back to
   * the configured per-harness defaults.
   */
  harnessDefaults?: (harnessId: HarnessId) => HarnessDefaultsEntry | undefined
  /**
   * Worker-route selector inputs (10 §3.2); `isolated`/`unattended` come from
   * the create call. Absent → the manager's own provider/model on `kun`.
   */
  selector?: Omit<
    WorkerSelectorDeps,
    'catalog' | 'detector' | 'capabilitiesForRoute' | 'isolated' | 'unattended' | 'allowUnattendedFullAccess' | 'recentFailures' | 'managerRoute' | 'language'
  >
}
