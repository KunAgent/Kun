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
import { ContextSnapshotEvent } from '../contracts/context-snapshot.js'
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

export const ThreadDetailResponse = ThreadSchema.extend({
  latestSeq: z.number().int().nonnegative().default(0),
  pendingUserInputIds: z.array(z.string()).default([]),
  // Omitted by older servers. Keep omission distinct from an authoritative
  // empty gate so clients do not hide legacy pending approval records.
  pendingApprovalIds: z.array(z.string()).optional(),
  // The latest request's context split; omitted by older servers and when
  // the session store cannot read it.
  contextSnapshot: ContextSnapshotEvent.nullable().optional()
})

export const UserInputResolutionResponse = z.object({
  inputId: z.string().min(1),
  status: z.enum(['submitted', 'cancelled']),
  answers: z.array(z.unknown()).optional()
})

export const RuntimeToolsResponse = z.object({
  providers: z.array(z.object({
    id: z.string(), kind: z.string(), enabled: z.boolean(), available: z.boolean(),
    reason: z.string().optional()
  }).passthrough()).default([]),
  mcpServers: z.array(z.object({
    id: z.string(),
    enabled: z.boolean(),
    transport: z.string(),
    trustScope: z.string(),
    available: z.boolean(),
    status: z.enum(['disabled', 'connected', 'reconnecting', 'error', 'authorization_required']),
    toolCount: z.number().int().nonnegative(),
    toolNames: z.array(z.string()).default([]),
    lastError: z.string().optional()
  }).passthrough()).default([]),
  extensions: z.object({
    jobs: z.object({
      activeCount: z.number().int().nonnegative(),
      subscriptionCount: z.number().int().nonnegative(),
      recent: z.array(z.object({
        jobId: z.string(),
        ownerExtensionId: z.string(),
        kind: z.string(),
        state: z.string(),
        executionAttempt: z.number().int().nonnegative(),
        action: z.string(),
        code: z.string().optional()
      }).passthrough()).default([])
    }).optional()
  }).passthrough().optional()
}).passthrough()

export const SkillsResponse = z.object({
  enabled: z.boolean(),
  roots: z.array(z.string()),
  skills: z.array(z.object({
    id: z.string(), name: z.string(), description: z.string().optional(), version: z.string(),
    root: z.string(), source: z.enum(['project', 'global']), legacy: z.boolean(),
    allowedTools: z.array(z.string()).default([])
  }).passthrough()),
  validationErrors: z.array(z.object({ root: z.string(), message: z.string() }))
})

export const DelegationDiagnosticsResponse = z.object({
  enabled: z.boolean(),
  active: z.number().int().nonnegative(),
  childRuns: z.array(z.object({
    id: z.string(), parentThreadId: z.string(), parentTurnId: z.string(),
    label: z.string().optional(), prompt: z.string(), profile: z.string().optional(),
    profileSnapshot: z.object({ name: z.string().optional() }).passthrough().optional(),
    model: z.string().optional(), providerId: z.string().optional(),
    reasoningEffort: z.string().optional(), toolPolicy: z.enum(['readOnly', 'inherit']).optional(),
    status: z.enum(['queued', 'running', 'completed', 'failed', 'aborted']),
    summary: z.string().optional(), error: z.string().optional(), detached: z.boolean().optional(),
    usage: z.object({
      promptTokens: z.number().int().nonnegative().default(0),
      completionTokens: z.number().int().nonnegative().default(0),
      totalTokens: z.number().int().nonnegative().default(0),
      cacheHitRate: z.number().min(0).max(1).nullable().optional(),
      costUsd: z.number().nonnegative().optional(),
      costCny: z.number().nonnegative().optional()
    }).passthrough().default({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
    prefixReused: z.boolean().optional(),
    inheritedHistoryItems: z.number().int().nonnegative().optional(),
    toolInvocations: z.number().int().nonnegative().optional(),
    activity: z.object({
      phase: z.enum(['starting', 'thinking', 'responding', 'tool', 'retrying', 'compacting', 'waiting']),
      label: z.string(),
      toolName: z.string().optional(),
      startedAt: z.string(),
      updatedAt: z.string()
    }).optional(),
    durationMs: z.number().int().nonnegative().optional(),
    queuedMs: z.number().int().nonnegative().optional(),
    childSeq: z.number().int().nonnegative().optional(),
    createdAt: z.string(), startedAt: z.string().optional(), updatedAt: z.string()
  }).passthrough()),
  aggregates: z.array(z.object({
    key: z.string(),
    label: z.string().optional(),
    model: z.string().optional(),
    runs: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    aborted: z.number().int().nonnegative(),
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative().optional(),
    costCny: z.number().nonnegative().optional(),
    averageTotalTokens: z.number().nonnegative(),
    averageCostUsd: z.number().nonnegative().optional(),
    averageCostCny: z.number().nonnegative().optional()
  }).passthrough()).default([])
})

export const MemoryListResponse = z.object({
  memories: z.array(MemoryRecord)
})

export const MemoryResponse = z.object({
  memory: MemoryRecord
})

export const DelegationAbortResponse = z.object({
  childId: z.string().min(1),
  aborted: z.boolean()
})

export const DelegationDetachResponse = z.object({
  childId: z.string().min(1),
  detached: z.boolean()
})

export const McpOAuthServer = z.object({
  serverId: z.string().min(1),
  enabled: z.boolean(),
  configured: z.boolean(),
  transport: z.string(),
  url: z.string().optional(),
  status: z.enum(['disabled', 'empty', 'partial', 'authorized', 'expired', 'error']),
  hasClientInformation: z.boolean(),
  hasTokens: z.boolean(),
  hasRefreshToken: z.boolean(),
  hasCodeVerifier: z.boolean(),
  hasDiscoveryState: z.boolean(),
  grantedScopes: z.array(z.string()).optional(),
  expiresAt: z.string().optional(),
  lastError: z.string().optional(),
  lastErrorAt: z.string().optional()
}).passthrough()

export const McpOAuthDiagnosticsResponse = z.object({ servers: z.array(McpOAuthServer) })
export const McpOAuthAuthorizeResponse = z.object({
  serverId: z.string(),
  status: z.enum(['disabled', 'empty', 'partial', 'authorized', 'expired', 'error']),
  authorized: z.boolean()
})
export const McpOAuthClearResponse = z.object({ cleared: z.array(z.string()) })
export const McpConfigResponse = z.object({
  enabled: z.boolean(),
  servers: z.array(z.object({
    id: z.string(),
    enabled: z.boolean(),
    transport: z.enum(['stdio', 'streamable-http', 'sse']),
    target: z.string(),
    trustScope: z.enum(['user', 'workspace']),
    oauth: z.boolean(),
    timeoutMs: z.number().int().positive()
  }))
})

export const ExtensionVersion = z.object({
  id: z.string(),
  version: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  requestedPermissions: z.array(z.string()).default([]),
  grantedPermissions: z.array(z.string()).default([])
}).passthrough()

export const ExtensionEntry = z.object({
  id: z.string(),
  selectedVersion: z.string().optional(),
  globallyEnabled: z.boolean(),
  effectiveEnabled: z.boolean().optional(),
  versions: z.array(ExtensionVersion).default([]),
  development: ExtensionVersion.optional()
}).passthrough()

export const ExtensionListResponse = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  extensions: z.array(ExtensionEntry),
  nextCursor: z.string().optional()
})

export const ExtensionChangedResponse = z.object({
  schemaVersion: z.literal(1),
  extension: ExtensionEntry
})

export const ExtensionVersionMutationResponse = z.object({
  schemaVersion: z.literal(1),
  extension: ExtensionVersion
}).passthrough()

export const ExtensionInspectionResponse = z.object({
  schemaVersion: z.literal(1),
  inspection: z.object({
    manifest: z.object({
      publisher: z.string(),
      name: z.string(),
      version: z.string(),
      displayName: z.string().optional(),
      description: z.string().optional(),
      permissions: z.array(z.string()).default([])
    }).passthrough(),
  }).passthrough()
})

export const ExtensionDiagnosticResponse = z.object({
  schemaVersion: z.literal(1),
  diagnostic: z.object({
    extensionId: z.string(),
    state: z.string().optional(),
    lastError: z.string().optional()
  }).passthrough()
}).passthrough()

export const ExtensionJob = z.object({
  id: z.string(),
  kind: z.string(),
  ownerExtensionId: z.string(),
  state: z.string(),
  executionAttempt: z.number().int().nonnegative(),
  initiatingOperation: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  progress: z.object({
    message: z.string().optional(),
    completed: z.number().optional(),
    total: z.number().optional()
  }).passthrough().optional(),
  error: z.object({ message: z.string() }).passthrough().optional()
}).passthrough()

export const ExtensionJobsResponse = z.object({
  schemaVersion: z.literal(1),
  jobs: z.array(ExtensionJob)
})

export const ExtensionJobCancelResponse = z.object({
  schemaVersion: z.literal(1),
  accepted: z.boolean(),
  job: ExtensionJob
})

export const GraphAvailabilityResponse = z.object({
  enabled: z.boolean()
}).passthrough()

export const GraphRunSummary = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  projectId: z.string().min(1),
  sourceTurnId: z.string().min(1),
  status: GraphRunStatusSchema,
  currentRevision: z.number().int().nonnegative(),
  lastEventSeq: z.number().int().nonnegative(),
  title: z.string(),
  goal: z.string(),
  nodeCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string()
})

export const GraphRunsResponse = z.object({
  runs: z.array(GraphRunSummary),
  nextCursor: z.string().optional()
})

// The Graph detail route can include additive public projections such as
// supervision state. Keep the durable Graph contract strict while allowing
// clients to consume newer runtime projections without rejecting the run.
export const PublicGraphRunResponse = GraphRunV1Schema.passthrough()

export type ThreadDetail = z.infer<typeof ThreadDetailResponse>
export type UserInputAnswer = z.infer<typeof UserInputAnswerSchema>
export type RuntimeTools = z.infer<typeof RuntimeToolsResponse>
export type SkillsSnapshot = z.infer<typeof SkillsResponse>
export type DelegationDiagnostics = z.infer<typeof DelegationDiagnosticsResponse>
export type McpOAuthSnapshot = z.infer<typeof McpOAuthDiagnosticsResponse>
export type ExtensionSnapshot = z.infer<typeof ExtensionListResponse>
