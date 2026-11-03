import { z, type ZodType } from 'zod'
import { randomUUID } from 'node:crypto'
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
import { KunTuiClientRuntimeApi } from './client-runtime-api.js'
import { abortableDelay, responseError, segment } from './client-utils.js'

export class KunTuiClientModelApi extends KunTuiClientRuntimeApi {
  modelConnections() {
    if (this.modelConnectionTransport) return this.modelConnectionTransport.modelConnections()
    return this.request('/v1/model-connections', ModelConnectionSnapshotSchema)
  }

  async subscribeModelConnections(input: {
    sinceRevision: number
    sinceMetadataRevision?: number
    signal: AbortSignal
    onSnapshot: (snapshot: z.infer<typeof ModelConnectionSnapshotSchema>) => void | Promise<void>
    onError?: (error: Error) => void
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  }): Promise<void> {
    if (this.modelConnectionTransport) return this.modelConnectionTransport.subscribeModelConnections(input)
    let revision = Math.max(0, input.sinceRevision)
    let metadataRevision = Math.max(0, input.sinceMetadataRevision ?? 0)
    let failures = 0
    const sleep = input.sleep ?? abortableDelay
    while (!input.signal.aborted) {
      try {
        await this.refreshConnection()
        const response = await this.fetchImpl(
          `${this.baseUrl}/v1/model-connections/events?since_revision=${revision}&since_metadata_revision=${metadataRevision}`,
          {
            headers: this.headers({ Accept: 'text/event-stream', 'Last-Event-ID': `${revision}:${metadataRevision}` }),
            signal: input.signal
          }
        )
        if (!response.ok || !response.body) {
          throw await responseError(response, '/v1/model-connections/events', this.runtimeToken)
        }
        failures = 0
        const parser = new IncrementalSseParser()
        const reader = response.body.getReader()
        const consume = async (frames: ReturnType<IncrementalSseParser['push']>): Promise<void> => {
          for (const frame of frames) {
            if (frame.event !== 'model_connections' || !frame.data.trim()) continue
            let body: unknown
            try { body = JSON.parse(frame.data) } catch { throw new Error('model connection stream returned invalid JSON') }
            const snapshot = ModelConnectionSnapshotSchema.parse(body)
            if (snapshot.revision <= revision && (snapshot.metadataRevision ?? 0) <= metadataRevision) continue
            revision = snapshot.revision
            metadataRevision = snapshot.metadataRevision ?? 0
            await input.onSnapshot(snapshot)
          }
        }
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            await consume(parser.push(value))
          }
          await consume(parser.finish())
        } finally {
          await reader.cancel().catch(() => undefined)
          reader.releaseLock()
        }
      } catch (error) {
        if (input.signal.aborted) return
        input.onError?.(error instanceof Error ? error : new Error(String(error)))
        failures += 1
      }
      if (input.signal.aborted) return
      await sleep(Math.min(5_000, 200 * 2 ** Math.min(failures, 5)), input.signal)
    }
  }

  connectModel(input: z.input<typeof ModelConnectionConnectRequestSchema>) {
    if (this.modelConnectionTransport) return this.modelConnectionTransport.connectModel(input)
    return this.request('/v1/model-connections/connect', ModelConnectionSnapshotSchema, {
      method: 'POST',
      body: ModelConnectionConnectRequestSchema.parse(input)
    })
  }

  patchModel(providerId: string, input: z.input<typeof ModelConnectionPatchRequestSchema>) {
    if (this.modelConnectionTransport) return this.modelConnectionTransport.patchModel(providerId, input)
    return this.request(`/v1/model-connections/${segment(providerId)}`, ModelConnectionSnapshotSchema, {
      method: 'PATCH',
      body: ModelConnectionPatchRequestSchema.parse(input)
    })
  }

  replaceModelCredential(providerId: string, input: z.input<typeof ModelConnectionCredentialRequestSchema>) {
    if (this.modelConnectionTransport) return this.modelConnectionTransport.replaceModelCredential(providerId, input)
    return this.request(`/v1/model-connections/${segment(providerId)}/credential`, ModelConnectionSnapshotSchema, {
      method: 'PUT',
      body: ModelConnectionCredentialRequestSchema.parse(input)
    })
  }

  deleteModel(providerId: string, expectedRevision: number) {
    if (this.modelConnectionTransport) return this.modelConnectionTransport.deleteModel(providerId, expectedRevision)
    return this.request(
      `/v1/model-connections/${segment(providerId)}?expected_revision=${expectedRevision}`,
      ModelConnectionSnapshotSchema,
      { method: 'DELETE' }
    )
  }

  probeModel(providerId: string) {
    if (this.modelConnectionTransport) return this.modelConnectionTransport.probeModel(providerId)
    return this.request(
      `/v1/model-connections/${segment(providerId)}/probe`,
      z.object({ ok: z.literal(true), models: z.array(z.string()) }),
      { method: 'POST' }
    )
  }

  selectModel(input: z.input<typeof ModelConnectionSelectRequestSchema>) {
    if (this.modelConnectionTransport) return this.modelConnectionTransport.selectModel(input)
    return this.request('/v1/model-connections/select', ModelConnectionSnapshotSchema, {
      method: 'POST',
      body: ModelConnectionSelectRequestSchema.parse(input)
    })
  }

  completeModelCliAuth(input: z.input<typeof ModelConnectionCliAuthRequestSchema>) {
    if (this.modelConnectionTransport) return this.modelConnectionTransport.completeModelCliAuth(input)
    return this.request('/v1/model-connections/cli/complete', ModelConnectionSnapshotSchema, {
      method: 'POST',
      body: ModelConnectionCliAuthRequestSchema.parse(input)
    })
  }

  startModelOAuth(input: z.input<typeof ModelConnectionOAuthStartRequestSchema>) {
    if (this.modelConnectionTransport) return this.modelConnectionTransport.startModelOAuth(input)
    return this.request('/v1/model-connections/oauth/start', ModelConnectionOAuthStatusSchema, {
      method: 'POST',
      body: ModelConnectionOAuthStartRequestSchema.parse(input)
    })
  }

  modelOAuthStatus(sessionId: string) {
    if (this.modelConnectionTransport) return this.modelConnectionTransport.modelOAuthStatus(sessionId)
    return this.request(`/v1/model-connections/oauth/${segment(sessionId)}`, ModelConnectionOAuthStatusSchema)
  }

  submitModelOAuth(sessionId: string, code: string) {
    if (this.modelConnectionTransport) return this.modelConnectionTransport.submitModelOAuth(sessionId, code)
    return this.request(
      `/v1/model-connections/oauth/${segment(sessionId)}/submit`,
      ModelConnectionOAuthStatusSchema,
      {
        method: 'POST',
        body: ModelConnectionOAuthSubmitRequestSchema.parse({ code })
      }
    )
  }

  cancelModelOAuth(sessionId: string) {
    if (this.modelConnectionTransport) return this.modelConnectionTransport.cancelModelOAuth(sessionId)
    return this.request(`/v1/model-connections/oauth/${segment(sessionId)}`, ModelConnectionOAuthStatusSchema, {
      method: 'DELETE'
    })
  }

  claudeSdkStatus() {
    if (this.modelConnectionTransport) return this.modelConnectionTransport.claudeSdkStatus()
    return this.request('/v1/model-connections/claude/sdk', ClaudeSdkInstallStatusSchema)
  }

  installClaudeSdk() {
    if (this.modelConnectionTransport) return this.modelConnectionTransport.installClaudeSdk()
    return this.request('/v1/model-connections/claude/sdk/install', ClaudeSdkInstallStatusSchema, {
      method: 'POST'
    })
  }

  async closeModelConnections(): Promise<void> {
    await this.modelConnectionTransport?.close?.()
  }
}
