import type { NotesWriteFileResult } from '../contracts/context-windows.js'

export type NoteFileSummary = {
  path: string
  revision: number
  byteSize: number
  updatedAt: string
}

export type NoteContent = {
  content: string
  revision: number
}

export type NoteAppendOutcome =
  | { status: 'applied'; revision: number }
  | { status: 'replayed'; revision: number }

export type ContextWindowStoreLimits = {
  maxFileBytes: number
  maxFilesPerThread: number
  maxTotalBytes: number
  /**
   * Version retention bound per note file. Every committed write/append
   * stores an immutable full-content snapshot; at most this many snapshots
   * are kept per file, oldest first. Defaults to
   * CONTEXT_WINDOW_NOTE_VERSION_RETENTION.maxVersionsPerFile.
   */
  maxVersionsPerFile?: number
  /**
   * Version retention bound per thread across all note files. Once the
   * retained snapshot bytes exceed this cap, the oldest snapshots (by commit
   * seq) are dropped across files until the cap holds; the newest snapshot of
   * each file is never dropped. Defaults to
   * CONTEXT_WINDOW_NOTE_VERSION_RETENTION.maxVersionBytesPerThread.
   */
  maxVersionBytesPerThread?: number
}

/**
 * Default version-retention policy. Version storage is deliberately bounded
 * and separate from the current-content quotas (maxFileBytes /
 * maxFilesPerThread / maxTotalBytes): quotas govern what a reader sees now,
 * retention governs how far back a fork can replay. Snapshots are full
 * content (no delta chains), so evicting an old snapshot never corrupts the
 * replay of a newer one.
 */
export const CONTEXT_WINDOW_NOTE_VERSION_RETENTION = {
  maxVersionsPerFile: 32,
  maxVersionBytesPerThread: 4 * 1024 * 1024
} as const

/**
 * Immutable snapshot of one committed note mutation. `seq` is a per-thread
 * monotonically increasing commit sequence assigned by the store at commit
 * time (versions are only ever compared within one thread, so the sequence
 * is scoped to the thread rather than to the whole store). `atItemSeq` is the
 * caller-reported public history position of the thread at commit time; it
 * is the fork cutoff correlation: a fork copies only versions whose
 * `atItemSeq` is at or below the fork point.
 */
export type NoteVersionRecord = {
  seq: number
  atItemSeq: number
  at: string
  content: string
}

/**
 * Dedicated port for feature-owned context-window data: thread-private notes
 * and their version sequence. Standard conversation data stays in the
 * SessionStore; this store only holds what the window index derives from
 * (nothing) plus notes, so the runtime never writes a second copy of the
 * standard stores.
 *
 * All mutating operations are atomic per thread: either the whole state
 * transition lands or none of it does, so quota violations and conflicts
 * never leave partial mutations behind.
 */
export interface ContextWindowStore {
  listNoteFiles(threadId: string): Promise<NoteFileSummary[]>
  readNote(threadId: string, path: string): Promise<NoteContent | null>
  /**
   * Replace a whole note file. `expectedRevision` must equal the current
   * revision; a missing file has revision 0. Returns a conflict result
   * instead of mutating when the revision does not match. Every successful
   * commit appends an immutable NoteVersionRecord stamped with `atItemSeq`.
   */
  writeNote(
    threadId: string,
    path: string,
    expectedRevision: number,
    content: string,
    nowIso: string,
    atItemSeq: number
  ): Promise<NotesWriteFileResult>
  /**
   * Append text idempotently: a repeated `operationId` returns the already
   * committed revision without duplicating content. Every successful commit
   * appends an immutable NoteVersionRecord stamped with `atItemSeq`.
   */
  appendNote(
    threadId: string,
    path: string,
    operationId: string,
    text: string,
    nowIso: string,
    atItemSeq: number
  ): Promise<NoteAppendOutcome>
  /**
   * Fork snapshot. Without `cutoffItemSeq` the whole source state is copied
   * (head fork). With a cutoff, only versions whose `atItemSeq` is at or
   * below the cutoff are copied and the child's current content is derived
   * by replaying exactly those versions; versions committed after the fork
   * point stay private to the source. Source state written before version
   * tracking existed (no version history) is treated as pre-fork content and
   * copied as-is.
   */
  copyThreadData(
    sourceThreadId: string,
    targetThreadId: string,
    cutoffItemSeq?: number
  ): Promise<void>
  /** Cascade delete: remove every feature-owned record of the thread. */
  deleteThreadData(threadId: string): Promise<void>
}
