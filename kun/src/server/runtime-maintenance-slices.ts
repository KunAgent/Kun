import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { AttachmentStore } from '../attachments/attachment-store.js'
import type { ThreadService } from '../services/thread-service.js'
import type { SessionGuardian } from '../services/session-guardian.js'
import type { ThreadHealthReport } from '../services/session-guardian.js'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import { optionalRuntimeWorkPaused } from './runtime-load-shedder.js'
import {
  appendReferencesChunk,
  readCompactedReferences,
  readReferencesChunk,
  removeGenerationFiles,
  writeCompactedReferences
} from './runtime-maintenance-reference-store.js'

export const MAINTENANCE_SLICE_MAX_THREADS = 8
export const MAINTENANCE_SLICE_MAX_MS = 50

const ScanStateSchema = z.object({
  version: z.literal(3),
  attachments: z.object({
    generation: z.number().int().nonnegative(),
    cursor: z.string().optional(),
    pageOffset: z.number().int().nonnegative().optional(),
    partialThread: z.object({
      threadId: z.string(),
      turnOffset: z.number().int().nonnegative(),
      attachmentOffset: z.number().int().nonnegative()
    }).optional()
  }),
  guardian: z.object({
    cursor: z.string().optional(),
    pageOffset: z.number().int().nonnegative().optional()
  })
}).strict()

const ScanStateV2Schema = z.object({
  version: z.literal(2),
  attachments: z.object({
    generation: z.number().int().nonnegative(),
    cursor: z.string().optional(),
    pageOffset: z.number().int().nonnegative().optional()
  }),
  guardian: z.object({
    cursor: z.string().optional(),
    pageOffset: z.number().int().nonnegative().optional()
  })
}).strict()

const ScanStateV1Schema = z.object({
  version: z.literal(1),
  attachments: z.object({
    generation: z.number().int().nonnegative(),
    cursor: z.string().optional(),
    pageOffset: z.number().int().nonnegative().optional(),
    references: z.array(z.string()),
    previousReferences: z.array(z.string()).optional()
  }),
  guardian: z.object({
    cursor: z.string().optional(),
    pageOffset: z.number().int().nonnegative().optional()
  })
}).strict()

type ScanState = z.infer<typeof ScanStateSchema>
type ScanStateV2 = z.infer<typeof ScanStateV2Schema>
type ScanStateV1 = z.infer<typeof ScanStateV1Schema>

export type RuntimeMaintenanceSliceStats = {
  slices: number
  paused: number
  maxDurationMs: number
  processedThreads: number
  bytesWritten: number
  overshoots: number
  eventIndexSlices: number
}

type DeadlineResult<T> = { timedOut: true } | { timedOut: false; value: T }

export function createRuntimeMaintenanceSlices(input: {
  dataDir: string
  threads: ThreadService
  attachments: () => AttachmentStore | undefined
  guardian: SessionGuardian
  eventIndexRebuild?: () => Promise<boolean>
  nowIso: () => string
  hasActiveTurns?: () => Promise<boolean>
  onGuardianReport?: (report: ThreadHealthReport) => Promise<void> | void
  log?: (message: string) => void
}) {
  const statePath = join(input.dataDir, 'maintenance-state.json')
  let statePromise: Promise<ScanState> | undefined
  let slices = 0
  let paused = 0
  let maxDurationMs = 0
  let processedThreads = 0
  let bytesWritten = 0
  let overshoots = 0
  let eventIndexSlices = 0
  // Single-flight registry keyed by `<task>:<threadId>`. The slice deadline
  // only bounds how long a slice waits, never the underlying work; a timed-out
  // read keeps running. Scheduler retries (250ms) join the still-running read
  // instead of stacking duplicate full-file reads and scans on one thread.
  type FlightEntry = {
    promise: Promise<unknown>
    startedAt: number
    settledAt: number | undefined // undefined = still pending
  }
  const flights = new Map<string, FlightEntry>()
  const SINGLE_FLIGHT_RESULT_TTL_MS = 10 * 60_000

  const acquireFlight = <T>(key: string, start: () => Promise<T>): Promise<T> => {
    const entry = flights.get(key)
    if (entry) {
      if (entry.settledAt === undefined) {
        // A pending entry is never evicted, even past the TTL: evicting it
        // would let the next acquire restart the same still-running work and
        // stack duplicate full-file reads/scans on one thread. Log a slow-flight
        // warning so a stuck IO is observable without cancelling it.
        if (Date.now() - entry.startedAt > SINGLE_FLIGHT_RESULT_TTL_MS) {
          input.log?.(`[kun] single-flight still pending after ${SINGLE_FLIGHT_RESULT_TTL_MS}ms: ${key}`)
        }
        return entry.promise as Promise<T>
      }
      // Settled results are cached for RESULT_TTL measured from settlement.
      if (Date.now() - entry.settledAt <= SINGLE_FLIGHT_RESULT_TTL_MS) {
        return entry.promise as Promise<T>
      }
      flights.delete(key)
    }
    const promise = start()
    const record: FlightEntry = { promise, startedAt: Date.now(), settledAt: undefined }
    flights.set(key, record)
    // Fulfilment marks the entry settled so its result becomes TTL-eligible;
    // rejections cannot be reused, so the entry self-evicts. The catch also
    // suppresses unhandled rejections while no slice is joining.
    promise.then(() => {
      record.settledAt = Date.now()
    }).catch(() => {
      if (flights.get(key) === record) flights.delete(key)
    })
    return promise
  }

  const consumeFlight = (key: string, promise: Promise<unknown>): void => {
    const entry = flights.get(key)
    if (entry?.promise === promise) flights.delete(key)
  }

  const freshState = (): ScanState => ({
    version: 3,
    attachments: { generation: 0 },
    guardian: {}
  })

  const migrateV1 = async (v1: ScanStateV1): Promise<ScanState> => {
    const generation = v1.attachments.generation
    if (v1.attachments.references.length > 0) {
      bytesWritten += await appendReferencesChunk(input.dataDir, generation, v1.attachments.references)
    }
    if (v1.attachments.previousReferences && v1.attachments.previousReferences.length > 0) {
      bytesWritten += await writeCompactedReferences(
        input.dataDir,
        generation - 1,
        v1.attachments.previousReferences
      )
    }
    return {
      version: 3,
      attachments: {
        generation,
        cursor: v1.attachments.cursor,
        pageOffset: v1.attachments.pageOffset
      },
      guardian: v1.guardian
    }
  }

  const readState = (): Promise<ScanState> => {
    if (!statePromise) {
      statePromise = readFile(statePath, 'utf8')
        .then(async (text) => {
          const raw: unknown = JSON.parse(text)
          const v3 = ScanStateSchema.safeParse(raw)
          if (v3.success) return v3.data
          const v2 = ScanStateV2Schema.safeParse(raw)
          if (v2.success) {
            // v2 predates the in-thread breakpoint; carry its cursor/pageOffset
            // forward verbatim and resume future slices from thread starts.
            const migrated: ScanState = {
              version: 3,
              attachments: { ...v2.data.attachments },
              guardian: v2.data.guardian
            }
            return migrated
          }
          const v1 = ScanStateV1Schema.safeParse(raw)
          if (v1.success) return await migrateV1(v1.data)
          return freshState()
        })
        .catch(() => freshState())
    }
    return statePromise
  }

  const saveState = async (state: ScanState): Promise<void> => {
    const contents = JSON.stringify(state)
    bytesWritten += Buffer.byteLength(contents, 'utf8')
    await atomicWriteFile(statePath, contents)
    statePromise = Promise.resolve(state)
  }

  const shouldPause = async (): Promise<boolean> => {
    if (optionalRuntimeWorkPaused()) return true
    return await input.hasActiveTurns?.() ?? false
  }

  const recordSlice = (startedAt: number, processed: number): void => {
    slices += 1
    processedThreads += processed
    maxDurationMs = Math.max(maxDurationMs, Date.now() - startedAt)
  }

  const runAttachmentSlice = async (): Promise<boolean> => {
    const attachmentStore = input.attachments()
    if (!attachmentStore?.pruneExpiredLeases) return true
    if (await shouldPause()) {
      paused += 1
      return false
    }
    const startedAt = Date.now()
    const state = await readState()
    const generation = state.attachments.generation
    const page = await input.threads.listPage({
      limit: MAINTENANCE_SLICE_MAX_THREADS,
      includeArchived: true,
      includeSide: true,
      cursor: state.attachments.cursor
    })
    // The soft deadline only budgets the per-thread work; state load and page
    // listing are bounded setup costs that must not starve the first thread.
    const loopStartedAt = Date.now()
    const deadlineReached = (): boolean => Date.now() - loopStartedAt >= MAINTENANCE_SLICE_MAX_MS
    const sliceIds: string[] = []
    let processed = 0
    // `advanced` flips true as soon as this slice has persisted-worthy progress
    // (a completed thread or at least one attachment id). Every deadline stop is
    // gated on it, so a slice always advances at least one persistable unit and
    // can never re-scan the same prefix forever.
    let advanced = false
    // In-thread breakpoint. Set only when the slice stops in the middle of a
    // thread; otherwise undefined so a thread or page boundary resumes cleanly.
    let partialThread: NonNullable<ScanState['attachments']['partialThread']> | undefined
    const pageOffset = Math.min(state.attachments.pageOffset ?? 0, page.threads.length)
    for (const summary of page.threads.slice(pageOffset)) {
      const remaining = MAINTENANCE_SLICE_MAX_MS - (Date.now() - loopStartedAt)
      if (advanced && remaining <= 0) break
      const readKey = `attachment-maintenance:${summary.id}`
      const read = acquireFlight(readKey, () => input.threads.get(summary.id))
      const result = await withDeadline(read, Math.max(0, remaining))
      if (result.timedOut) {
        overshoots += 1
        break
      }
      consumeFlight(readKey, read)
      const thread = result.value
      // Restore the in-thread breakpoint only when this page slot still holds
      // the same thread; a reorder or deletion makes it stale, so restart from
      // the top (safe to duplicate at compaction, never safe to skip).
      const resume = state.attachments.partialThread
      const resumeHere = resume !== undefined && resume.threadId === summary.id
      const turnOffset = resumeHere ? resume!.turnOffset : 0
      const attachmentOffset = resumeHere ? resume!.attachmentOffset : 0
      const turns = thread?.turns ?? []
      let stopped = false
      for (let t = turnOffset; t < turns.length && !stopped; t += 1) {
        const ids = turns[t]?.attachmentIds ?? []
        const startA = t === turnOffset ? attachmentOffset : 0
        for (let a = startA; a < ids.length; a += 1) {
          if (advanced && deadlineReached()) {
            partialThread = { threadId: summary.id, turnOffset: t, attachmentOffset: a }
            stopped = true
            break
          }
          sliceIds.push(ids[a])
          advanced = true
        }
        if (stopped) break
        // Turn `t` is now fully consumed — one unit of progress even when it
        // held no attachments — so a deadline stop here always advances.
        advanced = true
        if (deadlineReached()) {
          partialThread = { threadId: summary.id, turnOffset: t + 1, attachmentOffset: 0 }
          stopped = true
          break
        }
      }
      if (stopped) break
      processed += 1
      advanced = true
    }
    state.attachments.partialThread = partialThread
    if (sliceIds.length > 0) {
      bytesWritten += await appendReferencesChunk(input.dataDir, generation, sliceIds)
    }
    const consumedPage = pageOffset + processed === page.threads.length
    if (page.hasMore && consumedPage && page.nextCursor) {
      state.attachments.cursor = page.nextCursor
      state.attachments.pageOffset = 0
      state.attachments.partialThread = undefined
      await saveState(state)
      recordSlice(startedAt, processed)
      return false
    }
    if (!consumedPage) {
      state.attachments.pageOffset = pageOffset + processed
      await saveState(state)
      recordSlice(startedAt, processed)
      return false
    }

    // Full pass over the current generation: dedupe the appended chunks, keep
    // the previous generation as the prune safety set, and compact once.
    const current = [...new Set(await readReferencesChunk(input.dataDir, generation))].sort()
    const previous = await readCompactedReferences(input.dataDir, generation - 1)
    if (previous.length > 0) {
      const safeReferences = new Set([...previous, ...current])
      const now = Date.parse(input.nowIso())
      if (Number.isFinite(now)) {
        await attachmentStore.pruneExpiredLeases(
          safeReferences,
          new Date(now - 24 * 60 * 60 * 1_000).toISOString()
        )
      }
    }
    bytesWritten += await writeCompactedReferences(input.dataDir, generation, current)
    await removeGenerationFiles(input.dataDir, generation - 1)
    await removeGenerationFiles(input.dataDir, generation, { json: false, jsonl: true })
    state.attachments = { generation: generation + 1 }
    await saveState(state)
    recordSlice(startedAt, processed)
    return true
  }

  const runGuardianSlice = async (): Promise<boolean> => {
    if (await shouldPause()) {
      paused += 1
      return false
    }
    const startedAt = Date.now()
    const state = await readState()
    const page = await input.threads.listPage({
      limit: MAINTENANCE_SLICE_MAX_THREADS,
      includeArchived: true,
      includeSide: true,
      cursor: state.guardian.cursor
    })
    const loopStartedAt = Date.now()
    const warnings: string[] = []
    let processed = 0
    const pageOffset = Math.min(state.guardian.pageOffset ?? 0, page.threads.length)
    for (const summary of page.threads.slice(pageOffset)) {
      const remaining = MAINTENANCE_SLICE_MAX_MS - (Date.now() - loopStartedAt)
      if (processed > 0 && remaining <= 0) break
      const scanKey = `session-guardian:${summary.id}`
      const scan = acquireFlight(scanKey, () => input.guardian.scanThread(summary.id))
      const result = await withDeadline(scan, Math.max(0, remaining))
      if (result.timedOut) {
        overshoots += 1
        break
      }
      consumeFlight(scanKey, scan)
      const report = result.value
      await input.onGuardianReport?.(report)
      if (report.warnings.length > 0) warnings.push(`${summary.id}:${report.warnings.join(',')}`)
      processed += 1
    }
    if (warnings.length > 0) input.log?.(`[kun] quick guardian warnings: ${warnings.length}`)
    const consumedPage = pageOffset + processed === page.threads.length
    if (page.hasMore && consumedPage && page.nextCursor) {
      state.guardian.cursor = page.nextCursor
      state.guardian.pageOffset = 0
    } else if (!consumedPage) state.guardian.pageOffset = pageOffset + processed
    else if (consumedPage) state.guardian = {}
    await saveState(state)
    recordSlice(startedAt, processed)
    return consumedPage && !page.hasMore
  }

  const runEventIndexSlice = async (): Promise<boolean> => {
    if (!input.eventIndexRebuild) return true
    if (await shouldPause()) {
      paused += 1
      return false
    }
    const startedAt = Date.now()
    const rebuildKey = 'event-index-rebuild'
    const rebuild = acquireFlight(rebuildKey, () => input.eventIndexRebuild!())
    const complete = await rebuild
    consumeFlight(rebuildKey, rebuild)
    slices += 1
    eventIndexSlices += 1
    maxDurationMs = Math.max(maxDurationMs, Date.now() - startedAt)
    return complete
  }

  return {
    runAttachmentSlice,
    runGuardianSlice,
    runEventIndexSlice,
    stats: (): RuntimeMaintenanceSliceStats => ({
      slices,
      paused,
      maxDurationMs,
      processedThreads,
      bytesWritten,
      overshoots,
      eventIndexSlices
    })
  }
}

/**
 * Wait for a read-only operation but abandon it after `timeoutMs`. On timeout
 * the underlying promise is left to settle in the background (a `.catch` is
 * attached to suppress any unhandled rejection); genuine rejections before the
 * deadline still propagate so callers see real failures.
 */
function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<DeadlineResult<T>> {
  if (timeoutMs <= 0) {
    promise.catch(() => undefined)
    return Promise.resolve({ timedOut: true })
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      promise.catch(() => undefined)
      resolve({ timedOut: true })
    }, timeoutMs)
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ timedOut: false, value })
      },
      (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}
