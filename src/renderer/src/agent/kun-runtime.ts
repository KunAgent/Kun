import { getKunThreadDetail } from './kun-runtime-thread-detail'
import type {
  AgentProvider,
  ChatBlock,
  NormalizedThread,
  ReviewTarget,
  ThreadEventSink,
  ThreadUsageSnapshot,
  UserInputAnswer
} from './types'
import type { WriteTurnContext } from './write-turn-context'
import type { ThreadListOptions, ThreadListPage } from './provider-types'
import { getKunRuntimeSettings } from '@shared/app-settings-kun-defaults'
import type {
  ApprovalPolicy as KunApprovalPolicy,
  ApprovalReviewer as KunApprovalReviewer,
  SandboxMode as KunSandboxMode
} from '@shared/app-settings'
import {
  KUN_ATTACHMENT_DIAGNOSTICS_PATH,
  KUN_ATTACHMENTS_PATH,
  KUN_HEALTH_PATH,
  KUN_MEMORY_DIAGNOSTICS_PATH,
  KUN_MEMORY_PATH,
  KUN_MCP_OAUTH_PATH,
  KUN_MODEL_CONNECTIONS_PATH,
  KUN_RUNTIME_INFO_PATH,
  KUN_RUNTIME_TOOLS_PATH,
  KUN_SKILLS_PATH,
  KUN_THREADS_CONTENT_SEARCH_PATH,
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
import { extraRootsForWorkspace } from '../lib/code-workspace-folder-lookup'
import { additionalWorkspacesForThread, readCodeWorkspaceFolderSets } from '../lib/code-workspace-folder-sets'
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
  CoreThreadSummaryJson,
  CoreThreadTodosResponseJson
} from './kun-contract'
import {
  buildQuery,
  dispatchKunRuntimeEvents,
  threadFromCore
} from './kun-mapper'
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

function logRuntimeProbeFailure(path: string, status: number): void {
  void (async () => {
    let baseUrl: string | undefined
    try {
      const settings = await rendererRuntimeClient.getSettings()
      const port = settings.agents.kun.port
      if (typeof port === 'number' && Number.isFinite(port) && port > 0) {
        baseUrl = `http://127.0.0.1:${port}`
      }
    } catch {
      // Probe logging is best-effort; the thrown health error is the user path.
    }
    if (typeof window.kunGui?.logError !== 'function') return
    await window.kunGui.logError('runtime-probe', 'Kun runtime health probe failed', {
      path,
      status,
      ...(baseUrl ? { baseUrl } : {})
    })
  })()
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
    const health = await rendererRuntimeClient.runtimeRequest(KUN_HEALTH_PATH, 'GET')
    if (health.ok) return
    logRuntimeProbeFailure(KUN_HEALTH_PATH, health.status)
    throw runtimeErrorToError(readRuntimeError(health.body, `runtime unhealthy (${health.status || 0})`))
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
      KUN_THREADS_CONTENT_SEARCH_PATH + '?' + params.toString(),
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
      indexStatus?: { status: 'not_started' | 'running' | 'ready' | 'failed' | 'unavailable'; indexed: number; total: number }
    }>(
      response.body,
      'runtime returned an invalid thread list response'
    )
    return {
      threads: body.threads.map(threadFromCore),
      nextCursor: body.nextCursor,
      hasMore: body.hasMore === true,
      total: body.total,
      ...(body.indexStatus ? { indexStatus: body.indexStatus } : {})
    }
  }

  async createThread(input: {
    workspace?: string
    additionalWorkspaces?: string[]
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
    const additionalWorkspaces = additionalWorkspacesForThread(
      workspace,
      input.additionalWorkspaces ?? extraRootsForWorkspace(workspace, readCodeWorkspaceFolderSets())
    )
    const response = await rendererRuntimeClient.runtimeRequest(
      '/v1/threads',
      'POST',
      JSON.stringify({
        workspace,
        ...(additionalWorkspaces.length ? { additionalWorkspaces } : {}),
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

  getThreadDetail: AgentProvider['getThreadDetail'] = getKunThreadDetail

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
      guiExcalidrawCanvas?: boolean
      guiDesignMode?: boolean
      persona?: string
      agentSurface?: 'code' | 'write' | 'design'
      approvalPolicy?: KunApprovalPolicy
      sandboxMode?: KunSandboxMode
      approvalReviewer?: KunApprovalReviewer
      designProfile?: DesignTaskProfileInput
      designDocumentTarget?: DesignDocumentTarget
      designImagePlacementTarget?: DesignImagePlacementTarget
      guiDesignArtifact?: {
        kind: 'svg'
        artifactId: string
        relativePath: string
      }
      attachmentIds?: string[]
      /** Queue this turn durably when the thread already has an active turn. */
      enqueueIfBusy?: boolean
      workspaceCheckpointId?: string
      workspaceCheckpointRequestId?: string
      fileReferences?: Array<{ path: string; relativePath: string; name: string; kind?: 'file' | 'directory' }>
      composerContexts?: ComposerContextAttachment[]
      writeContext?: WriteTurnContext
    }
  ): Promise<{
    turnId: string
    threadId: string
    userMessageItemId?: string
    status?: 'queued' | 'running' | 'completed' | 'failed' | 'aborted'
    queuedPosition?: number
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
      ...(options?.enqueueIfBusy === true ? { enqueueIfBusy: true } : {}),
      ...(options?.orchestration === 'graph' ? { orchestration: 'graph' } : {}),
      clientSurface: 'gui',
      ...(selectedModel ? { model: selectedModel } : {}),
      ...(selectedProviderId ? { providerId: selectedProviderId } : {}),
      ...(selectedAccountId ? { accountId: selectedAccountId } : {}),
      approvalPolicy: options?.approvalPolicy ?? runtime.approvalPolicy,
      sandboxMode: options?.sandboxMode ?? runtime.sandboxMode,
      approvalReviewer: options?.approvalReviewer ?? runtime.approvalReviewer
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
    if (options?.guiExcalidrawCanvas) {
      body.guiExcalidrawCanvas = true
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
    if (options?.writeContext) {
      body.writeContext = options.writeContext
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
      ...(parsed.status ? { status: parsed.status } : {}),
      ...(parsed.queuedPosition !== undefined ? { queuedPosition: parsed.queuedPosition } : {}),
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
