import { uploadAttachmentViaDesktop } from './kun-runtime-attachment-upload'
import type {
  AgentProvider,
  ChatBlock,
  NormalizedThread,
  ReviewTarget,
  ThreadEventSink,
  ThreadUsageSnapshot,
  UserInputAnswer
} from './types'
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
  KUN_THREAD_GUARDIAN_PATH,
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
  kunThreadQueuedTurnsPath,
  kunThreadStatePath,
  kunThreadTimelinePath,
  kunThreadSteerPath,
  kunThreadTurnsPath,
  kunAttachmentContentPath,
  kunUserInputPath,
  kunMemoryRecordPath,
  kunMcpOAuthServerPath,
  kunSessionResumeMetadataPath,
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
  CoreQueuedTurnsResponseJson,
  CoreResumeSessionMetadataJson,
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
import { rendererRuntimeClient } from './runtime-client'
import type { ComposerContextAttachment } from '@kun/extension-api'
import type { DesignDocumentTarget } from './design-task-profile'

const MAX_PENDING_SSE_DISPATCH_BATCHES = 32

/** Preserves the native SSE failure status for the store's recovery policy. */
export class KunSseSubscriptionError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: 'replay_reset_required' | 'renderer_ack_timeout',
    readonly threadId?: string,
    readonly floorSeq?: number
  ) {
    super(message)
    this.name = 'KunSseSubscriptionError'
  }
}

function createSseStreamId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `sse-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function readRuntimeError(body: string, fallback: string): RuntimeError {
  return parseRuntimeErrorBody(body, fallback)
}

export function readRuntimeJson<T>(body: string, fallback: string): T {
  try {
    return JSON.parse(body) as T
  } catch {
    throw runtimeErrorToError({ code: 'unknown', message: fallback })
  }
}

export type CoreThreadGuardianResultJson = {
  checkedAt: string
  scannedThreads: number
  inconsistentThreads: number
  repairedThreads: number
  remainingIssues: Array<{ code: string; message: string; severity: 'warning' | 'error' }>
}

export class KunRuntimeProviderServices {
  async getRuntimeInfo(): Promise<CoreRuntimeInfoJson> {
    const response = await rendererRuntimeClient.runtimeRequest(KUN_RUNTIME_INFO_PATH, 'GET')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load runtime info'))
    }
    return readRuntimeJson<CoreRuntimeInfoJson>(
      response.body,
      'runtime returned an invalid runtime info response'
    )
  }

  async getToolDiagnostics(): Promise<CoreRuntimeToolDiagnosticsJson> {
    const response = await rendererRuntimeClient.runtimeRequest(KUN_RUNTIME_TOOLS_PATH, 'GET')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load runtime diagnostics'))
    }
    return readRuntimeJson<CoreRuntimeToolDiagnosticsJson>(
      response.body,
      'runtime returned an invalid runtime diagnostics response'
    )
  }

  async runThreadGuardian(): Promise<CoreThreadGuardianResultJson> {
    const response = await rendererRuntimeClient.runtimeRequest(KUN_THREAD_GUARDIAN_PATH, 'POST')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to run thread guardian'))
    }
    return readRuntimeJson<CoreThreadGuardianResultJson>(
      response.body,
      'runtime returned an invalid thread guardian response'
    )
  }

  async getMcpOAuthDiagnostics(): Promise<CoreMcpOAuthDiagnosticJson[]> {
    const response = await rendererRuntimeClient.runtimeRequest(KUN_MCP_OAUTH_PATH, 'GET')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load MCP OAuth diagnostics'))
    }
    return readRuntimeJson<CoreMcpOAuthDiagnosticsResponseJson>(
      response.body,
      'runtime returned an invalid MCP OAuth diagnostics response'
    ).servers
  }

  async clearMcpOAuthCredentials(serverId?: string): Promise<string[]> {
    const response = await rendererRuntimeClient.runtimeRequest(
      serverId ? kunMcpOAuthServerPath(serverId) : KUN_MCP_OAUTH_PATH,
      'DELETE'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to clear MCP OAuth credentials'))
    }
    return readRuntimeJson<CoreMcpOAuthClearResponseJson>(
      response.body,
      'runtime returned an invalid MCP OAuth reset response'
    ).cleared
  }

  async authorizeMcpOAuthCredentials(serverId: string): Promise<CoreMcpOAuthAuthorizeResponseJson> {
    const response = await rendererRuntimeClient.runtimeRequest(kunMcpOAuthServerPath(serverId), 'POST')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to authorize MCP OAuth connector'))
    }
    return readRuntimeJson<CoreMcpOAuthAuthorizeResponseJson>(
      response.body,
      'runtime returned an invalid MCP OAuth authorize response'
    )
  }

  async listSkills(): Promise<CoreRuntimeSkillJson[]> {
    const response = await rendererRuntimeClient.runtimeRequest(KUN_SKILLS_PATH, 'GET')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to list skills'))
    }
    return readRuntimeJson<CoreRuntimeSkillsResponseJson>(
      response.body,
      'runtime returned an invalid skills response'
    ).skills ?? []
  }

  async uploadAttachment(input: {
    name: string
    mimeType?: string
    dataBase64: string
    documentText?: string
    documentFormat?: 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'text' | 'csv' | 'json' | 'xml'
    sourceSha256?: string
    pageCount?: number
    localFilePath?: string
    textFallback?: CoreAttachmentTextFallbackJson
    visualPreview?: CoreAttachmentTextFallbackJson
    threadId?: string
    workspace?: string
  }): Promise<CoreAttachmentMetadataJson> {
    const desktopAttachment = await uploadAttachmentViaDesktop(input)
    if (desktopAttachment) return desktopAttachment
    if (!input.dataBase64) {
      throw new Error('Runtime attachment upload is unavailable.')
    }
    const response = await rendererRuntimeClient.runtimeRequest(
      KUN_ATTACHMENTS_PATH,
      'POST',
      JSON.stringify(input)
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'attachment upload failed'))
    }
    return readRuntimeJson<CoreAttachmentUploadResponseJson>(
      response.body,
      'runtime returned an invalid attachment upload response'
    ).attachment
  }

  async getAttachmentDiagnostics(): Promise<CoreAttachmentDiagnosticsJson> {
    const response = await rendererRuntimeClient.runtimeRequest(KUN_ATTACHMENT_DIAGNOSTICS_PATH, 'GET')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load attachment diagnostics'))
    }
    return readRuntimeJson<CoreAttachmentDiagnosticsJson>(
      response.body,
      'runtime returned an invalid attachment diagnostics response'
    )
  }

  async getAttachmentContent(
    attachmentId: string,
    options: { threadId?: string; workspace?: string } = {}
  ): Promise<CoreAttachmentContentResponseJson> {
    const query = buildQuery({
      thread_id: options.threadId,
      workspace: options.workspace
    })
    const response = await rendererRuntimeClient.runtimeRequest(
      `${kunAttachmentContentPath(attachmentId)}${query}`,
      'GET'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load attachment content'))
    }
    return readRuntimeJson<CoreAttachmentContentResponseJson>(
      response.body,
      'runtime returned an invalid attachment content response'
    )
  }

  async listMemories(options: { workspace?: string; project?: string; includeDeleted?: boolean; all?: boolean } = {}): Promise<CoreMemoryRecordJson[]> {
    const query = buildQuery({
      workspace: options.workspace,
      project: options.project,
      include_deleted: options.includeDeleted,
      all: options.all
    })
    const response = await rendererRuntimeClient.runtimeRequest(`${KUN_MEMORY_PATH}${query}`, 'GET')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to list memories'))
    }
    return readRuntimeJson<CoreMemoryListResponseJson>(
      response.body,
      'runtime returned an invalid memory list response'
    ).memories ?? []
  }

  async createMemory(input: {
    content: string
    scope?: 'user' | 'workspace' | 'project'
    workspace?: string
    project?: string
    tags?: string[]
    confidence?: number
    type?: CoreMemoryRecordJson['type']
    importance?: number
    observedAt?: string
    validFrom?: string
    validTo?: string
    expiresAt?: string
    disabled?: boolean
    sources?: Array<Omit<NonNullable<CoreMemoryRecordJson['sources']>[number], 'id'> & { id?: string }>
  }): Promise<CoreMemoryRecordJson> {
    const response = await rendererRuntimeClient.runtimeRequest(
      KUN_MEMORY_PATH,
      'POST',
      JSON.stringify(input)
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to create memory'))
    }
    return readRuntimeJson<{ memory: CoreMemoryRecordJson }>(
      response.body,
      'runtime returned an invalid memory response'
    ).memory
  }

  async updateMemory(
    memoryId: string,
    patch: { content?: string; tags?: string[]; confidence?: number; importance?: number; type?: CoreMemoryRecordJson['type']; disabled?: boolean },
    options: { workspace?: string; project?: string } = {}
  ): Promise<CoreMemoryRecordJson> {
    const query = buildQuery({ workspace: options.workspace, project: options.project })
    const response = await rendererRuntimeClient.runtimeRequest(
      `${kunMemoryRecordPath(memoryId)}${query}`,
      'PATCH',
      JSON.stringify(patch)
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to update memory'))
    }
    return readRuntimeJson<{ memory: CoreMemoryRecordJson }>(
      response.body,
      'runtime returned an invalid memory response'
    ).memory
  }

  async deleteMemory(memoryId: string, options: { workspace?: string; project?: string } = {}): Promise<CoreMemoryRecordJson> {
    const query = buildQuery({ workspace: options.workspace, project: options.project })
    const response = await rendererRuntimeClient.runtimeRequest(`${kunMemoryRecordPath(memoryId)}${query}`, 'DELETE')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to delete memory'))
    }
    return readRuntimeJson<{ memory: CoreMemoryRecordJson }>(
      response.body,
      'runtime returned an invalid memory response'
    ).memory
  }

  async getMemoryDiagnostics(): Promise<CoreMemoryDiagnosticsJson> {
    const response = await rendererRuntimeClient.runtimeRequest(KUN_MEMORY_DIAGNOSTICS_PATH, 'GET')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'failed to load memory diagnostics'))
    }
    return readRuntimeJson<CoreMemoryDiagnosticsJson>(
      response.body,
      'runtime returned an invalid memory diagnostics response'
    )
  }

  async forkThread(
    threadId: string,
    options?: {
      relation?: 'primary' | 'fork' | 'side'
      title?: string
      turnId?: string
      workspace?: string
      designDocumentTarget?: DesignDocumentTarget
      designCloneOperationId?: string
    }
  ): Promise<NormalizedThread> {
    const body: Record<string, unknown> = {}
    if (options?.relation) body.relation = options.relation
    if (options?.title) body.title = options.title
    if (options?.turnId) body.turnId = options.turnId
    if (options?.workspace) body.workspace = options.workspace
    if (options?.designDocumentTarget) body.designDocumentTarget = options.designDocumentTarget
    if (options?.designCloneOperationId) body.designCloneOperationId = options.designCloneOperationId
    const url = kunThreadForkPath(threadId)
    const response =
      Object.keys(body).length > 0
        ? await rendererRuntimeClient.runtimeRequest(url, 'POST', JSON.stringify(body))
        : await rendererRuntimeClient.runtimeRequest(url, 'POST')
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'fork thread failed'))
    }
    return threadFromCore(readRuntimeJson<CoreThreadJson>(
      response.body,
      'runtime returned an invalid thread response'
    ))
  }

  async resumeSession(
    sessionId: string,
    options?: {
      model?: string
      mode?: KunThreadMode
      workspace?: string
      designDocumentTarget?: DesignDocumentTarget
      designCloneOperationId?: string
    }
  ): Promise<{ threadId: string; sessionId: string }> {
    const settings = await rendererRuntimeClient.getSettings()
    const runtime = getKunRuntimeSettings(settings)
    const response = await rendererRuntimeClient.runtimeRequest(
      kunSessionResumePath(sessionId),
      'POST',
      JSON.stringify({
        workspace: (options?.workspace ?? settings.workspaceRoot) || undefined,
        model: options?.model?.trim() || runtime.model,
        mode: options?.mode,
        designDocumentTarget: options?.designDocumentTarget,
        designCloneOperationId: options?.designCloneOperationId
      })
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'resume session failed'))
    }
    const body = readRuntimeJson<CoreResumeSessionResponseJson>(
      response.body,
      'runtime returned an invalid resume session response'
    )
    const threadId = body.thread_id ?? body.threadId
    if (!threadId) {
      throw runtimeErrorToError({
        code: 'unknown',
        message: 'resume session returned an invalid response'
      })
    }
    return { threadId, sessionId: body.session_id ?? body.sessionId ?? sessionId }
  }

  async getResumeSessionMetadata(sessionId: string): Promise<CoreResumeSessionMetadataJson> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunSessionResumeMetadataPath(sessionId),
      'GET'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'read resume session metadata failed'))
    }
    return readRuntimeJson<CoreResumeSessionMetadataJson>(
      response.body,
      'runtime returned invalid resume session metadata'
    )
  }

  async getQueuedTurns(threadId: string): Promise<CoreQueuedTurnsResponseJson> {
    const response = await rendererRuntimeClient.runtimeRequest(
      kunThreadQueuedTurnsPath(threadId),
      'GET'
    )
    if (!response.ok) {
      throw runtimeErrorToError(readRuntimeError(response.body, 'read queued turns failed'))
    }
    return readRuntimeJson<CoreQueuedTurnsResponseJson>(
      response.body,
      'runtime returned invalid queued turns'
    )
  }

  async subscribeThreadEvents(
    threadId: string,
    sinceSeq: number,
    sink: ThreadEventSink,
    signal: AbortSignal
  ): Promise<void> {
    const streamId = createSseStreamId()
    await new Promise<void>(async (resolve) => {
      let settled = false
      let dispatchTail: Promise<void> = Promise.resolve()
      let queuedDispatchBatches = 0
      // The subscription cursor is also the projection high-water mark.  A
      // reconnect may replay already persisted non-delta events (tool running,
      // completion, approval, Graph activity, ...), so filter the whole wire
      // event before normalization.  This keeps reducer work and side effects
      // behind the same monotonic gate instead of deduplicating text only.
      let projectionSeqHighWater = sinceSeq
      let replaySynchronized = false
      const finish = (): void => {
        if (settled) return
        settled = true
        offData()
        offEnd()
        offErr()
        offOpen()
        signal.removeEventListener('abort', onAbort)
        void dispatchTail.finally(() => resolve())
      }
      const offData = rendererRuntimeClient.onSseEvent((payload) => {
        if (payload.streamId !== streamId) return
        // Older main processes (pre-batching) deliver a single event under
        // `data`; accept both shapes so a stale main/renderer pair during a
        // dev reload or partial update degrades gracefully instead of
        // silently dropping the stream.
        const legacySingle = (payload as { data?: unknown }).data
        const rawEvents = Array.isArray(payload.events)
          ? payload.events
          : legacySingle !== undefined
            ? [legacySingle]
            : []
        const batch = rawEvents.map((entry): CoreRuntimeEventJson =>
          entry && typeof entry === 'object' ? (entry as CoreRuntimeEventJson) : {}
        )
        if (batch.length === 0) return
        if (queuedDispatchBatches >= MAX_PENDING_SSE_DISPATCH_BATCHES) {
          sink.onError(new Error('SSE renderer dispatch backlog exceeded its safety limit'))
          void rendererRuntimeClient.stopSse(streamId)
          finish()
          return
        }
        // Keep batches strictly ordered. The main process reads no further SSE
        // data until this batch is acknowledged, so dispatch must not fan out
        // into an unbounded renderer-side promise set.
        queuedDispatchBatches += 1
        const task = dispatchTail.then(async () => {
          if (signal.aborted || settled) return
          let acceptedSegment: CoreRuntimeEventJson[] = []
          let acceptedMaxSeq: number | null = null
          let heartbeatSeq: number | null = null
          let synchronizedSeq: number | null = null
          let candidateSeqHighWater = projectionSeqHighWater
          const flushAcceptedSegment = async (): Promise<void> => {
            if (acceptedSegment.length === 0) return
            const segment = acceptedSegment
            acceptedSegment = []
            await dispatchKunRuntimeEvents(segment, sink, (runtimeEvent, eventSink) =>
              this.handleApprovalRequest(runtimeEvent, eventSink)
            )
          }
          for (const event of batch) {
            if (event.kind === 'replay_synchronized') {
              const cursor = event.cursor
              if (
                replaySynchronized ||
                event.threadId !== threadId ||
                typeof cursor !== 'number' ||
                !Number.isSafeInteger(cursor) ||
                cursor < 0
              ) {
                continue
              }
              // The marker is an ordering barrier, not a projected runtime
              // event. Apply every replay event before revealing the thread,
              // then process any live events that followed it in this batch.
              await flushAcceptedSegment()
              if (signal.aborted || settled) return
              candidateSeqHighWater = Math.max(candidateSeqHighWater, cursor)
              sink.onSeq(cursor)
              sink.onReplaySynchronized?.(cursor)
              synchronizedSeq = cursor
              replaySynchronized = true
              continue
            }
            if (typeof event.seq === 'number') {
              if (event.seq <= candidateSeqHighWater) {
                // Heartbeats deliberately reuse the current event cursor. They
                // are stale for projection purposes, but still prove that the
                // live stream is healthy and must keep the busy watchdog from
                // aborting a quiet, long-running tool call.
                if (event.kind === 'heartbeat') {
                  heartbeatSeq = Math.max(heartbeatSeq ?? event.seq, event.seq)
                }
                continue
              }
              candidateSeqHighWater = event.seq
              acceptedMaxSeq = event.seq
            }
            acceptedSegment.push(event)
          }
          await flushAcceptedSegment()
          if (signal.aborted || settled) return
          // Commit the local replay gate only after every accepted event was
          // projected. If a reducer/effect throws, the unadvanced cursor lets
          // recovery replay the whole unacknowledged batch.
          projectionSeqHighWater = candidateSeqHighWater
          // Commit the renderer cursor only after the whole ordered batch has
          // been projected. ACK is flow control for the main process and must
          // never precede the renderer's durable in-memory projection.
          const observedSeq = acceptedMaxSeq ?? heartbeatSeq
          if (observedSeq !== null && (synchronizedSeq === null || observedSeq > synchronizedSeq)) {
            sink.onSeq(observedSeq)
          }
          if (signal.aborted || settled) return
          if (payload.batchId) {
            await rendererRuntimeClient.ackSse(streamId, payload.batchId)
          }
        }).catch((error) => {
          if (!settled) {
            sink.onError(error instanceof Error ? error : new Error(String(error)))
            void rendererRuntimeClient.stopSse(streamId)
            finish()
          }
        })
        dispatchTail = task
        void task.finally(() => {
          queuedDispatchBatches = Math.max(0, queuedDispatchBatches - 1)
        })
      })
      const offErr = rendererRuntimeClient.onSseError(({
        streamId: sid,
        message,
        status,
        code,
        threadId: resetThreadId,
        floorSeq
      }) => {
        if (sid !== streamId) return
        sink.onError(new KunSseSubscriptionError(
          message ?? `sse error ${status ?? ''}`,
          status,
          code,
          resetThreadId,
          floorSeq
        ))
        finish()
      })
      const offEnd = rendererRuntimeClient.onSseEnd(({ streamId: sid }) => {
        if (sid !== streamId) return
        finish()
      })
      const offOpen = rendererRuntimeClient.onSseOpen(({ streamId: sid }) => {
        if (sid !== streamId || settled || signal.aborted) return
        sink.onConnected?.()
      })
      const onAbort = (): void => {
        void rendererRuntimeClient.stopSse(streamId)
        finish()
      }
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        await rendererRuntimeClient.startSse(threadId, sinceSeq, streamId, { acknowledgedBatches: true })
      } catch (error) {
        sink.onError(error instanceof Error ? error : new Error(String(error)))
        finish()
      }
    })
    void rendererRuntimeClient.stopSse(streamId)
  }

  private async handleApprovalRequest(event: CoreRuntimeEventJson, sink: ThreadEventSink): Promise<void> {
    const approvalId = event.approvalId ?? event.itemId ?? ''
    if (!approvalId) return
    // Automatic review is owned by Kun and is deliberately not resolvable
    // through the user approval surface. Missing reviewer identity is legacy
    // manual review; never infer it from mutable global settings because the
    // emitting thread owns an immutable authority snapshot.
    if (event.approvalReviewer === 'agent') return
    sink.onApproval({
      approvalId,
      turnId: event.turnId,
      createdAt: event.timestamp,
      summary: event.summary ?? 'Approval required',
      toolName: event.toolName,
      ...(event.child ? { meta: { child: event.child } } : {})
    })
  }
}
