import type { TurnItem } from '../../contracts/items.js'
import { mkdir } from 'node:fs/promises'
import {
  FileSessionLiveItems,
  LIVE_ITEM_CHECKPOINT_STEP_BYTES
} from './file-session-live-items.js'

export const LIVE_ITEM_CHECKPOINT_MAX_EVENTS = 128
export const LIVE_ITEM_CHECKPOINT_MAX_AGE_MS = 1_000

type PendingCheckpoint = {
  threadId: string
  itemId: string
  latestItem: TurnItem
  latestBytes: number
  latestSeq: number
  lastFlushedBytes: number
  lastFlushedSeq: number
  lastFlushedAt: number
  dirtyEvents: number
  generation: number
  timer?: ReturnType<typeof setTimeout>
  flush?: Promise<void>
}

export type LiveCheckpointStats = {
  pending: number
  flushes: number
  skipped: number
  maxObservedSeqLag: number
  maxObservedAgeMs: number
}

export type FileSessionLiveCheckpointHost = {
  liveItems: FileSessionLiveItems
  withThreadWrite<T>(threadId: string, operation: () => Promise<T>): Promise<T>
  threadDir(threadId: string): string
  liveItemsPath(threadId: string): string
  bumpItemsVersion(threadId: string): void
  applyItemToCache(threadId: string, item: TurnItem): void
  bumpItemHistoryRevision(threadId: string): number
}

export class FileSessionLiveCheckpointCoordinator {
  private readonly pending = new Map<string, PendingCheckpoint>()
  private readonly threadGenerations = new Map<string, number>()
  private flushes = 0
  private skipped = 0
  private maxObservedSeqLag = 0
  private maxObservedAgeMs = 0

  constructor(
    private readonly host: FileSessionLiveCheckpointHost,
    private readonly now: () => number = Date.now
  ) {}

  async checkpoint(threadId: string, item: TurnItem, representedSeq: number): Promise<void> {
    const key = checkpointKey(threadId, item.id)
    let state = this.pending.get(key)
    if (!state) {
      const now = this.now()
      state = {
        threadId,
        itemId: item.id,
        latestItem: item,
        latestBytes: itemBytes(item),
        latestSeq: representedSeq,
        lastFlushedBytes: itemBytes(item),
        lastFlushedSeq: representedSeq,
        lastFlushedAt: now,
        dirtyEvents: 1,
        generation: this.threadGenerations.get(threadId) ?? 0
      }
      this.pending.set(key, state)
      await this.flushState(state)
      return
    }

    state.latestBytes = nextItemBytes(state.latestItem, item, state.latestBytes)
    state.latestItem = item
    state.latestSeq = Math.max(state.latestSeq, representedSeq)
    state.dirtyEvents += 1
    state.generation = this.threadGenerations.get(threadId) ?? 0
    const age = Math.max(0, this.now() - state.lastFlushedAt)
    const seqLag = Math.max(0, state.latestSeq - state.lastFlushedSeq)
    this.maxObservedAgeMs = Math.max(this.maxObservedAgeMs, age)
    this.maxObservedSeqLag = Math.max(this.maxObservedSeqLag, seqLag)
    const bytesDue = state.latestBytes - state.lastFlushedBytes >= LIVE_ITEM_CHECKPOINT_STEP_BYTES
    if (bytesDue || state.dirtyEvents >= LIVE_ITEM_CHECKPOINT_MAX_EVENTS || age >= LIVE_ITEM_CHECKPOINT_MAX_AGE_MS) {
      await this.flushState(state)
      return
    }
    this.skipped += 1
    this.armTimer(state)
  }

  async flushItem(threadId: string, itemId: string): Promise<void> {
    const state = this.pending.get(checkpointKey(threadId, itemId))
    if (state) await this.flushState(state)
  }

  async flushThread(threadId: string): Promise<number> {
    const generation = (this.threadGenerations.get(threadId) ?? 0) + 1
    this.threadGenerations.set(threadId, generation)
    for (;;) {
      const dirty = [...this.pending.values()].filter(
        (state) => state.threadId === threadId &&
          (state.flush !== undefined || state.dirtyEvents > 0)
      )
      if (dirty.length === 0) break
      await Promise.all(dirty.map((state) => this.flushState(state)))
    }
    return generation
  }

  async remove(threadId: string, itemId: string): Promise<void> {
    const key = checkpointKey(threadId, itemId)
    const state = this.pending.get(key)
    if (!state) return
    await this.flushState(state)
    this.clearState(key, state)
  }

  async close(): Promise<void> {
    await Promise.all([...this.pending.values()].map((state) => this.flushState(state)))
    for (const [key, state] of this.pending) this.clearState(key, state)
  }

  clearThread(threadId: string, expectedGeneration: number): void {
    for (const [key, state] of this.pending) {
      if (state.threadId !== threadId) continue
      if (state.generation >= expectedGeneration) continue
      this.clearState(key, state)
    }
    if (![...this.pending.values()].some((state) => state.threadId === threadId)) {
      this.threadGenerations.delete(threadId)
    }
  }

  stats(): LiveCheckpointStats {
    return {
      pending: this.pending.size,
      flushes: this.flushes,
      skipped: this.skipped,
      maxObservedSeqLag: this.maxObservedSeqLag,
      maxObservedAgeMs: this.maxObservedAgeMs
    }
  }

  private armTimer(state: PendingCheckpoint): void {
    if (state.timer) return
    const remaining = Math.max(1, LIVE_ITEM_CHECKPOINT_MAX_AGE_MS - (this.now() - state.lastFlushedAt))
    state.timer = setTimeout(() => {
      state.timer = undefined
      void this.flushState(state).catch((error) => {
        console.warn(`[kun] live checkpoint flush deferred for ${state.threadId}: ${
          error instanceof Error ? error.message : String(error)
        }`)
      })
    }, remaining)
    state.timer.unref?.()
  }

  private async flushState(state: PendingCheckpoint): Promise<void> {
    if (state.flush) {
      await state.flush
      return this.flushState(state)
    }
    if (state.dirtyEvents === 0) return
    if (state.timer) clearTimeout(state.timer)
    state.timer = undefined
    const item = state.latestItem
    const flushedBytes = state.latestBytes
    const representedSeq = state.latestSeq
    const dirtyAtStart = state.dirtyEvents
    const task = this.writeCheckpoint(state.threadId, item, representedSeq).then(() => {
      state.lastFlushedBytes = flushedBytes
      state.lastFlushedSeq = representedSeq
      state.lastFlushedAt = this.now()
      state.dirtyEvents = Math.max(0, state.dirtyEvents - dirtyAtStart)
      this.flushes += 1
    })
    state.flush = task
    try {
      await task
    } finally {
      if (state.flush === task) state.flush = undefined
      if (state.dirtyEvents > 0) this.armTimer(state)
    }
  }

  private writeCheckpoint(threadId: string, item: TurnItem, representedSeq: number): Promise<void> {
    return this.host.withThreadWrite(threadId, async () => {
      await mkdir(this.host.threadDir(threadId), { recursive: true, mode: 0o700 })
      await this.host.liveItems.checkpoint(
        this.host.liveItemsPath(threadId),
        threadId,
        item,
        representedSeq,
        { force: true }
      )
      this.host.bumpItemsVersion(threadId)
      this.host.applyItemToCache(threadId, item)
      this.host.bumpItemHistoryRevision(threadId)
    })
  }

  private clearState(key: string, state: PendingCheckpoint): void {
    if (state.timer) clearTimeout(state.timer)
    if (this.pending.get(key) === state) this.pending.delete(key)
  }
}

function checkpointKey(threadId: string, itemId: string): string {
  return `${threadId}\0${itemId}`
}

function itemBytes(item: TurnItem): number {
  if (item.kind === 'assistant_text' || item.kind === 'assistant_reasoning') {
    return Buffer.byteLength(item.text, 'utf8')
  }
  return Buffer.byteLength(JSON.stringify(item), 'utf8')
}

function nextItemBytes(previous: TurnItem, next: TurnItem, previousBytes: number): number {
  if (
    (previous.kind === 'assistant_text' && next.kind === 'assistant_text') ||
    (previous.kind === 'assistant_reasoning' && next.kind === 'assistant_reasoning')
  ) {
    if (next.text.startsWith(previous.text)) {
      return previousBytes + Buffer.byteLength(next.text.slice(previous.text.length), 'utf8')
    }
  }
  return itemBytes(next)
}
