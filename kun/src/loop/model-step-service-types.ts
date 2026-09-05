import type { ImmutablePrefix } from '../cache/immutable-prefix.js'
import type { PipelineStage } from '../contracts/events.js'
import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { ModelClient } from '../ports/model-client.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { GuiPlanContext } from '../ports/tool-host.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { TurnService } from '../services/turn-service.js'
import type { ThreadItemProjectionService } from '../services/thread-item-projection.js'
import type { GoalTurnCoordinator } from './goal-turn-coordinator.js'
import type { HistoryCompactionService } from './history-compaction-service.js'
import type { LoopTelemetry } from './loop-telemetry.js'
import type { ModelRoutingService } from './model-routing-service.js'
import type { ModelRoundEngine } from './model-round-engine.js'
import type { RoundOutcomeCoordinator } from './round-outcome-coordinator.js'
import type { TurnAttachmentService } from './turn-attachment-service.js'
import type { TurnBudgetGate } from './turn-budget-gate.js'
import type { TurnContextResolver } from './turn-context-resolver.js'
import type { TurnExecutionFailure } from './turn-execution-types.js'
import type { TokenEconomyConfig } from './token-economy.js'
import type { TurnLimitsConfig } from './turn-limits.js'

export type ModelStepServiceDeps = {
  threadStore: ThreadStore
  sessionStore: SessionStore
  turns: Pick<TurnService, 'getTurn' | 'applyItem' | 'updateItem' | 'updateTurnMetadata' | 'ensureGoalContext'>
  events: Pick<RuntimeEventRecorder, 'record'>
  model: ModelClient
  compactor: import('./context-compactor.js').ContextCompactor
  prefix: ImmutablePrefix
  ids: Pick<IdGenerator, 'next'>
  nowIso: () => string
  modelCapabilities?: (model: string, providerId?: string) => ModelCapabilityMetadata
  activePlanContext?: GuiPlanContext
  tokenEconomy?: TokenEconomyConfig
  toolArgumentRepair?: { maxStringBytes?: number }
  turnLimits?: TurnLimitsConfig
  finalAnswerOnlyStep?: number
  modelRouting: ModelRoutingService
  budgetGate: TurnBudgetGate
  goalTurns: Pick<GoalTurnCoordinator, 'suppressResume'>
  threadItems: Pick<ThreadItemProjectionService, 'syncFromSession'>
  turnContextResolver: TurnContextResolver
  telemetry: Pick<LoopTelemetry, 'recordToolCatalogFingerprint'>
  historyCompaction: HistoryCompactionService
  turnAttachments: TurnAttachmentService
  modelRoundEngine: ModelRoundEngine
  roundOutcome: RoundOutcomeCoordinator
  recordPipelineStage: (
    threadId: string,
    turnId: string,
    stage: PipelineStage,
    details?: Record<string, unknown>
  ) => Promise<void>
  recordToolCatalogDrift: (input: {
    threadId: string
    turnId: string
    fingerprint: string
    toolCount: number
    toolNames: string[]
    changeKind: 'additive' | 'breaking'
    message: string
  }) => Promise<void>
  recordTokenEconomySavings: (input: {
    threadId: string
    turnId: string
    model: string
    rawInputTokens: number
    sentInputTokens: number
  }) => Promise<void>
  rememberFailure: (turnId: string, failure: TurnExecutionFailure) => void
  awaitWorkspaceCheckpoint?: (
    checkpointRequestId: string,
    signal: AbortSignal
  ) => Promise<string | null>
}
