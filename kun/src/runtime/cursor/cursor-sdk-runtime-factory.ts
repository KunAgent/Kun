import type { CapabilityRegistry } from '../../adapters/tool/capability-registry.js'
import type {
  ApprovalPolicy,
  ApprovalReviewer,
  SandboxMode
} from '../../contracts/policy.js'
import type { InstructionRuntime } from '../../instructions/instruction-runtime.js'
import { historyReferenceInstructions } from '../../prompt/history-reference-context.js'
import {
  DESIGN_MODE_INSTRUCTION,
  SVG_ARTIFACT_MODE_INSTRUCTION
} from '../../loop/design-mode.js'
import {
  PLAN_MODE_INSTRUCTION,
  todoContinuationInstruction
} from '../../loop/agent-loop.js'
import type { MemoryStore } from '../../memory/memory-store.js'
import { resolveMemoryTurnContext } from '../../memory/memory-turn-context.js'
import { memoryInjectionMetadata } from '../../loop/model-step-preparation-memory.js'
import {
  recordRetrieved,
  type MemoryRetrievalFeedbackTarget
} from '../../memory/memory-retrieval-feedback.js'
import type { ApprovalGate } from '../../ports/approval-gate.js'
import type { ApprovalReviewPort } from '../../ports/approval-review.js'
import type { ToolHost, ToolHostContext } from '../../ports/tool-host.js'
import type { UserInputGate } from '../../ports/user-input-gate.js'
import type { SkillRuntime } from '../../skills/skill-runtime.js'
import type { CanvasReceiptRegistry } from '../../services/canvas-receipt-registry.js'
import {
  CursorSdkRuntime,
  type CursorSdkRuntimeDeps
} from './cursor-sdk-runtime.js'
import {
  buildCursorCustomTools,
  CURSOR_OVERLAP_TOOL_NAMES
} from './cursor-sdk-tool-bridge.js'
import { createKunToolBridgeHost } from '../../harness/kun-tool-bridge-host.js'
import {
  delegatedGraphPlanCanRetry,
  delegatedGraphPlanWasCommitted
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
  /**
   * Dynamic Graph planning harness summary (P1-25): injected while the turn
   * is still in the planning phase (not the stable session prefix).
   */
  graphHarnessSummary?: () => Promise<string | undefined>
  memoryStore?: MemoryStore
  memoryFeedback?: MemoryRetrievalFeedbackTarget
  userInputGate?: UserInputGate
  approvalGate?: ApprovalGate
  approvalReview?: ApprovalReviewPort
  /** Design-canvas receipt registry shared with the native loop. */
  receipts?: CanvasReceiptRegistry
  nowIso?: () => string
  toolContextBoundary?: Pick<
    ToolHostContext,
    | 'allowedModelProviderIds'
    | 'allowedModelIds'
    | 'allowedProviderIds'
    | 'allowedToolNames'
    | 'allowedSkillIds'
    | 'allowedReadPaths'
    | 'allowHostReads'
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
    memoryFeedback,
    userInputGate,
    approvalGate,
    approvalReview,
    nowIso: configuredNowIso,
    toolContextBoundary,
    receipts,
    ...runtimeDeps
  } = deps
  const nowIso = (): string => configuredNowIso?.() ?? new Date().toISOString()

  // Bridged Kun tool listing + execution runs through the shared
  // transport-independent host (docs/ade/05 §3.2). Cursor keeps only the
  // SDKCustomTool format conversion in cursor-sdk-tool-bridge.ts.
  const toolBridge = createKunToolBridgeHost({
    threadStore: deps.threadStore,
    sessionStore: deps.sessionStore,
    registry,
    toolHost,
    turns: deps.turns,
    events: deps.events,
    ids: deps.ids,
    receipts,
    userInputGate,
    approvalGate,
    approvalReview,
    skillRuntime,
    toolContextBoundary,
    defaultApprovalPolicy,
    defaultSandboxMode,
    defaultApprovalReviewer,
    enforceReadOnly: runtimeDeps.enforceReadOnly,
    callIdPrefix: 'call_cursor_sdk',
    nowIso
  })

  const loadKunTurnContext: NonNullable<
    CursorSdkRuntimeDeps['loadKunTurnContext']
  > = async ({ threadId, turnId, userText, actingModelRoute, signal }) => {
      const scope = await toolBridge.resolveTurnScope(threadId, turnId, {
        skillPrompt: userText,
        actingModelRoute
      })
      if (!scope) throw new Error('Cursor SDK Kun tool context is unavailable')
      const { thread, turn, plan, graphPolicy, skillResolution, activeSkillIds } = scope
      // The bridged catalog comes from the shared tool bridge host. Cursor
      // keeps its native read/write/bash priority, so overlap exclusion stays
      // pinned for Cursor even where the host would suppress it.
      const tools = await toolBridge.listTools(threadId, turnId, {
        scope,
        overlap: CURSOR_OVERLAP_TOOL_NAMES
      })

      const instructionResolution = instructionRuntime
        ? await instructionRuntime.resolveTurn({ workspace: thread.workspace })
        : undefined
      if (instructionResolution) {
        await deps.turns.updateTurnMetadata(threadId, turnId, {
          injectedInstructionSources: instructionResolution.sources,
          instructionInjectionBytes: instructionResolution.injectedBytes
        })
      }
      // Directives are injected on every turn — including empty-prompt
      // continuations — while reference memories stay relevance-gated. Rooms
      // keep the memory-free boundary.
      const memoryContext = await resolveMemoryTurnContext(
        thread.roomContext ? undefined : memoryStore,
        { query: userText, workspace: thread.workspace }
      )
      const directiveBlocks = memoryContext.directiveBlocks
      const memoryBlocks = memoryContext.referenceBlocks
      const memoryIds = memoryContext.memories.map((memory) => memory.id)
      if (memoryContext.memories.length > 0 || memoryContext.directives.length > 0) {
        await deps.turns.updateTurnMetadata(threadId, turnId, memoryInjectionMetadata({
          memories: memoryContext.memories,
          directives: memoryContext.directives
        }))
      }
      if (!plan.planMode && thread.goal?.status === 'active') {
        await deps.turns.ensureGoalContext(threadId, turnId, signal)
      }
      if (signal.aborted) {
        return { instructionBlocks: [], activeSkillIds: [], tools: [], customTools: {} }
      }
      const todoInstruction = plan.planMode ? null : todoContinuationInstruction(thread.todos)
      const graphHarnessInstruction =
        graphPolicy?.phase === 'planning'
          ? await deps.graphHarnessSummary?.().catch(() => undefined)
          : undefined
      const instructionBlocks = [
        ...historyReferenceInstructions(thread),
        ...(graphPolicy ? [graphPolicy.instruction] : []),
        ...(graphHarnessInstruction ? [graphHarnessInstruction] : []),
        ...(plan.planMode ? [PLAN_MODE_INSTRUCTION] : []),
        ...(turn.guiDesignArtifact?.kind === 'svg'
          ? [SVG_ARTIFACT_MODE_INSTRUCTION]
          : turn.guiDesignMode
            ? [DESIGN_MODE_INSTRUCTION]
            : []),
        ...(instructionResolution?.instruction ? [instructionResolution.instruction] : []),
        ...(todoInstruction ? [todoInstruction] : []),
        ...directiveBlocks,
        ...memoryBlocks,
        ...(skillResolution?.catalogInstruction ? [skillResolution.catalogInstruction] : []),
        ...(skillResolution?.instructions ?? []),
        ...(tools.length ? [CURSOR_KUN_TOOL_INSTRUCTION] : [])
      ]
      let graphPlanCommitted = false
      let graphPlanRetryAllowed = true
      const customTools = toolHost
        ? buildCursorCustomTools(tools, async ({ toolName, args, toolCallId }) => {
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
            const toolResult = await toolBridge.execute(threadId, turnId, {
              toolName,
              args,
              ...(toolCallId?.trim() ? { callId: toolCallId.trim() } : {}),
              ...(spec.providerId ? { providerId: spec.providerId } : {}),
              ...(spec.toolKind ? { toolKind: spec.toolKind } : {}),
              signal
            })
            if (toolName === 'graph_define_plan' && delegatedGraphPlanWasCommitted(toolResult)) {
              graphPlanCommitted = true
              graphPlanRetryAllowed = false
            } else if (toolName === 'graph_define_plan') {
              graphPlanRetryAllowed = delegatedGraphPlanCanRetry(toolResult)
            }
            return toolResult
          })
        : {}

      void recordRetrieved({
        feedback: memoryFeedback,
        selectedIds: memoryIds,
        threadId,
        turnId,
        occurredAt: turn.createdAt
      })
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
