/**
 * Snapshots of an Office file taken before Kun changes it from the artifact
 * chat panel. They back "undo", "compare with before" and the Versions list.
 * The main process keeps them outside the workspace, keyed by the resolved
 * file path, so restoring never depends on git checkpoints.
 */

export const MAX_OFFICE_VERSION_BYTES = 64 * 1024 * 1024
export const MAX_OFFICE_VERSIONS_PER_FILE = 20
export const MAX_OFFICE_VERSION_LABEL_CHARS = 200

export type OfficeVersionReason = 'agent-edit' | 'restore'

export type OfficeVersionEntry = {
  id: string
  createdAt: string
  /** SHA-256 of the snapshot bytes. */
  sha256: string
  /** File SHA-256 right after the change this snapshot precedes, when known. */
  replacedBySha256?: string
  size: number
  /** The user's request (agent-edit) or what was restored (restore). */
  label: string
  reason: OfficeVersionReason
  threadId?: string
}

export type OfficeVersionTarget = {
  workspaceRoot: string
  path: string
}

export type OfficeVersionRecordPayload = OfficeVersionTarget & {
  dataBase64: string
  sha256: string
  replacedBySha256?: string
  label: string
  threadId?: string
}

export type OfficeVersionReadPayload = OfficeVersionTarget & { id: string }

export type OfficeVersionRestorePayload = OfficeVersionTarget & {
  id: string
  /** The file must still have this content; a newer change is never overwritten. */
  expectedSha256: string
}

export type OfficeVersionFailure = {
  ok: false
  code: 'invalid' | 'missing' | 'changed' | 'io'
  message: string
}

export type OfficeVersionRecordResult = { ok: true; entry: OfficeVersionEntry } | OfficeVersionFailure
export type OfficeVersionListResult = { ok: true; entries: OfficeVersionEntry[] } | OfficeVersionFailure
export type OfficeVersionReadResult =
  | { ok: true; entry: OfficeVersionEntry; dataBase64: string }
  | OfficeVersionFailure
export type OfficeVersionRestoreResult =
  | { ok: true; sha256: string; backup: OfficeVersionEntry }
  | OfficeVersionFailure

export type KunGuiOfficeVersionApi = {
  recordOfficeVersion: (payload: OfficeVersionRecordPayload) => Promise<OfficeVersionRecordResult>
  listOfficeVersions: (payload: OfficeVersionTarget) => Promise<OfficeVersionListResult>
  readOfficeVersion: (payload: OfficeVersionReadPayload) => Promise<OfficeVersionReadResult>
  restoreOfficeVersion: (payload: OfficeVersionRestorePayload) => Promise<OfficeVersionRestoreResult>
}
