/**
 * Kun HTTP endpoint path templates. The renderer and the main
 * process IPC allow-list both derive their paths from this table, so
 * adding a new endpoint is a one-file change.
 *
 * `*TEMPLATE` constants carry the `{id}` / `{turn}` placeholders
 * literally. `*PATH(...)` builders perform the URL encoding and
 * return a concrete path for runtime use.
 */

export const KUN_HEALTH_PATH = '/health'
export const KUN_HEALTH_TEMPLATE = '/health'

export const KUN_RUNTIME_INFO_PATH = '/v1/runtime/info'
export const KUN_RUNTIME_INFO_TEMPLATE = '/v1/runtime/info'

export const KUN_RUNTIME_TOOLS_PATH = '/v1/runtime/tools'
export const KUN_RUNTIME_TOOLS_TEMPLATE = '/v1/runtime/tools'
export const KUN_THREAD_GUARDIAN_PATH = '/v1/runtime/thread-guardian'
export const KUN_THREAD_GUARDIAN_TEMPLATE = '/v1/runtime/thread-guardian'

export const KUN_MODEL_CONNECTIONS_PATH = '/v1/model-connections'
export const KUN_MODEL_CONNECTIONS_TEMPLATE = '/v1/model-connections'
export const KUN_MODEL_CONNECTION_EVENTS_TEMPLATE = '/v1/model-connections/events'
export const KUN_MODEL_CONNECTION_CONNECT_TEMPLATE = '/v1/model-connections/connect'
export const KUN_MODEL_CONNECTION_SELECT_TEMPLATE = '/v1/model-connections/select'
export const KUN_MODEL_CONNECTION_OAUTH_START_TEMPLATE = '/v1/model-connections/oauth/start'
export const KUN_MODEL_CONNECTION_OAUTH_TEMPLATE = '/v1/model-connections/oauth/{id}'
export const KUN_MODEL_CONNECTION_OAUTH_SUBMIT_TEMPLATE =
  '/v1/model-connections/oauth/{id}/submit'
export const KUN_MODEL_CONNECTION_CLAUDE_SDK_TEMPLATE =
  '/v1/model-connections/claude/sdk'
export const KUN_MODEL_CONNECTION_CLAUDE_SDK_INSTALL_TEMPLATE =
  '/v1/model-connections/claude/sdk/install'
export const KUN_MODEL_CONNECTION_PROVIDER_TEMPLATE = '/v1/model-connections/{id}'
export const KUN_MODEL_CONNECTION_CREDENTIAL_TEMPLATE =
  '/v1/model-connections/{id}/credential'
export const KUN_MODEL_CONNECTION_CREDENTIAL_FENCE_TEMPLATE =
  '/v1/model-connections/{id}/credential/fence'
export const KUN_MODEL_CONNECTION_CREDENTIAL_COMMIT_TEMPLATE =
  '/v1/model-connections/{id}/credential/commit'
export const KUN_MODEL_CONNECTION_PROBE_TEMPLATE = '/v1/model-connections/{id}/probe'

export const KUN_MODEL_ROUTES_PATH = '/v1/model-routes'
export const KUN_MODEL_ROUTES_TEMPLATE = '/v1/model-routes'
export const KUN_GATEWAY_CREDENTIAL_STATUS_TEMPLATE = '/v1/model-gateway/credential/status'
export const KUN_GATEWAY_CREDENTIAL_ENSURE_TEMPLATE = '/v1/model-gateway/credential/ensure'
export const KUN_GATEWAY_CREDENTIAL_ROTATE_TEMPLATE = '/v1/model-gateway/credential/rotate'
export const KUN_GATEWAY_CREDENTIAL_REVOKE_TEMPLATE = '/v1/model-gateway/credential'
export const KUN_GATEWAY_CREDENTIAL_REVEAL_TEMPLATE = '/v1/model-gateway/credential/reveal'
export const KUN_MODEL_ROUTE_TEST_TEMPLATE = '/v1/model-routes/{id}/test'
export function kunModelRouteTestPath(poolId: string): string {
  return `/v1/model-routes/${encodeURIComponent(poolId)}/test`
}

export const KUN_SUPPLY_CHAIN_AUDIT_PATH = '/v1/supply-chain/audit'
export const KUN_SUPPLY_CHAIN_AUDIT_TEMPLATE = '/v1/supply-chain/audit'
export const KUN_SUPPLY_CHAIN_UPDATE_CHECK_PATH = '/v1/supply-chain/update-check'
export const KUN_SUPPLY_CHAIN_UPDATE_CHECK_TEMPLATE = '/v1/supply-chain/update-check'

export const KUN_MCP_OAUTH_PATH = '/v1/mcp/oauth'
export const KUN_MCP_OAUTH_TEMPLATE = '/v1/mcp/oauth'
export const KUN_MCP_OAUTH_SERVER_TEMPLATE = '/v1/mcp/oauth/{id}'
export function kunMcpOAuthServerPath(serverId: string): string {
  return `/v1/mcp/oauth/${encodeURIComponent(serverId)}`
}

export const KUN_SKILLS_PATH = '/v1/skills'
export const KUN_SKILLS_TEMPLATE = '/v1/skills'

export const KUN_ATTACHMENTS_PATH = '/v1/attachments'
export const KUN_ATTACHMENTS_TEMPLATE = '/v1/attachments'
export const KUN_ATTACHMENT_DIAGNOSTICS_PATH = '/v1/attachments/diagnostics'
export const KUN_ATTACHMENT_DIAGNOSTICS_TEMPLATE = '/v1/attachments/diagnostics'
export const KUN_ATTACHMENT_TEMPLATE = '/v1/attachments/{id}'
export function kunAttachmentPath(attachmentId: string): string {
  return `/v1/attachments/${encodeURIComponent(attachmentId)}`
}
export const KUN_ATTACHMENT_CONTENT_TEMPLATE = '/v1/attachments/{id}/content'
export function kunAttachmentContentPath(attachmentId: string): string {
  return `${kunAttachmentPath(attachmentId)}/content`
}

export const KUN_MEMORY_PATH = '/v1/memory'
export const KUN_MEMORY_TEMPLATE = '/v1/memory'
export const KUN_MEMORY_DIAGNOSTICS_PATH = '/v1/memory/diagnostics'
export const KUN_MEMORY_DIAGNOSTICS_TEMPLATE = '/v1/memory/diagnostics'
export const KUN_MEMORY_RECORD_TEMPLATE = '/v1/memory/{id}'
export function kunMemoryRecordPath(memoryId: string): string {
  return `/v1/memory/${encodeURIComponent(memoryId)}`
}

export const KUN_DELEGATION_PROFILES_PATH = '/v1/delegation/profiles'
export const KUN_DELEGATION_PROFILES_TEMPLATE = '/v1/delegation/profiles'
export const KUN_DELEGATION_DIAGNOSTICS_PATH = '/v1/delegation/diagnostics'
export const KUN_DELEGATION_DIAGNOSTICS_TEMPLATE = '/v1/delegation/diagnostics'
export const KUN_DELEGATION_ABORT_TEMPLATE = '/v1/delegation/abort/{id}'
export function kunDelegationProfilesPath(workspace?: string): string {
  if (!workspace?.trim()) return KUN_DELEGATION_PROFILES_PATH
  return `${KUN_DELEGATION_PROFILES_PATH}?workspace=${encodeURIComponent(workspace.trim())}`
}
export function kunDelegationDiagnosticsPath(parentThreadId?: string): string {
  if (!parentThreadId?.trim()) return KUN_DELEGATION_DIAGNOSTICS_PATH
  return `${KUN_DELEGATION_DIAGNOSTICS_PATH}?parent_thread_id=${encodeURIComponent(parentThreadId.trim())}`
}
export function kunDelegationAbortPath(childId: string): string {
  return `/v1/delegation/abort/${encodeURIComponent(childId)}`
}

export const KUN_GRAPHS_PATH = '/v1/graphs'
export const KUN_GRAPHS_TEMPLATE = '/v1/graphs'
export const KUN_GRAPH_TEMPLATE = '/v1/graphs/{id}'
export function kunGraphPath(runId: string): string {
  return `${KUN_GRAPHS_PATH}/${encodeURIComponent(runId)}`
}
export const KUN_GRAPH_DRAFTS_PATH = '/v1/graph-drafts'
export const KUN_GRAPH_DRAFTS_TEMPLATE = '/v1/graph-drafts'
export const KUN_GRAPH_DRAFT_TEMPLATE = '/v1/graph-drafts/{id}'
export function kunGraphDraftPath(draftId: string): string {
  return `${KUN_GRAPH_DRAFTS_PATH}/${encodeURIComponent(draftId)}`
}
export const KUN_GRAPH_DRAFT_RESUME_TEMPLATE = '/v1/graph-drafts/{id}/resume'
export const KUN_GRAPH_DRAFT_CANCEL_TEMPLATE = '/v1/graph-drafts/{id}/cancel'
export function kunGraphDraftActionPath(
  draftId: string,
  action: 'resume' | 'cancel'
): string {
  return `${kunGraphDraftPath(draftId)}/${action}`
}
export const KUN_GRAPH_EVENTS_TEMPLATE = '/v1/graphs/{id}/events'
export function kunGraphEventsPath(runId: string): string {
  return `${kunGraphPath(runId)}/events`
}
export const KUN_GRAPH_ARTIFACT_TEMPLATE = '/v1/graphs/{id}/artifacts/{id}'
export function kunGraphArtifactPath(runId: string, artifactId: string): string {
  return `${kunGraphPath(runId)}/artifacts/${encodeURIComponent(artifactId)}`
}
export const KUN_GRAPH_START_TEMPLATE = '/v1/graphs/{id}/start'
export const KUN_GRAPH_PAUSE_TEMPLATE = '/v1/graphs/{id}/pause'
export const KUN_GRAPH_RESUME_TEMPLATE = '/v1/graphs/{id}/resume'
export const KUN_GRAPH_CLEANUP_TEMPLATE = '/v1/graphs/{id}/cleanup'
export const KUN_GRAPH_CANCEL_TEMPLATE = '/v1/graphs/{id}/cancel'
export const KUN_GRAPH_RETRY_TEMPLATE = '/v1/graphs/{id}/retry'
export const KUN_GRAPH_STEER_TEMPLATE = '/v1/graphs/{id}/steer'
export const KUN_GRAPH_PATCH_TEMPLATE = '/v1/graphs/{id}/patch'
export const KUN_GRAPH_REVIEWS_TEMPLATE = '/v1/graphs/{id}/reviews'
export const KUN_GRAPH_SUPERVISION_TEMPLATE = '/v1/graphs/{id}/supervision'
export const KUN_GRAPH_SUPERVISION_WAKE_TEMPLATE = '/v1/graphs/{id}/supervision/wake'
export function kunGraphSupervisionPath(runId: string): string {
  return `${kunGraphPath(runId)}/supervision`
}
export function kunGraphSupervisionWakePath(runId: string): string {
  return `${kunGraphSupervisionPath(runId)}/wake`
}
export function kunGraphActionPath(
  runId: string,
  action: 'start' | 'pause' | 'resume' | 'cleanup' | 'cancel' | 'retry' | 'steer' | 'patch' | 'reviews'
): string {
  return `${kunGraphPath(runId)}/${action}`
}

export const KUN_GRAPH_PROJECT_IDENTITY_PATH = '/v1/graph-projects/identity'
export const KUN_GRAPH_PROJECT_IDENTITY_TEMPLATE = '/v1/graph-projects/identity'
export function kunGraphProjectPath(projectId: string): string {
  return `/v1/graph-projects/${encodeURIComponent(projectId)}`
}
export const KUN_GRAPH_PROJECT_AGENTS_TEMPLATE = '/v1/graph-projects/{id}/agents'
export function kunGraphProjectAgentsPath(projectId: string): string {
  return `${kunGraphProjectPath(projectId)}/agents`
}
export const KUN_GRAPH_PROJECT_EVIDENCE_TEMPLATE = '/v1/graph-projects/{id}/evidence'
export const KUN_GRAPH_PROJECT_SCORES_TEMPLATE = '/v1/graph-projects/{id}/scores'
export const KUN_GRAPH_PROJECT_AUDIT_TEMPLATE = '/v1/graph-projects/{id}/audit'
export const KUN_GRAPH_PROJECT_CANDIDATES_TEMPLATE = '/v1/graph-projects/{id}/candidates'
export const KUN_GRAPH_PROJECT_JOBS_TEMPLATE = '/v1/graph-projects/{id}/jobs'
export function kunGraphProjectCollectionPath(
  projectId: string,
  collection: 'evidence' | 'scores' | 'audit' | 'candidates' | 'jobs'
): string {
  return `${kunGraphProjectPath(projectId)}/${collection}`
}
export const KUN_GRAPH_PROJECT_AGENT_LIFECYCLE_TEMPLATE =
  '/v1/graph-projects/{id}/agents/{id}/lifecycle'
export const KUN_GRAPH_PROJECT_AGENT_EXPORT_TEMPLATE =
  '/v1/graph-projects/{id}/agents/{id}/export'
export function kunGraphProjectAgentActionPath(
  projectId: string,
  profileId: string,
  action: 'lifecycle' | 'export'
): string {
  return `${kunGraphProjectAgentsPath(projectId)}/${encodeURIComponent(profileId)}/${action}`
}
export const KUN_GRAPH_PROJECT_AGENTS_IMPORT_TEMPLATE =
  '/v1/graph-projects/{id}/agents/import'
export const KUN_GRAPH_PROJECT_AGENTS_MERGE_TEMPLATE =
  '/v1/graph-projects/{id}/agents/merge'
export function kunGraphProjectAgentsActionPath(
  projectId: string,
  action: 'import' | 'merge'
): string {
  return `${kunGraphProjectAgentsPath(projectId)}/${action}`
}
export const KUN_GRAPH_PROJECT_CANDIDATE_ACTION_TEMPLATE =
  '/v1/graph-projects/{id}/candidates/{id}/action'
export function kunGraphProjectCandidateActionPath(
  projectId: string,
  candidateId: string
): string {
  return `${kunGraphProjectPath(projectId)}/candidates/${encodeURIComponent(candidateId)}/action`
}
export const KUN_GRAPH_PROJECT_CONSOLIDATE_TEMPLATE =
  '/v1/graph-projects/{id}/consolidate'
export function kunGraphProjectConsolidatePath(projectId: string): string {
  return `${kunGraphProjectPath(projectId)}/consolidate`
}

export const KUN_THREAD_ACTIVITY_EVENTS_PATH = '/v1/thread-activity/events'
export const KUN_THREAD_ACTIVITY_EVENTS_TEMPLATE = '/v1/thread-activity/events'

export const KUN_THREADS_PATH = '/v1/threads'
export const KUN_THREADS_TEMPLATE = '/v1/threads'

export const KUN_THREAD_STATES_PATH = '/v1/threads/states'
export const KUN_THREAD_STATES_TEMPLATE = '/v1/threads/states'

export const KUN_THREADS_BULK_DELETE_PATH = '/v1/threads/bulk-delete'
export const KUN_THREADS_BULK_DELETE_TEMPLATE = '/v1/threads/bulk-delete'

export const KUN_THREADS_CONTENT_SEARCH_PATH = '/v1/threads/content-search'
export const KUN_THREADS_CONTENT_SEARCH_TEMPLATE = '/v1/threads/content-search'

export const KUN_PROJECT_BOARD_SNAPSHOT_PATH = '/v1/project-boards/snapshot'
export const KUN_PROJECT_BOARD_SNAPSHOT_TEMPLATE = '/v1/project-boards/snapshot'
export const KUN_PROJECT_BOARD_SUMMARIES_PATH = '/v1/project-boards/summaries'
export const KUN_PROJECT_BOARD_SUMMARIES_TEMPLATE = '/v1/project-boards/summaries'
export const KUN_PROJECT_BOARD_CARDS_PATH = '/v1/project-boards/cards'
export const KUN_PROJECT_BOARD_CARDS_TEMPLATE = '/v1/project-boards/cards'
export const KUN_PROJECT_BOARD_CARD_STATUS_PATH = '/v1/project-boards/cards/status'
export const KUN_PROJECT_BOARD_CARD_STATUS_TEMPLATE = '/v1/project-boards/cards/status'
export const KUN_PROJECT_BOARD_CARD_TEMPLATE = '/v1/project-boards/cards/{id}'
export const KUN_PROJECT_BOARD_TODO_OVERLAY_TEMPLATE =
  '/v1/project-boards/todo-overlays/{id}/{id}'
export function kunProjectBoardCardPath(cardId: string): string {
  return `${KUN_PROJECT_BOARD_CARDS_PATH}/${encodeURIComponent(cardId)}`
}
export function kunProjectBoardTodoOverlayPath(threadId: string, todoId: string): string {
  return `/v1/project-boards/todo-overlays/${encodeURIComponent(threadId)}/${encodeURIComponent(todoId)}`
}

export const KUN_THREAD_TEMPLATE = '/v1/threads/{id}'
export function kunThreadPath(threadId: string): string {
  return `/v1/threads/${encodeURIComponent(threadId)}`
}

export const KUN_THREAD_SUMMARY_TEMPLATE = '/v1/threads/{id}/summary'
export function kunThreadSummaryPath(threadId: string): string {
  return `${kunThreadPath(threadId)}/summary`
}

export const KUN_THREAD_STATE_TEMPLATE = '/v1/threads/{id}/state'
export function kunThreadStatePath(threadId: string): string {
  return `${kunThreadPath(threadId)}/state`
}

export const KUN_THREAD_TIMELINE_TEMPLATE = '/v1/threads/{id}/timeline'
export function kunThreadTimelinePath(
  threadId: string,
  options: { before?: string; limit?: number } = {}
): string {
  const params = new URLSearchParams()
  if (options.before) params.set('before', options.before)
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  const query = params.toString()
  return `${kunThreadPath(threadId)}/timeline${query ? `?${query}` : ''}`
}

export const KUN_THREAD_KNOWLEDGE_BASES_TEMPLATE = '/v1/threads/{id}/knowledge-bases'
export function kunThreadKnowledgeBasesPath(threadId: string): string {
  return `${kunThreadPath(threadId)}/knowledge-bases`
}

export const KUN_THREAD_KNOWLEDGE_BASE_REINDEX_TEMPLATE =
  '/v1/threads/{id}/knowledge-bases/{id}/reindex'
export function kunThreadKnowledgeBaseReindexPath(
  threadId: string,
  knowledgeBaseId: string
): string {
  return `${kunThreadKnowledgeBasesPath(threadId)}/${encodeURIComponent(knowledgeBaseId)}/reindex`
}

export const KUN_THREAD_FORK_TEMPLATE = '/v1/threads/{id}/fork'
export function kunThreadForkPath(threadId: string): string {
  return `${kunThreadPath(threadId)}/fork`
}

export const KUN_THREAD_SUMMARIZE_TEMPLATE = '/v1/threads/{id}/summarize'
export function kunThreadSummarizePath(threadId: string): string {
  return `${kunThreadPath(threadId)}/summarize`
}

export const KUN_THREAD_GOAL_TEMPLATE = '/v1/threads/{id}/goal'
export function kunThreadGoalPath(threadId: string): string {
  return `${kunThreadPath(threadId)}/goal`
}

export const KUN_THREAD_TODOS_TEMPLATE = '/v1/threads/{id}/todos'
export function kunThreadTodosPath(threadId: string): string {
  return `${kunThreadPath(threadId)}/todos`
}

export const KUN_THREAD_TODOS_SYNC_PLAN_TEMPLATE = '/v1/threads/{id}/todos/sync-plan'
export function kunThreadTodosSyncPlanPath(threadId: string): string {
  return `${kunThreadTodosPath(threadId)}/sync-plan`
}

export const KUN_THREAD_TODO_TEMPLATE = '/v1/threads/{id}/todos/{id}'
export function kunThreadTodoPath(threadId: string, todoId: string): string {
  return `${kunThreadTodosPath(threadId)}/${encodeURIComponent(todoId)}`
}

export const KUN_THREAD_COMPACT_TEMPLATE = '/v1/threads/{id}/compact'
export function kunThreadCompactPath(threadId: string): string {
  return `${kunThreadPath(threadId)}/compact`
}

export const KUN_THREAD_PRUNE_TEMPLATE = '/v1/threads/{id}/prune'
export function kunThreadPrunePath(threadId: string): string {
  return `${kunThreadPath(threadId)}/prune`
}

export const KUN_THREAD_REVIEW_TEMPLATE = '/v1/threads/{id}/review'
export function kunThreadReviewPath(threadId: string): string {
  return `${kunThreadPath(threadId)}/review`
}

export const KUN_THREAD_REWIND_TEMPLATE = '/v1/threads/{id}/rewind'
export function kunThreadRewindPath(threadId: string): string {
  return `${kunThreadPath(threadId)}/rewind`
}

export const KUN_THREAD_TURNS_TEMPLATE = '/v1/threads/{id}/turns'
export function kunThreadTurnsPath(threadId: string): string {
  return `${kunThreadPath(threadId)}/turns`
}

export const KUN_THREAD_TURN_TEMPLATE = '/v1/threads/{id}/turns/{turn}'
export function kunThreadTurnPath(threadId: string, turnId: string): string {
  return `${kunThreadTurnsPath(threadId)}/${encodeURIComponent(turnId)}`
}

export const KUN_THREAD_STEER_TEMPLATE = '/v1/threads/{id}/turns/{turn}/steer'
export function kunThreadCancelQueuedPath(threadId: string, turnId: string): string {
  return `/v1/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/cancel-queued`
}

export function kunThreadQueuePositionPath(threadId: string, turnId: string): string {
  return `/v1/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/queue-position`
}

export function kunThreadQueueResumePath(threadId: string): string {
  return `/v1/threads/${encodeURIComponent(threadId)}/queue/resume`
}

export const KUN_THREAD_QUEUED_TURNS_TEMPLATE = '/v1/threads/{id}/queued-turns'
export function kunThreadQueuedTurnsPath(threadId: string): string {
  return `/v1/threads/${encodeURIComponent(threadId)}/queued-turns`
}

export function kunThreadSteerPath(threadId: string, turnId: string): string {
  return `${kunThreadTurnPath(threadId, turnId)}/steer`
}

export const KUN_THREAD_INTERRUPT_TEMPLATE = '/v1/threads/{id}/turns/{turn}/interrupt'
export function kunThreadInterruptPath(threadId: string, turnId: string): string {
  return `${kunThreadTurnPath(threadId, turnId)}/interrupt`
}

export const KUN_THREAD_TOOL_CANCEL_TEMPLATE =
  '/v1/threads/{id}/turns/{turn}/tool-calls/{id}/cancel'
export function kunThreadToolCancelPath(threadId: string, turnId: string, callId: string): string {
  return `${kunThreadTurnPath(threadId, turnId)}/tool-calls/${encodeURIComponent(callId)}/cancel`
}

export const KUN_THREAD_EVENTS_TEMPLATE = '/v1/threads/{id}/events'
export function kunThreadEventsPath(threadId: string): string {
  return `${kunThreadPath(threadId)}/events`
}

export const KUN_THREAD_MODEL_REQUESTS_TEMPLATE = '/v1/threads/{id}/model-requests'
export function kunThreadModelRequestsPath(threadId: string): string {
  return `${kunThreadPath(threadId)}/model-requests`
}

export const KUN_THREAD_TRAJECTORY_TEMPLATE = '/v1/threads/{id}/trajectory'
export const KUN_THREAD_TRAJECTORY_SUMMARY_TEMPLATE = '/v1/threads/{id}/trajectory/summary'
export const KUN_THREAD_TRAJECTORY_DETAIL_TEMPLATE =
  '/v1/threads/{id}/trajectory/{id}/detail'
export function kunThreadTrajectoryPath(threadId: string): string {
  return `${kunThreadPath(threadId)}/trajectory`
}
export function kunThreadTrajectorySummaryPath(threadId: string): string {
  return `${kunThreadTrajectoryPath(threadId)}/summary`
}
export function kunThreadTrajectoryDetailPath(threadId: string, recordId: string): string {
  return `${kunThreadTrajectoryPath(threadId)}/${encodeURIComponent(recordId)}/detail`
}

export const KUN_APPROVAL_TEMPLATE = '/v1/approvals/{id}'
export function kunApprovalPath(approvalId: string): string {
  return `/v1/approvals/${encodeURIComponent(approvalId)}`
}

export const KUN_USER_INPUT_TEMPLATE = '/v1/user-inputs/{id}'
export function kunUserInputPath(inputId: string): string {
  return `/v1/user-inputs/${encodeURIComponent(inputId)}`
}

export const KUN_SESSION_RESUME_TEMPLATE = '/v1/sessions/{id}/resume-thread'
export function kunSessionResumePath(sessionId: string): string {
  return `/v1/sessions/${encodeURIComponent(sessionId)}/resume-thread`
}

export const KUN_SESSION_RESUME_METADATA_TEMPLATE = '/v1/sessions/{id}/resume-metadata'
export function kunSessionResumeMetadataPath(sessionId: string): string {
  return `/v1/sessions/${encodeURIComponent(sessionId)}/resume-metadata`
}

export const KUN_USAGE_PATH = '/v1/usage'
export const KUN_USAGE_TEMPLATE = '/v1/usage'

export const KUN_DEBUG_LLM_ROUNDS_PATH = '/v1/debug/llm-rounds'
export const KUN_DEBUG_LLM_ROUNDS_TEMPLATE = '/v1/debug/llm-rounds'

export const KUN_BACKGROUND_SHELLS_PATH = '/v1/background-shells'
export const KUN_BACKGROUND_SHELLS_TEMPLATE = '/v1/background-shells'
export const KUN_BACKGROUND_SHELL_TEMPLATE = '/v1/background-shells/{sessionId}'
export function kunBackgroundShellPath(sessionId: string): string {
  return `/v1/background-shells/${encodeURIComponent(sessionId)}`
}
export function kunBackgroundShellStopPath(sessionId: string): string {
  return `${kunBackgroundShellPath(sessionId)}/stop`
}

/** Thread mode shared with the Kun contract. */
export type KunThreadMode = 'agent' | 'plan'

const THREAD_MODES: ReadonlySet<KunThreadMode> = new Set<KunThreadMode>(['agent', 'plan'])

export function isKunThreadMode(value: unknown): value is KunThreadMode {
  return typeof value === 'string' && (THREAD_MODES as Set<string>).has(value)
}

export function normalizeThreadMode(value: unknown): KunThreadMode {
  return value === 'plan' ? 'plan' : 'agent'
}
