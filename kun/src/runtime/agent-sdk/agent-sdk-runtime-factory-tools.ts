/**
 * Binds the decoupled {@link AgentSdkRuntime} to kun's real runtime services.
 * This is the only place that touches the SDK package and kun's concrete stores,
 * keeping the orchestration (and its tests) free of both.
 */
import {
  AgentSdkCredentialUnavailableError,
  AgentSdkRuntime,
  agentSdkCapabilities,
  type SdkRuntimeDeps,
  type SdkTurnContext
} from './agent-sdk-runtime.js'
import type { SdkStreamResourceLimits } from './sdk-event-mapper.js'
import {
  normalizeClaudeOAuthToken,
  resolveSdkModel,
  type ToolApprovalDecision
} from './sdk-options-builder.js'
import {
  selectBridgeableTools,
  type BridgeableTool,
  type KunToolResult
} from './sdk-tool-bridge.js'
import type { SdkApi } from './sdk-protocol.js'
import type { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import type { LlmDebugSink } from '../../services/llm-debug-recorder.js'
import type { TurnService } from '../../services/turn-service.js'
import type { TurnRunOutcome } from '../../loop/turn-execution-types.js'
import type { SessionStore } from '../../ports/session-store.js'
import type { ThreadStore } from '../../ports/thread-store.js'
import type { CapabilityRegistry } from '../../adapters/tool/capability-registry.js'
import type { ToolHost, ToolHostContext } from '../../ports/tool-host.js'
import { applyRoomToolPolicy } from '../../loop/room-turn-policy.js'
import {
  DEFAULT_APPROVAL_REVIEWER,
  DEFAULT_SANDBOX_MODE,
  type ApprovalPolicy,
  type ApprovalReviewer,
  type SandboxMode
} from '../../contracts/policy.js'
import type { ServeProviderConfig } from '../../config/kun-config.js'
import type { AttachmentStore } from '../../attachments/attachment-store.js'
import type { SkillRuntime } from '../../skills/skill-runtime.js'
import type { InstructionRuntime } from '../../instructions/instruction-runtime.js'
import type { MemoryStore } from '../../memory/memory-store.js'
import {
  PLAN_MODE_INSTRUCTION,
  todoContinuationInstruction,
  memoryInstructions,
  isStalePlanContext
} from '../../loop/agent-loop.js'
import {
  filterGoalContextsForGoalKey,
  goalContextKey
} from '../../loop/continuation-instructions.js'
import {
  DESIGN_MODE_INSTRUCTION,
  SVG_ARTIFACT_ALLOWED_TOOL_NAMES,
  SVG_ARTIFACT_MODE_INSTRUCTION
} from '../../loop/design-mode.js'
import type { GuiDesignArtifactContext, GuiPlanContext } from '../../ports/tool-host.js'
import type { ThreadRecord } from '../../contracts/threads.js'
import type {
  UserInputGate,
  UserInputRequest,
  UserInputResolution
} from '../../ports/user-input-gate.js'
import { goalContextTexts, type TurnItem } from '../../contracts/items.js'
import type { ApprovalGate } from '../../ports/approval-gate.js'
import {
  createApprovalActionEnvelope,
  createApprovalRequest,
  safeApprovalActionSummary,
  type ApprovalRequest,
  type ApprovalResolution
} from '../../domain/approval.js'
import type { ApprovalReviewPort } from '../../ports/approval-review.js'
import type { ActingTurnModelRoute } from '../../contracts/turns.js'
import { makeUserInputItem } from '../../domain/item.js'
import { awaitAbortableGate } from '../../services/interactive-gate.js'
import {
  buildHistoryTranscript,
  DEFAULT_SDK_HISTORY_TRANSCRIPT_MAX_BYTES
} from './sdk-context-assembler.js'
import { shellSpawnEnv } from '../../adapters/tool/builtin-tool-utils.js'
import type { TurnLimitsConfig } from '../../loop/turn-limits.js'
import { userMessageTextWithComposerContexts } from '../../domain/composer-context.js'
import { mkdir } from 'node:fs/promises'
import { resolveTurnClientSurface } from '../../loop/turn-context-resolver.js'
import { buildClientSurfaceInstruction } from '../../prompt/kun-prompt-context.js'
import {
  delegatedCapabilityFingerprint,
  delegatedCredentialIdentity,
  priorItemsForDelegatedTurn,
  type DelegatedSessionCoordinator,
  type DelegatedSessionPreparation
} from '../delegated-session-binding.js'
import {
  delegatedGraphCompletionCheck,
  delegatedGraphAllowedToolNames,
  delegatedGraphTurnPolicy,
  intersectDelegatedToolNames,
  parkDelegatedGraphTurnAfterRecovery
} from '../delegated-graph-turn-policy.js'

const CLAUDE_KUN_TOOL_INSTRUCTION = [
  'Kun-managed capabilities are available through the mcp__kun__ tools.',
  'Use these tools for Kun capabilities such as MCP, extensions, skills, memory, media, GUI input, and delegation.',
  'Their execution remains governed by Kun ToolHost approval and sandbox policy.'
].join(' ')

const SDK_ON_REQUEST_AUTO_ALLOWED_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'TodoWrite'
])
import { isPendingReceiptOutput } from '../../services/canvas-receipt-registry.js'
import type { AgentSdkRuntimeFactoryDeps } from './agent-sdk-runtime-factory-contracts.js'
import { resolveTurnPlanContext } from './agent-sdk-runtime-factory-plan.js'
import type { AgentSdkFactoryContext } from './agent-sdk-runtime-factory-context.js'

export function createAgentSdkToolRuntimeDeps(
  deps: AgentSdkRuntimeFactoryDeps,
  context: AgentSdkFactoryContext
): Pick<SdkRuntimeDeps, 'executeKunTool' | 'decideToolApproval'> {
  const { sessionIdsByTurn, sessionPreparationsByTurn, sessionGoalContextKeysByTurn, activeSkillIdsByTurn, skillPromptByTurn, skillTurnKey, resolveActiveSkillIds, nowIso, makeAwaitUserInput, makeAwaitApproval, toolContext, resolveImages } = context
  return {
    async executeKunTool(threadId, turnId, toolName, args, signal, sdkCallId): Promise<KunToolResult> {
      const thread = await deps.threadStore.get(threadId)
      const turn = thread?.turns.find((candidate) => candidate.id === turnId)
      if (!thread || !turn || signal?.aborted) {
        return { output: 'turn is no longer active; tool execution was cancelled', isError: true }
      }
      if (!deps.toolHost) {
        return { output: 'Kun tool host is unavailable; tool execution was denied', isError: true }
      }
      // Re-resolve plan context so create_plan can write to its reserved path.
      const plan = turn.guiDesignArtifact?.kind === 'svg'
        ? { planMode: false as const }
        : resolveTurnPlanContext(thread, turnId)
      const approvalPolicy =
        turn.approvalPolicy ?? thread.approvalPolicy ?? deps.defaultApprovalPolicy
      const sandboxMode =
        turn.sandboxMode ?? thread.sandboxMode ?? deps.defaultSandboxMode
      const approvalReviewer =
        turn.approvalReviewer ??
        thread.approvalReviewer ??
        deps.defaultApprovalReviewer ??
        DEFAULT_APPROVAL_REVIEWER
      const actingModelRoute = turn.actingModelRoute
      if (!actingModelRoute) {
        return { output: 'Acting model route is unavailable; tool execution was denied', isError: true }
      }
      const toolSignal = signal ?? new AbortController().signal
      const activeSkillIds = await resolveActiveSkillIds(thread, turn)
      const clientSurface = resolveTurnClientSurface(turn)
      const graphPolicy = delegatedGraphTurnPolicy(turn)
      const executionOptions = {
        additionalWorkspaces: thread.additionalWorkspaces,
        ...(plan ?? {}),
        ...(turn?.guiDesignCanvas ? { guiDesignCanvas: true } : {}),
        ...(turn?.guiExcalidrawCanvas ? { guiExcalidrawCanvas: true } : {}),
        ...(turn?.guiDesignMode ? { guiDesignMode: true } : {}),
        ...(turn?.guiDesignArtifact ? { guiDesignArtifact: turn.guiDesignArtifact } : {}),
        ...(activeSkillIds ? { activeSkillIds } : {}),
        clientSurface,
        ...(sandboxMode ? { sandboxMode } : {}),
        approvalPolicy,
        approvalReviewer,
        actingModelRoute,
        ...(turn.orchestration ? { orchestration: turn.orchestration } : {}),
        signal: toolSignal,
        awaitApproval: makeAwaitApproval(
          approvalPolicy,
          sandboxMode,
          approvalReviewer,
          actingModelRoute,
          turn.prompt,
          toolSignal
        ),
        ...(turn.disableUserInput === true
          ? {}
          : { awaitUserInput: makeAwaitUserInput(threadId, turnId, toolSignal) })
      }
      const rawDiscoveryContext = toolContext(threadId, turnId, thread.workspace, {
        ...executionOptions,
        ...(!graphPolicy && turn.guiDesignArtifact?.kind === 'svg'
          ? { allowedToolNames: SVG_ARTIFACT_ALLOWED_TOOL_NAMES }
          : {})
      })
      const discoveryContext = thread.roomContext
        ? applyRoomToolPolicy(rawDiscoveryContext, thread)
        : rawDiscoveryContext
      const graphAllowedToolNames = graphPolicy
        ? delegatedGraphAllowedToolNames(
            deps.registry.listTools(discoveryContext),
            graphPolicy.phase
          )
        : undefined
      // Real per-call signal so an interactive user_input cancels on turn abort.
      const rawContext = toolContext(threadId, turnId, thread.workspace, {
        ...executionOptions,
        ...(intersectDelegatedToolNames(
          !graphPolicy && turn.guiDesignArtifact?.kind === 'svg'
            ? SVG_ARTIFACT_ALLOWED_TOOL_NAMES
            : undefined,
          graphAllowedToolNames
        )
          ? {
              allowedToolNames: intersectDelegatedToolNames(
                !graphPolicy && turn.guiDesignArtifact?.kind === 'svg'
                  ? SVG_ARTIFACT_ALLOWED_TOOL_NAMES
                  : undefined,
                graphAllowedToolNames
              )
            }
          : {})
      })
      const ctx = thread.roomContext ? applyRoomToolPolicy(rawContext, thread) : rawContext
      try {
        // The SDK's MCP handler must cross the same LocalToolHost boundary as
        // native turns. Calling CapabilityRegistry.tool.execute directly skips
        // policy/sandbox/approval gates, hooks, read-before-edit validation,
        // and the operation journal.
        const call = { callId: sdkCallId ?? deps.ids.next('call_sdk'), toolName, arguments: args }
        const result = await deps.toolHost.execute(call, ctx)
        if (result.item.kind !== 'tool_result') {
          return {
            output: `Kun tool ${toolName} returned an invalid result item`,
            isError: true
          }
        }
        if (isPendingReceiptOutput(result.item.output)) {
          if (!deps.receipts || !sdkCallId) return { output: 'Canvas receipt service or SDK call identity is unavailable; application was not verified.', isError: true }
          const item = { ...result.item, id: `item_toolresult_${turnId}_${sdkCallId}` }
          let finalized: KunToolResult | undefined
          deps.receipts.register({ receiptKey: result.item.output.receiptKey, threadId, turnId,
            call, itemId: item.id, acceptedOutput: result.item.output,
            onFinalized: (settled) => { finalized = { output: settled.output, isError: settled.isError } } })
          await deps.turns.applyItem(threadId, item)
          await deps.receipts.awaitReceipt(result.item.output.receiptKey, 30_000)
          if (finalized) return finalized
          return { output: 'Renderer receipt timed out; the canvas was not verified.', isError: true }
        }
        return { output: result.item.output, isError: result.item.isError }
      } catch (err) {
        return { output: err instanceof Error ? err.message : String(err), isError: true }
      }
    },

    async decideToolApproval(threadId, turnId, toolName, input, signal): Promise<ToolApprovalDecision> {
      // Bridged Kun tools perform their own per-tool policy check through the
      // LocalToolHost context above; asking here too would create two prompts.
      if (toolName.startsWith('mcp__kun__')) return { allow: true }
      const thread = await deps.threadStore.get(threadId)
      const turn = thread?.turns.find((candidate) => candidate.id === turnId)
      if (thread?.roomContext || deps.allowSdkBuiltins === false) {
        return { allow: false, message: 'This turn only allows Kun-gated tools.' }
      }
      const approvalPolicy =
        turn?.approvalPolicy ?? thread?.approvalPolicy ?? deps.defaultApprovalPolicy
      if (approvalPolicy === 'never') {
        return { allow: false, message: 'tools are disabled for this turn (policy: never)' }
      }
      // `canUseTool` runs for every SDK-native tool. Preserve the same Kun
      // boundary as LocalToolHost: bounded reads and internal todo state are
      // auto-allowed under on-request/suggest after decideSdkBuiltinSandbox has
      // validated their paths; writes, commands, and network calls still review.
      if (
        (approvalPolicy === 'on-request' || approvalPolicy === 'suggest') &&
        SDK_ON_REQUEST_AUTO_ALLOWED_TOOLS.has(toolName)
      ) {
        return { allow: true }
      }
      const sandboxMode =
        turn?.sandboxMode ?? thread?.sandboxMode ?? deps.defaultSandboxMode ?? DEFAULT_SANDBOX_MODE
      const approvalReviewer =
        turn?.approvalReviewer ??
        thread?.approvalReviewer ??
        deps.defaultApprovalReviewer ??
        DEFAULT_APPROVAL_REVIEWER
      const workspaceCommandApproval =
        toolName === 'Bash' && sandboxMode === 'workspace-write'
      if (approvalPolicy === 'auto' && !workspaceCommandApproval) return { allow: true }
      if (!thread || !turn) {
        return { allow: false, message: 'Acting turn is unavailable; approval failed closed.' }
      }
      const action = createApprovalActionEnvelope({
          toolName,
          providerId: turn.providerId ?? thread.providerId,
          toolKind: toolName === 'Bash'
            ? 'command_execution'
            : ['Write', 'Edit', 'MultiEdit'].includes(toolName)
              ? 'file_change'
              : 'tool_call',
          effects: {
            network: toolName === 'WebSearch' || toolName === 'WebFetch',
            externalWrite: ['Write', 'Edit', 'MultiEdit'].includes(toolName),
            processExecution: toolName === 'Bash',
            guiAutomation: false
          },
          arguments: input,
          workspace: thread.workspace,
          cwd: typeof input.cwd === 'string' ? input.cwd : thread.workspace,
          reason: 'Agent SDK native tool crossed the Kun approval boundary.'
      })
      const approval = createApprovalRequest({
        id: deps.ids.next('appr'),
        threadId,
        turnId,
        toolName,
        summary: safeApprovalActionSummary(action),
        action
      })
      const actingModelRoute = turn.actingModelRoute
      if (!actingModelRoute) {
        return { allow: false, message: 'Acting model route is unavailable; approval failed closed.' }
      }
      const decision = await makeAwaitApproval(
        approvalPolicy,
        sandboxMode,
        approvalReviewer,
        actingModelRoute,
        turn.prompt,
        signal ?? new AbortController().signal
      )(approval)
      const resolvedDecision = typeof decision === 'string' ? decision : decision.decision
      return resolvedDecision === 'allow'
        ? { allow: true }
        : {
            allow: false,
            message: typeof decision === 'string'
              ? 'Tool call was denied by the approval policy or user.'
              : decision.reason ?? 'Tool call was denied by the approval reviewer.'
          }
    },
  }
}
