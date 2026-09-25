import { uploadAttachmentViaDesktop } from './kun-runtime-attachment-upload'
import type { NormalizedThread, ThreadEventSink } from './types'
import { getKunRuntimeSettings } from '@shared/app-settings-kun-defaults'
import {
  KUN_ATTACHMENT_DIAGNOSTICS_PATH,
  KUN_ATTACHMENTS_PATH,
  KUN_MEMORY_DIAGNOSTICS_PATH,
  KUN_MEMORY_PATH,
  KUN_MCP_OAUTH_PATH,
  KUN_RUNTIME_INFO_PATH,
  KUN_RUNTIME_TOOLS_PATH,
  KUN_THREAD_GUARDIAN_PATH,
  KUN_SKILLS_PATH,
  kunThreadForkPath,
  kunThreadQueuedTurnsPath,
  kunAttachmentContentPath,
  kunMemoryRecordPath,
  kunMcpOAuthServerPath,
  kunSessionResumeMetadataPath,
  kunSessionResumePath,
  type KunThreadMode
} from '@shared/kun-endpoints'
import { parseRuntimeErrorBody, runtimeErrorToError, type RuntimeError } from '@shared/runtime-error'
import type {
  CoreAttachmentDiagnosticsJson,
  CoreAttachmentContentResponseJson,
  CoreAttachmentMetadataJson,
  CoreAttachmentTextFallbackJson,
  CoreAttachmentUploadResponseJson,
  CoreMemoryDiagnosticsJson,
  CoreMemoryListResponseJson,
  CoreMemoryRecordJson,
  CoreMcpOAuthAuthorizeResponseJson,
  CoreMcpOAuthClearResponseJson,
  CoreMcpOAuthDiagnosticJson,
  CoreMcpOAuthDiagnosticsResponseJson,
  CoreQueuedTurnsResponseJson,
  CoreResumeSessionMetadataJson,
  CoreResumeSessionResponseJson,
  CoreRuntimeInfoJson,
  CoreRuntimeSkillJson,
  CoreRuntimeSkillsResponseJson,
  CoreRuntimeToolDiagnosticsJson,
  CoreThreadJson
} from './kun-contract'
import {
  decideRuntimeMemoryCandidate,
  listRuntimeMemoryCandidates
} from './kun-runtime-memory-distillation'
import {
  confirmRuntimeMemory,
  correctRuntimeMemory
} from './kun-runtime-memory-feedback'
import { buildQuery, threadFromCore } from './kun-mapper'
import { subscribeKunThreadEvents } from './kun-runtime-sse-subscription'
import { rendererRuntimeClient } from './runtime-client'
import type { DesignDocumentTarget } from './design-task-profile'

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

  confirmMemory = confirmRuntimeMemory

  correctMemory = correctRuntimeMemory

  listMemoryDistillationCandidates = listRuntimeMemoryCandidates

  decideMemoryDistillationCandidate = decideRuntimeMemoryCandidate

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
    return subscribeKunThreadEvents(threadId, sinceSeq, sink, signal)
  }
}
