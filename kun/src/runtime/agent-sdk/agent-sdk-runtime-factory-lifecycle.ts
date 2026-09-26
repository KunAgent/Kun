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
import type { AgentSdkRuntimeFactoryDeps } from './agent-sdk-runtime-factory-contracts.js'
import type { AgentSdkFactoryContext } from './agent-sdk-runtime-factory-context.js'

export function createAgentSdkLifecycleRuntimeDeps(
  deps: AgentSdkRuntimeFactoryDeps,
  context: AgentSdkFactoryContext,
  loadSdk: () => Promise<SdkApi>
): Omit<
  SdkRuntimeDeps,
  'handlesProvider' | 'loadTurnContext' | 'executeKunTool' | 'decideToolApproval'
> {
  const { sessionIdsByTurn, sessionPreparationsByTurn, sessionGoalContextKeysByTurn, activeSkillIdsByTurn, skillPromptByTurn, handoffBriefDigestsByTurn, skillTurnKey, resolveActiveSkillIds, nowIso, makeAwaitUserInput, makeAwaitApproval, toolContext, resolveImages } = context
  return {
    async recordEvent(draft): Promise<void> {
      await deps.events.record(draft)
    },

    async applyItem(threadId, item): Promise<void> {
      await deps.turns.applyItem(threadId, item)
    },

    async applyAssistantDelta(threadId, item, deltaText, deltaOffset): Promise<void> {
      await deps.turns.applyAssistantDelta(threadId, item, deltaText, deltaOffset)
    },

    async finishTurn(threadId, turnId, status, error, code): Promise<TurnRunOutcome> {
      const key = skillTurnKey(threadId, turnId)
      try {
        let outcome: TurnRunOutcome = status
        if (status === 'completed') {
          const graphCompletion = await parkDelegatedGraphTurnAfterRecovery(
            deps.turns,
            { threadId, turnId }
          )
          if (
            graphCompletion === 'suspended' ||
            graphCompletion === 'suspended_pending_supervision'
          ) {
            outcome = graphCompletion
          } else {
            await deps.turns.finishTurn({
              threadId,
              turnId,
              status,
              ...(error ? { error } : {}),
              ...(code ? { code } : {})
            })
          }
        } else {
          await deps.turns.finishTurn({
            threadId,
            turnId,
            status,
            ...(error ? { error } : {}),
            ...(code ? { code } : {})
          })
        }
        if (
          (
            outcome === 'completed' ||
            outcome === 'suspended' ||
            outcome === 'suspended_pending_supervision'
          ) &&
          deps.sessionCoordinator
        ) {
          const preparation = sessionPreparationsByTurn.get(key)
          if (preparation) {
            try {
              await deps.sessionCoordinator.commit({
                preparation,
                committedItems: filterGoalContextsForGoalKey(
                  await deps.sessionStore.loadItems(threadId),
                  sessionGoalContextKeysByTurn.get(key)
                ),
                lastCommittedTurnId: turnId,
                nativeSessionId: sessionIdsByTurn.get(key),
                ...(handoffBriefDigestsByTurn.has(key)
                  ? { handoffBriefDigest: handoffBriefDigestsByTurn.get(key) }
                  : {})
              })
            } catch {
              // Native continuation is an optimization. A failed checkpoint
              // commit must not turn a successfully persisted Kun turn into a
              // failed answer; the next history digest safely forces a rebase.
            }
          }
        }
        return outcome
      } finally {
        activeSkillIdsByTurn.delete(key)
        skillPromptByTurn.delete(key)
        sessionIdsByTurn.delete(key)
        sessionPreparationsByTurn.delete(key)
        sessionGoalContextKeysByTurn.delete(key)
        handoffBriefDigestsByTurn.delete(key)
        if (typeof deps.skillRuntime?.clearTurnActivation === 'function') {
          deps.skillRuntime.clearTurnActivation(threadId, turnId)
        }
      }
    },

    async checkGraphCompletion(threadId, turnId) {
      return delegatedGraphCompletionCheck(
        await deps.turns.suspendGraphLeadTurn({ threadId, turnId })
      )
    },

    async saveSessionId(threadId, turnId, sessionId): Promise<void> {
      sessionIdsByTurn.set(skillTurnKey(threadId, turnId), sessionId)
    },

    async rejectResume(threadId, turnId) {
      const key = skillTurnKey(threadId, turnId)
      const preparation = sessionPreparationsByTurn.get(key)
      if (!preparation) return undefined
      const rejected = await deps.sessionCoordinator!.rejectResume(preparation)
      sessionPreparationsByTurn.set(key, rejected)
      return rejected
    },

    loadSdk,
    // The embedded SDK launches a separate agent process. Give it the same
    // scrubbed base environment as native shell tools; buildScopedEnv adds the
    // selected SDK OAuth credential explicitly when it is needed.
    baseEnv: () => shellSpawnEnv(),
    kunSystemPrompt: () => deps.prefix.systemPrompt,
    nextId: (prefix) => deps.ids.next(prefix),
    getTurnLimits: () => deps.turnLimits,
    ...(deps.debugSink ? { debugSink: deps.debugSink } : {}),
    ...(deps.sdkStreamLimits
      ? { getSdkStreamLimits: () => deps.sdkStreamLimits }
      : {}),
    ...(deps.pathToClaudeCodeExecutable
      ? { pathToClaudeCodeExecutable: deps.pathToClaudeCodeExecutable }
      : {}),
    ...(deps.sessionCoordinator
      ? { runExclusive: (threadId, operation) =>
          deps.sessionCoordinator!.runExclusive(threadId, operation) }
      : {})
  }
}
