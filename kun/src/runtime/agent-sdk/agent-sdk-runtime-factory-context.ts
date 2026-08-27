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
import { sessionEventExists } from '../../adapters/session-event-query.js'
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
import {
  armUserInputTimeout,
  awaitAbortableGate,
  userInputRequestWithDeadline
} from '../../services/interactive-gate.js'
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
import { resolveTurnPlanContext, waitForGate } from './agent-sdk-runtime-factory-plan.js'

function intersectAllowedToolNames(
  first: readonly string[] | undefined,
  second: readonly string[] | undefined
): readonly string[] | undefined {
  if (!first) return second
  if (!second) return first
  const secondSet = new Set(second)
  return first.filter((name) => secondSet.has(name))
}

export function createAgentSdkFactoryContext(deps: AgentSdkRuntimeFactoryDeps) {
  const sessionIdsByTurn = new Map<string, string>()
    const sessionPreparationsByTurn = new Map<string, DelegatedSessionPreparation>()
    // A delegated native session must checkpoint the same goal projection that
    // its request used. The goal can be completed, cleared, or replaced while
    // the request is running; using its post-turn value here would make the
    // checkpoint digest disagree with the provider's actual transcript and
    // force every later turn to rebase.
    const sessionGoalContextKeysByTurn = new Map<string, string | null>()
    // Skill activation is turn-scoped. Keep the exact result used for the SDK
    // tool catalog so bridged execution sees the same skill-gated tools after a
    // Client-neutral structured input pause/resume.
    const activeSkillIdsByTurn = new Map<string, readonly string[]>()
    const skillPromptByTurn = new Map<string, string>()
    const skillTurnKey = (threadId: string, turnId: string): string => `${threadId}\u0000${turnId}`

    const resolveActiveSkillIds = async (
      thread: ThreadRecord,
      turn: ThreadRecord['turns'][number]
    ): Promise<readonly string[]> => {
      const key = skillTurnKey(thread.id, turn.id)
      if (!deps.skillRuntime) return activeSkillIdsByTurn.get(key) ?? []
      const resolution = await deps.skillRuntime.resolveTurn({
        prompt: skillPromptByTurn.get(key) ?? turn.prompt ?? '',
        workspace: thread.workspace,
        threadId: thread.id,
        turnId: turn.id,
        ...(deps.toolContextBoundary?.allowedSkillIds
          ? { allowedSkillIds: deps.toolContextBoundary.allowedSkillIds }
          : {}),
        ...(deps.toolContextBoundary?.blockedSkillIds
          ? { blockedSkillIds: deps.toolContextBoundary.blockedSkillIds }
          : {})
      })
      activeSkillIdsByTurn.set(key, resolution.activeSkillIds)
      return resolution.activeSkillIds
    }

    const nowIso = (): string => (deps.nowIso ? deps.nowIso() : new Date().toISOString())

    /**
     * Bridge kun's `user_input` tool to the active client: persist the request item,
     * publish the events clients render, wait on the gate,
     * then mark it resolved. Returns undefined when no gate is wired (the tool then
     * stays unadvertised — its shouldAdvertise checks for awaitUserInput).
     */
    const makeAwaitUserInput = (
      threadId: string,
      turnId: string,
      signal: AbortSignal
    ): ToolHostContext['awaitUserInput'] => {
      const gate = deps.userInputGate
      if (!gate) return undefined
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
        // Arm first so an event subscriber can immediately submit a response.
        const pending = gate.request(userInputRequestWithDeadline(request))
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
          gate.resolve(input.id, { status: 'cancelled' })
          void pending.catch(() => undefined)
          throw error
        }
        const disarmTimeout = armUserInputTimeout(
          (resolution) => gate.resolve(input.id, resolution),
          input.id,
          input.timeoutSeconds
        )
        let resolution: UserInputResolution
        try {
          resolution = await waitForGate(gate, request, signal, pending)
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
    ): ((approval: ApprovalRequest) => Promise<'allow' | 'deny' | ApprovalResolution>) => async (approval) => {
      if (approvalPolicy === 'auto' && sandboxMode === 'danger-full-access') return 'allow'
      if (approvalReviewer === 'agent') {
        if (!deps.approvalReview) {
          return {
            decision: 'deny',
            reviewer: 'agent',
            reason: 'Automatic approval review is unavailable.',
            reviewStatus: 'failed-closed'
          }
        }
        return deps.approvalReview.review({
          approval,
          route: actingModelRoute,
          intent,
          signal
        })
      }
      const gate = deps.approvalGate
      if (approvalPolicy === 'never' || !gate) return 'deny'
      const pending = gate.request(approval)

      // Arm cancellation before publishing approval_requested. The recorder may
      // block on durable storage or synchronous observers, but a cancelled SDK
      // turn must still stop waiting immediately.
      let resolveRequested!: () => void
      let rejectRequested!: (reason: unknown) => void
      const requested = new Promise<void>((resolve, reject) => {
        resolveRequested = resolve
        rejectRequested = reject
      })

      return new Promise<'allow' | 'deny'>((resolve, reject) => {
        let settled = false
        let expiredResolutionScheduled = false
        const cleanup = (): void => signal.removeEventListener('abort', onAbort)
        const recordExpiredAfterRequest = (): void => {
          if (expiredResolutionScheduled) return
          expiredResolutionScheduled = true
          // Preserve the observable event order and consume every background
          // promise: requested must be durable before its expired resolution.
          void requested.then(async () => {
            await pending
            const current = gate.get(approval.id)
            if (current?.status !== 'expired') return
            await deps.events.record({
              kind: 'approval_resolved',
              threadId: approval.threadId,
              turnId: approval.turnId,
              approvalId: approval.id,
              toolName: approval.toolName,
              status: 'expired',
              approvalReviewer: 'user',
              summary: approval.summary,
              ...(approval.action ? { action: approval.action } : {}),
              ...(current.reason ? { reason: current.reason } : {})
            })
          }).catch(() => undefined)
        }
        const expirePending = (reason: string): void => {
          // InMemoryApprovalGate resolves an expiration as deny. When an HTTP
          // decision is reserved, expiration is deferred until commit/rollback;
          // the status check above prevents a false expired event if commit wins.
          if (gate.expire(approval.id, reason)) recordExpiredAfterRequest()
        }
        const onAbort = (): void => {
          if (settled) return
          settled = true
          cleanup()
          expirePending('turn aborted while awaiting approval')
          void pending.catch(() => undefined)
          resolve('deny')
        }

        signal.addEventListener('abort', onAbort, { once: true })

        try {
          const recording = deps.events.record({
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
          // Attach both handlers immediately so a recorder rejection cannot
          // surface as unhandled while abort is winning the race.
          void recording.then(resolveRequested, rejectRequested).catch(rejectRequested)
        } catch (error) {
          rejectRequested(error)
        }

        if (signal.aborted) {
          onAbort()
          return
        }

        requested.then(
          () => {
            if (settled) return
            pending.then(
              (decision) => {
                if (settled) return
                settled = true
                cleanup()
                resolve(decision)
              },
              (error) => {
                if (settled) return
                settled = true
                cleanup()
                reject(error)
              }
            )
          },
          (error) => {
            if (settled) return
            settled = true
            cleanup()
            gate.expire(approval.id, 'failed to publish approval request')
            void pending.catch(() => undefined)
            reject(error)
          }
        )
      })
    }

    const toolContext = (
      threadId: string,
      turnId: string,
      workspace: string,
      opts?: {
        planMode?: boolean
        guiPlan?: GuiPlanContext
        guiDesignCanvas?: boolean
        guiDesignMode?: boolean
        guiDesignArtifact?: GuiDesignArtifactContext
        activeSkillIds?: readonly string[]
        additionalWorkspaces?: readonly string[]
        allowedToolNames?: readonly string[]
        sandboxMode?: SandboxMode
        approvalPolicy?: ApprovalPolicy
        approvalReviewer?: ApprovalReviewer
        actingModelRoute?: ActingTurnModelRoute
        signal?: AbortSignal
        awaitUserInput?: ToolHostContext['awaitUserInput']
        awaitApproval?: ToolHostContext['awaitApproval']
        clientSurface?: ToolHostContext['clientSurface']
        orchestration?: ToolHostContext['orchestration']
      }
    ): ToolHostContext => {
      const allowedToolNames = intersectAllowedToolNames(
        deps.toolContextBoundary?.allowedToolNames,
        opts?.allowedToolNames
      )
      return {
        threadId,
        turnId,
        workspace,
        ...(opts?.additionalWorkspaces?.length ? { additionalWorkspaces: opts.additionalWorkspaces } : {}),
        approvalPolicy: opts?.approvalPolicy ?? deps.defaultApprovalPolicy,
        approvalReviewer:
          opts?.approvalReviewer ?? deps.defaultApprovalReviewer ?? DEFAULT_APPROVAL_REVIEWER,
        sandboxMode: opts?.sandboxMode ?? deps.defaultSandboxMode ?? DEFAULT_SANDBOX_MODE,
        ...(opts?.actingModelRoute ? { actingModelRoute: opts.actingModelRoute } : {}),
        abortSignal: opts?.signal ?? new AbortController().signal,
        ...deps.toolContextBoundary,
        // Expose plan state so `create_plan` is advertised (listTools) and executable
        // (executeKunTool) on plan turns — both are gated on it.
        ...(opts?.planMode ? { threadMode: 'plan' as const } : {}),
        ...(opts?.guiPlan ? { guiPlan: opts.guiPlan } : {}),
        ...(opts?.guiDesignCanvas ? { guiDesignCanvas: true } : {}),
        ...(opts?.guiDesignMode ? { guiDesignMode: true } : {}),
        ...(opts?.guiDesignArtifact ? { guiDesignArtifact: opts.guiDesignArtifact } : {}),
        ...(opts?.activeSkillIds ? { activeSkillIds: opts.activeSkillIds } : {}),
        ...(opts?.clientSurface ? { clientSurface: opts.clientSurface } : {}),
        ...(opts?.orchestration ? { orchestration: opts.orchestration } : {}),
        ...(allowedToolNames ? { allowedToolNames } : {}),
        // Presence advertises `user_input`; the active client renders the gate.
        ...(opts?.awaitUserInput ? { awaitUserInput: opts.awaitUserInput } : {}),
        // Execution supplies the real client approval callback; listing contexts stay
        // deny-closed because no tool may execute through them.
        awaitApproval: opts?.awaitApproval ?? (async () => 'deny')
      }
    }

    const resolveImages = async (
      threadId: string,
      workspace: string,
      attachmentIds: readonly string[]
    ): Promise<Array<{ mediaType: string; base64: string }>> => {
      if (!deps.attachmentStore || attachmentIds.length === 0) return []
      const images: Array<{ mediaType: string; base64: string }> = []
      for (const id of attachmentIds) {
        try {
          const attachment = await deps.attachmentStore.resolveContent(id, { threadId, workspace })
          if (typeof attachment.mimeType === 'string' && attachment.mimeType.startsWith('image/')) {
            images.push({ mediaType: attachment.mimeType, base64: attachment.data.toString('base64') })
          }
        } catch {
          // skip attachments that can't be resolved/authorized
        }
      }
      return images
    }
  return { sessionIdsByTurn, sessionPreparationsByTurn, sessionGoalContextKeysByTurn, activeSkillIdsByTurn, skillPromptByTurn, skillTurnKey, resolveActiveSkillIds, nowIso, makeAwaitUserInput, makeAwaitApproval, toolContext, resolveImages }
}

export type AgentSdkFactoryContext = ReturnType<typeof createAgentSdkFactoryContext>
