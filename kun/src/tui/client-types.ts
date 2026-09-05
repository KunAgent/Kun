import { z, type ZodType } from 'zod'
import { randomUUID } from 'node:crypto'
import type { ClientOwnedRuntimeHandle } from '../cli/client-owned-runtime.js'
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
export type TuiConnection = {
  baseUrl: string
  runtimeToken: string
  runtimeInfo: z.infer<typeof RuntimeInfoResponse>
  discovered: boolean
  /** Verified pre-discovery GUI runtime with no shared model-connection API. */
  legacyGui?: boolean
  /** Present only when this TUI invocation started and owns the Runtime. */
  ownedRuntime?: ClientOwnedRuntimeHandle
}

/**
 * Model connection operations can be provided by the shared runtime HTTP API
 * or, during a rolling upgrade, by the local compatibility coordinator that
 * writes the same protected registry and hot-applies the verified legacy
 * runtime. Thread/session operations always remain HTTP/SSE runtime calls.
 */
export type ModelConnectionTransport = {
  modelConnections(): Promise<z.infer<typeof ModelConnectionSnapshotSchema>>
  subscribeModelConnections(input: {
    sinceRevision: number
    signal: AbortSignal
    onSnapshot: (snapshot: z.infer<typeof ModelConnectionSnapshotSchema>) => void | Promise<void>
    onError?: (error: Error) => void
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  }): Promise<void>
  connectModel(input: z.input<typeof ModelConnectionConnectRequestSchema>): Promise<z.infer<typeof ModelConnectionSnapshotSchema>>
  patchModel(providerId: string, input: z.input<typeof ModelConnectionPatchRequestSchema>): Promise<z.infer<typeof ModelConnectionSnapshotSchema>>
  replaceModelCredential(providerId: string, input: z.input<typeof ModelConnectionCredentialRequestSchema>): Promise<z.infer<typeof ModelConnectionSnapshotSchema>>
  deleteModel(providerId: string, expectedRevision: number): Promise<z.infer<typeof ModelConnectionSnapshotSchema>>
  probeModel(providerId: string): Promise<{ ok: true; models: string[] }>
  selectModel(input: z.input<typeof ModelConnectionSelectRequestSchema>): Promise<z.infer<typeof ModelConnectionSnapshotSchema>>
  completeModelCliAuth(input: z.input<typeof ModelConnectionCliAuthRequestSchema>): Promise<z.infer<typeof ModelConnectionSnapshotSchema>>
  startModelOAuth(input: z.input<typeof ModelConnectionOAuthStartRequestSchema>): Promise<z.infer<typeof ModelConnectionOAuthStatusSchema>>
  modelOAuthStatus(sessionId: string): Promise<z.infer<typeof ModelConnectionOAuthStatusSchema>>
  submitModelOAuth(sessionId: string, code: string): Promise<z.infer<typeof ModelConnectionOAuthStatusSchema>>
  cancelModelOAuth(sessionId: string): Promise<z.infer<typeof ModelConnectionOAuthStatusSchema>>
  claudeSdkStatus(): Promise<z.infer<typeof ClaudeSdkInstallStatusSchema>>
  installClaudeSdk(): Promise<z.infer<typeof ClaudeSdkInstallStatusSchema>>
  close?(): Promise<void> | void
}

export class TuiClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly path?: string
  ) {
    super(message)
    this.name = 'TuiClientError'
  }
}
