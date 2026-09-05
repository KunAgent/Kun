import type { RuntimeEvent } from '../../contracts/events.js'
import type { EventHistoryPage, EventHistoryPageOptions } from '../../ports/session-store.js'
import { stat } from 'node:fs/promises'
import { DEFAULT_EVENT_REPLAY_MAX_RECORD_BYTES, firstEventSeqFromJsonl, iterateRuntimeEventsJsonl, trimEventsWithGuards } from './file-session-jsonl.js'
import { loadFileSessionEventPage } from './file-session-event-page.js'
import type { JsonlFileAccessCoordinator } from './jsonl-file-access.js'
import { FileSessionEventIndex } from './file-session-event-index.js'
import { FileSessionEventIndexRebuild } from './file-session-event-index-rebuild.js'

export async function collectFileSessionEvents(input: {
  path: string
  sinceSeq: number
  maxRecordBytes: number
  fileAccess: JsonlFileAccessCoordinator
  eventIndex?: FileSessionEventIndex
  threadId?: string
}): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = []
  for await (const event of iterateFileSessionEvents(input)) events.push(event)
  return events.sort((left, right) => left.seq - right.seq)
}

export async function* iterateFileSessionEvents(input: {
  path: string
  sinceSeq: number
  maxRecordBytes: number
  fileAccess: JsonlFileAccessCoordinator
  eventIndex?: FileSessionEventIndex
  threadId?: string
}): AsyncIterable<RuntimeEvent> {
  const release = await input.fileAccess.acquireRead(input.path)
  try {
    const startOffset = input.eventIndex && input.threadId
      ? await input.eventIndex.startOffset(input.threadId, input.path, input.sinceSeq, input.maxRecordBytes)
      : 0
    yield* iterateRuntimeEventsJsonl(input.path, input.sinceSeq, input.maxRecordBytes, startOffset)
  } finally {
    release()
  }
}

export function readFileSessionReplayFloor(input: {
  path: string
  maxRecordBytes: number
  fileAccess: JsonlFileAccessCoordinator
}): Promise<number> {
  return input.fileAccess.withRead(
    input.path,
    () => firstEventSeqFromJsonl(input.path, input.maxRecordBytes)
  )
}

export class FileSessionEventHistory {
  readonly eventIndex: FileSessionEventIndex

  constructor(private readonly options: {
    pathFor: (threadId: string) => string
    maxRecordBytes: number
    fileAccess: JsonlFileAccessCoordinator
    readRevision: (threadId: string) => number
    bumpRevision: (threadId: string) => void
    invalidateCache: (threadId: string) => void
    withWrite: <T>(threadId: string, operation: () => Promise<T>) => Promise<T>
    scheduleRetry: (threadId: string) => void
    eventIndex?: FileSessionEventIndex
  }) {
    this.eventIndex = options.eventIndex ?? new FileSessionEventIndex()
  }

  load(threadId: string, sinceSeq: number): Promise<RuntimeEvent[]> {
    return collectFileSessionEvents({
      path: this.options.pathFor(threadId), sinceSeq,
      maxRecordBytes: this.options.maxRecordBytes, fileAccess: this.options.fileAccess,
      eventIndex: this.eventIndex, threadId
    })
  }

  async page(threadId: string, options: EventHistoryPageOptions): Promise<EventHistoryPage> {
    const path = this.options.pathFor(threadId)
    return loadFileSessionEventPage({
      path, options,
      resolveInitialOffset: () =>
        this.eventIndex.startOffset(threadId, path, options.sinceSeq, this.options.maxRecordBytes),
      defaultMaxRecordBytes: this.options.maxRecordBytes, fileAccess: this.options.fileAccess
    })
  }

  iterate(threadId: string, sinceSeq: number, maxRecordBytes: number): AsyncIterable<RuntimeEvent> {
    return iterateFileSessionEvents({
      path: this.options.pathFor(threadId), sinceSeq,
      maxRecordBytes, fileAccess: this.options.fileAccess,
      eventIndex: this.eventIndex, threadId
    })
  }

  floor(threadId: string): Promise<number> {
    return readFileSessionReplayFloor({
      path: this.options.pathFor(threadId),
      maxRecordBytes: this.options.maxRecordBytes,
      fileAccess: this.options.fileAccess
    })
  }

  async trim(threadId: string, fromSeqInclusive: number): Promise<{ afterBytes: number }> {
    const path = this.options.pathFor(threadId)
    const info = await stat(path).catch(() => null)
    if (!info) return { afterBytes: 0 }
    const result = await trimEventsWithGuards({
      path, fromSeqInclusive, maxRecordBytes: this.options.maxRecordBytes, info,
      revisionBefore: this.options.readRevision(threadId),
      readRevision: () => this.options.readRevision(threadId),
      bumpRevision: () => this.options.bumpRevision(threadId),
      invalidateCache: () => this.options.invalidateCache(threadId),
      withWrite: (operation) => this.options.withWrite(threadId, operation),
      withRead: (operation) => this.options.fileAccess.withRead(path, operation),
      withReplacement: (operation) => this.options.fileAccess.withReplacement(path, operation),
      scheduleRetry: () => this.options.scheduleRetry(threadId)
    })
    await this.eventIndex.invalidate(threadId, path)
    return result
  }

  async recordAppend(
    threadId: string,
    seq: number,
    recordBytes: number,
    info: { size: number; dev: number; ino: number }
  ): Promise<void> {
    const sourcePath = this.options.pathFor(threadId)
    await this.eventIndex.recordAppend({
      threadId,
      sourcePath,
      seq,
      recordOffset: Math.max(0, info.size - recordBytes),
      sourceSize: info.size,
      dev: info.dev,
      ino: info.ino
    })
  }

  /**
   * Hold the per-source index mutation critical section around a caller's
   * whole write transaction so a rebuild publish cannot replace the index
   * between the canonical append and its `recordAppend` update.
   */
  withEventIndexMutation<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
    return this.eventIndex.withIndexMutation(this.options.pathFor(threadId), operation)
  }
}

export interface FileSessionEventSubsystemHost {
  readonly dataDir: string
  readonly fileAccess: JsonlFileAccessCoordinator
  readonly highestSeqCache: { delete(threadId: string): void }
  readonly eventsSizeTracker: { invalidate(threadId: string): void }
  readonly compactionScheduler: { schedule(threadId: string, kind: 'events'): void }
  eventsPath(threadId: string): string
  eventHistoryRevision(threadId: string): number
  bumpEventHistoryRevision(threadId: string): number
  withThreadWrite<T>(threadId: string, operation: () => Promise<T>): Promise<T>
}

export type FileSessionEventSubsystem = {
  eventHistory: FileSessionEventHistory
  eventIndexRebuild: FileSessionEventIndexRebuild
}

/**
 * Build the sparse-index + incremental-rebuild subsystem in one place. The
 * host is the store itself (a friend interface), so construction stays out
 * of the store's at-limit file while the store keeps ownership of the shared
 * index used by foreground reads.
 */
export function createFileSessionEventSubsystem(
  host: FileSessionEventSubsystemHost
): FileSessionEventSubsystem {
  let eventIndexRebuild: FileSessionEventIndexRebuild | undefined
  const eventIndex = new FileSessionEventIndex({
    onFallback: (threadId) => eventIndexRebuild?.request(threadId)
  })
  eventIndexRebuild = new FileSessionEventIndexRebuild({
    threadsDir: host.dataDir,
    eventsPathFor: (threadId) => host.eventsPath(threadId),
    fileAccess: host.fileAccess,
    index: eventIndex,
    maxRecordBytes: DEFAULT_EVENT_REPLAY_MAX_RECORD_BYTES
  })
  const eventHistory = new FileSessionEventHistory({
    pathFor: (threadId) => host.eventsPath(threadId),
    maxRecordBytes: DEFAULT_EVENT_REPLAY_MAX_RECORD_BYTES,
    fileAccess: host.fileAccess,
    readRevision: (threadId) => host.eventHistoryRevision(threadId),
    bumpRevision: (threadId) => host.bumpEventHistoryRevision(threadId),
    invalidateCache: (threadId) => { host.highestSeqCache.delete(threadId); host.eventsSizeTracker.invalidate(threadId) },
    withWrite: (threadId, operation) => host.withThreadWrite(threadId, operation),
    scheduleRetry: (threadId) => host.compactionScheduler.schedule(threadId, 'events'),
    eventIndex
  })
  return { eventHistory, eventIndexRebuild }
}
