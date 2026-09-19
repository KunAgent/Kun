import type { Turn } from '../contracts/turns.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ToolCallLike, ToolProviderKind } from '../ports/tool-host.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { TurnService } from '../services/turn-service.js'
import type { CanvasReceiptRegistry } from '../services/canvas-receipt-registry.js'
import type { ModelRoundStreamResult } from './model-round-engine.js'
import type { SvgArtifactCompletionState } from './svg-artifact-completion.js'
import type {
  PreparedTurnContext,
  ToolDispatchInput,
  ToolDispatchOutcome,
  TurnExecutionFailure
} from './turn-execution-types.js'

export const MAX_SVG_COMPLETION_RECOVERY_STEPS = 3
export const GRAPH_CREATE_RUN_TOOL_NAME = 'graph_create_run'
export const MAX_GRAPH_CREATE_RUN_ATTEMPTS = 3
/** @deprecated Use MAX_GRAPH_CREATE_RUN_ATTEMPTS for the total request cap. */
export const MAX_GRAPH_CREATE_RUN_RECOVERY_STEPS = MAX_GRAPH_CREATE_RUN_ATTEMPTS - 1
/** How long the loop waits for a renderer design receipt before finalizing as unverified. */
export const CANVAS_RECEIPT_TIMEOUT_MS = 45_000

export type GraphCreateRunRecoveryReason = 'missing' | 'invalid' | 'mismatch'

export type GraphCreateRunRecoveryState = Readonly<{
  steps: number
  reason: GraphCreateRunRecoveryReason
}>

export type RoundToolProviderMetadata = Readonly<{
  providerId?: string
  providerKind?: ToolProviderKind
}>

export type RoundOutcomeInput = Readonly<{
  threadId: string
  turnId: string
  streamed: ModelRoundStreamResult
  /** Hard transport and dispatch constraint from ModelRequest. */
  requiredToolName?: string
  /** Soft workflow completion expectation (currently Plan create_plan). */
  softRequiredToolName?: string
  turn: Turn
  prepared: PreparedTurnContext
  modelProviderId?: string
  modelReasoningEffort?: string
  sourceResultBudgetTokens?: number
  /** The request advertised no tools and must not execute provider-emitted calls. */
  toolCallsDisabled?: boolean
  toolProviderMetadata: ReadonlyMap<string, RoundToolProviderMetadata>
  toolKinds: ReadonlyMap<string, ToolCallLike['toolKind'] | undefined>
  toolProviderKinds: ReadonlyMap<string, ToolProviderKind | undefined>
  svgCompletion: SvgArtifactCompletionState | null
}>

export type RoundOutcomeCoordinatorDeps = {
  sessionStore: Pick<SessionStore, 'loadItems'>
  turns: Pick<TurnService, 'applyItem' | 'updateItem' | 'getTurn' | 'updateTurnMetadata'>
  events: Pick<RuntimeEventRecorder, 'record'>
  ids: Pick<IdGenerator, 'next'>
  dispatchToolCalls: (input: ToolDispatchInput) => Promise<ToolDispatchOutcome>
  suppressToolCalls: (input: ToolDispatchInput, reason: string) => Promise<void>
  rememberFailure: (turnId: string, failure: TurnExecutionFailure) => void
  hasTurnMadeProgress: (turnId: string) => boolean
  suppressGoalResume: (turnId: string) => void
  /** Two-phase design tool receipts; awaited after dispatch so the model sees the real outcome. */
  receipts?: CanvasReceiptRegistry
}

export abstract class RoundOutcomeState {
  protected readonly lastNoToolTextByTurn = new Map<string, string>()
  protected readonly goalNoToolRecoveryStepsByTurn = new Map<string, number>()
  protected readonly emptyPostToolRecoveryStepsByTurn = new Map<string, number>()
  protected readonly toolSuppressionRecoveryStepsByTurn = new Map<string, number>()
  protected readonly svgCompletionRecoveryStepsByTurn = new Map<string, number>()
  protected readonly graphCreateRunRecoveryByTurn = new Map<string, GraphCreateRunRecoveryState>()
  protected readonly graphPlanNoToolRecoveryByTurn = new Map<string, number>()
  protected readonly pptNoToolRecoveryByTurn = new Map<string, number>()
  protected readonly postToolFailureRecoveryStepsByTurn = new Map<string, number>()
  protected readonly outputTruncationRecoveryStepsByTurn = new Map<string, number>()

  constructor(protected readonly deps: RoundOutcomeCoordinatorDeps) {}

  goalNoToolRecoverySteps(turnId: string): number {
    return this.goalNoToolRecoveryStepsByTurn.get(turnId) ?? 0
  }

  hasEmptyPostToolRecovery(turnId: string): boolean {
    return (this.emptyPostToolRecoveryStepsByTurn.get(turnId) ?? 0) > 0
  }

  emptyPostToolRecoverySteps(turnId: string): number {
    return this.emptyPostToolRecoveryStepsByTurn.get(turnId) ?? 0
  }

  postToolFailureRecoverySteps(turnId: string): number {
    return this.postToolFailureRecoveryStepsByTurn.get(turnId) ?? 0
  }

  outputTruncationRecoverySteps(turnId: string): number {
    return this.outputTruncationRecoveryStepsByTurn.get(turnId) ?? 0
  }

  toolSuppressionRecoverySteps(turnId: string): number {
    return this.toolSuppressionRecoveryStepsByTurn.get(turnId) ?? 0
  }

  graphCreateRunRecoverySteps(turnId: string): number {
    return this.graphCreateRunRecoveryByTurn.get(turnId)?.steps ?? 0
  }

  graphCreateRunRecoveryReason(turnId: string): GraphCreateRunRecoveryReason | undefined {
    return this.graphCreateRunRecoveryByTurn.get(turnId)?.reason
  }

  graphPlanNoToolRecoverySteps(turnId: string): number {
    return this.graphPlanNoToolRecoveryByTurn.get(turnId) ?? 0
  }

  clearTurn(turnId: string): void {
    this.lastNoToolTextByTurn.delete(turnId)
    this.goalNoToolRecoveryStepsByTurn.delete(turnId)
    this.emptyPostToolRecoveryStepsByTurn.delete(turnId)
    this.toolSuppressionRecoveryStepsByTurn.delete(turnId)
    this.svgCompletionRecoveryStepsByTurn.delete(turnId)
    this.graphCreateRunRecoveryByTurn.delete(turnId)
    this.graphPlanNoToolRecoveryByTurn.delete(turnId)
    this.pptNoToolRecoveryByTurn.delete(turnId)
    this.postToolFailureRecoveryStepsByTurn.delete(turnId)
    this.outputTruncationRecoveryStepsByTurn.delete(turnId)
  }
}
