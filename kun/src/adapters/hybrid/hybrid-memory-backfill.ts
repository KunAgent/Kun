import type { MemoryRecord } from '../../contracts/memory.js'
import type { CanonicalMemoryReadResult } from '../../memory/memory-canonical-files.js'
import { canonicalMemoryHash } from '../../memory/memory-record-normalizer.js'

type IndexedMemoryRow = { id: string; canonicalHash: string; updatedAt: string }

export type HybridMemoryBackfillState = {
  running: boolean
  scanned: number
  remaining: number
}

type BackfillCandidate = { record: MemoryRecord; hash: string }

export class HybridMemoryBackfillCoordinator {
  private stopped = false
  private pendingRestart = false
  private promise: Promise<void> | null = null
  private stateValue: HybridMemoryBackfillState = { running: false, scanned: 0, remaining: 0 }

  constructor(private readonly deps: {
    readCanonical: () => Promise<CanonicalMemoryReadResult>
    readCanonicalRecordHashes: (ids: readonly string[]) => Promise<Map<string, string>>
    indexedRows: () => IndexedMemoryRow[]
    upsert: (record: MemoryRecord, hash: string) => void
    remove: (id: string) => void
    enqueueIndexWrite: (write: () => void) => Promise<void>
    noteState: (state: HybridMemoryBackfillState) => void
    generation: () => number
    beforeBatch?: () => Promise<void> | void
    complete?: (clean: boolean) => void
    yieldToEventLoop: () => Promise<void>
    warn: (action: string, error: unknown) => void
    batchSize?: number
  }) {}

  start(): void {
    if (this.promise || this.stopped) return
    const promise = this.run()
      .then((clean) => {
        if (this.stopped) return
        if (clean) this.deps.complete?.(true)
        else this.pendingRestart = true
      })
      .catch((error) => this.deps.warn('backfill', error))
      .finally(() => {
        if (this.promise === promise) this.promise = null
        if (this.pendingRestart && !this.stopped) {
          this.pendingRestart = false
          this.start()
        }
      })
    this.promise = promise
  }

  stop(): void { this.stopped = true }
  async wait(): Promise<void> {
    while (this.promise) await this.promise
  }
  state(): HybridMemoryBackfillState { return { ...this.stateValue } }

  private async run(): Promise<boolean> {
    const canonical = await this.deps.readCanonical()
    if (this.stopped) return false
    const snapshotGen = this.deps.generation()
    let dirty = false
    const indexed = new Map(this.deps.indexedRows().map((row) => [row.id, row]))
    const total = canonical.records.length + indexed.size
    this.update({ running: true, scanned: 0, remaining: total })
    const batchSize = Math.max(1, Math.floor(this.deps.batchSize ?? 32))

    for (let offset = 0; offset < canonical.records.length; offset += batchSize) {
      if (this.stopped) return false
      await this.deps.beforeBatch?.()
      if (this.stopped) return false
      const batch = canonical.records.slice(offset, offset + batchSize)
      const candidates: BackfillCandidate[] = []
      for (const record of batch) {
        const hash = canonicalMemoryHash(record)
        const row = indexed.get(record.id)
        if (!row || row.canonicalHash !== hash || row.updatedAt !== record.updatedAt) {
          candidates.push({ record, hash })
        }
      }
      if (candidates.length > 0) {
        const readGen = this.deps.generation()
        const currentHashes = await this.deps.readCanonicalRecordHashes(
          candidates.map((candidate) => candidate.record.id)
        )
        await this.deps.enqueueIndexWrite(() => {
          if (this.deps.generation() !== readGen) {
            dirty = true
            return
          }
          for (const candidate of candidates) {
            if (currentHashes.get(candidate.record.id) === candidate.hash) {
              this.deps.upsert(candidate.record, candidate.hash)
            } else {
              dirty = true
            }
          }
        })
      }
      const scanned = Math.min(total, this.stateValue.scanned + batch.length)
      this.update({ running: true, scanned, remaining: Math.max(0, total - scanned) })
      await this.deps.yieldToEventLoop()
    }

    if (indexed.size > 0) {
      const readGen = this.deps.generation()
      const currentCanonical = await this.deps.readCanonical()
      if (this.stopped) return false
      const currentIds = new Set(currentCanonical.records.map((record) => record.id))
      const currentMalformed = new Set(currentCanonical.malformedIds)
      const removeIds: string[] = []
      for (const row of indexed.values()) {
        if (!currentIds.has(row.id) || currentMalformed.has(row.id)) removeIds.push(row.id)
      }
      if (removeIds.length > 0) {
        await this.deps.enqueueIndexWrite(() => {
          if (this.deps.generation() !== readGen) {
            dirty = true
            return
          }
          for (const id of removeIds) this.deps.remove(id)
        })
      }
    }
    this.update({ running: false, scanned: total, remaining: 0 })
    return !dirty && this.deps.generation() === snapshotGen
  }

  private update(state: HybridMemoryBackfillState): void {
    this.stateValue = state
    this.deps.noteState(state)
  }
}
