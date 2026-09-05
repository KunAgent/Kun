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
import { KunTuiClientCore } from './client-core.js'
import { segment } from './client-utils.js'

export class KunTuiClientRuntimeApi extends KunTuiClientCore {
  runtimeInfo() {
    return this.request('/v1/runtime/info', RuntimeInfoResponse)
  }

  applyRuntimeConfig(input: z.input<typeof RuntimeConfigApplyRequest>) {
    return this.request('/v1/runtime/config/apply', RuntimeConfigApplyResponse, {
      method: 'POST',
      body: RuntimeConfigApplyRequest.parse(input)
    })
  }

  runtimeTools() {
    return this.request('/v1/runtime/tools', RuntimeToolsResponse)
  }

  skills(workspace?: string) {
    const query = workspace ? `?workspace=${encodeURIComponent(workspace)}` : ''
    return this.request(`/v1/skills${query}`, SkillsResponse)
  }

  refreshSkills() {
    return this.request('/v1/skills/refresh', z.object({ refreshed: z.boolean(), message: z.string().optional() }), {
      method: 'POST'
    })
  }

  setSkillsEnabled(enabled: boolean) {
    return this.request('/v1/skills/config', z.object({ enabled: z.boolean() }), {
      method: 'PATCH',
      body: { enabled }
    })
  }

  setLocalCapabilityEnabled(id: 'attachments' | 'memory', enabled: boolean) {
    return this.request(`/v1/runtime/capabilities/${id}`, z.object({
      id: z.enum(['attachments', 'memory']),
      enabled: z.boolean()
    }), {
      method: 'PATCH',
      body: { enabled }
    })
  }

  delegationDiagnostics(parentThreadId?: string) {
    const query = parentThreadId ? `?parent_thread_id=${encodeURIComponent(parentThreadId)}` : ''
    return this.request(`/v1/delegation/diagnostics${query}`, DelegationDiagnosticsResponse)
  }

  backgroundShells(threadId?: string) {
    const query = threadId ? `?thread_id=${encodeURIComponent(threadId)}` : ''
    return this.request(`/v1/background-shells${query}`, BackgroundShellListResponse)
  }

  backgroundShell(sessionId: string) {
    return this.request(`/v1/background-shells/${segment(sessionId)}`, BackgroundShellRecord)
  }

  stopBackgroundShell(sessionId: string) {
    return this.request(`/v1/background-shells/${segment(sessionId)}/stop`, BackgroundShellStopResponse, {
      method: 'POST'
    })
  }

  abortDelegation(childId: string) {
    return this.request(`/v1/delegation/abort/${segment(childId)}`, DelegationAbortResponse, {
      method: 'POST'
    })
  }

  detachDelegation(childId: string) {
    return this.request(`/v1/delegation/detach/${segment(childId)}`, DelegationDetachResponse, {
      method: 'POST'
    })
  }

  uploadAttachment(input: z.input<typeof AttachmentUploadRequest>) {
    return this.request('/v1/attachments', AttachmentUploadResponse, {
      method: 'POST',
      body: AttachmentUploadRequest.parse(input)
    })
  }

  releaseAttachment(attachmentId: string, leaseId: string) {
    return this.request(`/v1/attachments/${segment(attachmentId)}`, AttachmentReleaseResponse, {
      method: 'DELETE',
      body: { leaseId }
    })
  }

  getAttachment(attachmentId: string) {
    return this.request(`/v1/attachments/${segment(attachmentId)}`, AttachmentUploadResponse)
  }

  listMemories(input: { workspace?: string; project?: string; includeDeleted?: boolean; all?: boolean } = {}) {
    const query = new URLSearchParams()
    if (input.workspace) query.set('workspace', input.workspace)
    if (input.project) query.set('project', input.project)
    if (input.includeDeleted) query.set('include_deleted', 'true')
    if (input.all) query.set('all', 'true')
    return this.request(`/v1/memory${query.size ? `?${query}` : ''}`, MemoryListResponse)
  }

  createMemory(input: z.input<typeof MemoryCreateRequest>) {
    return this.request('/v1/memory', MemoryResponse, {
      method: 'POST',
      body: MemoryCreateRequest.parse(input)
    })
  }

  updateMemory(
    id: string,
    workspace: string | undefined,
    input: z.input<typeof MemoryUpdateRequest>,
    project?: string
  ) {
    const params = new URLSearchParams()
    if (workspace) params.set('workspace', workspace)
    if (project) params.set('project', project)
    const query = params.size ? `?${params}` : ''
    return this.request(`/v1/memory/${segment(id)}${query}`, MemoryResponse, {
      method: 'PATCH',
      body: MemoryUpdateRequest.parse(input)
    })
  }

  deleteMemory(id: string, workspace?: string, project?: string) {
    const params = new URLSearchParams()
    if (workspace) params.set('workspace', workspace)
    if (project) params.set('project', project)
    const query = params.size ? `?${params}` : ''
    return this.request(`/v1/memory/${segment(id)}${query}`, MemoryResponse, { method: 'DELETE' })
  }

  mcpOAuth() {
    return this.request('/v1/mcp/oauth', McpOAuthDiagnosticsResponse)
  }

  authorizeMcp(serverId: string) {
    return this.request(`/v1/mcp/oauth/${segment(serverId)}`, McpOAuthAuthorizeResponse, { method: 'POST' })
  }

  clearMcpOAuth(serverId?: string) {
    return this.request(serverId ? `/v1/mcp/oauth/${segment(serverId)}` : '/v1/mcp/oauth', McpOAuthClearResponse, {
      method: 'DELETE'
    })
  }

  mcpConfig() {
    return this.request('/v1/mcp/config', McpConfigResponse)
  }

  putMcpServer(serverId: string, input: z.input<typeof McpServerConfig>) {
    return this.request(`/v1/mcp/config/${segment(serverId)}`, McpConfigResponse, {
      method: 'PUT',
      body: McpServerConfig.parse(input)
    })
  }

  deleteMcpServer(serverId: string) {
    return this.request(`/v1/mcp/config/${segment(serverId)}`, McpConfigResponse, { method: 'DELETE' })
  }

  setMcpServerEnabled(serverId: string, enabled: boolean) {
    return this.request(`/v1/mcp/config/${segment(serverId)}`, McpConfigResponse, {
      method: 'PATCH',
      body: { enabled }
    })
  }

  extensions(workspaceRoot?: string) {
    const query = workspaceRoot ? `?workspace_root=${encodeURIComponent(workspaceRoot)}` : ''
    return this.request(`/v1/extensions${query}`, ExtensionListResponse)
  }

  inspectExtension(path: string) {
    return this.request('/v1/extensions/inspect', ExtensionInspectionResponse, {
      method: 'POST',
      body: { path }
    })
  }

  installExtension(input:
    | { source: 'archive' | 'development'; path: string; grantedPermissions: string[]; select?: boolean; enable?: boolean }
    | { source: 'index'; indexUrl: string; extensionId: string; version: string; grantedPermissions: string[]; select?: boolean; enable?: boolean }
  ) {
    return this.request('/v1/extensions/install', ExtensionVersionMutationResponse, {
      method: 'POST',
      body: { select: true, enable: true, ...input }
    })
  }

  selectExtensionVersion(id: string, version: string) {
    return this.request(`/v1/extensions/${segment(id)}/select`, ExtensionChangedResponse, {
      method: 'POST',
      body: { version }
    })
  }

  setExtensionEnabled(id: string, enabled: boolean, workspaceRoot?: string) {
    return this.request(`/v1/extensions/${segment(id)}/${enabled ? 'enable' : 'disable'}`, ExtensionChangedResponse, {
      method: 'POST',
      body: workspaceRoot ? { workspaceRoot } : {}
    })
  }

  setExtensionPermissions(id: string, workspaceRoot: string, expectedVersion: string, permissions: string[] | null) {
    return this.request(`/v1/extensions/${segment(id)}/permissions`, ExtensionChangedResponse, {
      method: 'PUT',
      body: { workspaceRoot, expectedVersion, permissions }
    })
  }

  rollbackExtension(id: string) {
    return this.request(`/v1/extensions/${segment(id)}/rollback`, ExtensionChangedResponse, { method: 'POST' })
  }

  reloadExtension(id: string) {
    return this.request(`/v1/extensions/${segment(id)}/reload`, ExtensionVersionMutationResponse, { method: 'POST' })
  }

  retryExtension(id: string) {
    return this.request(`/v1/extensions/${segment(id)}/retry`, ExtensionDiagnosticResponse, { method: 'POST' })
  }

  extensionJobs(limit = 100) {
    return this.request(`/v1/extensions/jobs?limit=${Math.max(1, Math.min(500, Math.floor(limit)))}`, ExtensionJobsResponse)
  }

  cancelExtensionJob(jobId: string) {
    return this.request(`/v1/extensions/jobs/${segment(jobId)}/cancel`, ExtensionJobCancelResponse, {
      method: 'POST'
    })
  }

  uninstallExtension(id: string) {
    return this.request(`/v1/extensions/${segment(id)}`, z.object({
      schemaVersion: z.literal(1),
      removed: z.object({ extensionId: z.string() }),
      dataPreserved: z.boolean()
    }), { method: 'DELETE' })
  }
}
