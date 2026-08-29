import type {
  AgentProvider,
  ChatBlock,
  NormalizedThread,
  ReviewTarget,
  ThreadDetail,
  ThreadEventSink,
  ThreadUsageSnapshot,
  UserInputAnswer
} from './types'
import type { ThreadListOptions, ThreadListPage } from './provider-types'
import { getKunRuntimeSettings } from '@shared/app-settings-kun-defaults'
import {
  KUN_ATTACHMENT_DIAGNOSTICS_PATH,
  KUN_ATTACHMENTS_PATH,
  KUN_MEMORY_DIAGNOSTICS_PATH,
  KUN_MEMORY_PATH,
  KUN_MCP_OAUTH_PATH,
  KUN_MODEL_CONNECTIONS_PATH,
  KUN_RUNTIME_INFO_PATH,
  KUN_RUNTIME_TOOLS_PATH,
  KUN_SKILLS_PATH,
  kunThreadCompactPath,
  kunThreadEventsPath,
  kunThreadForkPath,
  kunThreadGoalPath,
  kunThreadReviewPath,
  kunThreadRewindPath,
  kunThreadTodosPath,
  kunThreadInterruptPath,
  kunThreadToolCancelPath,
  kunThreadPath,
  kunThreadTimelinePath,
  kunThreadSteerPath,
  kunThreadTurnsPath,
  kunAttachmentContentPath,
  kunUserInputPath,
  kunMemoryRecordPath,
  kunMcpOAuthServerPath,
  kunSessionResumePath,
  normalizeThreadMode,
  type KunThreadMode
} from '@shared/kun-endpoints'
import { parseRuntimeErrorBody, runtimeErrorToError, type RuntimeError } from '@shared/runtime-error'
import {
  workspaceDirectoryExists,
  workspaceMissingError
} from '../lib/workspace-availability'
import type {
  CoreAttachmentDiagnosticsJson,
  CoreAttachmentContentResponseJson,
  CoreAttachmentMetadataJson,
  CoreAttachmentTextFallbackJson,
  CoreAttachmentUploadResponseJson,
  CoreMemoryDiagnosticsJson,
  CoreMemoryListResponseJson,
  CoreMemoryRecordJson,
  CoreMcpOAuthClearResponseJson,
  CoreMcpOAuthAuthorizeResponseJson,
  CoreMcpOAuthDiagnosticJson,
  CoreMcpOAuthDiagnosticsResponseJson,
  CoreResumeSessionResponseJson,
  CoreRuntimeInfoJson,
  CoreRuntimeEventJson,
  CoreRuntimeSkillJson,
  CoreRuntimeSkillsResponseJson,
  CoreRuntimeToolDiagnosticsJson,
  CoreStartReviewResponseJson,
  CoreClearThreadGoalResponseJson,
  CoreClearThreadTodosResponseJson,
  CoreCancelToolCallResponseJson,
  CoreStartTurnResponseJson,
  CoreThreadGoalResponseJson,
  CoreThreadJson,
  CoreThreadTimelineJson,
  CoreThreadSummaryJson,
  CoreThreadTodosResponseJson
} from './kun-contract'
import {
  buildQuery,
  chatBlockFromItem,
  dispatchKunRuntimeEvents,
  goalFromCore,
  mergeChatBlocks,
  todosFromCore,
  threadFromCore
} from './kun-mapper'
import { restoredThreadLiveProjection } from './kun-runtime-thread-live-projection'
import { rendererRuntimeClient } from './runtime-client'
import type { ComposerContextAttachment } from '@kun/extension-api'
import { KunRuntimeThreadServices } from './kun-runtime-thread-services'
import { readRuntimeError, readRuntimeJson } from './kun-runtime-services'
import type {
  DesignDocumentTarget,
  DesignImagePlacementTarget,
  DesignTaskProfile,
  DesignTaskProfileInput
} from './design-task-profile'
import { buildTurnDurationByUserId, resolveRunningTurnStartedAtMs } from './thread-timing'

function normalizeApprovalPolicy(value: string | undefined): NormalizedThread['approvalPolicy'] {
  switch (value) {
    case 'always':
    case 'auto':
    case 'on-request':
    case 'untrusted':
    case 'suggest':
    case 'never':
      return value
    default:
      return undefined
  }
}

async function sharedDefaultModelSelection(): Promise<{
  registryAvailable: boolean
  providerId?: string
  accountId?: string
  model?: string
  providers?: Array<{
    id: string
    accountId?: string
    configured: boolean
    models: string[]
  }>
}> {
  const response = await rendererRuntimeClient.runtimeRequest(KUN_MODEL_CONNECTIONS_PATH, 'GET')
  if (!response.ok) return { registryAvailable: false }
  try {
    const value = JSON.parse(response.body) as {
      defaultProviderId?: unknown
      defaultAccountId?: unknown
      defaultModel?: unknown
      providers?: unknown
    }
    return {
      registryAvailable: true,
      ...(typeof value.defaultProviderId === 'string' && value.defaultProviderId.trim()
        ? { providerId: value.defaultProviderId.trim() }
        : {}),
      ...(typeof value.defaultAccountId === 'string' && value.defaultAccountId.trim()
        ? { accountId: value.defaultAccountId.trim() }
        : {}),
      ...(typeof value.defaultModel === 'string' && value.defaultModel.trim()
        ? { model: value.defaultModel.trim() }
        : {}),
      providers: Array.isArray(value.providers)
        ? value.providers.flatMap((entry) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
            const profile = entry as Record<string, unknown>
            if (typeof profile.id !== 'string' || !profile.id.trim()) return []
            return [{
              id: profile.id.trim(),
              ...(typeof profile.accountId === 'string' && profile.accountId.trim()
                ? { accountId: profile.accountId.trim() }
                : {}),
              configured: profile.configured === true,
              models: Array.isArray(profile.models)
                ? profile.models.filter((model): model is string =>
                    typeof model === 'string' && Boolean(model.trim()))
                : []
            }]
          })
        : []
    }
  } catch {
    return { registryAvailable: false }
  }
}

/**
 * GUI-side adapter for the Kun HTTP/SSE contract.
 *
 * The provider owns renderer orchestration only: HTTP calls, SSE
 * reconnection, and approval policy decisions. DTO and chat-block
 * mapping live in `kun-contract.ts` and `kun-mapper.ts`.
 */
/** One conversation whose message content matched a deep-search term. */
export type ThreadContentMatch = {
  threadId: string
  title: string
  workspace: string
  snippet: string
  updatedAt: string
}

export class KunRuntimeProvider extends KunRuntimeThreadServices implements AgentProvider {
  readonly id = 'kun' as const
  readonly displayName = 'Kun'

  getCapabilities(): {
    interrupt: boolean
    stream: boolean
    approvals: boolean
    attachFiles: boolean
    review: boolean
  } {
    return { interrupt: true, stream: true, approvals: true, attachFiles: true, review: true }
  }

  async connect(): Promise<void> {
    const health = await rendererRuntimeClient.runtimeRequest('/health', 'GET')
    if (!health.ok) {
      throw runtimeErrorToError(readRuntimeError(health.body, `runtime unhealthy (${health.status || 0})`))
    }
    const threads = await rendererRuntimeClient.runtimeRequest('/v1/threads?limit=1', 'GET')
    if (!threads.ok) {
      throw runtimeErrorToError(readRuntimeError(threads.body, `failed to list threads (${threads.status || 0})`))
    }
  }

  /**
   * Deep-search conversation message content across recent threads in every
   * project. Returns one snippet per matching conversation, most recently
   * updated first; each match carries the workspace it belongs to.
   */
  async searchThreadContent(
    query: string,
    options: { limit?: number } = {}
  ): Promise<ThreadContentMatch[]> {
    const normalized = query.trim()
    if (!normalized) return []
    const params = new URLSearchParams({
      q: normalized,
      limit: String(options.limit ?? 12)
    })
    const response = await rendererRuntimeClient.runtimeRequest(
      '/v1/threads/content-search?' + params.toString(),
      'GET'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to search thread content'))
    }
    const body = readRuntimeJson<{ matches: ThreadContentMatch[] }>(
      response.body,
      'runtime returned an invalid thread content search response'
    )
    return Array.isArray(body.matches) ? body.matches : []
  }

  async listThreads(options: ThreadListOptions = {}): Promise<NormalizedThread[]> {
    const threads: NormalizedThread[] = []
    let cursor = options.cursor
    do {
      const page = await this.listThreadsPage({
        ...options,
        limit: options.limit ?? 500,
        ...(cursor ? { cursor } : {})
      })
      threads.push(...page.threads)
      cursor = page.hasMore ? page.nextCursor : undefined
    } while (cursor)
    return threads
  }

  async listThreadsPage(options: ThreadListOptions = {}): Promise<ThreadListPage> {
    const query = buildQuery({
      limit: options.limit,
      search: options.search,
      include_archived: options.includeArchived,
      archived_only: options.archivedOnly,
      include: options.includeSide ? 'side' : undefined,
      cursor: options.cursor,
      workspace: options.workspace,
      lean: options.lean === true ? '1' : undefined
    })
    const response = await rendererRuntimeClient.runtimeRequest(`/v1/threads${query}`, 'GET')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to list threads'))
    }
    const body = readRuntimeJson<{
      threads: CoreThreadSummaryJson[]
      nextCursor?: string
      hasMore?: boolean
      total?: number
    }>(
      response.body,
      'runtime returned an invalid thread list response'
    )
    return {
      threads: body.threads.map(threadFromCore),
      nextCursor: body.nextCursor,
      hasMore: body.hasMore === true,
      total: body.total
    }
  }

  async createThread(input: {
    workspace?: string
    title?: string
    titleAuto?: boolean
    mode?: KunThreadMode
    agentSurface?: 'code' | 'write' | 'design'
    agentId?: string
    providerId?: string
    accountId?: string
    model?: string
    systemPrompt?: string
  }): Promise<NormalizedThread> {
    const settings = await rendererRuntimeClient.getSettings()
    const runtime = getKunRuntimeSettings(settings)
    const workspace = (input.workspace || settings.workspaceRoot || '').trim()
    if (!workspace || !(await workspaceDirectoryExists(workspace))) {
      throw new Error(workspaceMissingError())
    }
    const sharedDefault = await sharedDefaultModelSelection()
    const requestedProviderId = input.providerId?.trim() || sharedDefault.providerId
    const requestedModel = input.model?.trim() ||
      (requestedProviderId === sharedDefault.providerId ? sharedDefault.model : undefined)
    const requestedProfile = sharedDefault.providers?.find((profile) =>
      profile.id === requestedProviderId
    )
    if (
      sharedDefault.registryAvailable &&
      (
        !requestedProviderId ||
        !requestedModel ||
        !requestedProfile?.configured ||
        (requestedProfile.models.length > 0 && !requestedProfile.models.includes(requestedModel))
      )
    ) {
      throw new Error('No connected model is selected. Connect a provider or choose an available shared model first.')
    }
    const response = await rendererRuntimeClient.runtimeRequest(
      '/v1/threads',
      'POST',
      JSON.stringify({
        workspace,
        title: input.title,
        ...(input.titleAuto !== undefined ? { titleAuto: input.titleAuto } : {}),
        ...(input.agentSurface ? { agentSurface: input.agentSurface } : {}),
        model: requestedModel || runtime.model,
        mode: normalizeThreadMode(input.mode),
        approvalPolicy: runtime.approvalPolicy,
        sandboxMode: runtime.sandboxMode,
        approvalReviewer: runtime.approvalReviewer,
        modelRequestCaptureEnabled: runtime.llmDebug.defaultThreadCaptureEnabled,
        ...(requestedProviderId
          ? { providerId: requestedProviderId }
          : {}),
        ...(input.accountId?.trim() || requestedProfile?.accountId || sharedDefault.accountId
          ? { accountId: input.accountId?.trim() || requestedProfile?.accountId || sharedDefault.accountId }
          : {}),
        ...(input.agentId?.trim() ? { agentId: input.agentId.trim() } : {}),
        ...(input.systemPrompt?.trim() ? { systemPrompt: input.systemPrompt.trim() } : {})
      })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to create thread'))
    }
    return threadFromCore(readRuntimeJson<CoreThreadJson>(
      response.body,
      'runtime returned an invalid thread response'
    ))
  }

  async getThreadDetail(threadId: string, options: { before?: string } = {}): Promise<ThreadDetail> {
    let response = await rendererRuntimeClient.runtimeRequest(
      kunThreadTimelinePath(threadId, {
        ...(options.before ? { before: options.before } : {}),
        limit: 300
      }),
      'GET'
    )
    // A renderer can briefly outlive an older bundled runtime during a local
    // restart. Preserve initial hydration compatibility until that runtime is
    // replaced; older-page requests require the new timeline contract.
    if (
      !response.ok &&
      !options.before &&
      (response.status === 404 || response.status === 405)
    ) {
      response = await rendererRuntimeClient.runtimeRequest(kunThreadPath(threadId), 'GET')
    }
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load thread'))
    }
    const thread = readRuntimeJson<CoreThreadTimelineJson>(
      response.body,
      'runtime returned an invalid thread response'
    )
    const turns = Array.isArray(thread.turns) ? thread.turns : []
    const items = turns.flatMap((turn) =>
      (turn.items ?? []).map((item) => ({
        ...item,
        attachmentIds: turn.attachmentIds,
        activeSkillIds: turn.activeSkillIds,
        injectedMemoryIds: turn.injectedMemoryIds,
        injectedMemorySummaries: turn.injectedMemorySummaries,
        skillInjectionBytes: turn.skillInjectionBytes,
        injectedInstructionSources: turn.injectedInstructionSources,
        instructionInjectionBytes: turn.instructionInjectionBytes,
        mode: turn.mode === 'plan' || turn.mode === 'agent' ? turn.mode : undefined,
        guiDesignCanvas: turn.guiDesignCanvas,
        guiDesignMode: turn.guiDesignMode,
        designProfile: item.designProfile ?? turn.designProfile,
        designDocumentTarget: item.designDocumentTarget ?? turn.designDocumentTarget,
        workspaceCheckpointId: item.workspaceCheckpointId ?? turn.workspaceCheckpointId
      }))
    )
    const latestTurn = thread.latestTurn ?? turns.at(-1)
    const restoredLive = restoredThreadLiveProjection(
      items,
      latestTurn?.id,
      latestTurn?.status
    )
    const blocks = mergeChatBlocks(items.flatMap((item) => {
      if (restoredLive.liveItemIds.has(item.id)) return []
      const block = chatBlockFromItem(item)
      return block ? [block] : []
    }))
    // Re-derive the live ask-user flag from the runtime's pending gate so a
    // request the agent is still awaiting stays answerable after a rehydration
    // (thread switch, SSE recovery, restart) — and a stale `pending` item from a
    // finished thread, whose gate entry is gone, stays a read-only record (#606).
    const pendingUserInputIds = new Set(
      Array.isArray(thread.pendingUserInputIds) ? thread.pendingUserInputIds : []
    )
    if (pendingUserInputIds.size > 0) {
      for (const block of blocks) {
        if (block.kind === 'user_input' && pendingUserInputIds.has(block.requestId)) {
          block.live = true
        }
      }
    }
    // Manual approval history is event-sourced. A recovered snapshot includes
    // the currently live approval-gate ids, which distinguish an actionable
    // pending request from one that expired while the GUI was disconnected
    // (for example after an SSE 404).
    if (Array.isArray(thread.pendingApprovalIds)) {
      const pendingApprovalIds = new Set(thread.pendingApprovalIds)
      for (const block of blocks) {
        if (
          block.kind === 'approval' &&
          block.status === 'pending' &&
          !pendingApprovalIds.has(block.approvalId)
        ) {
          block.status = 'expired'
        }
      }
    }
    const latestTurnId = latestTurn?.id
    // Prefer the active turn's opening user message: a long running turn may
    // push its own prompt to the front of the page (timeline anchor) while
    // later background/steering user items are appended after it. The anchor
    // keeps the real request visible; the reverse scan is the legacy fallback
    // for older runtimes that did not anchor the page.
    const latestUserMessageId = latestTurnId
      ? items.find(
          (item) => item.turnId === latestTurnId && item.kind === 'user_message'
        )?.id
      : undefined
    const resolvedLatestUserMessageId =
      latestUserMessageId ?? [...items].reverse().find((item) => item.kind === 'user_message')?.id
    return {
      blocks,
      latestSeq: thread.latestSeq ?? 0,
      ...(restoredLive.liveProjection ? { liveProjection: restoredLive.liveProjection } : {}),
      threadStatus: thread.status ?? latestTurn?.status,
      latestTurnId: latestTurn?.id,
      latestTurnStatus: latestTurn?.status,
      latestTurnOrchestration: latestTurn
        ? latestTurn.orchestration === 'graph' ? 'graph' : 'direct'
        : undefined,
      latestUserMessageId: resolvedLatestUserMessageId,
      turnDurationByUserId: buildTurnDurationByUserId(turns),
      ...(latestTurn
        ? (() => {
            const startedAtMs = resolveRunningTurnStartedAtMs([latestTurn])
            return startedAtMs !== undefined ? { latestTurnStartedAtMs: startedAtMs } : {}
          })()
        : {}),
      relation: thread.relation,
      ...(thread.parentThreadId ? { parentThreadId: thread.parentThreadId } : {}),
      ...(typeof thread.model === 'string' && thread.model.trim() ? { model: thread.model.trim() } : {}),
      goal: thread.goal ? goalFromCore(thread.goal) : null,
      todos: thread.todos ? todosFromCore(thread.todos) : null,
      payloadBytes: response.body.length,
      ...(thread.timeline?.nextCursor ? { historyCursor: thread.timeline.nextCursor } : {}),
      hasMoreHistory: thread.timeline?.hasMore === true,
      ...(thread.designProfile ? { designProfile: thread.designProfile } : {})
    }
  }

  async sendUserMessage(
    threadId: string,
    text: string,
    options?: {
      clientRequestId?: string
      mode?: KunThreadMode
      orchestration?: 'direct' | 'graph'
      model?: string
      providerId?: string
      accountId?: string
      reasoningEffort?: string
      serviceTier?: 'priority'
      subagentResume?: { childId: string; expectedResumeCount: number }
      messageSource?: 'design_continuation'
      displayText?: string
      guiPlan?: {
        operation: 'draft' | 'refine'
        workspaceRoot: string
        relativePath: string
        planId: string
        sourceRequest?: string
        title?: string
      }
      guiDesignCanvas?: boolean
      guiDesignMode?: boolean
      persona?: string
      agentSurface?: 'code' | 'write' | 'design'
      designProfile?: DesignTaskProfileInput
      designDocumentTarget?: DesignDocumentTarget
      designImagePlacementTarget?: DesignImagePlacementTarget
      guiDesignArtifact?: {
        kind: 'svg'
        artifactId: string
        relativePath: string
      }
      attachmentIds?: string[]
      workspaceCheckpointId?: string
      workspaceCheckpointRequestId?: string
      fileReferences?: Array<{ path: string; relativePath: string; name: string; kind?: 'file' | 'directory' }>
      composerContexts?: ComposerContextAttachment[]
    }
  ): Promise<{
    turnId: string
    threadId: string
    userMessageItemId?: string
    agentSurface?: 'code' | 'write' | 'design'
    threadAgentSurface?: 'code' | 'write' | 'design'
    designProfile?: DesignTaskProfile
    designDocumentTarget?: DesignDocumentTarget
  }> {
    const settings = await rendererRuntimeClient.getSettings()
    const runtime = getKunRuntimeSettings(settings)
    const mode = options?.mode
    const selectedModel = options?.model?.trim() ||
      (mode === 'plan' ? runtime.planModel?.trim() : '')
    const selectedProviderId = options?.providerId?.trim() ||
      (mode === 'plan' ? runtime.planProviderId?.trim() : '')
    const selectedAccountId = options?.accountId?.trim() ||
      (mode === 'plan' ? runtime.planAccountId?.trim() : '')
    const body: Record<string, unknown> = {
      prompt: text,
      ...(options?.clientRequestId?.trim()
        ? { clientRequestId: options.clientRequestId.trim() }
        : {}),
      ...(options?.orchestration === 'graph' ? { orchestration: 'graph' } : {}),
      clientSurface: 'gui',
      ...(selectedModel ? { model: selectedModel } : {}),
      ...(selectedProviderId ? { providerId: selectedProviderId } : {}),
      ...(selectedAccountId ? { accountId: selectedAccountId } : {}),
      approvalPolicy: runtime.approvalPolicy,
      sandboxMode: runtime.sandboxMode,
      approvalReviewer: runtime.approvalReviewer
    }
    if (options?.subagentResume) {
      body.subagentResume = options.subagentResume
      body.messageSource = 'subagent_resume'
    } else if (options?.messageSource === 'design_continuation') {
      body.messageSource = options.messageSource
    }
    if (options?.reasoningEffort?.trim()) {
      body.reasoningEffort = options.reasoningEffort.trim()
    }
    if (options?.serviceTier === 'priority') {
      body.serviceTier = 'priority'
    }
    if (options?.displayText?.trim() && options.displayText.trim() !== text.trim()) {
      body.displayText = options.displayText.trim()
    }
    if (mode === 'agent' || mode === 'plan') {
      body.mode = mode
    }
    if (options?.guiPlan) {
      body.guiPlan = {
        operation: options.guiPlan.operation,
        workspaceRoot: options.guiPlan.workspaceRoot,
        relativePath: options.guiPlan.relativePath,
        planId: options.guiPlan.planId,
        sourceRequest: options.guiPlan.sourceRequest,
        title: options.guiPlan.title
      }
    }
    if (options?.guiDesignCanvas) {
      body.guiDesignCanvas = true
    }
    if (options?.guiDesignMode) {
      body.guiDesignMode = true
    }
    if (options?.persona?.trim()) {
      body.persona = options.persona.trim()
    }
    if (options?.agentSurface) {
      body.agentSurface = options.agentSurface
    }
    if (options?.designProfile) {
      body.designProfile = options.designProfile
    }
    if (options?.designDocumentTarget) {
      body.designDocumentTarget = options.designDocumentTarget
    }
    if (options?.designImagePlacementTarget) {
      body.designImagePlacementTarget = options.designImagePlacementTarget
    }
    if (options?.guiDesignArtifact) {
      body.guiDesignArtifact = options.guiDesignArtifact
    }
    if (options?.attachmentIds?.length) {
      body.attachmentIds = options.attachmentIds
    }
    if (options?.workspaceCheckpointId?.trim()) {
      body.workspaceCheckpointId = options.workspaceCheckpointId.trim()
    }
    if (options?.workspaceCheckpointRequestId?.trim()) {
      body.workspaceCheckpointRequestId = options.workspaceCheckpointRequestId.trim()
    }
    if (options?.fileReferences?.length) {
      body.fileReferences = options.fileReferences
    }
    if (options?.composerContexts?.length) {
      body.composerContexts = options.composerContexts
    }
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadTurnsPath(threadId),
      'POST',
      JSON.stringify(body)
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to start turn'))
    }
    const parsed = readRuntimeJson<CoreStartTurnResponseJson>(
      response.body,
      'runtime returned an invalid turn response'
    )
    return {
      threadId: parsed.threadId,
      turnId: parsed.turnId,
      userMessageItemId: parsed.userMessageItemId,
      ...(parsed.agentSurface ? { agentSurface: parsed.agentSurface } : {}),
      ...(parsed.threadAgentSurface
        ? { threadAgentSurface: parsed.threadAgentSurface }
        : {}),
      ...(parsed.designProfile ? { designProfile: parsed.designProfile } : {}),
      ...(parsed.designDocumentTarget
        ? { designDocumentTarget: parsed.designDocumentTarget }
        : {})
    }
  }

}

export { KunSseSubscriptionError } from './kun-runtime-services'
export { kunThreadEventsPath }
