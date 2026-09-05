import type { TurnItem } from '../../contracts/items.js'

export type ItemIndexRow = {
  itemId: string
  turnId: string
  kind: TurnItem['kind']
  isPublic: boolean
  baseline: boolean
  offset: number
  recordBytes: number
}

export type ItemIndexSourceIdentity = {
  size: number
  mtimeMs: number
  dev: number
  ino: number
}

export type ItemIndexViewStats = {
  entries: number
  estimatedBytes: number
  maxBytes: number
  hits: number
  hydrations: number
  incrementalUpdates: number
  evictions: number
}

const ROW_OVERHEAD_BYTES = 416
const DEFAULT_MAX_ENTRIES = 4
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024

export class ItemIndexView {
  readonly latest = new Map<string, ItemIndexRow>()
  readonly order: string[] = []
  readonly positions = new Map<string, number>()
  readonly publicRows: ItemIndexRow[] = []
  readonly publicPositions = new Map<string, number>()
  readonly anchorPositions = new Map<string, number>()
  rowCount = 0
  estimatedBytes = 0

  applyRow(row: ItemIndexRow): void {
    this.rowCount += 1
    const previous = this.latest.get(row.itemId)
    if (!previous) {
      this.positions.set(row.itemId, this.order.length)
      this.order.push(row.itemId)
      this.latest.set(row.itemId, row)
      this.estimatedBytes += estimateRowBytes(row)
      if (row.isPublic) this.appendPublicRow(row)
      return
    }

    this.latest.set(row.itemId, row)
    this.estimatedBytes += estimateRowBytes(row) - estimateRowBytes(previous)
    const publicPosition = this.publicPositions.get(row.itemId)
    const projectionStable = previous.isPublic === row.isPublic && (
      !row.isPublic || (
        previous.turnId === row.turnId &&
        previous.kind === row.kind
      )
    )
    if (!projectionStable) {
      this.rebuildPublicProjection()
    } else if (publicPosition !== undefined) {
      this.publicRows[publicPosition] = row
    }
  }

  private appendPublicRow(row: ItemIndexRow): void {
    const position = this.publicRows.length
    this.publicRows.push(row)
    this.publicPositions.set(row.itemId, position)
    if (row.kind === 'user_message' && !this.anchorPositions.has(row.turnId)) {
      this.anchorPositions.set(row.turnId, position)
    }
  }

  private rebuildPublicProjection(): void {
    this.publicRows.length = 0
    this.publicPositions.clear()
    this.anchorPositions.clear()
    for (const itemId of this.order) {
      const row = this.latest.get(itemId)
      if (row?.isPublic) this.appendPublicRow(row)
    }
  }
}

export class ItemIndexViewCache {
  private readonly entries = new Map<string, {
    identity: ItemIndexSourceIdentity
    view: ItemIndexView
  }>()
  private readonly inflight = new Map<string, Promise<ItemIndexView | null>>()
  private resetGeneration = 0
  private readonly sourceGenerations = new Map<string, number>()
  private hits = 0
  private hydrations = 0
  private incrementalUpdates = 0
  private evictions = 0

  constructor(
    private readonly maxEntries = DEFAULT_MAX_ENTRIES,
    private readonly maxBytes = DEFAULT_MAX_BYTES
  ) {}

  get(sourcePath: string, identity: ItemIndexSourceIdentity, rowCount: number): ItemIndexView | undefined {
    const entry = this.entries.get(sourcePath)
    if (!entry || !sameIdentity(entry.identity, identity) || entry.view.rowCount !== rowCount) return undefined
    this.entries.delete(sourcePath)
    this.entries.set(sourcePath, entry)
    this.hits += 1
    return entry.view
  }

  async hydrate(
    sourcePath: string,
    identity: ItemIndexSourceIdentity,
    rowCount: number,
    load: () => Promise<ItemIndexView | null>
  ): Promise<ItemIndexView | null> {
    const cached = this.get(sourcePath, identity, rowCount)
    if (cached) return cached
    const key = `${sourcePath}\0${identityKey(identity)}\0${rowCount}`
    const existing = this.inflight.get(key)
    if (existing) return existing
    const startedGeneration = this.currentGeneration(sourcePath)
    this.hydrations += 1
    const run = load().then((view) => {
      if (view && view.rowCount === rowCount && this.currentGeneration(sourcePath) === startedGeneration) {
        this.publish(sourcePath, identity, view)
      }
      return view
    }).finally(() => {
      if (this.inflight.get(key) === run) this.inflight.delete(key)
    })
    this.inflight.set(key, run)
    return run
  }

  currentGeneration(sourcePath: string): string {
    return `${this.resetGeneration}:${this.sourceGenerations.get(sourcePath) ?? 0}`
  }

  publish(
    sourcePath: string,
    identity: ItemIndexSourceIdentity,
    view: ItemIndexView,
    expectedGeneration = this.currentGeneration(sourcePath)
  ): void {
    if (expectedGeneration !== this.currentGeneration(sourcePath)) return
    this.entries.delete(sourcePath)
    if (view.estimatedBytes > this.maxBytes) return
    this.entries.set(sourcePath, { identity, view })
    this.evictOverflow()
  }

  applyAppend(input: {
    sourcePath: string
    before: ItemIndexSourceIdentity
    after: ItemIndexSourceIdentity
    expectedRows: number
    expectedGeneration?: string
    row: ItemIndexRow
  }): void {
    if (
      input.expectedGeneration !== undefined &&
      input.expectedGeneration !== this.currentGeneration(input.sourcePath)
    ) return
    const entry = this.entries.get(input.sourcePath)
    if (!entry || !sameIdentity(entry.identity, input.before) || entry.view.rowCount !== input.expectedRows) {
      this.clearSource(input.sourcePath)
      return
    }
    entry.view.applyRow(input.row)
    entry.identity = input.after
    this.entries.delete(input.sourcePath)
    this.entries.set(input.sourcePath, entry)
    this.incrementalUpdates += 1
    this.evictOverflow()
  }

  clearSource(sourcePath: string): void {
    this.sourceGenerations.set(sourcePath, (this.sourceGenerations.get(sourcePath) ?? 0) + 1)
    this.entries.delete(sourcePath)
  }

  clear(): void {
    this.resetGeneration += 1
    this.sourceGenerations.clear()
    this.entries.clear()
    this.inflight.clear()
  }

  stats(): ItemIndexViewStats {
    return {
      entries: this.entries.size,
      estimatedBytes: this.totalBytes(),
      maxBytes: this.maxBytes,
      hits: this.hits,
      hydrations: this.hydrations,
      incrementalUpdates: this.incrementalUpdates,
      evictions: this.evictions
    }
  }

  private totalBytes(): number {
    let total = 0
    for (const entry of this.entries.values()) total += entry.view.estimatedBytes
    return total
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxEntries || this.totalBytes() > this.maxBytes) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
      this.evictions += 1
    }
  }
}

export function identityFromStat(value: ItemIndexSourceIdentity): ItemIndexSourceIdentity {
  return { size: value.size, mtimeMs: value.mtimeMs, dev: value.dev, ino: value.ino }
}

export function sameIdentity(left: ItemIndexSourceIdentity, right: ItemIndexSourceIdentity): boolean {
  return left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.dev === right.dev &&
    left.ino === right.ino
}

function identityKey(identity: ItemIndexSourceIdentity): string {
  return `${identity.size}:${identity.mtimeMs}:${identity.dev}:${identity.ino}`
}

function estimateRowBytes(row: ItemIndexRow): number {
  return ROW_OVERHEAD_BYTES + Buffer.byteLength(row.itemId, 'utf8') + Buffer.byteLength(row.turnId, 'utf8')
}
