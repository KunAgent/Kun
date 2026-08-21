import type {
  ThreadAgentSurface, ThreadGoal, ThreadMode, ThreadRecord, ThreadRelation, ThreadStatus,
  ThreadSummary, ThreadTodoList
} from '../../contracts/threads.js'
import {
  DEFAULT_APPROVAL_REVIEWER,
  type ApprovalPolicy,
  type ApprovalReviewer,
  type SandboxMode
} from '../../contracts/policy.js'
import type { ThreadStoreListOptions } from '../../ports/thread-store.js'
import { resolveThreadAgentSurface } from '../../domain/thread.js'

export type ThreadRow = {
  id: string; title: string; workspace: string; model: string; mode: ThreadMode; status: ThreadStatus
  agent_surface: ThreadAgentSurface | null
  approval_policy: ApprovalPolicy; sandbox_mode: SandboxMode
  approval_reviewer: ApprovalReviewer | null
  cost_budget_usd: number | null
  model_request_capture_enabled: number
  cost_budget_warning_sent: number | null; relation: ThreadRelation; parent_thread_id: string | null
  forked_from_thread_id: string | null; forked_from_title: string | null; forked_at: string | null
  forked_from_message_count: number | null; forked_from_turn_count: number | null
  goal_json: string | null; todos_json: string | null; created_at: string; updated_at: string
  extension_metadata_json: string | null
  created_at_ms: number; updated_at_ms: number; preview: string | null; message_count: number
  event_seq_high_water: number; metadata_path: string; messages_path: string; events_path: string
  search_text: string
}

export type ThreadIndexRecord = { thread: ThreadRecord; messageCount: number; eventSeqHighWater: number; preview: string }

export function rowFromIndexRecord(record: ThreadIndexRecord, paths: {
  metadataPath: string; messagesPath: string; eventsPath: string
}): ThreadRow {
  const thread = record.thread
  return {
    id: thread.id, title: thread.title, workspace: thread.workspace, model: thread.model,
    agent_surface: resolveThreadAgentSurface(thread),
    mode: thread.mode, status: thread.status, approval_policy: thread.approvalPolicy,
    sandbox_mode: thread.sandboxMode,
    approval_reviewer: thread.approvalReviewer ?? DEFAULT_APPROVAL_REVIEWER,
    model_request_capture_enabled: thread.modelRequestCaptureEnabled === true ? 1 : 0,
    cost_budget_usd: thread.costBudgetUsd ?? null,
    cost_budget_warning_sent: thread.costBudgetWarningSent === undefined ? null : thread.costBudgetWarningSent ? 1 : 0,
    relation: thread.relation ?? 'primary', parent_thread_id: thread.parentThreadId ?? null,
    forked_from_thread_id: thread.forkedFromThreadId ?? null, forked_from_title: thread.forkedFromTitle ?? null,
    forked_at: thread.forkedAt ?? null, forked_from_message_count: thread.forkedFromMessageCount ?? null,
    forked_from_turn_count: thread.forkedFromTurnCount ?? null,
    goal_json: thread.goal ? JSON.stringify(thread.goal) : null,
    todos_json: thread.todos ? JSON.stringify(thread.todos) : null,
    extension_metadata_json: thread.ownerExtensionId || thread.planBuildRunId
      || thread.planBuildAdmissionFingerprint || thread.planBuildAdmissionCapabilityHash
      || thread.planBuildAdmissionFrozen !== undefined ? JSON.stringify({
      ownerExtensionId: thread.ownerExtensionId,
      ownerExtensionVersion: thread.ownerExtensionVersion,
      accountId: thread.accountId,
      extensionVisibility: thread.extensionVisibility,
      extensionProfile: thread.extensionProfile,
      extensionBudget: thread.extensionBudget,
      toolCatalogEpoch: thread.toolCatalogEpoch,
      planBuildRunId: thread.planBuildRunId,
      planBuildAdmissionFingerprint: thread.planBuildAdmissionFingerprint,
      planBuildAdmissionCapabilityHash: thread.planBuildAdmissionCapabilityHash,
      planBuildAdmissionFrozen: thread.planBuildAdmissionFrozen
    }) : null,
    created_at: thread.createdAt, updated_at: thread.updatedAt,
    created_at_ms: isoToMillis(thread.createdAt), updated_at_ms: isoToMillis(thread.updatedAt),
    preview: record.preview || null, message_count: record.messageCount,
    event_seq_high_water: record.eventSeqHighWater, metadata_path: paths.metadataPath,
    messages_path: paths.messagesPath, events_path: paths.eventsPath,
    search_text: searchTextForThread(thread)
  }
}

export function summaryFromRow(row: ThreadRow): ThreadSummary {
  const goal = parseJson<ThreadGoal>(row.goal_json)
  const todos = parseJson<ThreadTodoList>(row.todos_json)
  const extension = parseJson<ExtensionThreadMetadata>(row.extension_metadata_json)
  return {
    id: row.id, title: row.title, workspace: row.workspace, model: row.model, mode: row.mode,
    agentSurface: row.agent_surface ?? 'code',
    status: row.status, approvalPolicy: row.approval_policy, sandboxMode: row.sandbox_mode,
    approvalReviewer: row.approval_reviewer ?? DEFAULT_APPROVAL_REVIEWER,
    modelRequestCaptureEnabled: Boolean(row.model_request_capture_enabled),
    ...(row.cost_budget_usd !== null ? { costBudgetUsd: row.cost_budget_usd } : {}),
    ...(row.cost_budget_warning_sent !== null ? { costBudgetWarningSent: Boolean(row.cost_budget_warning_sent) } : {}),
    relation: row.relation, ...(row.parent_thread_id ? { parentThreadId: row.parent_thread_id } : {}),
    ...(row.forked_from_thread_id ? { forkedFromThreadId: row.forked_from_thread_id } : {}),
    ...(row.forked_from_title ? { forkedFromTitle: row.forked_from_title } : {}),
    ...(row.forked_at ? { forkedAt: row.forked_at } : {}),
    ...(row.forked_from_message_count !== null ? { forkedFromMessageCount: row.forked_from_message_count } : {}),
    ...(row.forked_from_turn_count !== null ? { forkedFromTurnCount: row.forked_from_turn_count } : {}),
    ...(goal ? { goal } : {}), ...(todos ? { todos } : {}), ...(extension ?? {}),
    latestSeq: Math.max(0, row.event_seq_high_water),
    createdAt: row.created_at, updatedAt: row.updated_at
  }
}

type ExtensionThreadMetadata = Pick<ThreadRecord,
  'ownerExtensionId' | 'ownerExtensionVersion' | 'accountId' | 'extensionVisibility'
  | 'extensionProfile' | 'extensionBudget' | 'toolCatalogEpoch' | 'planBuildRunId'
  | 'planBuildAdmissionFingerprint' | 'planBuildAdmissionCapabilityHash'
  | 'planBuildAdmissionFrozen'>

export function filterThreadSummaries(summaries: ThreadSummary[], options: ThreadStoreListOptions): ThreadSummary[] {
  const query = options.search?.trim().toLowerCase()
  let out = options.archivedOnly ? summaries.filter((thread) => thread.status === 'archived')
    : options.includeArchived ? summaries
      : summaries.filter((thread) => thread.status !== 'archived' && thread.status !== 'deleted')
  if (!options.includeSide) out = out.filter((thread) => (thread.relation ?? 'primary') !== 'side')
  if (options.workspace) out = out.filter((thread) => thread.workspace === options.workspace)
  if (query) out = out.filter((thread) => searchTextForThread(thread).includes(query))
  return typeof options.limit === 'number' ? out.slice(0, options.limit) : out
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

function searchTextForThread(thread: Pick<ThreadRecord, 'id' | 'title' | 'workspace' | 'model' | 'mode' | 'forkedFromTitle' | 'forkedFromThreadId' | 'todos'>): string {
  return [thread.id, thread.title, thread.workspace, thread.model, thread.mode, thread.forkedFromTitle,
    thread.forkedFromThreadId, ...(thread.todos?.items.map((item) => item.content) ?? [])]
    .filter(Boolean).join('\n').toLowerCase()
}

function isoToMillis(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}
