import type { JsonValue } from '../extensions/types.js'
import type {
  JobError,
  JobEvent,
  JobEventType,
  JobFilter,
  JobPage,
  JobProgress,
  JobResult,
  JobSnapshot,
  JobState,
  JobTerminalState
} from '@kun/extension-api'

export const EXTENSION_JOB_STORE_SCHEMA_VERSION = 1 as const
export const EXTENSION_JOB_SCHEMA_VERSION = 1 as const

export type ExtensionJobState = JobState
export type ExtensionJobTerminalState = JobTerminalState
export type ExtensionJobProgress = JobProgress
export type ExtensionJobErrorData = JobError
export type ExtensionJobResult = JobResult
export type ExtensionJobSnapshot = JobSnapshot
export type ExtensionJobEventType = JobEventType
export type ExtensionJobEvent = JobEvent
export type ExtensionJobFilter = JobFilter
export type ExtensionJobPage = JobPage

export type ExtensionJobOwner = {
  extensionId: string
  extensionVersion: string
  workspaceId: string
}

export type ExtensionJobCaller = {
  extensionId: string
  workspaceIds: readonly string[]
}

export type ExtensionJobIdempotency = {
  key: string
  operation: string
}

export type ExtensionJobCheckpoint = {
  schemaVersion: number
  data: JsonValue
}

export type StoredExtensionJob = {
  snapshot: ExtensionJobSnapshot
  /** Core-only filesystem authority. Never project this into snapshots or events. */
  workspaceRoot: string
  permissionsSnapshot: string[]
  idempotency?: ExtensionJobIdempotency
  cancellationReason?: string
  checkpoint?: ExtensionJobCheckpoint
  events: ExtensionJobEvent[]
  oldestRetainedSequence: number
  retainedEventBytes: number
}

export type ExtensionJobStoreDocument = {
  schemaVersion: typeof EXTENSION_JOB_STORE_SCHEMA_VERSION
  revision: number
  updatedAt: string
  jobs: Record<string, StoredExtensionJob>
  idempotency: Record<string, string>
}

export function isExtensionJobTerminal(state: ExtensionJobState): state is ExtensionJobTerminalState {
  return state === 'completed' || state === 'failed' || state === 'cancelled' || state === 'interrupted'
}

export function extensionJobCursor(jobId: string, sequence: number): string {
  return Buffer.from(JSON.stringify({ jobId, sequence }), 'utf8').toString('base64url')
}

export function parseExtensionJobCursor(cursor: string): { jobId: string; sequence: number } | undefined {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      jobId?: unknown
      sequence?: unknown
    }
    if (
      typeof parsed.jobId !== 'string' ||
      !Number.isSafeInteger(parsed.sequence) ||
      Number(parsed.sequence) < 0
    ) return undefined
    return { jobId: parsed.jobId, sequence: Number(parsed.sequence) }
  } catch {
    return undefined
  }
}
