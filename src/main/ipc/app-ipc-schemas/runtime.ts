import { z } from 'zod'
import { ROOM_ENDPOINTS, ROOM_TASK_ACTIONS } from '../../../shared/rooms-api'
import {
  KUN_ATTACHMENT_CONTENT_TEMPLATE,
  KUN_ATTACHMENT_DIAGNOSTICS_TEMPLATE,
  KUN_ATTACHMENTS_TEMPLATE,
  KUN_ATTACHMENT_TEMPLATE,
  KUN_HEALTH_TEMPLATE,
  KUN_MEMORY_CONFIRM_TEMPLATE,
  KUN_MEMORY_CORRECT_TEMPLATE,
  KUN_MEMORY_DIAGNOSTICS_TEMPLATE,
  KUN_MEMORY_DISTILLATION_DECISION_TEMPLATE,
  KUN_MEMORY_DISTILLATION_TEMPLATE,
  KUN_MEMORY_RECORD_TEMPLATE,
  KUN_MEMORY_TEMPLATE,
  KUN_MCP_OAUTH_SERVER_TEMPLATE,
  KUN_MCP_OAUTH_TEMPLATE,
  KUN_MODEL_CONNECTIONS_TEMPLATE,
  KUN_MODEL_CONNECTION_CLAUDE_SDK_INSTALL_TEMPLATE,
  KUN_MODEL_CONNECTION_CLAUDE_SDK_TEMPLATE,
  KUN_MODEL_CONNECTION_CONNECT_TEMPLATE,
  KUN_MODEL_CONNECTION_CREDENTIAL_TEMPLATE,
  KUN_MODEL_CONNECTION_CREDENTIAL_FENCE_TEMPLATE,
  KUN_MODEL_CONNECTION_CREDENTIAL_COMMIT_TEMPLATE,
  KUN_MODEL_CONNECTION_EVENTS_TEMPLATE,
  KUN_MODEL_CONNECTION_OAUTH_START_TEMPLATE,
  KUN_MODEL_CONNECTION_OAUTH_SUBMIT_TEMPLATE,
  KUN_MODEL_CONNECTION_OAUTH_TEMPLATE,
  KUN_MODEL_CONNECTION_PROBE_TEMPLATE,
  KUN_MODEL_CONNECTION_PROVIDER_TEMPLATE,
  KUN_MODEL_CONNECTION_SELECT_TEMPLATE,
  KUN_MODEL_ROUTES_TEMPLATE,
  KUN_GATEWAY_CREDENTIAL_STATUS_TEMPLATE,
  KUN_GATEWAY_CREDENTIAL_ENSURE_TEMPLATE,
  KUN_GATEWAY_CREDENTIAL_ROTATE_TEMPLATE,
  KUN_GATEWAY_CREDENTIAL_REVOKE_TEMPLATE,
  KUN_MODEL_ROUTE_TEST_TEMPLATE,
  KUN_RUNTIME_INFO_TEMPLATE,
  KUN_RUNTIME_TOOLS_TEMPLATE,
  KUN_THREAD_GUARDIAN_TEMPLATE,
  KUN_SUPPLY_CHAIN_AUDIT_TEMPLATE,
  KUN_SUPPLY_CHAIN_UPDATE_CHECK_TEMPLATE,
  KUN_SESSION_RESUME_METADATA_TEMPLATE,
  KUN_SESSION_RESUME_TEMPLATE,
  KUN_SKILLS_TEMPLATE,
  KUN_THREAD_ACTIVITY_EVENTS_TEMPLATE,
  KUN_THREADS_TEMPLATE,
  KUN_THREADS_BULK_DELETE_TEMPLATE,
  KUN_THREADS_CONTENT_SEARCH_TEMPLATE,
  KUN_PROJECT_BOARD_SNAPSHOT_TEMPLATE,
  KUN_PROJECT_BOARD_SUMMARIES_TEMPLATE,
  KUN_PROJECT_BOARD_CARDS_TEMPLATE,
  KUN_PROJECT_BOARD_CARD_STATUS_TEMPLATE,
  KUN_PROJECT_BOARD_CARD_TEMPLATE,
  KUN_PROJECT_BOARD_TODO_OVERLAY_TEMPLATE,
  KUN_THREAD_COMPACT_TEMPLATE,
  KUN_THREAD_PRUNE_TEMPLATE,
  KUN_THREAD_FORK_TEMPLATE,
  KUN_THREAD_SUMMARIZE_TEMPLATE,
  KUN_THREAD_GOAL_TEMPLATE,
  KUN_THREAD_KNOWLEDGE_BASE_REINDEX_TEMPLATE,
  KUN_THREAD_KNOWLEDGE_BASES_TEMPLATE,
  KUN_THREAD_REVIEW_TEMPLATE,
  KUN_THREAD_REWIND_TEMPLATE,
  KUN_THREAD_TODOS_SYNC_PLAN_TEMPLATE,
  KUN_THREAD_TODOS_TEMPLATE,
  KUN_THREAD_TODO_TEMPLATE,
  KUN_THREAD_TURN_TEMPLATE,
  KUN_THREAD_TURNS_TEMPLATE,
  KUN_THREAD_INTERRUPT_TEMPLATE,
  KUN_THREAD_TOOL_CANCEL_TEMPLATE,
  KUN_THREAD_MODEL_REQUESTS_TEMPLATE,
  KUN_THREAD_TRAJECTORY_TEMPLATE,
  KUN_THREAD_TRAJECTORY_SUMMARY_TEMPLATE,
  KUN_THREAD_TRAJECTORY_DETAIL_TEMPLATE,
  KUN_THREAD_CANCEL_QUEUED_TEMPLATE,
  KUN_THREAD_QUEUE_POSITION_TEMPLATE,
  KUN_THREAD_QUEUE_RESUME_TEMPLATE,
  KUN_THREAD_QUEUED_TURNS_TEMPLATE,
  KUN_THREAD_STEER_TEMPLATE,
  KUN_THREAD_STATE_TEMPLATE,
  KUN_THREAD_SUMMARY_TEMPLATE,
  KUN_THREAD_STATES_TEMPLATE,
  KUN_THREAD_TIMELINE_TEMPLATE,
  KUN_THREAD_TEMPLATE,
  KUN_USER_INPUT_TEMPLATE,
  KUN_USAGE_TEMPLATE,
  KUN_DEBUG_LLM_ROUNDS_TEMPLATE,
  KUN_BACKGROUND_SHELLS_TEMPLATE,
  KUN_BACKGROUND_SHELL_TEMPLATE,
  KUN_DELEGATION_DIAGNOSTICS_TEMPLATE,
  KUN_DELEGATION_ABORT_TEMPLATE,
  KUN_DELEGATION_PROFILES_TEMPLATE,
  KUN_GRAPHS_TEMPLATE,
  KUN_GRAPH_DRAFTS_TEMPLATE,
  KUN_GRAPH_DRAFT_TEMPLATE,
  KUN_GRAPH_DRAFT_RESUME_TEMPLATE,
  KUN_GRAPH_DRAFT_CANCEL_TEMPLATE,
  KUN_GRAPH_TEMPLATE,
  KUN_GRAPH_EVENTS_TEMPLATE,
  KUN_GRAPH_ARTIFACT_TEMPLATE,
  KUN_GRAPH_START_TEMPLATE,
  KUN_GRAPH_PAUSE_TEMPLATE,
  KUN_GRAPH_RESUME_TEMPLATE,
  KUN_GRAPH_CLEANUP_TEMPLATE,
  KUN_GRAPH_CANCEL_TEMPLATE,
  KUN_GRAPH_RETRY_TEMPLATE,
  KUN_GRAPH_STEER_TEMPLATE,
  KUN_GRAPH_PATCH_TEMPLATE,
  KUN_GRAPH_REVIEWS_TEMPLATE,
  KUN_GRAPH_SUPERVISION_TEMPLATE,
  KUN_GRAPH_SUPERVISION_WAKE_TEMPLATE,
  KUN_GRAPH_PROJECT_IDENTITY_TEMPLATE,
  KUN_GRAPH_PROJECT_AGENTS_TEMPLATE,
  KUN_GRAPH_PROJECT_EVIDENCE_TEMPLATE,
  KUN_GRAPH_PROJECT_SCORES_TEMPLATE,
  KUN_GRAPH_PROJECT_AUDIT_TEMPLATE,
  KUN_GRAPH_PROJECT_CANDIDATES_TEMPLATE,
  KUN_GRAPH_PROJECT_JOBS_TEMPLATE,
  KUN_GRAPH_PROJECT_AGENT_LIFECYCLE_TEMPLATE,
  KUN_GRAPH_PROJECT_AGENT_EXPORT_TEMPLATE,
  KUN_GRAPH_PROJECT_AGENTS_IMPORT_TEMPLATE,
  KUN_GRAPH_PROJECT_AGENTS_MERGE_TEMPLATE,
  KUN_GRAPH_PROJECT_CANDIDATE_ACTION_TEMPLATE,
  KUN_GRAPH_PROJECT_CONSOLIDATE_TEMPLATE
} from '../../../shared/kun-endpoints'
import { MODEL_ENDPOINT_FORMATS } from '../../../shared/app-settings'
import { MAX_BODY_BYTES, MAX_URL_LENGTH, trimmedString } from './common'
export const providerProbePayloadSchema = z
  .object({
    providerId: trimmedString(128),
    baseUrl: trimmedString(MAX_URL_LENGTH),
    apiKey: z.string().max(8_192),
    endpointFormat: z.enum(MODEL_ENDPOINT_FORMATS),
    useProxy: z.boolean()
  })
  .strict()

export const modelProviderCredentialRevealPayloadSchema = z
  .object({
    providerId: trimmedString(128)
  })
  .strict()

export const modelsDevCatalogPayloadSchema = z
  .object({
    providerId: trimmedString(128),
    // SDK-backed subscription providers (Cursor and Antigravity) deliberately
    // have no HTTP endpoint. Their canonical provider id is enough for
    // deterministic models.dev matching, so an empty Base URL is valid here.
    baseUrl: z.string().trim().max(MAX_URL_LENGTH),
    forceRefresh: z.boolean().optional(),
    modelHints: z.array(z.object({
      id: trimmedString(512),
      aliases: z.array(trimmedString(512)).max(32).optional()
    }).strict()).max(500).optional()
  })
  .strict()

export const promptOptimizationPayloadSchema = z
  .object({
    text: trimmedString(100_000)
  })
  .strict()

interface EndpointTemplate {
  /** Compiled path matcher. */
  match(path: string): boolean
  allowedMethods: readonly string[]
}

function compileEndpoint(
  template: string,
  allowedMethods: readonly string[]
): EndpointTemplate {
  // Build a regex from the template by escaping the literal parts and
  // substituting every `{name}` placeholder with one non-empty path segment.
  // Template fragments are URL-encoded by path helpers, so they contain only
  // characters that are safe to escape directly.
  const pattern = template
    .replace(/[.+*?^$()|[\]\\]/g, '\\$&')
    .replace(/\{[^/{}]+\}/g, '[^/]+')
  const regex = new RegExp(`^${pattern}$`)
  return {
    match: (path: string) => regex.test(path),
    allowedMethods
  }
}

const ENDPOINTS: readonly EndpointTemplate[] = [
  compileEndpoint('/v1/agent-handoffs', ['GET', 'POST']),
  compileEndpoint('/v1/agent-handoffs/{handoffId}', ['GET']),
  compileEndpoint('/v1/agent-handoffs/{handoffId}/cancel', ['POST']),
  compileEndpoint('/v1/agent-handoffs/{handoffId}/retry', ['POST']),
  compileEndpoint('/v1/agents/default-members', ['POST']),
  compileEndpoint('/v1/rooms/sidebar', ['GET']),
  compileEndpoint('/v1/rooms/user-profile', ['GET', 'PUT']),
  compileEndpoint('/v1/agents/onboarding', ['GET', 'POST']),
  compileEndpoint('/v1/agents/chat-entry', ['GET', 'POST']),
  compileEndpoint('/v1/agents/quick-create', ['POST']),
  compileEndpoint('/v1/agents/{agentId}/models', ['GET', 'PUT']),
  compileEndpoint('/v1/rooms/{roomId}/direct', ['GET']),
  compileEndpoint('/v1/rooms/{roomId}/direct/permissions', ['GET']),
  compileEndpoint('/v1/rooms/{roomId}/files', ['GET']),
  compileEndpoint('/v1/rooms/{roomId}/direct/context', ['POST']),
  compileEndpoint('/v1/rooms/{roomId}/direct/{requestId}', ['POST']),
  compileEndpoint('/v1/agents/templates', ['GET']),
  compileEndpoint('/v1/agents/features', ['GET', 'PUT']),
  compileEndpoint('/v1/agents', ['GET', 'POST']),
  compileEndpoint('/v1/agents/{agentId}', ['GET', 'PATCH']),
  compileEndpoint('/v1/agents/{agentId}/conversation', ['POST']),
  compileEndpoint('/v1/agents/{agentId}/runs', ['GET']),
  compileEndpoint('/v1/agents/{agentId}/conversations', ['GET']),
  compileEndpoint('/v1/agents/{agentId}/memory-candidates', ['GET']),
  compileEndpoint('/v1/agents/{agentId}/memory-candidates/{candidateId}/decision', ['POST']),
  compileEndpoint('/v1/agents/{agentId}/memory-work', ['GET']),
  compileEndpoint('/v1/agents/{agentId}/memories', ['GET', 'POST']),
  compileEndpoint('/v1/agents/{agentId}/memories/{memoryId}', ['PATCH']),
  compileEndpoint('/v1/history-sources/codex/sessions', ['GET']),
  compileEndpoint('/v1/history-sources/codex/preview', ['POST']),
  compileEndpoint('/v1/history-sources/{id}', ['GET']),
  compileEndpoint('/v1/history-sources/{id}/timeline', ['GET']),
  compileEndpoint('/v1/history-sources/{id}/attachments/{itemId}/{index}', ['GET']),
  compileEndpoint('/v1/history-sources/{id}/relink', ['POST']),
  compileEndpoint('/v1/threads/reference-branches', ['POST']),
  compileEndpoint(ROOM_ENDPOINTS.list, ['GET', 'POST']),
  compileEndpoint(ROOM_ENDPOINTS.presets, ['GET']),
  compileEndpoint('/v1/rooms/search', ['GET']),
  compileEndpoint('/v1/rooms/repositories', ['GET']),
  compileEndpoint('/v1/rooms/avatars', ['POST']),
  compileEndpoint('/v1/rooms/avatars/{avatarId}', ['GET']),
  compileEndpoint('/v1/rooms/events', ['GET']),
  compileEndpoint('/v1/rooms/attention', ['GET']),
  compileEndpoint(ROOM_ENDPOINTS.room, ['GET', 'PATCH']),
  compileEndpoint(ROOM_ENDPOINTS.messages, ['GET', 'POST']),
  compileEndpoint(ROOM_ENDPOINTS.tasks, ['GET']),
  compileEndpoint(ROOM_ENDPOINTS.task, ['GET']),
  compileEndpoint(ROOM_ENDPOINTS.events, ['GET']),
  compileEndpoint(ROOM_ENDPOINTS.rules, ['GET', 'POST']),
  compileEndpoint('/v1/rooms/{roomId}/messages/{messageId}', ['GET']),
  compileEndpoint('/v1/rooms/{roomId}/replies/{messageId}', ['GET']),
  compileEndpoint('/v1/rooms/{roomId}/preferences', ['GET', 'PUT']),
  compileEndpoint('/v1/rooms/{roomId}/run-summary', ['GET']),
  compileEndpoint('/v1/rooms/{roomId}/content', ['GET']),
  compileEndpoint('/v1/rooms/{roomId}/content-options', ['GET']),
  compileEndpoint('/v1/rooms/{roomId}/messages/{messageId}/link-preview', ['GET']),
  compileEndpoint('/v1/rooms/{roomId}/messages/{messageId}/link-preview/image', ['GET']),
  compileEndpoint('/v1/rooms/{roomId}/messages/{messageId}/interactions', ['GET']),
  compileEndpoint('/v1/rooms/{roomId}/messages/{messageId}/reactions', ['PUT']),
  compileEndpoint('/v1/rooms/{roomId}/polls', ['POST']),
  compileEndpoint('/v1/rooms/{roomId}/polls/{pollId}', ['GET']),
  compileEndpoint('/v1/rooms/{roomId}/polls/{pollId}/vote', ['PUT']),
  ...['close', 'invite', 'discuss'].map((action) => compileEndpoint('/v1/rooms/{roomId}/polls/{pollId}/' + action, ['POST'])),
  compileEndpoint('/v1/rooms/{roomId}/messages/{messageId}/run', ['GET']),
  compileEndpoint('/v1/rooms/{roomId}/runs', ['GET']),
  compileEndpoint('/v1/rooms/{roomId}/runs/{runId}', ['GET']),
  compileEndpoint('/v1/rooms/{roomId}/runs/{runId}/items', ['GET']),
  compileEndpoint('/v1/rooms/{roomId}/runs/{runId}/events', ['GET']),
  compileEndpoint('/v1/rooms/{roomId}/read', ['POST']),
  compileEndpoint('/v1/rooms/{roomId}/search', ['GET']),
  compileEndpoint('/v1/rooms/{roomId}/requests', ['GET']),
  compileEndpoint('/v1/rooms/{roomId}/topics', ['GET']),
  compileEndpoint('/v1/rooms/{roomId}/topics/{requestId}/stop', ['POST']),
  compileEndpoint('/v1/rooms/{roomId}/topics/{requestId}/metrics', ['GET']),
  compileEndpoint('/v1/rooms/{roomId}/requests/{requestId}/retry', ['POST']),
  compileEndpoint('/v1/rooms/{roomId}/requests/{requestId}', ['GET']),
  ...['continue', 'cancel', 'reconcile'].map((action) =>
    compileEndpoint('/v1/rooms/{roomId}/requests/{requestId}/' + action, ['POST'])),
  compileEndpoint('/v1/rooms/{roomId}/rules/{ruleId}', ['PATCH']),
  compileEndpoint('/v1/rooms/{roomId}/rules/{ruleId}/versions', ['GET']),
  compileEndpoint('/v1/rooms/{roomId}/rules/{ruleId}/adopt', ['POST']),
  ...['recovery', 'deliveries', 'compare'].map((part) =>
    compileEndpoint(ROOM_ENDPOINTS.task + '/' + part, ['GET'])),
  compileEndpoint(ROOM_ENDPOINTS.task + '/recover', ['POST']),
  compileEndpoint(ROOM_ENDPOINTS.task + '/reviews', ['GET']),
  compileEndpoint(ROOM_ENDPOINTS.task + '/diff', ['GET']),
  compileEndpoint(ROOM_ENDPOINTS.task + '/logs/{artifactId}', ['GET']),
  compileEndpoint('/v1/rooms/{roomId}/agreements/{bundleId}', ['GET']),
  ...['diff', 'candidates'].map((part) => compileEndpoint(ROOM_ENDPOINTS.task + '/integrations/{integrationId}/' + part, ['GET'])),
  compileEndpoint(ROOM_ENDPOINTS.task + '/integrations/{integrationId}', ['GET']),
  ...['cleanup', 'integrations'].map((part) =>
    compileEndpoint(ROOM_ENDPOINTS.task + '/' + part, ['GET', 'POST'])),
  compileEndpoint(ROOM_ENDPOINTS.task + '/deliveries/{deliveryId}', ['GET']),
  ...['resolve', 'apply', 'cancel', 'open', 'validate'].map((part) =>
    compileEndpoint(ROOM_ENDPOINTS.task + '/integrations/{integrationId}/' + part, ['POST'])),
  ...ROOM_TASK_ACTIONS.map((action) => compileEndpoint(`${ROOM_ENDPOINTS.task}/${action}`, ['POST'])),
  compileEndpoint(KUN_HEALTH_TEMPLATE, ['GET']),
  compileEndpoint(KUN_RUNTIME_INFO_TEMPLATE, ['GET']),
  compileEndpoint(KUN_RUNTIME_TOOLS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_THREAD_GUARDIAN_TEMPLATE, ['POST']),
  compileEndpoint(KUN_MODEL_CONNECTIONS_TEMPLATE, ['GET', 'PATCH']),
  compileEndpoint(KUN_MODEL_CONNECTION_EVENTS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_MODEL_CONNECTION_CONNECT_TEMPLATE, ['POST']),
  compileEndpoint(KUN_MODEL_CONNECTION_SELECT_TEMPLATE, ['POST']),
  compileEndpoint(KUN_MODEL_CONNECTION_OAUTH_START_TEMPLATE, ['POST']),
  compileEndpoint(KUN_MODEL_CONNECTION_CLAUDE_SDK_TEMPLATE, ['GET']),
  compileEndpoint(KUN_MODEL_CONNECTION_CLAUDE_SDK_INSTALL_TEMPLATE, ['POST']),
  compileEndpoint(KUN_MODEL_CONNECTION_OAUTH_SUBMIT_TEMPLATE, ['POST']),
  compileEndpoint(KUN_MODEL_CONNECTION_OAUTH_TEMPLATE, ['GET', 'DELETE']),
  compileEndpoint(KUN_MODEL_CONNECTION_CREDENTIAL_TEMPLATE, ['PUT', 'DELETE']),
  compileEndpoint(KUN_MODEL_CONNECTION_CREDENTIAL_FENCE_TEMPLATE, ['POST']),
  compileEndpoint(KUN_MODEL_CONNECTION_CREDENTIAL_COMMIT_TEMPLATE, ['POST']),
  compileEndpoint(KUN_MODEL_CONNECTION_PROBE_TEMPLATE, ['POST']),
  compileEndpoint(KUN_MODEL_CONNECTION_PROVIDER_TEMPLATE, ['PATCH', 'DELETE']),
  compileEndpoint(KUN_MODEL_ROUTES_TEMPLATE, ['GET']),
  compileEndpoint(KUN_GATEWAY_CREDENTIAL_STATUS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_GATEWAY_CREDENTIAL_ENSURE_TEMPLATE, ['POST']),
  compileEndpoint(KUN_GATEWAY_CREDENTIAL_ROTATE_TEMPLATE, ['POST']),
  compileEndpoint(KUN_GATEWAY_CREDENTIAL_REVOKE_TEMPLATE, ['DELETE']),
  compileEndpoint(KUN_MODEL_ROUTE_TEST_TEMPLATE, ['POST']),
  compileEndpoint(KUN_SUPPLY_CHAIN_AUDIT_TEMPLATE, ['POST']),
  compileEndpoint(KUN_SUPPLY_CHAIN_UPDATE_CHECK_TEMPLATE, ['POST']),
  compileEndpoint(KUN_SKILLS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_ATTACHMENTS_TEMPLATE, ['POST']),
  compileEndpoint(KUN_ATTACHMENT_DIAGNOSTICS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_ATTACHMENT_TEMPLATE, ['GET']),
  compileEndpoint(KUN_ATTACHMENT_CONTENT_TEMPLATE, ['GET']),
  compileEndpoint(KUN_MEMORY_TEMPLATE, ['GET', 'POST']),
  compileEndpoint(KUN_MEMORY_DIAGNOSTICS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_MEMORY_DISTILLATION_TEMPLATE, ['GET']),
  compileEndpoint(KUN_MEMORY_DISTILLATION_DECISION_TEMPLATE, ['POST']),
  compileEndpoint(KUN_MEMORY_CONFIRM_TEMPLATE, ['POST']),
  compileEndpoint(KUN_MEMORY_CORRECT_TEMPLATE, ['POST']),
  compileEndpoint(KUN_MEMORY_RECORD_TEMPLATE, ['PATCH', 'DELETE']),
  compileEndpoint(KUN_MCP_OAUTH_TEMPLATE, ['GET', 'DELETE']),
  compileEndpoint(KUN_MCP_OAUTH_SERVER_TEMPLATE, ['DELETE']),
  compileEndpoint(KUN_THREAD_ACTIVITY_EVENTS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_THREADS_TEMPLATE, ['GET', 'POST']),
  compileEndpoint(KUN_THREAD_STATES_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREAD_STATE_TEMPLATE, ['GET']),
  compileEndpoint(KUN_THREAD_SUMMARY_TEMPLATE, ['GET']),
  compileEndpoint(KUN_THREAD_TIMELINE_TEMPLATE, ['GET']),
  compileEndpoint(KUN_THREAD_KNOWLEDGE_BASES_TEMPLATE, ['GET']),
  compileEndpoint(KUN_THREAD_KNOWLEDGE_BASE_REINDEX_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREADS_BULK_DELETE_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREADS_CONTENT_SEARCH_TEMPLATE, ['GET']),
  compileEndpoint(KUN_PROJECT_BOARD_SNAPSHOT_TEMPLATE, ['GET']),
  compileEndpoint(KUN_PROJECT_BOARD_SUMMARIES_TEMPLATE, ['POST']),
  compileEndpoint(KUN_PROJECT_BOARD_CARDS_TEMPLATE, ['POST']),
  compileEndpoint(KUN_PROJECT_BOARD_CARD_STATUS_TEMPLATE, ['PATCH']),
  compileEndpoint(KUN_PROJECT_BOARD_CARD_TEMPLATE, ['GET', 'PATCH', 'DELETE']),
  compileEndpoint(KUN_PROJECT_BOARD_TODO_OVERLAY_TEMPLATE, ['PATCH']),
  compileEndpoint(KUN_THREAD_TEMPLATE, ['GET', 'PATCH', 'DELETE']),
  compileEndpoint(KUN_THREAD_FORK_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREAD_SUMMARIZE_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREAD_GOAL_TEMPLATE, ['GET', 'POST', 'DELETE']),
  compileEndpoint(KUN_THREAD_TODOS_SYNC_PLAN_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREAD_TODOS_TEMPLATE, ['GET', 'POST', 'DELETE']),
  compileEndpoint(KUN_THREAD_TODO_TEMPLATE, ['PATCH']),
  compileEndpoint(KUN_THREAD_COMPACT_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREAD_PRUNE_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREAD_REVIEW_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREAD_REWIND_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREAD_TURNS_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREAD_TURN_TEMPLATE, ['GET']),
  compileEndpoint(KUN_THREAD_CANCEL_QUEUED_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREAD_QUEUE_POSITION_TEMPLATE, ['PATCH']),
  compileEndpoint(KUN_THREAD_QUEUE_RESUME_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREAD_QUEUED_TURNS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_THREAD_STEER_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREAD_INTERRUPT_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREAD_TOOL_CANCEL_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREAD_MODEL_REQUESTS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_THREAD_TRAJECTORY_TEMPLATE, ['GET']),
  compileEndpoint(KUN_THREAD_TRAJECTORY_SUMMARY_TEMPLATE, ['GET']),
  compileEndpoint(KUN_THREAD_TRAJECTORY_DETAIL_TEMPLATE, ['GET']),
  compileEndpoint(KUN_USER_INPUT_TEMPLATE, ['POST']),
  compileEndpoint(KUN_SESSION_RESUME_TEMPLATE, ['POST']),
  compileEndpoint(KUN_SESSION_RESUME_METADATA_TEMPLATE, ['GET']),
  compileEndpoint(KUN_USAGE_TEMPLATE, ['GET']),
  compileEndpoint(KUN_DEBUG_LLM_ROUNDS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_BACKGROUND_SHELLS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_BACKGROUND_SHELL_TEMPLATE, ['GET']),
  compileEndpoint(`${KUN_BACKGROUND_SHELL_TEMPLATE}/stop`, ['POST']),
  compileEndpoint(KUN_DELEGATION_DIAGNOSTICS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_DELEGATION_ABORT_TEMPLATE, ['POST']),
  compileEndpoint(KUN_DELEGATION_PROFILES_TEMPLATE, ['GET']),
  compileEndpoint(KUN_GRAPHS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_GRAPH_DRAFTS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_GRAPH_DRAFT_TEMPLATE, ['GET']),
  compileEndpoint(KUN_GRAPH_DRAFT_RESUME_TEMPLATE, ['POST']),
  compileEndpoint(KUN_GRAPH_DRAFT_CANCEL_TEMPLATE, ['POST']),
  compileEndpoint(KUN_GRAPH_TEMPLATE, ['GET']),
  compileEndpoint(KUN_GRAPH_EVENTS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_GRAPH_ARTIFACT_TEMPLATE, ['GET']),
  compileEndpoint(KUN_GRAPH_START_TEMPLATE, ['POST']),
  compileEndpoint(KUN_GRAPH_PAUSE_TEMPLATE, ['POST']),
  compileEndpoint(KUN_GRAPH_RESUME_TEMPLATE, ['POST']),
  compileEndpoint(KUN_GRAPH_CLEANUP_TEMPLATE, ['POST']),
  compileEndpoint(KUN_GRAPH_CANCEL_TEMPLATE, ['POST']),
  compileEndpoint(KUN_GRAPH_RETRY_TEMPLATE, ['POST']),
  compileEndpoint(KUN_GRAPH_STEER_TEMPLATE, ['POST']),
  compileEndpoint(KUN_GRAPH_PATCH_TEMPLATE, ['POST']),
  compileEndpoint(KUN_GRAPH_REVIEWS_TEMPLATE, ['POST']),
  compileEndpoint(KUN_GRAPH_SUPERVISION_TEMPLATE, ['GET']),
  compileEndpoint(KUN_GRAPH_SUPERVISION_WAKE_TEMPLATE, ['POST']),
  compileEndpoint(KUN_GRAPH_PROJECT_IDENTITY_TEMPLATE, ['GET']),
  compileEndpoint(KUN_GRAPH_PROJECT_AGENTS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_GRAPH_PROJECT_EVIDENCE_TEMPLATE, ['GET']),
  compileEndpoint(KUN_GRAPH_PROJECT_SCORES_TEMPLATE, ['GET']),
  compileEndpoint(KUN_GRAPH_PROJECT_AUDIT_TEMPLATE, ['GET']),
  compileEndpoint(KUN_GRAPH_PROJECT_CANDIDATES_TEMPLATE, ['GET']),
  compileEndpoint(KUN_GRAPH_PROJECT_JOBS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_GRAPH_PROJECT_AGENT_LIFECYCLE_TEMPLATE, ['POST']),
  compileEndpoint(KUN_GRAPH_PROJECT_AGENT_EXPORT_TEMPLATE, ['GET']),
  compileEndpoint(KUN_GRAPH_PROJECT_AGENTS_IMPORT_TEMPLATE, ['POST']),
  compileEndpoint(KUN_GRAPH_PROJECT_AGENTS_MERGE_TEMPLATE, ['POST']),
  compileEndpoint(KUN_GRAPH_PROJECT_CANDIDATE_ACTION_TEMPLATE, ['POST']),
  compileEndpoint(KUN_GRAPH_PROJECT_CONSOLIDATE_TEMPLATE, ['POST'])
]

function isAllowedRuntimeRequest(value: { path: string; method?: string }): boolean {
  try {
    const url = new URL(value.path, 'http://localhost')
    const path = url.pathname
    const method = value.method ?? 'GET'
    for (const endpoint of ENDPOINTS) {
      if (endpoint.match(path)) {
        return endpoint.allowedMethods.includes(method)
      }
    }
    return false
  } catch {
    return false
  }
}

export const runtimeRequestPayloadSchema = z
  .object({
    path: trimmedString(MAX_URL_LENGTH).transform((value) =>
      value.startsWith('/') ? value : `/${value}`
    ),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
    body: z.string().max(MAX_BODY_BYTES).optional(),
    requestId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional(),
    priority: z.enum(['foreground', 'background']).optional()
  })
  .refine((payload) => isAllowedRuntimeRequest(payload), {
    message: 'runtime request path is not allowed'
  })
  .strict()

export const runtimeRequestCancelPayloadSchema = z.object({
  requestId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/)
}).strict()

export const kunProtectedApprovalPayloadSchema = z
  .object({
    presentation: z.literal('room').optional(),
    approvalId: z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9._:-]+$/),
    decision: z.enum(['allow', 'deny']),
    source: z.enum(['policy', 'user'])
  })
  .strict()
