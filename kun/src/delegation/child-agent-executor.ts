import { InMemoryApprovalGate } from '../adapters/in-memory-approval-gate.js'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { InMemoryUserInputGate } from '../adapters/in-memory-user-input-gate.js'
import { setSystemPrompt, type ImmutablePrefix } from '../cache/immutable-prefix.js'
import { SUBAGENT_READ_ONLY_TOOL_NAMES, type ModelCapabilityMetadata } from '../contracts/capabilities.js'
import { ChildRunFailureSchema, type ChildRunFailure } from '../contracts/subagent-retry.js'
import {
  DEFAULT_APPROVAL_REVIEWER,
  type ApprovalPolicy,
  type ApprovalReviewer,
  type SandboxMode
} from '../contracts/policy.js'
import type { RuntimeTuningConfig } from '../config/kun-config.js'
import { AgentLoop } from '../loop/agent-loop.js'
import { normalizeRoleReasoningEffort } from '../loop/reasoning-effort.js'
import type {
  ContextCompactionConfig,
  ModelConfig,
  ModelContextProfile
} from '../loop/model-context-profile.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import type { TokenEconomyConfig } from '../loop/token-economy.js'
import type { MemoryStore } from '../memory/memory-store.js'
import type { ArtifactStore } from '../artifacts/artifact-store.js'
import type { AttachmentStore } from '../attachments/attachment-store.js'
import type { ModelClient } from '../ports/model-client.js'
import { RandomIdGenerator } from '../ports/id-generator.js'
import type { ApprovalGate } from '../ports/approval-gate.js'
import type { ApprovalReviewPort } from '../ports/approval-review.js'
import type { PptWorkflowScope } from '../ports/tool-host.js'
import {
  childDirectionBundle,
  childDeckArtifact,
  childReviewBundle
} from './child-ppt-result-extraction.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { ToolHost } from '../ports/tool-host.js'
import { findSessionEvent } from '../adapters/session-event-query.js'
import type { DelegatedTurnRuntime } from '../runtime/delegated-turn-runtime.js'
import type { SkillRuntime } from '../skills/skill-runtime.js'
import type { InstructionRuntime } from '../instructions/instruction-runtime.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { ThreadService } from '../services/thread-service.js'
import { isHostShutdownTurnSuspension, TurnService } from '../services/turn-service.js'
import { UsageService } from '../services/usage-service.js'
import { submittedDesignTaskProfile } from '../domain/design-task-profile.js'
import type { ChildRunExecutor } from './delegation-runtime.js'
import {
  ChildResultExecutionError,
  childResultSource,
  materializeChildResult
} from './child-result-materializer.js'
import { buildFastContextEvidencePack } from './fast-context-evidence.js'
import { createFastContextToolHost } from './fast-context-tool-host.js'
import { resolveChildEpisodeLimits } from './child-episode-limits.js'
import { withGlobalSubagentTools } from './subagent-global-tool-policy.js'
import {
  childResultUsedNoTextSummary,
  childToolEvidence,
  FAST_CONTEXT_RECOVERABLE_LOOP_ERROR_CODES
} from './child-agent-result-support.js'

export type ChildDelegatedRuntimeFactory = (input: {
  threads: ThreadService
  turns: TurnService
  sessionStore: SessionStore
  threadStore: ThreadStore
  events: RuntimeEventRecorder
  ids: { next(prefix: string): string }
  prefix: ImmutablePrefix
  toolPolicy: 'readOnly' | 'inherit'
  allowedModelProviderIds?: readonly string[]
  allowedModelIds?: readonly string[]
  allowedToolNames?: readonly string[]
  allowedProviderIds?: readonly string[]
  allowedSkillIds?: readonly string[]
  allowedReadPaths?: readonly string[]
  allowedWritePaths?: readonly string[]
  allowedArtifactIds?: readonly string[]
  blockedToolNames?: readonly string[]
  blockedProviderIds?: readonly string[]
  blockedSkillIds?: readonly string[]
  skillsEnabled: boolean
  instructionsEnabled: boolean
  memoryEnabled: boolean
  pptWorkflowScope?: PptWorkflowScope
}) => DelegatedTurnRuntime | undefined

export type ChildAgentExecutorOptions = {
  model: ModelClient
  toolHost: ToolHost
  prefix: ImmutablePrefix
  defaultModel: string
  models?: ModelConfig
  contextCompaction?: ContextCompactionConfig
  approvalPolicy?: ApprovalPolicy
  sandboxMode?: SandboxMode
  approvalReviewer?: ApprovalReviewer
  tokenEconomy?: TokenEconomyConfig
  runtime?: RuntimeTuningConfig
  nowIso?: () => string
  modelCapabilities?: (model: string, providerId?: string) => ModelCapabilityMetadata
  profilesForProvider?: (
    providerId: string | undefined
  ) => readonly ModelContextProfile[]
  skillRuntime?: SkillRuntime
  instructionRuntime?: InstructionRuntime
  memoryStore?: MemoryStore
  attachmentStore?: () => AttachmentStore | undefined
  artifactStore?: ArtifactStore
  /** Runtime-owned approval channel shared with the HTTP decision endpoint. */
  approvalGate?: ApprovalGate
  /** Isolated automatic reviewer used when the inherited reviewer is `agent`. */
  approvalReview?: ApprovalReviewPort
  /**
   * Host-owned provider-native runtime composition. The callback receives the
   * already narrowed child capability envelope and child turn services.
   */
  createDelegatedRuntime?: ChildDelegatedRuntimeFactory
  /**
   * Persistence wiring. When the main runtime's stores + event recorder are
   * supplied, the child runs as a persisted `relation: 'side'` thread on the
   * shared event bus: its full session (reasoning, tool calls, results) is
   * queryable via `getThreadDetail(childId)` and streams live to UI
   * subscribers. The thread is hidden from the default thread list (the store
   * filters `side`). When omitted (e.g. in unit tests) the child falls back to
   * throwaway in-memory stores, preserving full isolation.
   */
  sessionStore?: SessionStore
  threadStore?: ThreadStore
  events?: RuntimeEventRecorder
  /**
   * Shared runtime usage ledger. When supplied, child usage counts live in the
   * runtime aggregate under the child thread id; tests that omit it keep an
   * isolated throwaway counter.
   */
  usage?: UsageService
}

export function createChildAgentExecutor(options: ChildAgentExecutorOptions): ChildRunExecutor {
  return async (input) => {
    const fastContextTaskCount = input.fastContextTasks?.length ?? 1
    const toolHost = input.fastContext
      ? createFastContextToolHost(options.toolHost, fastContextTaskCount)
      : options.toolHost
    // Fast Context source calls are always confined to a parent-minted read
    // scope. This remains true when the parent itself chose full access: an
    // omitted scope means the captured workspace only, never the host.
    const allowedReadPaths = input.fastContext
      ? input.security?.allowedReadPaths ?? ['.']
      : input.security?.allowedReadPaths
    const blockedSkillIds = unique([
      ...(input.security?.blockedSkillIds ?? []),
      ...(input.blockedSkills ?? [])
    ])
    const nowIso = options.nowIso ?? (() => new Date().toISOString())
    const attachmentStore = options.attachmentStore?.()
    // Persist into the main runtime's stores + event bus when supplied, so the
    // child session is queryable and streams live; otherwise stay isolated in
    // throwaway in-memory stores (preserves test behavior). The recorder is
    // shared too — events persist-before-publish to the same bus, and seq
    // allocation is per-thread (childId), so child events never bleed into the
    // parent thread's stream.
    const sessionStore: SessionStore = options.sessionStore ?? new InMemorySessionStore()
    const threadStore: ThreadStore = options.threadStore ?? new InMemoryThreadStore()
    const events =
      options.events ??
      (() => {
        const eventBus = new InMemoryEventBus()
        return new RuntimeEventRecorder({
          eventBus,
          sessionStore,
          allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
          nowIso
        })
      })()
    const usage = options.usage ?? new UsageService()
    const ids = new RandomIdGenerator()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const compactor = new ContextCompactor({
      contextCompaction: options.contextCompaction,
      models: options.models,
      profilesForProvider: options.profilesForProvider
    })
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight,
      steering,
      compactor,
      ids,
      ...(attachmentStore ? { attachmentStore: () => attachmentStore } : {}),
      nowIso
    })
    const threads = new ThreadService({
      threadStore,
      sessionStore,
      events,
      ids,
      nowIso
    })
    // Every ordinary allow-list is an upper bound. Global host-owned child
    // capabilities are added only after that narrowing and remain subject to
    // the parent snapshot plus explicit tool/provider deny-lists.
    const ordinaryAllowedToolNames = intersectDefinedLists(
      input.toolPolicy === 'readOnly' ? SUBAGENT_READ_ONLY_TOOL_NAMES : undefined,
      input.fastContext ? ['grep', 'glob', 'read'] : undefined,
      input.allowedTools,
      input.security?.allowedToolNames
    )
    const blockedToolNames = unique([
      ...(input.security?.blockedToolNames ?? []),
      ...(input.blockedTools ?? [])
    ])
    const blockedProviderIds = unique([
      ...(input.security?.blockedProviderIds ?? []),
      ...(input.blockedMcpServers ?? []).map((serverId) => `mcp:${serverId}`)
    ])
    const forcedAllowedToolNames = withGlobalSubagentTools({
      allowedToolNames: ordinaryAllowedToolNames,
      parentAllowedToolNames: input.security?.allowedToolNames,
      blockedToolNames,
      parentAllowedProviderIds: input.security?.allowedProviderIds,
      parentBlockedProviderIds: blockedProviderIds,
      fastContext: input.fastContext === true
    })
    // A custom system prompt augments the base prefix (kun tool/safety
    // conventions stay) on a distinct fingerprint, so same-agent calls still
    // hit the prompt cache; cross-agent reuse is intentionally given up.
    // omitBasePrompt replaces the base with the role prompt when present.
    const source = input.source
    if (source && source.prompt !== input.prompt) {
      throw new Error('child source prompt must exactly match the delegated prompt')
    }
    if (source?.agentSurface && input.agentSurface && source.agentSurface !== input.agentSurface) {
      throw new Error('child source surface must match the delegated surface')
    }
    const agentSurface = source?.agentSurface ?? input.agentSurface
    const rolePrompt = input.systemPrompt?.trim()
    const childPrefix = rolePrompt
      ? setSystemPrompt(
        options.prefix,
        input.omitBasePrompt === true
          ? rolePrompt
          : `${options.prefix.systemPrompt}\n\n${rolePrompt}`.trim()
      )
      : options.prefix
    const model = input.model?.trim() || options.defaultModel
    const approvalPolicy = input.approvalPolicy ?? options.approvalPolicy ?? 'auto'
    const sandboxMode = input.sandboxMode ?? options.sandboxMode
    const approvalReviewer =
      input.approvalReviewer ?? options.approvalReviewer ?? DEFAULT_APPROVAL_REVIEWER
    // Provider-native SDKs own separate shell/search tool catalogs. Fast
    // Context deliberately stays in Kun's managed loop so its exact source
    // tool allow-list, semaphore, and result bounds cannot be bypassed.
    const delegatedRuntime = input.fastContext ? undefined : options.createDelegatedRuntime?.({
      threads,
      turns,
      sessionStore,
      threadStore,
      events,
      ids,
      prefix: childPrefix,
      toolPolicy: input.toolPolicy,
      ...(input.security?.allowedModelProviderIds
        ? { allowedModelProviderIds: input.security.allowedModelProviderIds }
        : {}),
      ...(input.security?.allowedModelIds
        ? { allowedModelIds: input.security.allowedModelIds }
        : {}),
      ...(forcedAllowedToolNames ? { allowedToolNames: forcedAllowedToolNames } : {}),
      ...(input.security?.allowedProviderIds
        ? { allowedProviderIds: input.security.allowedProviderIds }
        : {}),
      ...(input.security?.allowedSkillIds
        ? { allowedSkillIds: input.security.allowedSkillIds }
        : {}),
      ...(allowedReadPaths
        ? { allowedReadPaths }
        : {}),
      ...(input.security?.allowedWritePaths
        ? { allowedWritePaths: input.security.allowedWritePaths }
        : {}),
      ...(input.security?.allowedArtifactIds
        ? { allowedArtifactIds: input.security.allowedArtifactIds }
        : {}),
      ...(blockedToolNames.length ? { blockedToolNames } : {}),
      ...(blockedProviderIds.length ? { blockedProviderIds } : {}),
      ...(blockedSkillIds.length ? { blockedSkillIds } : {}),
      skillsEnabled: input.skillsEnabled !== false,
      instructionsEnabled: input.security?.instructionsEnabled !== false,
      memoryEnabled: input.security?.memoryEnabled !== false,
      ...(input.pptWorkflowScope ? { pptWorkflowScope: input.pptWorkflowScope } : {})
    })
    const loop = new AgentLoop({
      threadStore,
      sessionStore,
      approvalGate: options.approvalGate ?? new InMemoryApprovalGate(),
      ...(options.approvalReview ? { approvalReview: options.approvalReview } : {}),
      userInputGate: new InMemoryUserInputGate(),
      model: options.model,
      toolHost,
      ...(delegatedRuntime ? { sdkRuntime: delegatedRuntime } : {}),
      usage,
      events,
      turns,
      inflight,
      steering,
      compactor,
      prefix: childPrefix,
      ids,
      nowIso,
      ...(forcedAllowedToolNames ? { forcedAllowedToolNames } : {}),
      ...(input.security?.allowedModelProviderIds
        ? { allowedModelProviderIds: input.security.allowedModelProviderIds }
        : {}),
      ...(input.security?.allowedModelIds
        ? { allowedModelIds: input.security.allowedModelIds }
        : {}),
      ...(input.security?.allowedProviderIds ? { allowedProviderIds: input.security.allowedProviderIds } : {}),
      ...(input.security?.allowedSkillIds ? { allowedSkillIds: input.security.allowedSkillIds } : {}),
      ...(allowedReadPaths
        ? { allowedReadPaths }
        : {}),
      ...(input.security?.allowedWritePaths
        ? { allowedWritePaths: input.security.allowedWritePaths }
        : {}),
      ...(input.security?.allowedArtifactIds
        ? { allowedArtifactIds: input.security.allowedArtifactIds }
        : {}),
      ...(input.pptWorkflowScope ? { pptWorkflowScope: input.pptWorkflowScope } : {}),
      ...(blockedToolNames.length ? { blockedToolNames } : {}),
      ...(blockedProviderIds.length ? { blockedProviderIds } : {}),
      ...(blockedSkillIds.length ? { blockedSkillIds } : {}),
      ...(options.modelCapabilities ? { modelCapabilities: options.modelCapabilities } : {}),
      ...(input.fastContext !== true && input.skillsEnabled !== false && options.skillRuntime
        ? { skillRuntime: options.skillRuntime }
        : {}),
      ...(input.fastContext !== true && options.instructionRuntime && input.security?.instructionsEnabled !== false
        ? { instructionRuntime: options.instructionRuntime }
        : {}),
      ...(input.fastContext !== true && options.memoryStore && input.security?.memoryEnabled !== false
        ? { memoryStore: options.memoryStore }
        : {}),
      ...(attachmentStore ? { attachmentStore } : {}),
      ...(options.artifactStore ? { artifactStore: options.artifactStore } : {}),
      ...(options.contextCompaction ? { contextCompaction: options.contextCompaction } : {}),
      ...(options.tokenEconomy ? { tokenEconomy: options.tokenEconomy } : {}),
      turnLimits: resolveChildEpisodeLimits(options.runtime?.turnLimits, input.fastContext === true),
      ...(input.fastContext
        ? {
            fastContext: true,
            fastContextScopeId: input.parentThreadId,
            fastContextTaskCount
          }
        : {}),
      ...(options.runtime?.toolStorm ? { toolStorm: options.runtime.toolStorm } : {}),
      ...(options.runtime?.toolArgumentRepair ? { toolArgumentRepair: options.runtime.toolArgumentRepair } : {})
    })

    const title = childThreadTitle(input.childId, input.label, input.profile)
    const thread = input.resumeChild
      ? await threadStore.get(input.childId)
      : await threads.create({
        title,
        workspace: input.workspace?.trim() || '~',
        model,
        mode: 'agent',
        approvalPolicy,
        ...(sandboxMode ? { sandboxMode } : {}),
        approvalReviewer,
        // Route the child to the profile's provider. ThreadService threads
        // providerId into every ModelRequest, and the executor's model is the
        // MultiProviderModelClient, so this single field is all routing needs.
        ...(input.providerId ? { providerId: input.providerId } : {}),
        ...(input.accountId ? { accountId: input.accountId } : {}),
        // Persist the resolved profile id so the GUI can label explore/side
        // sessions (e.g. return-bar "viewing explore process").
        ...(input.profile?.trim() ? { agentId: input.profile.trim() } : {})
      }, {
        id: input.childId,
        title,
        // Persist as a side branch of the parent: hidden from the default thread
        // list, but loadable on demand so the user can open the subagent's own
        // session from the parent's delegate_task card.
        relation: 'side',
        parentThreadId: input.parentThreadId
      })
    if (!thread) throw new Error(`child thread ${input.childId} no longer exists`)
    if (input.resumeChild && (thread.relation !== 'side' || thread.parentThreadId !== input.parentThreadId)) {
      throw new Error(`child thread ${input.childId} is not a side thread of the expected parent`)
    }
    const parentDesignProfile = agentSurface === 'design' && !thread.designProfile
      ? (threadStore.getMetadata
          ? await threadStore.getMetadata(input.parentThreadId)
          : await threadStore.get(input.parentThreadId))?.designProfile
      : undefined
    const designAdmission = parentDesignProfile
      ? {
          designProfile: submittedDesignTaskProfile(parentDesignProfile),
          designDocumentTarget: parentDesignProfile.documentTarget
        }
      : undefined
    // A profile preamble rides in the prompt body (not the system prompt) so
    // the cached stable prefix stays byte-identical to the main agent's.
    const promptBase = source
      ? source.prompt
      : input.promptPreamble?.trim()
      ? `${input.promptPreamble.trim()}\n\n${input.prompt}`
      : input.prompt
    const prompt = input.returnFormat === 'evidence'
      ? `${promptBase}\n\nReturn a concise evidence-based conclusion. Inspect the task with tools so the parent can verify the result.`
      : promptBase
    if (input.serviceTier === 'priority') {
      // Mirror the main loop's service-tier gating so users are not silently
      // charged for a "fast" request the routed model cannot honor.
      const capabilityProviderId = input.providerId?.trim().toLowerCase() === 'default'
        ? undefined
        : input.providerId
      const capabilities = options.modelCapabilities?.(model, capabilityProviderId)
      if (!capabilities?.serviceTiers?.includes('priority')) {
        console.warn(`[kun] fast (serviceTier=priority) requested but unsupported for child model=${model}${input.providerId ? ` provider=${input.providerId}` : ''}`)
      }
    }
    const started = await turns.startTurn({
      threadId: thread.id,
      request: {
        prompt,
        ...(source?.displayText !== undefined ? { displayText: source.displayText } : {}),
        ...(source?.attachmentIds.length ? { attachmentIds: source.attachmentIds } : {}),
        ...(source?.composerContexts.length ? { composerContexts: source.composerContexts } : {}),
        ...(source?.fileReferences.length ? { fileReferences: source.fileReferences } : {}),
        model,
        clientSurface: input.guiDesignCanvas ? 'gui' : input.clientSurface ?? 'api',
        ...(input.providerId ? { providerId: input.providerId } : {}),
        ...(input.accountId ? { accountId: input.accountId } : {}),
        approvalPolicy,
        ...(sandboxMode ? { sandboxMode } : {}),
        approvalReviewer,
        mode: 'agent',
        reasoningEffort: normalizeRoleReasoningEffort(input.reasoningEffort),
        ...(input.serviceTier ? { serviceTier: input.serviceTier } : {}),
        ...(input.guiDesignCanvas ? { guiDesignCanvas: true } : {}),
        ...(agentSurface ? { agentSurface } : {}),
        ...(designAdmission ?? {}),
        // Child runs have no independent interactive surface for structured prompts.
        disableUserInput: true
      }
    }, {
      ...(input.controlPrompt?.trim()
        ? { runtimeContext: { kind: 'host-control', content: input.controlPrompt.trim() } }
        : {})
    })
    const abortChild = (): void => {
      console.warn(`[kun] foreground subagent parent abort received child=${thread.id} turn=${started.turnId} parentThread=${input.parentThreadId} parentTurn=${input.parentTurnId}`)
      if (isHostShutdownTurnSuspension(input.signal)) return
      void turns.interruptTurn({
        threadId: thread.id,
        turnId: started.turnId
      }).catch(() => undefined)
    }
    if (input.signal.aborted) {
      console.warn(`[kun] foreground subagent started with aborted parent signal child=${thread.id} turn=${started.turnId}`)
      abortChild()
    } else {
      console.warn(`[kun] foreground subagent abort bridge armed child=${thread.id} turn=${started.turnId} parentThread=${input.parentThreadId} parentTurn=${input.parentTurnId}`)
      input.signal.addEventListener('abort', abortChild, { once: true })
    }
    let status: 'completed' | 'failed' | 'aborted' = input.signal.aborted ? 'aborted' : 'failed'
    let executionError: unknown
    try {
      const outcome = await loop.runTurn(thread.id, started.turnId)
      if (
        outcome === 'suspended' ||
        outcome === 'suspended_pending_supervision'
      ) {
        throw new Error(`non-Graph child turn suspended unexpectedly: ${started.turnId}`)
      }
      status = outcome
    } catch (error) {
      executionError = error
      status = input.signal.aborted ? 'aborted' : 'failed'
    } finally {
      input.signal.removeEventListener('abort', abortChild)
    }
    console.warn(`[kun] foreground subagent turn settled child=${thread.id} turn=${started.turnId} status=${status}`)
    const items = await sessionStore.loadItems(thread.id)
    // Settlement snapshot for every terminal status: failed and aborted runs
    // must still report the tokens they already burned (issue #1155).
    const childUsage = usage.forThread(thread.id)
    const toolInvocations = items.filter(
      (item) => item.turnId === started.turnId && item.kind === 'tool_call'
    ).length
    const settlement = { usage: childUsage, toolInvocations }
    const result = await materializeChildResult({
      content: childResultSource(items, started.turnId, status),
      childId: thread.id,
      parentThreadId: input.parentThreadId,
      ...(options.artifactStore ? { artifactStore: options.artifactStore } : {})
    })
    const reviewBundle = childReviewBundle(items, started.turnId)
    const directionBundle = childDirectionBundle(items, started.turnId)
    const deckArtifact = childDeckArtifact(items, started.turnId)
    const evidencePack = input.fastContext && input.fastContextTasks?.length
      ? buildFastContextEvidencePack({
          tasks: input.fastContextTasks,
          items,
          turnId: started.turnId,
          summary: result.summary,
          ...(status === 'completed' ? {} : { failure: `Retrieval child ${status}.` })
        })
      : undefined
    // For a Fast Context child the evidence pack is the contract product.
    // When the model spent its whole budget on retrieval and wrote no final
    // text, the pack still carries every task conclusion, so never let a
    // stringified tool_result or duplicated loop error text impersonate the
    // summary (that produced self-contradictory "failed + status: completed"
    // cards). The placeholder text tracks the settled terminal status.
    if (input.fastContext && evidencePack && childResultUsedNoTextSummary(items, started.turnId)) {
      result.summary = status === 'completed'
        ? 'Fast Context retrieval completed; see evidence pack.'
        : 'Fast Context retrieval incomplete; see evidence pack.'
      result.summaryTruncated = undefined
    }
    const structuredResult = {
      ...result,
      ...(directionBundle !== undefined ? { directionBundle } : {}),
      ...(reviewBundle !== undefined ? { reviewBundle } : {}),
      ...(deckArtifact !== undefined ? { deckArtifact } : {}),
      ...(evidencePack ? { evidencePack } : {})
    }
    // Only a FATAL error fails the child. Recoverable tool errors — a tool
    // rejected by the child's read-only policy, or a tool that crashed — are
    // recorded as `severity: 'warning'` error events but the loop hands the
    // model an error tool-result it adapts to and the turn still completes.
    // Treating those as fatal wrongly marked the whole subagent "failed" for a
    // single denied `bash` call. Genuine failures are caught by the `status`
    // check below; here we only honor non-warning (fatal) error events.
    const runtimeError = await findSessionEvent(
      sessionStore,
      thread.id,
      (event) =>
        event.kind === 'error' &&
        event.turnId === started.turnId &&
        event.severity !== 'warning' &&
        event.severity !== 'info'
    )
    if (runtimeError?.kind === 'error') {
      // A Fast Context child that exhausted its retrieval budget can still
      // settle `completed` with a fatal-looking loop bookkeeping error (empty
      // final answer / suppressed repeat tool calls). Only those whitelisted
      // loop-cleanup codes are outranked by the evidence pack; any other fatal
      // error (provider crash, sandbox failure, unknown) still fails the run.
      const fastContextRecovered =
        input.fastContext === true &&
        status === 'completed' &&
        evidencePack !== undefined &&
        runtimeError.code !== undefined &&
        FAST_CONTEXT_RECOVERABLE_LOOP_ERROR_CODES.has(runtimeError.code)
      if (!fastContextRecovered) {
        throw new ChildResultExecutionError(runtimeError.message, structuredResult, {
          ...settlement,
          failure: childFailureFromRuntimeError(runtimeError)
        })
      }
    }
    if (executionError !== undefined) {
      throw new ChildResultExecutionError(childExecutionErrorMessage(executionError), structuredResult, {
        ...settlement,
        failure: { source: 'runtime' }
      })
    }
    const evidence = input.returnFormat === 'evidence'
      ? childToolEvidence(items, started.turnId)
      : undefined
    if (status !== 'completed') {
      throw new ChildResultExecutionError(result.summary || `child agent ${status}`, structuredResult, {
        ...settlement,
        failure: { source: 'runtime' }
      })
    }
    return {
      ...result,
      ...(directionBundle !== undefined ? { directionBundle } : {}),
      ...(reviewBundle !== undefined ? { reviewBundle } : {}),
      ...(deckArtifact !== undefined ? { deckArtifact } : {}),
      ...(evidence ? { evidence } : {}),
      ...(evidencePack ? { evidencePack } : {}),
      usage: childUsage,
      toolInvocations,
      // Only a stable role system prompt changes the immutable prefix.
      // Host workflow control is private chronological model context.
      prefixReused: !input.systemPrompt?.trim(),
      inheritedHistoryItems: 0
    }
  }
}

function intersectDefinedLists(...lists: Array<readonly string[] | undefined>): string[] | undefined {
  const defined = lists.filter((list): list is readonly string[] => Boolean(list))
  if (!defined.length) return undefined
  let result = unique(defined[0] ?? [])
  for (const list of defined.slice(1)) {
    const allowed = new Set(list)
    result = result.filter((value) => allowed.has(value))
  }
  return result
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function childThreadTitle(childId: string, label?: string, profile?: string): string {
  const suffix = label?.trim() || profile?.trim() || childId
  return `Child agent: ${suffix}`
}

function childExecutionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function childFailureFromRuntimeError(
  event: Extract<import('../contracts/events.js').RuntimeEvent, { kind: 'error' }>
): ChildRunFailure {
  const details = event.details && typeof event.details === 'object' && !Array.isArray(event.details)
    ? event.details as Record<string, unknown>
    : undefined
  const modelFailure = details?.modelFailure
  const parsed = ChildRunFailureSchema.safeParse(
    modelFailure && typeof modelFailure === 'object' && !Array.isArray(modelFailure)
      ? {
          source: 'model',
          code: event.code,
          category: (modelFailure as Record<string, unknown>).category,
          httpStatus: (modelFailure as Record<string, unknown>).httpStatus,
          retryAfterMs: (modelFailure as Record<string, unknown>).retryAfterMs
        }
      : { source: 'runtime', code: event.code }
  )
  return parsed.success ? parsed.data : { source: 'runtime' }
}
