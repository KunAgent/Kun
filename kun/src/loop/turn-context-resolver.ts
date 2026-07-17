import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import type { MemoryRecord } from '../contracts/memory.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import { DEFAULT_APPROVAL_POLICY, DEFAULT_SANDBOX_MODE } from '../contracts/policy.js'
import type { InstructionRuntime, InstructionTurnResolution } from '../instructions/instruction-runtime.js'
import type { MemoryStore } from '../memory/memory-store.js'
import type { GuiPlanContext, ToolHost, ToolHostContext } from '../ports/tool-host.js'
import type { SkillRuntime, SkillTurnResolution } from '../skills/skill-runtime.js'
import { SVG_ARTIFACT_ALLOWED_TOOL_NAMES } from './design-mode.js'
import { InteractiveToolBridge } from './interactive-tool-bridge.js'
import {
  allowedToolNamesWithGuiStateTools,
  goalContinuationInstruction,
  goalNoToolRecoveryInstruction,
  intersectAllowedToolNames,
  todoContinuationInstruction
} from './continuation-instructions.js'
import { isStalePlanContext } from './plan-mode.js'
import { createToolDiscoveryContext } from './tool-discovery-context-factory.js'
import type {
  PreparedTurnContext,
  ResolvedTurnAttachments
} from './turn-execution-types.js'

const EMPTY_SKILL_RESOLUTION: SkillTurnResolution = {
  activeSkillIds: [],
  activations: [],
  instructions: [],
  injectedBytes: 0
}

const EMPTY_INSTRUCTION_RESOLUTION: InstructionTurnResolution = {
  instruction: undefined,
  sources: [],
  injectedBytes: 0
}

/** Stable, policy-relevant identity of a turn before resolving its schemas. */
export type TurnModeContext = Readonly<{
  dedicatedSvgTurn: boolean
  planContextStale: boolean
  activePlanContext?: GuiPlanContext
  effectiveMode: 'agent' | 'plan'
}>

export type TurnContextResolverInput = {
  threadId: string
  turnId: string
  thread: ThreadRecord
  turn: Turn
  history: readonly import('../contracts/items.js').TurnItem[]
  model: string
  modelCapabilities: ModelCapabilityMetadata
  signal: AbortSignal
  mode: TurnModeContext
  goalNoToolRecoverySteps: number
}

export type TurnContextResolverDeps = {
  toolHost: Pick<ToolHost, 'listTools'>
  resolveAttachments: (input: {
    attachmentIds: readonly string[]
    threadId: string
    workspace: string
    modelCapabilities: ModelCapabilityMetadata
  }) => Promise<ResolvedTurnAttachments>
  skillRuntime?: Pick<SkillRuntime, 'resolveTurn'>
  instructionRuntime?: Pick<InstructionRuntime, 'resolveTurn'>
  memoryStore?: Pick<MemoryStore, 'retrieve' | 'setLastInjected'>
  getMemoryStore?: () => Pick<MemoryStore, 'retrieve' | 'setLastInjected'> | undefined
  interactiveToolBridge: Pick<InteractiveToolBridge, 'awaitUserInput'>
  forcedAllowedToolNames?: readonly string[]
  blockedProviderIds?: readonly string[]
  blockedToolNames?: readonly string[]
  blockedSkillIds?: readonly string[]
  runtimeDataDir?: string
}

/**
 * Resolve the per-step context consumed by model and tool boundaries. It may
 * read runtime state but never streams a model, executes a tool, emits an
 * event, or persists a turn mutation.
 */
export class TurnContextResolver {
  constructor(private readonly deps: TurnContextResolverDeps) {}

  async resolve(input: TurnContextResolverInput): Promise<PreparedTurnContext> {
    const workspace = input.thread.workspace
    const approvalPolicy = normalizeApprovalPolicy(input.thread.approvalPolicy)
    const sandboxMode = normalizeSandboxMode(input.thread.sandboxMode)
    // Keep the legacy dependency/read order. Besides making failures and
    // diagnostics deterministic, the runtimes retain per-turn diagnostic
    // snapshots, so speculative parallel resolution would be observable.
    const attachments = await this.deps.resolveAttachments({
      attachmentIds: input.turn.attachmentIds ?? [],
      threadId: input.threadId,
      workspace,
      modelCapabilities: input.modelCapabilities
    })
    const skillResolution = await this.deps.skillRuntime?.resolveTurn({
      prompt: input.turn.prompt,
      workspace,
      threadId: input.threadId,
      turnId: input.turnId,
      ...(this.deps.blockedSkillIds ? { blockedSkillIds: this.deps.blockedSkillIds } : {})
    }) ?? EMPTY_SKILL_RESOLUTION
    const instructionResolution = await this.deps.instructionRuntime?.resolveTurn({ workspace }) ??
      EMPTY_INSTRUCTION_RESOLUTION
    const memoryStore = this.deps.getMemoryStore?.() ?? this.deps.memoryStore
    const memories = await retrieveMemories(memoryStore, {
      prompt: input.turn.prompt,
      workspace
    })
    const planTurnActive = !input.mode.dedicatedSvgTurn && !input.mode.planContextStale && (
      input.mode.effectiveMode === 'plan' || Boolean(input.mode.activePlanContext)
    )
    const activeGoalInstruction = planTurnActive
      ? null
      : goalContinuationInstruction(input.thread.goal)
    const goalRecoveryInstruction = activeGoalInstruction
      ? goalNoToolRecoveryInstruction(input.goalNoToolRecoverySteps)
      : null
    const activeTodoInstruction = planTurnActive
      ? null
      : todoContinuationInstruction(input.thread.todos)
    const forcedAllowedToolNames = intersectAllowedToolNames(
      this.deps.forcedAllowedToolNames,
      input.mode.dedicatedSvgTurn ? SVG_ARTIFACT_ALLOWED_TOOL_NAMES : undefined
    )
    const allowedToolNames = intersectAllowedToolNames(
      intersectAllowedToolNames(
        allowedToolNamesWithGuiStateTools(
          // A dedicated SVG turn must not let an unrelated activated skill hide
          // its required edit/validate tool family.
          input.mode.dedicatedSvgTurn ? undefined : skillResolution.allowedToolNames,
          activeGoalInstruction !== null
        ),
        forcedAllowedToolNames
      ),
      input.turn.allowedToolNames
    )
    const userInputDisabled = input.turn.disableUserInput === true
    const toolDiscoveryContext = createToolDiscoveryContext({
      threadId: input.threadId,
      turnId: input.turnId,
      workspace,
      threadMode: input.mode.effectiveMode,
      ...(input.mode.activePlanContext ? { activePlanContext: input.mode.activePlanContext } : {}),
      ...(input.turn.guiDesignCanvas ? { guiDesignCanvas: true } : {}),
      ...(input.turn.guiDesignMode ? { guiDesignMode: true } : {}),
      ...(input.turn.guiDesignArtifact ? { guiDesignArtifact: input.turn.guiDesignArtifact } : {}),
      ...(input.turn.imContext ? { imContext: true } : {}),
      modelCapabilities: input.modelCapabilities,
      activeSkillIds: skillResolution.activeSkillIds,
      ...(allowedToolNames ? { allowedToolNames } : {}),
      ...(input.thread.toolCatalogEpoch
        ? { extensionToolCatalogEpoch: input.thread.toolCatalogEpoch }
        : {}),
      approvalPolicy,
      sandboxMode,
      ...(userInputDisabled ? { userInputDisabled: true } : {}),
      signal: input.signal
    }, {
      memoryEnabled: Boolean(memoryStore),
      ...(this.deps.blockedProviderIds ? { blockedProviderIds: this.deps.blockedProviderIds } : {}),
      ...(this.deps.blockedToolNames ? { blockedToolNames: this.deps.blockedToolNames } : {}),
      ...(this.deps.blockedSkillIds ? { blockedSkillIds: this.deps.blockedSkillIds } : {}),
      ...(this.deps.runtimeDataDir ? { runtimeDataDir: this.deps.runtimeDataDir } : {}),
      interactiveToolBridge: this.deps.interactiveToolBridge
    })
    const tools = await this.deps.toolHost.listTools(toolDiscoveryContext)
    return {
      threadId: input.threadId,
      turnId: input.turnId,
      workspace,
      model: input.model,
      mode: input.mode.effectiveMode,
      dedicatedSvgTurn: input.mode.dedicatedSvgTurn,
      planContextStale: input.mode.planContextStale,
      ...(input.mode.activePlanContext ? { activePlanContext: input.mode.activePlanContext } : {}),
      approvalPolicy,
      sandboxMode,
      signal: input.signal,
      history: input.history,
      modelCapabilities: input.modelCapabilities,
      attachments,
      skillResolution,
      instructionResolution,
      memories,
      activeGoalInstruction,
      goalRecoveryInstruction,
      activeTodoInstruction,
      planTurnActive,
      ...(allowedToolNames ? { allowedToolNames } : {}),
      ...(input.thread.toolCatalogEpoch
        ? { extensionToolCatalogEpoch: input.thread.toolCatalogEpoch }
        : {}),
      userInputDisabled,
      toolDiscoveryContext,
      tools
    }
  }
}

/**
 * Resolve mode/plan identity before budget gating. Keeping it pure lets the
 * caller avoid constructing a context for a deliberately blocked turn.
 */
export function resolveTurnModeContext(input: {
  turn: Turn
  workspace: string
  threadMode: ThreadRecord['mode']
  fallbackPlanContext?: TurnModeContext['activePlanContext']
}): TurnModeContext {
  const dedicatedSvgTurn = input.turn.guiDesignArtifact?.kind === 'svg'
  const candidatePlanContext = input.turn.guiPlan
    ? { ...input.turn.guiPlan, turnId: input.turn.id }
    : input.fallbackPlanContext
  const planContextStale = isStalePlanContext(candidatePlanContext, input.workspace)
  const activePlanContext = dedicatedSvgTurn || planContextStale ? undefined : candidatePlanContext
  return {
    dedicatedSvgTurn,
    planContextStale,
    ...(activePlanContext ? { activePlanContext } : {}),
    effectiveMode: dedicatedSvgTurn ? 'agent' : input.turn.mode ?? input.threadMode
  }
}

async function retrieveMemories(
  memoryStore: TurnContextResolverDeps['memoryStore'],
  input: { prompt: string; workspace: string }
): Promise<MemoryRecord[]> {
  if (!memoryStore) return []
  const memories = await memoryStore.retrieve({
    query: input.prompt,
    workspace: input.workspace,
    limit: 8
  })
  memoryStore.setLastInjected(memories.map((memory) => memory.id))
  return memories
}

function normalizeApprovalPolicy(value: string | undefined): ToolHostContext['approvalPolicy'] {
  switch (value) {
    case 'on-request':
    case 'always':
    case 'never':
    case 'auto':
    case 'suggest':
    case 'untrusted':
      return value
    default:
      return DEFAULT_APPROVAL_POLICY
  }
}

function normalizeSandboxMode(
  value: string | undefined
): NonNullable<ToolHostContext['sandboxMode']> {
  switch (value) {
    case 'read-only':
    case 'workspace-write':
    case 'danger-full-access':
    case 'external-sandbox':
      return value
    default:
      return DEFAULT_SANDBOX_MODE
  }
}
