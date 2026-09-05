import type {
  AgentProvider,
  ChatBlock,
  NormalizedThread,
  KnowledgeBaseMount,
  KnowledgeBaseIndexStatus,
  ReviewTarget,
  ThreadEventSink,
  ThreadUsageSnapshot,
  UserInputAnswer
} from './types'
import { getKunRuntimeSettings, type ModelReasoningEffort } from '@shared/app-settings'
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
  KUN_THREAD_STATES_PATH,
  KUN_THREADS_BULK_DELETE_PATH,
  kunThreadCancelQueuedPath,
  kunThreadCompactPath,
  kunThreadQueuePositionPath,
  kunThreadQueueResumePath,
  kunThreadEventsPath,
  kunThreadForkPath,
  kunThreadGoalPath,
  kunThreadReviewPath,
  kunThreadRewindPath,
  kunThreadTodosPath,
  kunThreadTodosSyncPlanPath,
  kunThreadInterruptPath,
  kunThreadKnowledgeBaseReindexPath,
  kunThreadKnowledgeBasesPath,
  kunThreadToolCancelPath,
  kunThreadPath,
  kunThreadSummaryPath,
  kunThreadStatePath,
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
  CoreThreadRuntimeStateJson,
  CoreThreadRuntimeStateBatchResponseJson,
  CoreThreadTimelineJson,
  CoreThreadSummaryJson,
  CoreThreadTodosResponseJson
} from './kun-contract'
import type {
  ThreadRuntimeState,
  ThreadRuntimeStateBatchResult
} from './provider-types'
import {
  buildQuery,
  chatBlockFromItem,
  dispatchKunRuntimeEvents,
  goalFromCore,
  mergeChatBlocks,
  todosFromCore,
  threadFromCore
} from './kun-mapper'
import { rendererRuntimeClient } from './runtime-client'
import type { ComposerContextAttachment } from '@kun/extension-api'

import {
  KunRuntimeProviderServices,
  readRuntimeError,
  readRuntimeJson
} from './kun-runtime-services'

export class KunRuntimeThreadServices extends KunRuntimeProviderServices {
  async getThreadSummary(threadId: string): Promise<NormalizedThread> {
    const response = await rendererRuntimeClient.runtimeRequest(kunThreadSummaryPath(threadId), 'GET')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load thread summary'))
    }
    return threadFromCore(readRuntimeJson<CoreThreadSummaryJson>(
      response.body,
      'runtime returned an invalid thread summary response'
    ))
  }

  async getThreadState(threadId: string, options: { signal?: AbortSignal } = {}): Promise<ThreadRuntimeState> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadStatePath(threadId),
      'GET',
      undefined,
      { signal: options.signal, priority: 'foreground' }
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load thread state'))
    }
    return runtimeStateFromCore(readRuntimeJson<CoreThreadRuntimeStateJson>(
      response.body,
      'runtime returned an invalid thread state response'
    ))
  }

  async getThreadStates(threadIds: string[]): Promise<ThreadRuntimeStateBatchResult[]> {
    const response = await rendererRuntimeClient.runtimeRequest(
      KUN_THREAD_STATES_PATH,
      'POST',
      JSON.stringify({ threadIds })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load thread states'))
    }
    const body = readRuntimeJson<CoreThreadRuntimeStateBatchResponseJson>(
      response.body,
      'runtime returned an invalid thread states response'
    )
    return body.results.map((result) => result.ok
      ? { id: result.id, ok: true, state: runtimeStateFromCore(result.state) }
      : result)
  }

  async rewindThread(threadId: string, turnId: string): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadRewindPath(threadId),
      'POST',
      JSON.stringify({ turnId })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to rewind thread'))
    }
  }

  async reviewThread(
    threadId: string,
    target: ReviewTarget,
    options?: {
      model?: string
      providerId?: string
      accountId?: string
      reasoningEffort?: ModelReasoningEffort
    }
  ): Promise<{ turnId: string; threadId: string; userMessageItemId?: string; reviewItemId?: string }> {
    const body: Record<string, unknown> = { target }
    if (options?.model?.trim()) {
      body.model = options.model.trim()
    }
    if (options?.providerId?.trim()) {
      body.providerId = options.providerId.trim()
    }
    if (options?.accountId?.trim()) {
      body.accountId = options.accountId.trim()
    }
    if (options?.reasoningEffort) {
      body.reasoningEffort = options.reasoningEffort
    }
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadReviewPath(threadId),
      'POST',
      JSON.stringify(body)
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to start review'))
    }
    const parsed = readRuntimeJson<CoreStartReviewResponseJson>(
      response.body,
      'runtime returned an invalid review response'
    )
    return {
      threadId: parsed.threadId,
      turnId: parsed.turnId,
      userMessageItemId: parsed.userMessageItemId,
      reviewItemId: parsed.reviewItemId
    }
  }

  async steerUserMessage(
    threadId: string,
    turnId: string,
    text: string,
    options?: { displayText?: string; attachmentIds?: string[] }
  ): Promise<void> {
    const displayText = options?.displayText?.trim()
    const attachmentIds = options?.attachmentIds?.map((id) => id.trim()).filter(Boolean) ?? []
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadSteerPath(threadId, turnId),
      'POST',
      JSON.stringify({
        text,
        ...(displayText ? { displayText } : {}),
        ...(attachmentIds.length ? { attachmentIds } : {})
      })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to queue message'))
    }
  }

  async cancelQueuedTurn(threadId: string, turnId: string): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadCancelQueuedPath(threadId, turnId),
      'POST'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to cancel queued turn'))
    }
  }

  async moveQueuedTurn(
    threadId: string,
    turnId: string,
    position: { beforeTurnId?: string; afterTurnId?: string }
  ): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadQueuePositionPath(threadId, turnId),
      'PATCH',
      JSON.stringify(position)
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to reorder queued turn'))
    }
  }

  async resumeQueuedTurns(threadId: string): Promise<{ started: boolean; turnId?: string }> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadQueueResumePath(threadId),
      'POST'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to resume queued turns'))
    }
    const parsed = readRuntimeJson<{
      started: boolean
      turnId?: string
    }>(response.body, 'runtime returned an invalid queue resume response')
    return { started: parsed.started, ...(parsed.turnId ? { turnId: parsed.turnId } : {}) }
  }

  async interruptTurn(threadId: string, turnId: string, options?: { discard?: boolean }): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadInterruptPath(threadId, turnId),
      'POST',
      JSON.stringify({ discard: options?.discard === true })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to interrupt turn'))
    }
  }

  async cancelToolCall(
    threadId: string,
    turnId: string,
    callId: string
  ): Promise<CoreCancelToolCallResponseJson> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadToolCancelPath(threadId, turnId, callId),
      'POST'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to cancel tool call'))
    }
    return readRuntimeJson<CoreCancelToolCallResponseJson>(
      response.body,
      'runtime returned an invalid tool cancellation response'
    )
  }

  async renameThread(threadId: string, title: string, auto?: boolean): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadPath(threadId),
      'PATCH',
      JSON.stringify({ title, ...(auto !== undefined ? { titleAuto: auto } : {}) })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'rename thread failed'))
    }
  }

  async updateThreadWorkspace(threadId: string, workspace: string): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadPath(threadId),
      'PATCH',
      JSON.stringify({ workspace })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'update thread workspace failed'))
    }
  }

  async updateThreadKnowledgeBases(
    threadId: string,
    mounts: KnowledgeBaseMount[]
  ): Promise<NormalizedThread> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadPath(threadId),
      'PATCH',
      JSON.stringify({ knowledgeBases: mounts })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'update thread knowledge bases failed'))
    }
    return threadFromCore(readRuntimeJson<CoreThreadJson>(
      response.body,
      'runtime returned an invalid thread response'
    ))
  }

  async getThreadKnowledgeBases(threadId: string): Promise<{
    mounts: KnowledgeBaseMount[]
    statuses: KnowledgeBaseIndexStatus[]
  }> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadKnowledgeBasesPath(threadId),
      'GET'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'get thread knowledge bases failed'))
    }
    return readRuntimeJson(response.body, 'runtime returned invalid knowledge base status')
  }

  async reindexThreadKnowledgeBase(
    threadId: string,
    knowledgeBaseId: string
  ): Promise<KnowledgeBaseIndexStatus> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadKnowledgeBaseReindexPath(threadId, knowledgeBaseId),
      'POST'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'reindex knowledge base failed'))
    }
    return readRuntimeJson(response.body, 'runtime returned invalid knowledge base status')
  }

  async updateThreadPinned(threadId: string, pinned: boolean): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadPath(threadId),
      'PATCH',
      JSON.stringify({ pinned })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'update thread pin failed'))
    }
  }

  async archiveThread(threadId: string, archived: boolean): Promise<void> {
    const response = await window.kunGui.runtimeRequest(
      kunThreadPath(threadId),
      'PATCH',
      JSON.stringify({ status: archived ? 'archived' : 'idle' })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'archive thread failed'))
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(kunThreadPath(threadId), 'DELETE')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'delete thread failed'))
    }
  }

  async deleteThreadsByWorkspace(workspace: string): Promise<string[]> {
    const response = await rendererRuntimeClient.runtimeRequest(
      KUN_THREADS_BULK_DELETE_PATH,
      'POST',
      JSON.stringify({ workspace })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'delete workspace threads failed'))
    }
    const body = readRuntimeJson<{ deletedIds?: unknown }>(
      response.body,
      'runtime returned an invalid workspace thread deletion response'
    )
    return Array.isArray(body.deletedIds)
      ? body.deletedIds.filter((id): id is string => typeof id === 'string')
      : []
  }

  async compactThread(threadId: string, reason?: string): Promise<{ replacedTokens: number }> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadCompactPath(threadId),
      'POST',
      JSON.stringify({ reason: reason?.trim() || undefined })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'compact thread failed'))
    }
    // Surface the folded token count so the UI can drop the context gauge
    // immediately. Heuristic compaction has no usage event, and model-summary
    // usage can arrive separately from the compact response. Best-effort: a
    // parse hiccup must not turn a successful compaction into a thrown error.
    try {
      const body = readRuntimeJson<{ replacedTokens?: number }>(
        response.body,
        'runtime returned an invalid compact response'
      )
      return { replacedTokens: Math.max(0, Math.floor(body.replacedTokens ?? 0)) }
    } catch {
      return { replacedTokens: 0 }
    }
  }

  async archiveThreadHistory(threadId: string, cutoffTurnId: string): Promise<{
    replacedTokens: number
    archivedItems: number
    retainedItems: number
    archivePath: string
  }> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadCompactPath(threadId),
      'POST',
      JSON.stringify({ cutoffTurnId })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'archive thread history failed'))
    }
    const body = readRuntimeJson<{
      replacedTokens?: number
      archivedItems?: number
      retainedItems?: number
      archivePath?: string
    }>(response.body, 'runtime returned an invalid archive response')
    if (!body.archivePath) throw new Error('runtime archive response is missing archivePath')
    return {
      replacedTokens: Math.max(0, Math.floor(body.replacedTokens ?? 0)),
      archivedItems: Math.max(0, Math.floor(body.archivedItems ?? 0)),
      retainedItems: Math.max(0, Math.floor(body.retainedItems ?? 0)),
      archivePath: body.archivePath
    }
  }

  async getThreadGoal(threadId: string): Promise<NonNullable<NormalizedThread['goal']> | null> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadGoalPath(threadId),
      'GET'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load thread goal'))
    }
    const body = readRuntimeJson<CoreThreadGoalResponseJson>(
      response.body,
      'runtime returned an invalid thread goal response'
    )
    return body.goal ? goalFromCore(body.goal) : null
  }

  async setThreadGoal(
    threadId: string,
    patch: {
      objective?: string
      status?: NonNullable<NormalizedThread['goal']>['status']
      tokenBudget?: number | null
    }
  ): Promise<NonNullable<NormalizedThread['goal']>> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadGoalPath(threadId),
      'POST',
      JSON.stringify(patch)
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to set thread goal'))
    }
    const body = readRuntimeJson<CoreThreadGoalResponseJson>(
      response.body,
      'runtime returned an invalid thread goal response'
    )
    if (!body.goal) {
      throw runtimeErrorToError({
        code: 'unknown',
        message: 'set thread goal returned an invalid response'
      })
    }
    return goalFromCore(body.goal)
  }

  async clearThreadGoal(threadId: string): Promise<boolean> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadGoalPath(threadId),
      'DELETE'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to clear thread goal'))
    }
    return readRuntimeJson<CoreClearThreadGoalResponseJson>(
      response.body,
      'runtime returned an invalid clear thread goal response'
    ).cleared
  }

  async getThreadTodos(threadId: string): Promise<NonNullable<NormalizedThread['todos']> | null> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadTodosPath(threadId),
      'GET'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load thread todos'))
    }
    const body = readRuntimeJson<CoreThreadTodosResponseJson>(
      response.body,
      'runtime returned an invalid thread todos response'
    )
    return body.todos ? todosFromCore(body.todos) : null
  }

  async setThreadTodos(
    threadId: string,
    todos: Parameters<NonNullable<AgentProvider['setThreadTodos']>>[1]
  ): Promise<NonNullable<NormalizedThread['todos']>> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadTodosPath(threadId),
      'POST',
      JSON.stringify({ todos })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to set thread todos'))
    }
    const body = readRuntimeJson<CoreThreadTodosResponseJson>(
      response.body,
      'runtime returned an invalid thread todos response'
    )
    if (!body.todos) {
      throw runtimeErrorToError({
        code: 'unknown',
        message: 'set thread todos returned an invalid response'
      })
    }
    return todosFromCore(body.todos)
  }

  async syncThreadTodosFromPlan(
    threadId: string,
    plan: Parameters<NonNullable<AgentProvider['syncThreadTodosFromPlan']>>[1]
  ): Promise<NonNullable<NormalizedThread['todos']>> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadTodosSyncPlanPath(threadId),
      'POST',
      JSON.stringify(plan)
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to sync plan todos'))
    }
    const body = readRuntimeJson<CoreThreadTodosResponseJson>(
      response.body,
      'runtime returned an invalid thread todos response'
    )
    if (!body.todos) {
      throw runtimeErrorToError({ code: 'unknown', message: 'sync plan todos returned no todos' })
    }
    return todosFromCore(body.todos)
  }

  async clearThreadTodos(threadId: string): Promise<boolean> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadTodosPath(threadId),
      'DELETE'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to clear thread todos'))
    }
    return readRuntimeJson<CoreClearThreadTodosResponseJson>(
      response.body,
      'runtime returned an invalid clear thread todos response'
    ).cleared
  }

  async submitApprovalDecision(
    approvalId: string,
    decision: 'allow' | 'deny',
    userInitiated = false
  ): Promise<'submitted' | 'cancelled'> {
    const protectedResult = await window.kunGui.resolveKunApproval({
      approvalId,
      decision,
      source: userInitiated ? 'user' : 'policy'
    })
    if (!protectedResult.confirmed) return 'cancelled'
    if (!protectedResult.response.ok) {
      throw runtimeErrorToError(readRuntimeError(
        protectedResult.response.body,
        'approval decision failed'
      ))
    }
    return 'submitted'
  }

  async submitUserInputResponse(inputId: string, answers: UserInputAnswer[]): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunUserInputPath(inputId),
      'POST',
      JSON.stringify({ answers })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'request_user_input response failed'))
    }
  }

  async cancelUserInput(inputId: string): Promise<void> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunUserInputPath(inputId),
      'POST',
      JSON.stringify({ cancelled: true })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'request_user_input cancel failed'))
    }
  }

}

function runtimeStateFromCore(state: CoreThreadRuntimeStateJson): ThreadRuntimeState {
  return {
    status: state.status,
    updatedAt: state.updatedAt,
    latestSeq: state.latestSeq,
    ...(typeof state.replayFloorSeq === 'number' ? { replayFloorSeq: state.replayFloorSeq } : {}),
    pendingUserInputIds: state.pendingUserInputIds,
    ...(state.latestTurn
      ? {
          latestTurnId: state.latestTurn.id,
          latestTurnStatus: state.latestTurn.status,
          latestTurnOrchestration: state.latestTurn.orchestration
        }
      : {})
  }
}
