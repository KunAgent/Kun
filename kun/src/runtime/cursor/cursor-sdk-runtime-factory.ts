import type { CapabilityRegistry } from '../../adapters/tool/capability-registry.js'
import type { AttachmentStore } from '../../attachments/attachment-store.js'
import type {
  ApprovalPolicy,
  ApprovalReviewer,
  SandboxMode
} from '../../contracts/policy.js'
import type { ActingTurnModelRoute } from '../../contracts/turns.js'
import type { ThreadRecord } from '../../contracts/threads.js'
import type { TurnItem } from '../../contracts/items.js'
import { makeUserInputItem } from '../../domain/item.js'
import type { ApprovalRequest } from '../../domain/approval.js'
import type { InstructionRuntime } from '../../instructions/instruction-runtime.js'
import {
  DESIGN_MODE_INSTRUCTION,
  SVG_ARTIFACT_ALLOWED_TOOL_NAMES,
  SVG_ARTIFACT_MODE_INSTRUCTION
} from '../../loop/design-mode.js'
import {
  PLAN_MODE_INSTRUCTION,
  isStalePlanContext,
  memoryInstructions,
  todoContinuationInstruction
} from '../../loop/agent-loop.js'
import type { MemoryStore } from '../../memory/memory-store.js'
import type { ApprovalGate } from '../../ports/approval-gate.js'
import type { ApprovalReviewPort } from '../../ports/approval-review.js'
import type {
  GuiPlanContext,
  ToolHost,
  ToolHostContext
} from '../../ports/tool-host.js'
import type {
  UserInputGate,
  UserInputRequest,
  UserInputResolution
} from '../../ports/user-input-gate.js'
import {
  armUserInputTimeout,
  awaitAbortableGate,
  userInputRequestWithDeadline
} from '../../services/interactive-gate.js'
import { sessionEventExists } from '../../adapters/session-event-query.js'
import type { SkillRuntime } from '../../skills/skill-runtime.js'
import {
  DEFAULT_APPROVAL_REVIEWER,
  DEFAULT_SANDBOX_MODE
} from '../../contracts/policy.js'
import {
  CursorSdkRuntime,
  type CursorSdkRuntimeDeps
} from './cursor-sdk-runtime.js'
import {
  buildCursorCustomTools,
  selectCursorBridgeTools
} from './cursor-sdk-tool-bridge.js'
import {
  delegatedGraphAllowedToolNames,
  delegatedGraphPlanCanRetry,
  delegatedGraphPlanWasCommitted,
  delegatedGraphTurnPolicy,
  intersectDelegatedToolNames
} from '../delegated-graph-turn-policy.js'

const CURSOR_KUN_TOOL_INSTRUCTION = [
  'Prefer Cursor built-in tools for reading, editing, searching, and running shell commands.',
  'Kun-managed capabilities are available through Cursor custom tools (MCP, extensions, skills, memory, media, GUI input, and delegation).',
  'Use those custom tools only for Kun-exclusive work; their execution remains governed by Kun approval and sandbox policy.'
].join(' ')

export interface CursorSdkRuntimeFactoryDeps extends Omit<
  CursorSdkRuntimeDeps,
  'loadKunTurnContext'
> {
  registry: CapabilityRegistry
  toolHost?: ToolHost
  defaultApprovalPolicy: ApprovalPolicy
  defaultSandboxMode?: SandboxMode
  defaultApprovalReviewer?: ApprovalReviewer
  skillRuntime?: SkillRuntime
  instructionRuntime?: InstructionRuntime
  memoryStore?: MemoryStore
  userInputGate?: UserInputGate
  approvalGate?: ApprovalGate
  approvalReview?: ApprovalReviewPort
  nowIso?: () => string
  toolContextBoundary?: Pick<
    ToolHostContext,
    | 'allowedProviderIds'
    | 'allowedToolNames'
    | 'allowedSkillIds'
    | 'allowedReadPaths'
    | 'allowedWritePaths'
    | 'allowedArtifactIds'
    | 'pptWorkflowScope'
    | 'blockedProviderIds'
    | 'blockedToolNames'
    | 'blockedSkillIds'
  >
}

export function createCursorSdkRuntime(
  deps: CursorSdkRuntimeFactoryDeps
): CursorSdkRuntime {
  const {
    registry,
    toolHost,
    defaultApprovalPolicy,
    defaultSandboxMode,
    defaultApprovalReviewer,
    skillRuntime,
    instructionRuntime,
    memoryStore,
    userInputGate,
    approvalGate,
    approvalReview,
    nowIso: configuredNowIso,
    toolContextBoundary,
    ...runtimeDeps
  } = deps
  const activeSkillIdsByTurn = new Map<string, readonly string[]>()
  const turnKey = (threadId: string, turnId: string): string => `${threadId}\u0000${turnId}`
  const nowIso = (): string => configuredNowIso?.() ?? new Date().toISOString()

  const resolveActiveSkillIds = async (
    thread: ThreadRecord,
    turn: ThreadRecord['turns'][number],
    prompt: string
  ): Promise<readonly string[]> => {
    if (!skillRuntime) return activeSkillIdsByTurn.get(turnKey(thread.id, turn.id)) ?? []
    const resolution = await skillRuntime.resolveTurn({
      prompt,
      workspace: thread.workspace,
      threadId: thread.id,
      turnId: turn.id,
      ...(toolContextBoundary?.allowedSkillIds
        ? { allowedSkillIds: toolContextBoundary.allowedSkillIds }
        : {}),
      ...(toolContextBoundary?.blockedSkillIds
        ? { blockedSkillIds: toolContextBoundary.blockedSkillIds }
        : {})
    })
    activeSkillIdsByTurn.set(turnKey(thread.id, turn.id), resolution.activeSkillIds)
    return resolution.activeSkillIds
  }

  const makeAwaitUserInput = (
    threadId: string,
    turnId: string,
    signal: AbortSignal
  ): ToolHostContext['awaitUserInput'] => {
    if (!userInputGate) return undefined
    return async (input): Promise<UserInputResolution> => {
      const request: UserInputRequest = {
        id: input.id,
        threadId,
        turnId,
        itemId: input.itemId,
        prompt: input.prompt,
        questions: input.questions,
        ...(input.timeoutSeconds !== undefined ? { timeoutSeconds: input.timeoutSeconds } : {})
      }
      const pending = userInputGate.request(userInputRequestWithDeadline(request))
      const item = makeUserInputItem({
        id: input.itemId,
        threadId,
        turnId,
        inputId: input.id,
        prompt: input.prompt,
        questions: input.questions,
        ...(input.timeoutSeconds !== undefined ? { timeoutSeconds: input.timeoutSeconds } : {})
      })
      try {
        await deps.turns.applyItem(threadId, item)
        await deps.events.record({
          kind: 'user_input_requested',
          threadId,
          turnId,
          itemId: item.id,
          inputId: input.id,
          status: 'pending',
          prompt: input.prompt,
          questions: input.questions,
          ...(input.timeoutSeconds !== undefined ? { timeoutSeconds: input.timeoutSeconds } : {})
        })
      } catch (error) {
        userInputGate.resolve(input.id, { status: 'cancelled' })
        void pending.catch(() => undefined)
        throw error
      }
      const disarmTimeout = armUserInputTimeout(
        (resolution) => userInputGate.resolve(input.id, resolution),
        input.id,
        input.timeoutSeconds
      )
      let resolution: UserInputResolution
      try {
        resolution = await awaitAbortableGate(
          pending,
          signal,
          () => { userInputGate.resolve(input.id, { status: 'cancelled' }) },
          'cancelled while awaiting Cursor SDK tool input'
        )
      } catch {
        resolution = { status: 'cancelled' }
      } finally {
        disarmTimeout()
      }
      await deps.turns.updateItem(threadId, item.id, {
        status: resolution.status,
        finishedAt: nowIso(),
        ...(resolution.status === 'submitted' ? { answers: resolution.answers } : {})
      } as Partial<TurnItem>)
      const alreadyRecorded = await sessionEventExists(
        deps.sessionStore,
        threadId,
        (event) => event.kind === 'user_input_resolved' && event.inputId === input.id
      )
      if (!alreadyRecorded) {
        await deps.events.record({
          kind: 'user_input_resolved',
          threadId,
          turnId,
          itemId: item.id,
          inputId: input.id,
          status: resolution.status,
          prompt: input.prompt,
          questions: input.questions,
          ...(resolution.status === 'submitted' ? { answers: resolution.answers } : {})
        })
      }
      return resolution
    }
  }

  const makeAwaitApproval = (
    approvalPolicy: ApprovalPolicy,
    sandboxMode: SandboxMode | undefined,
    approvalReviewer: ApprovalReviewer,
    actingModelRoute: ActingTurnModelRoute,
    intent: string,
    signal: AbortSignal
  ): ToolHostContext['awaitApproval'] => async (approval: ApprovalRequest) => {
    if (approvalPolicy === 'auto' && sandboxMode === 'danger-full-access') return 'allow'
    if (approvalReviewer === 'agent') {
      if (!approvalReview) {
        return {
          decision: 'deny',
          reviewer: 'agent',
          reason: 'Automatic approval review is unavailable.',
          reviewStatus: 'failed-closed'
        }
      }
      return approvalReview.review({
        approval,
        route: actingModelRoute,
        intent,
        signal
      })
    }
    if (approvalPolicy === 'never' || !approvalGate) return 'deny'
    const pending = approvalGate.request(approval)
    try {
      await deps.events.record({
        kind: 'approval_requested',
        threadId: approval.threadId,
        turnId: approval.turnId,
        approvalId: approval.id,
        toolName: approval.toolName,
        status: 'pending',
        approvalPolicy,
        approvalReviewer: 'user',
        sandboxMode: sandboxMode ?? DEFAULT_SANDBOX_MODE,
        summary: approval.summary,
        ...(approval.action ? { action: approval.action } : {})
      })
      return await awaitAbortableGate(
        pending,
        signal,
        () => { approvalGate.expire(approval.id, 'Cursor SDK turn aborted while awaiting approval') },
        'cancelled while awaiting Cursor SDK tool approval'
      )
    } catch {
      approvalGate.expire(approval.id, 'Cursor SDK tool approval failed')
      void pending.catch(() => undefined)
      return 'deny'
    }
  }

  const toolContext = (input: {
    thread: ThreadRecord
    turn: ThreadRecord['turns'][number]
    signal: AbortSignal
    activeSkillIds: readonly string[]
    actingModelRoute: ActingTurnModelRoute
    approvalReviewer: ApprovalReviewer
    approvalPolicy: ApprovalPolicy
    sandboxMode: SandboxMode
    listing?: boolean
    allowedToolNames?: readonly string[]
  }): ToolHostContext => {
    const plan = resolveCursorPlanContext(input.thread, input.turn.id)
    const dedicatedSvgTurn =
      input.turn.orchestration !== 'graph' &&
      input.turn.guiDesignArtifact?.kind === 'svg'
    const allowedToolNames = intersectDelegatedToolNames(
      toolContextBoundary?.allowedToolNames,
      intersectDelegatedToolNames(
        dedicatedSvgTurn ? SVG_ARTIFACT_ALLOWED_TOOL_NAMES : undefined,
        input.allowedToolNames
      )
    )
    const awaitUserInput = makeAwaitUserInput(
      input.thread.id,
      input.turn.id,
      input.signal
    )
    return {
      threadId: input.thread.id,
      turnId: input.turn.id,
      workspace: input.thread.workspace,
      approvalPolicy: input.approvalPolicy,
      approvalReviewer: input.approvalReviewer,
      sandboxMode: input.sandboxMode,
      actingModelRoute: input.actingModelRoute,
      approvalIntent: input.turn.prompt,
      abortSignal: input.signal,
      ...toolContextBoundary,
      ...(input.turn.orchestration ? { orchestration: input.turn.orchestration } : {}),
      ...(plan.planMode ? { threadMode: 'plan' as const } : {}),
      ...(plan.guiPlan ? { guiPlan: plan.guiPlan } : {}),
      ...(input.turn.guiDesignCanvas ? { guiDesignCanvas: true } : {}),
      ...(input.turn.guiDesignMode ? { guiDesignMode: true } : {}),
      ...(input.turn.guiDesignArtifact
        ? { guiDesignArtifact: input.turn.guiDesignArtifact }
        : {}),
      ...(input.thread.toolCatalogEpoch
        ? { extensionToolCatalogEpoch: input.thread.toolCatalogEpoch }
        : {}),
      activeSkillIds: input.activeSkillIds,
      ...(allowedToolNames ? { allowedToolNames } : {}),
      ...(awaitUserInput ? { awaitUserInput } : {}),
      awaitApproval: input.listing
        ? async () => 'deny'
        : makeAwaitApproval(
            input.approvalPolicy,
            input.sandboxMode,
            input.approvalReviewer,
            input.actingModelRoute,
            input.turn.prompt,
            input.signal
          )
    }
  }

  const loadKunTurnContext: NonNullable<
    CursorSdkRuntimeDeps['loadKunTurnContext']
  > = async ({ threadId, turnId, userText, actingModelRoute, signal }) => {
      const thread = await deps.threadStore.get(threadId)
      const turn = thread?.turns.find((candidate) => candidate.id === turnId)
      if (!thread || !turn) throw new Error('Cursor SDK Kun tool context is unavailable')
      const approvalReviewer =
        turn.approvalReviewer ??
        thread.approvalReviewer ??
        defaultApprovalReviewer ??
        DEFAULT_APPROVAL_REVIEWER
      const approvalPolicy = runtimeDeps.enforceReadOnly === true
        ? 'never'
        : turn.approvalPolicy ?? thread.approvalPolicy ?? defaultApprovalPolicy
      const sandboxMode = runtimeDeps.enforceReadOnly === true
        ? 'read-only'
        : turn.sandboxMode ??
          thread.sandboxMode ??
          defaultSandboxMode ??
          DEFAULT_SANDBOX_MODE

      const skillResolution = skillRuntime
        ? await skillRuntime.resolveTurn({
            prompt: userText,
            workspace: thread.workspace,
            threadId,
            turnId,
            ...(toolContextBoundary?.allowedSkillIds
              ? { allowedSkillIds: toolContextBoundary.allowedSkillIds }
              : {}),
            ...(toolContextBoundary?.blockedSkillIds
              ? { blockedSkillIds: toolContextBoundary.blockedSkillIds }
              : {})
          })
        : undefined
      const activeSkillIds = skillResolution?.activeSkillIds ?? []
      activeSkillIdsByTurn.set(turnKey(threadId, turnId), activeSkillIds)
      const availableSkillIds = typeof skillRuntime?.availableSkillIdsForWorkspace === 'function'
        ? await skillRuntime.availableSkillIdsForWorkspace(
            thread.workspace,
            toolContextBoundary?.blockedSkillIds,
            toolContextBoundary?.allowedSkillIds
          )
        : activeSkillIds
      const listingSkillIds = [...new Set([...activeSkillIds, ...availableSkillIds])]
      const graphPolicy = delegatedGraphTurnPolicy(turn)
      const discoveryContext = toolContext({
        thread,
        turn,
        signal,
        activeSkillIds: listingSkillIds,
        actingModelRoute,
        approvalReviewer,
        approvalPolicy,
        sandboxMode,
        listing: true
      })
      if (toolHost) {
        // Run the host preparation hook first so turn-scoped extension
        // contributions are registered before the canonical catalog snapshot.
        await toolHost.listTools(discoveryContext)
      }
      const graphAllowedToolNames = graphPolicy
        ? delegatedGraphAllowedToolNames(
            registry.listTools(discoveryContext),
            graphPolicy.phase
          )
        : undefined
      const listingContext = toolContext({
        thread,
        turn,
        signal,
        activeSkillIds: listingSkillIds,
        actingModelRoute,
        approvalReviewer,
        approvalPolicy,
        sandboxMode,
        listing: true,
        ...(graphAllowedToolNames ? { allowedToolNames: graphAllowedToolNames } : {})
      })
      const tools = toolHost
        ? selectCursorBridgeTools(registry.listTools(listingContext))
        : []

      const instructionResolution = instructionRuntime
        ? await instructionRuntime.resolveTurn({ workspace: thread.workspace })
        : undefined
      if (instructionResolution) {
        await deps.turns.updateTurnMetadata(threadId, turnId, {
          injectedInstructionSources: instructionResolution.sources,
          instructionInjectionBytes: instructionResolution.injectedBytes
        })
      }
      let memoryBlocks: string[] = []
      if (memoryStore && userText.trim()) {
        const memories = await memoryStore.retrieve({
          query: userText,
          workspace: thread.workspace,
          limit: 8
        })
        memoryStore.setLastInjected(memories.map((memory) => memory.id))
        memoryBlocks = memoryInstructions(memories)
      }
      const plan = resolveCursorPlanContext(thread, turnId)
      if (!plan.planMode && thread.goal?.status === 'active') {
        await deps.turns.ensureGoalContext(threadId, turnId, signal)
      }
      if (signal.aborted) {
        return { instructionBlocks: [], activeSkillIds: [], tools: [], customTools: {} }
      }
      const todoInstruction = plan.planMode ? null : todoContinuationInstruction(thread.todos)
      const instructionBlocks = [
        ...(graphPolicy ? [graphPolicy.instruction] : []),
        ...(plan.planMode ? [PLAN_MODE_INSTRUCTION] : []),
        ...(turn.guiDesignArtifact?.kind === 'svg'
          ? [SVG_ARTIFACT_MODE_INSTRUCTION]
          : turn.guiDesignMode
            ? [DESIGN_MODE_INSTRUCTION]
            : []),
        ...(instructionResolution?.instruction ? [instructionResolution.instruction] : []),
        ...(todoInstruction ? [todoInstruction] : []),
        ...memoryBlocks,
        ...(skillResolution?.catalogInstruction ? [skillResolution.catalogInstruction] : []),
        ...(skillResolution?.instructions ?? []),
        ...(tools.length ? [CURSOR_KUN_TOOL_INSTRUCTION] : [])
      ]
      let graphPlanCommitted = false
      let graphPlanRetryAllowed = true
      const customTools = toolHost
        ? buildCursorCustomTools(tools, async ({ toolName, args, toolCallId }) => {
            const latestThread = await deps.threadStore.get(threadId)
            const latestTurn = latestThread?.turns.find((candidate) => candidate.id === turnId)
            if (!latestThread || !latestTurn) {
              return { output: 'Cursor SDK Kun tool context expired', isError: true }
            }
            // Resolve the tool against the bridged catalog so provider and
            // tool-kind stay authoritative. An unknown name is a structured
            // error instead of a bypassed registry resolution.
            const spec = tools.find((tool) => tool.name.trim() === toolName)
            if (!spec) {
              return {
                output: {
                  error: `Kun tool ${toolName} is not advertised in the active tool catalog`
                },
                isError: true
              }
            }
            const latestActiveSkillIds = await resolveActiveSkillIds(
              latestThread,
              latestTurn,
              userText
            )
            const latestGraphPolicy = delegatedGraphTurnPolicy(latestTurn)
            const discoveryExecutionContext = toolContext({
              thread: latestThread,
              turn: latestTurn,
              signal,
              activeSkillIds: latestActiveSkillIds,
              actingModelRoute,
              approvalReviewer,
              approvalPolicy,
              sandboxMode
            })
            const latestGraphAllowedToolNames = latestGraphPolicy
              ? delegatedGraphAllowedToolNames(
                  registry.listTools(discoveryExecutionContext),
                  latestGraphPolicy.phase
                )
              : undefined
            const context = toolContext({
              thread: latestThread,
              turn: latestTurn,
              signal,
              activeSkillIds: latestActiveSkillIds,
              actingModelRoute,
              approvalReviewer,
              approvalPolicy,
              sandboxMode,
              ...(latestGraphAllowedToolNames
                ? { allowedToolNames: latestGraphAllowedToolNames }
                : {})
            })
            try {
              const result = await toolHost.execute({
                callId: toolCallId?.trim() || deps.ids.next('call_cursor_sdk'),
                toolName,
                ...(spec.providerId ? { providerId: spec.providerId } : {}),
                ...(spec.toolKind ? { toolKind: spec.toolKind } : {}),
                arguments: args
              }, context)
              if (result.item.kind !== 'tool_result') {
                return {
                  output: `Kun tool ${toolName} returned an invalid result item`,
                  isError: true
                }
              }
              const toolResult = {
                output: result.item.output,
                isError: result.item.isError
              }
              if (
                toolName === 'graph_define_plan' &&
                delegatedGraphPlanWasCommitted(toolResult)
              ) {
                graphPlanCommitted = true
                graphPlanRetryAllowed = false
              } else if (toolName === 'graph_define_plan') {
                graphPlanRetryAllowed =
                  delegatedGraphPlanCanRetry(toolResult)
              }
              return toolResult
            } catch (error) {
              return {
                output: error instanceof Error ? error.message : String(error),
                isError: true
              }
            }
          })
        : {}

      return {
        instructionBlocks,
        activeSkillIds: [...(skillResolution?.activeSkillIds ?? activeSkillIds)],
        tools,
        customTools,
        ...(graphPolicy
          ? {
              graphPhase: graphPolicy.phase,
              graphPlanWasCommitted: () => graphPlanCommitted,
              graphPlanCanRetry: () => graphPlanRetryAllowed
            }
          : {})
      }
  }

  return new CursorSdkRuntime({
    ...runtimeDeps,
    ...(toolHost ? { loadKunTurnContext } : {})
  })
}

function resolveCursorPlanContext(
  thread: ThreadRecord,
  turnId: string
): { planMode: boolean; guiPlan?: GuiPlanContext } {
  const turn = thread.turns.find((entry) => entry.id === turnId)
  const candidate = turn?.guiPlan ? ({ ...turn.guiPlan, turnId } as GuiPlanContext) : undefined
  const guiPlan = candidate && !isStalePlanContext(candidate, thread.workspace)
    ? candidate
    : undefined
  const planMode = (turn?.mode ?? thread.mode) === 'plan' || Boolean(guiPlan)
  return { planMode, ...(guiPlan ? { guiPlan } : {}) }
}
