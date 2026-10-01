import { z, type ZodType } from 'zod'
import { randomUUID } from 'node:crypto'
import { ExecutionTaskSchema, CreateExecutionTaskSchema, UpdateExecutionTaskSchema } from '../contracts/execution-tasks.js'
import {
  ApprovalDecisionResponse,
  AttachmentReleaseResponse,
  AttachmentUploadRequest,
  AttachmentUploadResponse,
  BackgroundShellListResponse,
  BackgroundShellRecord,
  BackgroundShellStopResponse,
  ClearThreadGoalResponse,
  ClearThreadTodosResponse,
  CompactResponse,
  ClaudeSdkInstallStatusSchema,
  CreateThreadRequest,
  DeleteThreadResponse,
  ForkThreadRequest,
  GraphRunStatusSchema,
  GraphRunV1Schema,
  ListThreadsResponse,
  ModelConnectionConnectRequestSchema,
  ModelConnectionCliAuthRequestSchema,
  ModelConnectionCredentialRequestSchema,
  ModelConnectionOAuthStartRequestSchema,
  ModelConnectionOAuthStatusSchema,
  ModelConnectionOAuthSubmitRequestSchema,
  ModelConnectionPatchRequestSchema,
  ModelConnectionSelectRequestSchema,
  ModelConnectionSnapshotSchema,
  McpServerConfig,
  MemoryCreateRequest,
  MemoryRecord,
  MemoryUpdateRequest,
  RuntimeInfoResponse,
  RuntimeConfigApplyRequest,
  RuntimeConfigApplyResponse,
  ReplaceSteeringRequest,
  SetThreadGoalRequest,
  SetThreadTodosRequest,
  StartTurnRequest,
  StartTurnResponse,
  SteeringQueueResponse,
  ThreadGoalResponse,
  ThreadSchema,
  ThreadTodosResponse,
  ThreadUsageResponseSchema,
  ProviderQuotaListResponseSchema,
  UpdateThreadRequest,
  UserInputAnswerSchema,
  type ApprovalDecisionRequest,
  type CreateThreadRequest as CreateThreadRequestValue,
  type RuntimeEvent as RuntimeEventValue,
  type StartTurnRequest as StartTurnRequestValue,
  type ThreadRecord,
  type ThreadSummary
} from '../contracts/index.js'
import { createApprovalConsentToken, KUN_APPROVAL_CONSENT_HEADER } from '../server/approval-consent.js'
import { isLoopbackHost } from '../server/loopback-host.js'
import { readRuntimeDiscovery, type RuntimeDiscoveryRecord } from '../server/runtime-discovery.js'
import { ensureSharedRuntime, runtimeDiscoveryDirectory } from '../cli/shared-runtime.js'
import {
  allowsDevelopmentManagerBootstrap,
  runtimeBuildIdForFlavor
} from '../cli/runtime-flavor.js'
import { readRuntimeBuildIdForEntry } from '../server/runtime-build-identity.js'
import type { TuiOptions } from './options.js'
import { defaultKunControlDir } from '../manager/manager-discovery.js'
import { ensureServiceManager } from '../manager/manager-client.js'
import { IncrementalSseParser, parseRuntimeEventFrame } from './sse.js'
import { ThreadDetailResponse, UserInputResolutionResponse, RuntimeToolsResponse, SkillsResponse, DelegationDiagnosticsResponse, MemoryListResponse, MemoryResponse, DelegationAbortResponse, DelegationDetachResponse, McpOAuthServer, McpOAuthDiagnosticsResponse, McpOAuthAuthorizeResponse, McpOAuthClearResponse, McpConfigResponse, ExtensionVersion, ExtensionEntry, ExtensionListResponse, ExtensionChangedResponse, ExtensionVersionMutationResponse, ExtensionInspectionResponse, ExtensionDiagnosticResponse, ExtensionJob, ExtensionJobsResponse, ExtensionJobCancelResponse, GraphAvailabilityResponse, GraphRunSummary, GraphRunsResponse, PublicGraphRunResponse } from './client-schemas.js'
import { KunTuiClientModelApi } from './client-model-api.js'
import { isTerminalGraphStatus } from './client-utils.js'
import { segment } from './client-utils.js'
import type { ThreadDetail, UserInputAnswer } from './client-schemas.js'

export class KunTuiClientThreadApi extends KunTuiClientModelApi {
  async listThreads(input: {
    search?: string
    includeArchived?: boolean
    archivedOnly?: boolean
    includeSide?: boolean
    limit?: number
  } = {}): Promise<ThreadSummary[]> {
    const query = new URLSearchParams()
    if (input.search) query.set('search', input.search)
    if (input.includeArchived) query.set('include_archived', 'true')
    if (input.archivedOnly) query.set('archived_only', 'true')
    if (input.includeSide) query.set('include', 'side')
    if (input.limit) query.set('limit', String(input.limit))
    const suffix = query.size ? `?${query}` : ''
    return (await this.request(`/v1/threads${suffix}`, ListThreadsResponse)).threads
  }

  getThread(threadId: string): Promise<ThreadDetail> {
    return this.request(`/v1/threads/${segment(threadId)}`, ThreadDetailResponse)
  }

  createThread(input: CreateThreadRequestValue): Promise<ThreadRecord> {
    return this.request('/v1/threads', ThreadSchema, { method: 'POST', body: CreateThreadRequest.parse(input) })
  }

  updateThread(threadId: string, input: z.input<typeof UpdateThreadRequest>): Promise<ThreadRecord> {
    return this.request(`/v1/threads/${segment(threadId)}`, ThreadSchema, {
      method: 'PATCH',
      body: UpdateThreadRequest.parse(input)
    })
  }

  deleteThread(threadId: string) {
    return this.request(`/v1/threads/${segment(threadId)}`, DeleteThreadResponse, { method: 'DELETE' })
  }

  forkThread(threadId: string, input: z.input<typeof ForkThreadRequest> = {}): Promise<ThreadRecord> {
    return this.request(`/v1/threads/${segment(threadId)}/fork`, ThreadSchema, {
      method: 'POST',
      body: input ?? {}
    })
  }

  threadGoal(threadId: string) {
    return this.request(`/v1/threads/${segment(threadId)}/goal`, ThreadGoalResponse)
  }

  setThreadGoal(threadId: string, input: z.input<typeof SetThreadGoalRequest>) {
    return this.request(`/v1/threads/${segment(threadId)}/goal`, ThreadGoalResponse, {
      method: 'POST', body: SetThreadGoalRequest.parse(input)
    })
  }

  clearThreadGoal(threadId: string) {
    return this.request(`/v1/threads/${segment(threadId)}/goal`, ClearThreadGoalResponse, {
      method: 'DELETE'
    })
  }

  threadTodos(threadId: string) {
    return this.request(`/v1/threads/${segment(threadId)}/todos`, ThreadTodosResponse)
  }

  listExecutionTasks(threadId: string, cursor?: string) {
    const query = new URLSearchParams({ limit: '100', ...(cursor ? { cursor } : {}) })
    return this.request(`/v1/threads/${segment(threadId)}/tasks?${query}`, z.object({
      tasks: z.array(ExecutionTaskSchema), revision: z.number(), runnable: z.array(z.string()), nextCursor: z.string().optional()
    }))
  }

  createExecutionTask(threadId: string, input: z.input<typeof CreateExecutionTaskSchema>) {
    return this.request(`/v1/threads/${segment(threadId)}/tasks`, z.object({ task: ExecutionTaskSchema, replayed: z.boolean() }),
      { method: 'POST', body: CreateExecutionTaskSchema.parse(input) })
  }

  updateExecutionTask(threadId: string, taskId: string, input: z.input<typeof UpdateExecutionTaskSchema>) {
    return this.request(`/v1/threads/${segment(threadId)}/tasks/${segment(taskId)}`, z.object({ task: ExecutionTaskSchema, replayed: z.boolean() }),
      { method: 'PATCH', body: UpdateExecutionTaskSchema.parse(input) })
  }

  setThreadTodos(threadId: string, input: z.input<typeof SetThreadTodosRequest>) {
    return this.request(`/v1/threads/${segment(threadId)}/todos`, ThreadTodosResponse, {
      method: 'POST',
      body: SetThreadTodosRequest.parse(input)
    })
  }

  clearThreadTodos(threadId: string) {
    return this.request(`/v1/threads/${segment(threadId)}/todos`, ClearThreadTodosResponse, {
      method: 'DELETE'
    })
  }

  startTurn(threadId: string, input: StartTurnRequestValue) {
    return this.request(`/v1/threads/${segment(threadId)}/turns`, StartTurnResponse, {
      method: 'POST',
      body: StartTurnRequest.parse(input)
    })
  }

  graphAvailability() {
    return this.request('/v1/graphs/diagnostics', GraphAvailabilityResponse)
  }

  async listGraphRuns(threadId: string) {
    const summaries: z.infer<typeof GraphRunSummary>[] = []
    const seenCursors = new Set<string>()
    let cursor: string | undefined
    do {
      const page = await this.request(
        `/v1/graphs?thread_id=${encodeURIComponent(threadId)}&limit=100${
          cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
        }`,
        GraphRunsResponse
      )
      summaries.push(...page.runs)
      cursor = page.nextCursor
      if (cursor && seenCursors.has(cursor)) {
        throw new Error('Kun runtime repeated a Graph list cursor')
      }
      if (cursor) seenCursors.add(cursor)
    } while (cursor)
    const selected = summaries.sort((left, right) =>
      Number(isTerminalGraphStatus(left.status)) - Number(isTerminalGraphStatus(right.status)) ||
      right.updatedAt.localeCompare(left.updatedAt) ||
      left.id.localeCompare(right.id)
    )[0]
    return selected ? [await this.getGraphRun(selected.id)] : []
  }

  getGraphRun(runId: string) {
    return this.request(`/v1/graphs/${segment(runId)}`, PublicGraphRunResponse)
  }

  steerGraphRun(runId: string, text: string) {
    const commandId = `tui_steer_${randomUUID()}`
    return this.request(`/v1/graphs/${segment(runId)}/steer`, PublicGraphRunResponse, {
      method: 'POST',
      body: {
        commandId,
        idempotencyKey: commandId,
        target: { kind: 'run' },
        text
      }
    })
  }

  steerTurn(threadId: string, turnId: string, text: string): Promise<{ ok: boolean }> {
    return this.request(`/v1/threads/${segment(threadId)}/turns/${segment(turnId)}/steer`, z.object({ ok: z.boolean() }), {
      method: 'POST',
      body: { text }
    })
  }

  steeringQueue(threadId: string, turnId: string) {
    return this.request(
      `/v1/threads/${segment(threadId)}/turns/${segment(turnId)}/steering`,
      SteeringQueueResponse
    )
  }

  replaceSteeringQueue(
    threadId: string,
    turnId: string,
    input: z.input<typeof ReplaceSteeringRequest>
  ) {
    return this.request(
      `/v1/threads/${segment(threadId)}/turns/${segment(turnId)}/steering`,
      SteeringQueueResponse,
      { method: 'PATCH', body: ReplaceSteeringRequest.parse(input) }
    )
  }

  interruptTurn(threadId: string, turnId: string, discard = false) {
    return this.request(
      `/v1/threads/${segment(threadId)}/turns/${segment(turnId)}/interrupt`,
      z.object({ threadId: z.string(), turnId: z.string(), status: z.string() }),
      { method: 'POST', body: { discard } }
    )
  }

  compactThread(threadId: string, reason = 'manual terminal compaction') {
    return this.request(`/v1/threads/${segment(threadId)}/compact`, CompactResponse, {
      method: 'POST',
      body: { reason }
    })
  }

  decideApproval(approvalId: string, decision: ApprovalDecisionRequest['decision']) {
    const headers: Record<string, string> = {}
    if (this.runtimeToken) {
      headers[KUN_APPROVAL_CONSENT_HEADER] = createApprovalConsentToken({
        runtimeToken: this.runtimeToken,
        approvalId,
        decision,
        expiresAt: Date.now() + 30_000
      })
    }
    return this.request(`/v1/approvals/${segment(approvalId)}`, ApprovalDecisionResponse, {
      method: 'POST',
      body: { decision },
      headers
    })
  }

  resolveUserInput(inputId: string, answers: UserInputAnswer[]) {
    return this.request(`/v1/user-inputs/${segment(inputId)}`, UserInputResolutionResponse, {
      method: 'POST',
      body: { answers }
    })
  }

  cancelUserInput(inputId: string) {
    return this.request(`/v1/user-inputs/${segment(inputId)}`, UserInputResolutionResponse, {
      method: 'POST',
      body: { cancelled: true }
    })
  }

  usage() {
    return this.request('/v1/usage?group_by=thread', ThreadUsageResponseSchema)
  }

  providerQuotas() {
    return this.request('/v1/provider-quotas', ProviderQuotaListResponseSchema)
  }
}
