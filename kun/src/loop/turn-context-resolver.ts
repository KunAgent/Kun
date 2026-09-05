import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import type { MemoryRecord } from '../contracts/memory.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import type { ActingTurnModelRoute } from '../contracts/turns.js'
import type { TurnClientSurface } from '../contracts/turns.js'
import {
  ApprovalReviewerSchema,
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_APPROVAL_REVIEWER,
  DEFAULT_SANDBOX_MODE
} from '../contracts/policy.js'
import type { InstructionRuntime, InstructionTurnResolution } from '../instructions/instruction-runtime.js'
import type { MemoryStore } from '../memory/memory-store.js'
import { DEFAULT_MEMORY_RETRIEVAL_CANDIDATE_LIMIT } from '../memory/memory-retrieval.js'
import type { GuiPlanContext, PptWorkflowScope, ToolHost, ToolHostContext } from '../ports/tool-host.js'
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
import {
  createToolDiscoveryContext,
  modelToolDiscoveryContexts
} from './tool-discovery-context-factory.js'
import type {
  DiscoveredTool,
  PreparedTurnContext,
  ResolvedTurnAttachments
} from './turn-execution-types.js'
import { collectTurnAttachmentIds } from './turn-steering-attachments.js'

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
  actingModelRoute?: ActingTurnModelRoute
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
  allowedProviderIds?: readonly string[]
  allowedSkillIds?: readonly string[]
  allowedReadPaths?: readonly string[]
  allowedWritePaths?: readonly string[]
  allowedArtifactIds?: readonly string[]
  pptWorkflowScope?: PptWorkflowScope
  blockedProviderIds?: readonly string[]
  blockedToolNames?: readonly string[]
  blockedSkillIds?: readonly string[]
  runtimeDataDir?: string
  fastContext?: boolean
  fastContextScopeId?: string
  fastContextTaskCount?: number
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
    const clientSurface = resolveTurnClientSurface(input.turn)
    const approvalPolicy = normalizeApprovalPolicy(
      input.turn.approvalPolicy ?? input.thread.approvalPolicy
    )
    const sandboxMode = normalizeSandboxMode(
      input.turn.sandboxMode ?? input.thread.sandboxMode
    )
    const approvalReviewer = normalizeApprovalReviewer(
      input.turn.approvalReviewer ?? input.thread.approvalReviewer
    )
    const memoryStore = this.deps.getMemoryStore?.() ?? this.deps.memoryStore
    // These inputs are independent snapshots. Resolve their filesystem/store
    // I/O together so model dispatch pays the slowest branch, not their sum.
    const [attachments, skillResolution, instructionResolution, memories] = await Promise.all([
      this.deps.resolveAttachments({
        attachmentIds: collectTurnAttachmentIds(input.turn),
        threadId: input.threadId,
        workspace,
        modelCapabilities: input.modelCapabilities
      }),
      this.deps.skillRuntime?.resolveTurn({
        prompt: input.turn.prompt,
        workspace,
        threadId: input.threadId,
        turnId: input.turnId,
        ...(this.deps.allowedSkillIds ? { allowedSkillIds: this.deps.allowedSkillIds } : {}),
        ...(this.deps.blockedSkillIds ? { blockedSkillIds: this.deps.blockedSkillIds } : {})
      }) ?? Promise.resolve(EMPTY_SKILL_RESOLUTION),
      this.deps.instructionRuntime?.resolveTurn({ workspace }) ??
        Promise.resolve(EMPTY_INSTRUCTION_RESOLUTION),
      retrieveMemories(memoryStore, {
        prompt: input.turn.prompt,
        workspace
      })
    ])
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
      allowedToolNamesWithGuiStateTools(
        // A dedicated SVG turn must not let an unrelated activated skill hide
        // its required edit/validate tool family.
        input.mode.dedicatedSvgTurn ? undefined : skillResolution.allowedToolNames,
        activeGoalInstruction !== null
      ),
      forcedAllowedToolNames
    )
    const userInputDisabled = input.turn.disableUserInput === true
    const toolDiscoveryContext = createToolDiscoveryContext({
      threadId: input.threadId,
      turnId: input.turnId,
      workspace,
      orchestration: input.turn.orchestration,
      ...(input.turn.messageSource ? { messageSource: input.turn.messageSource } : {}),
      ...(input.turn.subagentResume ? { subagentResume: input.turn.subagentResume } : {}),
      additionalWorkspaces: input.thread.additionalWorkspaces,
      knowledgeBases: input.thread.knowledgeBases,
      clientSurface,
      threadMode: input.mode.effectiveMode,
      ...(input.mode.activePlanContext ? { activePlanContext: input.mode.activePlanContext } : {}),
      ...(input.turn.guiDesignCanvas ? { guiDesignCanvas: true } : {}),
      ...(input.turn.guiDesignMode ? { guiDesignMode: true } : {}),
      agentSurface: input.turn.agentSurface ?? 'code',
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
      approvalReviewer,
      actingModelRoute: input.actingModelRoute,
      ...(userInputDisabled ? { userInputDisabled: true } : {}),
      signal: input.signal
    }, {
      memoryEnabled: Boolean(memoryStore),
      ...(this.deps.allowedProviderIds ? { allowedProviderIds: this.deps.allowedProviderIds } : {}),
      ...(this.deps.allowedSkillIds ? { allowedSkillIds: this.deps.allowedSkillIds } : {}),
      ...(this.deps.allowedReadPaths ? { allowedReadPaths: this.deps.allowedReadPaths } : {}),
      ...(this.deps.allowedWritePaths ? { allowedWritePaths: this.deps.allowedWritePaths } : {}),
      ...(this.deps.allowedArtifactIds ? { allowedArtifactIds: this.deps.allowedArtifactIds } : {}),
      ...(this.deps.pptWorkflowScope ? { pptWorkflowScope: this.deps.pptWorkflowScope } : {}),
      ...(this.deps.blockedProviderIds ? { blockedProviderIds: this.deps.blockedProviderIds } : {}),
      ...(this.deps.blockedToolNames ? { blockedToolNames: this.deps.blockedToolNames } : {}),
      ...(this.deps.blockedSkillIds ? { blockedSkillIds: this.deps.blockedSkillIds } : {}),
      ...(this.deps.runtimeDataDir ? { runtimeDataDir: this.deps.runtimeDataDir } : {}),
      ...(this.deps.fastContext ? { fastContext: true } : {}),
      ...(this.deps.fastContextScopeId ? { fastContextScopeId: this.deps.fastContextScopeId } : {}),
      ...(this.deps.fastContextTaskCount ? { fastContextTaskCount: this.deps.fastContextTaskCount } : {}),
      interactiveToolBridge: this.deps.interactiveToolBridge
    })
    const tools = await listModelTools(
      this.deps.toolHost,
      modelToolDiscoveryContexts(toolDiscoveryContext)
    )
    return {
      threadId: input.threadId,
      turnId: input.turnId,
      workspace,
      orchestration: input.turn.orchestration,
      ...(input.turn.messageSource ? { messageSource: input.turn.messageSource } : {}),
      ...(input.turn.subagentResume ? { subagentResume: input.turn.subagentResume } : {}),
      additionalWorkspaces: input.thread.additionalWorkspaces,
      knowledgeBases: input.thread.knowledgeBases,
      model: input.model,
      actingModelRoute: input.actingModelRoute,
      mode: input.mode.effectiveMode,
      clientSurface,
      dedicatedSvgTurn: input.mode.dedicatedSvgTurn,
      planContextStale: input.mode.planContextStale,
      ...(input.mode.activePlanContext ? { activePlanContext: input.mode.activePlanContext } : {}),
      approvalPolicy,
      sandboxMode,
      approvalReviewer,
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

async function listModelTools(
  toolHost: Pick<ToolHost, 'listTools'>,
  contexts: readonly ToolHostContext[]
): Promise<DiscoveredTool[]> {
  const listings = await Promise.all(contexts.map((context) => toolHost.listTools(context)))
  const byName = new Map<string, DiscoveredTool>()
  for (const tools of listings) {
    for (const tool of tools) {
      if (!byName.has(tool.name)) byName.set(tool.name, tool)
    }
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name))
}

export function resolveTurnClientSurface(turn: Pick<
  Turn,
  | 'clientSurface'
  | 'imContext'
  | 'guiPlan'
  | 'guiDesignCanvas'
  | 'guiDesignMode'
  | 'guiDesignArtifact'
  | 'agentSurface'
>): TurnClientSurface {
  if (turn.clientSurface) return turn.clientSurface
  if (turn.imContext) return 'im'
  if (
    turn.guiPlan ||
    turn.guiDesignCanvas ||
    turn.guiDesignMode ||
    turn.guiDesignArtifact ||
    turn.agentSurface
  ) return 'gui'
  return 'api'
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
    limit: DEFAULT_MEMORY_RETRIEVAL_CANDIDATE_LIMIT
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

function normalizeApprovalReviewer(
  value: string | undefined
): NonNullable<ToolHostContext['approvalReviewer']> {
  const parsed = ApprovalReviewerSchema.safeParse(value)
  return parsed.success ? parsed.data : DEFAULT_APPROVAL_REVIEWER
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
