import { createHash, randomUUID } from 'node:crypto'
import { lstat, open, opendir } from 'node:fs/promises'
import type { BigIntStats } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { TextDecoder } from 'node:util'
import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import { AttachmentMetadata, type AttachmentMetadata as AttachmentMetadataType } from '../contracts/attachments.js'
import { RuntimeEvent } from '../contracts/events.js'
import { TurnItem } from '../contracts/items.js'
import {
  ThreadStoreDiagnostic,
  ThreadStoreDiagnosticReport,
  type ThreadStoreArtifactStatus,
  type ThreadStoreDiagnosticIssue,
  type ThreadStoreDoctorLimits,
  type ThreadStoreMetadataSource
} from '../contracts/thread-store-diagnostics.js'
import { isSafeThreadId } from '../contracts/thread-id.js'
import { ThreadSchema, type ThreadRecord } from '../contracts/threads.js'
import { ATTACHMENT_ID_PATTERN, type AttachmentBaseInspection, MAX_REPORT_ISSUES } from './thread-store-doctor-scan.js'
import { readBoundedFile, ScanBudget } from './thread-store-doctor-stability.js'
import { sqliteColumn, sqliteIndex } from './thread-store-doctor-sqlite.js'
import { attachmentIssueCode, attachmentIssueMessage, decodeUtf8, isRecord, issue, listThreadIds, sha256, worseStatus } from './thread-store-doctor-support.js'

export class AttachmentInspector {
  private readonly cache = new Map<string, AttachmentBaseInspection>()
  private readonly rootDir: string
  private readonly budget: ScanBudget
  private readonly limits: ThreadStoreDoctorLimits

  constructor(options: { rootDir: string; budget: ScanBudget; limits: ThreadStoreDoctorLimits }) {
    this.rootDir = options.rootDir
    this.budget = options.budget
    this.limits = options.limits
  }

  get scannedCount(): number {
    return this.cache.size
  }

  async inspect(
    ids: string[],
    threadId: string,
    workspace: string | undefined
  ): Promise<{
    status: ThreadStoreArtifactStatus
    incomplete: boolean
    issues: ThreadStoreDiagnosticIssue[]
  }> {
    let status: ThreadStoreArtifactStatus = 'ok'
    let incomplete = false
    const issues: ThreadStoreDiagnosticIssue[] = []
    for (const id of ids.sort()) {
      if (!ATTACHMENT_ID_PATTERN.test(id)) {
        status = worseStatus(status, 'invalid')
        issues.push(issue('invalid_attachment_reference', 'A thread contains an invalid attachment reference.', 'error'))
        continue
      }
      let inspected = this.cache.get(id)
      if (!inspected) {
        if (this.cache.size >= this.limits.maxAttachments) {
          status = worseStatus(status, 'limit_exceeded')
          incomplete = true
          issues.push(issue('attachment_limit_exceeded', 'The scan reached its configured attachment limit.', 'warning'))
          continue
        }
        inspected = await this.inspectBase(id)
        this.cache.set(id, inspected)
      }
      let nextStatus = inspected.status
      if (nextStatus === 'ok' && inspected.scopes) {
        const { threadIds, workspaces } = inspected.scopes
        if (threadIds.size === 0 && workspaces.size === 0) {
          nextStatus = 'ok'
        } else if (threadIds.has(threadId)) {
          nextStatus = 'ok'
        } else if (workspace && workspaces.has(workspace)) {
          nextStatus = 'ok'
        } else if (!workspace && workspaces.size > 0) {
          nextStatus = 'indeterminate'
        } else {
          nextStatus = 'mismatch'
        }
      }
      if (isIncompleteAttachmentStatus(nextStatus)) incomplete = true
      status = worseStatus(status, nextStatus)
      if (nextStatus !== 'ok' && issues.length < MAX_REPORT_ISSUES) {
        issues.push(issue(
          attachmentIssueCode(nextStatus),
          attachmentIssueMessage(nextStatus),
          nextStatus === 'limit_exceeded'
            || nextStatus === 'changed'
            || nextStatus === 'indeterminate'
            ? 'warning'
            : 'error'
        ))
      }
    }
    return { status, incomplete, issues }
  }

  private async inspectBase(id: string): Promise<AttachmentBaseInspection> {
    const metadataRead = await readBoundedFile(
      join(this.rootDir, `${id}.json`),
      this.budget,
      this.limits.maxArtifactBytes
    )
    if (metadataRead.kind === 'missing') return { status: 'missing' }
    if (metadataRead.kind === 'artifact_limit' || metadataRead.kind === 'total_limit') {
      return { status: 'limit_exceeded' }
    }
    if (metadataRead.kind === 'changed') return { status: 'changed' }
    if (metadataRead.kind !== 'ok') return { status: 'invalid' }
    const text = decodeUtf8(metadataRead.bytes)
    if (text === null) return { status: 'invalid' }

    let metadata: AttachmentMetadataType
    try {
      const raw = JSON.parse(text) as unknown
      const scopeValidation = validateAttachmentScopes(raw, this.limits)
      if (scopeValidation !== 'ok') return { status: scopeValidation }
      metadata = AttachmentMetadata.parse(raw)
    } catch {
      return { status: 'invalid' }
    }
    if (metadata.id !== id) return { status: 'mismatch' }

    const scopes = {
      threadIds: new Set(metadata.threadIds),
      workspaces: new Set(metadata.workspaces)
    }

    const content = await readBoundedFile(
      join(this.rootDir, `${id}.bin`),
      this.budget,
      this.limits.maxArtifactBytes
    )
    if (content.kind === 'missing') return { status: 'missing' }
    if (content.kind === 'artifact_limit' || content.kind === 'total_limit') {
      return { status: 'limit_exceeded' }
    }
    if (content.kind === 'changed') return { status: 'changed' }
    if (content.kind !== 'ok') return { status: 'invalid' }
    if (
      content.bytes.length !== metadata.byteSize
      || sha256(content.bytes) !== metadata.hash.toLowerCase()
    ) return { status: 'mismatch' }
    return { status: 'ok', scopes }
  }
}

export function isIncompleteAttachmentStatus(status: ThreadStoreArtifactStatus): boolean {
  return status === 'changed' || status === 'limit_exceeded' || status === 'indeterminate'
}

export function validateAttachmentScopes(
  raw: unknown,
  limits: ThreadStoreDoctorLimits
): 'ok' | 'invalid' | 'limit_exceeded' {
  if (!isRecord(raw)) return 'invalid'
  const threadIds = raw.threadIds ?? []
  const workspaces = raw.workspaces ?? []
  if (!Array.isArray(threadIds) || !Array.isArray(workspaces)) return 'invalid'
  if (threadIds.length + workspaces.length > limits.maxAttachmentScopeEntries) {
    return 'limit_exceeded'
  }
  for (const values of [threadIds, workspaces]) {
    for (const value of values) {
      if (typeof value !== 'string') return 'invalid'
      if (value.length > limits.maxAttachmentScopeItemChars) return 'limit_exceeded'
    }
  }
  return 'ok'
}

export type ReadonlyIndexRow = {
  metadata_path?: string
  messages_path?: string
  events_path?: string
}

export type ReadonlyIndex = {
  getThread: (threadId: string) => ReadonlyIndexRow | undefined
  listThreadIds: (limit: number) => {
    threadIds: string[]
    overflow: boolean
    invalidRows: boolean
  }
  close: () => void
}

export type ReadonlyIndexState = {
  status: 'ok' | 'missing' | 'invalid' | 'mismatch' | 'changed' | 'limit_exceeded'
  index: ReadonlyIndex | null
  verifyStable: () => Promise<boolean>
}

export type SqliteColumnExpectation = {
  name: string
  type: 'TEXT' | 'REAL' | 'INTEGER'
  notNull: boolean
  primaryKeyPosition: number
  defaultValue: string | null
}

export const REQUIRED_SQLITE_COLUMNS: Readonly<Record<string, readonly SqliteColumnExpectation[]>> = {
  threads: [
    sqliteColumn('id', 'TEXT', false, 1),
    sqliteColumn('title', 'TEXT', true),
    sqliteColumn('workspace', 'TEXT', true),
    sqliteColumn('model', 'TEXT', true),
    sqliteColumn('agent_surface', 'TEXT', false),
    sqliteColumn('mode', 'TEXT', true),
    sqliteColumn('status', 'TEXT', true),
    sqliteColumn('approval_policy', 'TEXT', true),
    sqliteColumn('sandbox_mode', 'TEXT', true),
    sqliteColumn('approval_reviewer', 'TEXT', true, 0, "'user'"),
    sqliteColumn('model_request_capture_enabled', 'INTEGER', true, 0, '0'),
    sqliteColumn('cost_budget_usd', 'REAL', false),
    sqliteColumn('cost_budget_warning_sent', 'INTEGER', false),
    sqliteColumn('relation', 'TEXT', true),
    sqliteColumn('parent_thread_id', 'TEXT', false),
    sqliteColumn('forked_from_thread_id', 'TEXT', false),
    sqliteColumn('forked_from_title', 'TEXT', false),
    sqliteColumn('forked_at', 'TEXT', false),
    sqliteColumn('forked_from_message_count', 'INTEGER', false),
    sqliteColumn('forked_from_turn_count', 'INTEGER', false),
    sqliteColumn('goal_json', 'TEXT', false),
    sqliteColumn('todos_json', 'TEXT', false),
    sqliteColumn('extension_metadata_json', 'TEXT', false),
    sqliteColumn('created_at', 'TEXT', true),
    sqliteColumn('updated_at', 'TEXT', true),
    sqliteColumn('created_at_ms', 'INTEGER', true),
    sqliteColumn('updated_at_ms', 'INTEGER', true),
    sqliteColumn('preview', 'TEXT', false),
    sqliteColumn('message_count', 'INTEGER', true, 0, '0'),
    sqliteColumn('event_seq_high_water', 'INTEGER', true, 0, '0'),
    sqliteColumn('metadata_path', 'TEXT', true),
    sqliteColumn('messages_path', 'TEXT', true),
    sqliteColumn('events_path', 'TEXT', true),
    sqliteColumn('search_text', 'TEXT', true),
    sqliteColumn('usage_backfilled', 'INTEGER', true, 0, '0'),
    sqliteColumn('usage_backfill_high_water', 'INTEGER', true, 0, '0')
  ],
  usage_events: [
    sqliteColumn('thread_id', 'TEXT', true, 1),
    sqliteColumn('seq', 'INTEGER', true, 2),
    sqliteColumn('timestamp', 'TEXT', true),
    sqliteColumn('turn_id', 'TEXT', false),
    sqliteColumn('model', 'TEXT', false),
    sqliteColumn('provider_id', 'TEXT', false),
    sqliteColumn('usage_json', 'TEXT', true)
  ]
}

export const REQUIRED_SQLITE_INDEXES = [
  sqliteIndex('threads', 'threads_updated_idx', [['updated_at_ms', true], ['id', true]]),
  sqliteIndex('threads', 'threads_workspace_updated_idx', [
    ['workspace', false], ['updated_at_ms', true], ['id', true]
  ]),
  sqliteIndex('threads', 'threads_status_updated_idx', [
    ['status', false], ['updated_at_ms', true], ['id', true]
  ]),
  sqliteIndex('threads', 'threads_relation_updated_idx', [
    ['relation', false], ['updated_at_ms', true], ['id', true]
  ]),
  sqliteIndex('usage_events', 'usage_events_thread_seq_idx', [
    ['thread_id', false], ['seq', false]
  ]),
  sqliteIndex('usage_events', 'usage_events_timestamp_idx', [['timestamp', false]])
] as const

export type WalState =
  | { kind: 'missing' }
  | { kind: 'file'; stat: BigIntStats }
  | { kind: 'invalid' }
