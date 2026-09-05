import { stat, readFile, rm } from 'node:fs/promises'
import type { RuntimeEvent } from '../../contracts/events.js'
import { TurnItem as TurnItemSchema, type TurnItem } from '../../contracts/items.js'
import type { LiveItemCheckpoint } from '../../ports/session-store.js'
import { atomicWriteFile } from './atomic-write.js'

export const ITEM_HISTORY_MAX_RECORD_BYTES = 16 * 1024 * 1024
export const LIVE_ITEM_CHECKPOINT_STEP_BYTES = 64 * 1024
export const LIVE_ITEMS_MAX_BYTES = 32 * 1024 * 1024

type LiveItemsFile = {
  version: 1
  entries: readonly LiveItemCheckpoint[]
}

export function serializeItemRecord(item: TurnItem): string {
  const serialized = JSON.stringify(item)
  const bytes = Buffer.byteLength(serialized, 'utf8')
  if (bytes > ITEM_HISTORY_MAX_RECORD_BYTES) {
    throw new Error(
      `item history record exceeds ${ITEM_HISTORY_MAX_RECORD_BYTES} bytes; ` +
      'store large content as an attachment or artifact'
    )
  }
  return serialized
}

export function serializeItemRecords(items: readonly TurnItem[]): string {
  const records = items.map(serializeItemRecord)
  return records.length > 0 ? `${records.join('\n')}\n` : ''
}

export function serializeLiveItems(entries: readonly LiveItemCheckpoint[]): string {
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.representedSeq) || entry.representedSeq < 0) {
      throw new RangeError('live item representedSeq must be a non-negative safe integer')
    }
    serializeItemRecord(entry.item)
  }
  const serialized = JSON.stringify({ version: 1, entries } satisfies LiveItemsFile)
  if (Buffer.byteLength(serialized, 'utf8') > LIVE_ITEMS_MAX_BYTES) {
    throw new Error(`live item checkpoint exceeds ${LIVE_ITEMS_MAX_BYTES} bytes`)
  }
  return serialized
}

export async function readLiveItems(path: string): Promise<LiveItemCheckpoint[]> {
  const info = await stat(path).catch(() => null)
  if (!info || info.size <= 0 || info.size > LIVE_ITEMS_MAX_BYTES) return []
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const candidate = value as { version?: unknown; entries?: unknown }
    if (candidate.version !== 1 || !Array.isArray(candidate.entries)) return []
    const entries: LiveItemCheckpoint[] = []
    for (const raw of candidate.entries) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const entry = raw as { item?: unknown; representedSeq?: unknown }
      const item = TurnItemSchema.safeParse(entry.item)
      if (
        !item.success ||
        !Number.isSafeInteger(entry.representedSeq) ||
        (entry.representedSeq as number) < 0
      ) continue
      entries.push({ item: item.data, representedSeq: entry.representedSeq as number })
    }
    return entries
  } catch {
    return []
  }
}

export function overlayLiveItems(
  canonical: readonly TurnItem[],
  live: readonly LiveItemCheckpoint[]
): TurnItem[] {
  if (live.length === 0) return [...canonical]
  const result = [...canonical]
  const positions = new Map(result.map((item, index) => [item.id, index]))
  for (const entry of live) {
    const index = positions.get(entry.item.id)
    if (index === undefined) {
      positions.set(entry.item.id, result.length)
      result.push(entry.item)
    } else if (isTerminalStatus(result[index]!.status)) {
      continue
    } else {
      result[index] = entry.item
    }
  }
  return result
}

export function liveItemsAfterCanonicalRewrite(
  live: readonly LiveItemCheckpoint[],
  canonical: readonly TurnItem[]
): LiveItemCheckpoint[] {
  const latestById = new Map(canonical.map((item) => [item.id, item]))
  return live.filter((entry) => {
    const item = latestById.get(entry.item.id)
    return item !== undefined && !isTerminalStatus(item.status)
  })
}

export function liveReplayAfterSeq(entries: readonly LiveItemCheckpoint[]): number | undefined {
  if (entries.length === 0) return undefined
  return entries.reduce(
    (lowest, entry) => Math.min(lowest, entry.representedSeq),
    entries[0]!.representedSeq
  )
}

/** Apply durable offset-bearing deltas that landed after each checkpoint. */
export function replayLiveItemDeltas(
  entries: readonly LiveItemCheckpoint[],
  events: readonly RuntimeEvent[]
): LiveItemCheckpoint[] {
  const recovered = entries.map((entry) => ({ ...entry }))
  const byId = new Map(recovered.map((entry) => [entry.item.id, entry]))
  for (const event of events) {
    if (event.kind !== 'assistant_text_delta' && event.kind !== 'assistant_reasoning_delta') continue
    const entry = byId.get(event.itemId ?? event.item.id)
    if (!entry || event.seq <= entry.representedSeq) continue
    const current = entry.item
    const delta = event.item
    if (
      (current.kind !== 'assistant_text' || delta.kind !== 'assistant_text') &&
      (current.kind !== 'assistant_reasoning' || delta.kind !== 'assistant_reasoning')
    ) continue
    entry.item = {
      ...current,
      text: mergeAssistantDelta(current.text, delta.text, event.deltaOffset),
      status: isTerminalStatus(current.status) ? current.status : delta.status,
      finishedAt: delta.finishedAt ?? current.finishedAt
    } as TurnItem
  }
  return recovered
}

export async function readRecoveredLiveItems(
  path: string,
  loadEvents: (sinceSeq: number) => Promise<RuntimeEvent[]>
): Promise<LiveItemCheckpoint[]> {
  const live = await readLiveItems(path)
  if (live.length === 0) return live
  return replayLiveItemDeltas(live, await loadEvents(liveReplayAfterSeq(live) ?? 0))
}

export class FileSessionLiveItems {
  private readonly checkpointBytes = new Map<string, number>()

  async checkpoint(
    path: string,
    threadId: string,
    item: TurnItem,
    representedSeq: number,
    options: { force?: boolean } = {}
  ): Promise<boolean> {
    serializeItemRecord(item)
    const key = `${threadId}:${item.id}`
    const itemBytes = liveItemTextBytes(item)
    const previousBytes = this.checkpointBytes.get(key)
    if (
      options.force !== true &&
      previousBytes !== undefined &&
      itemBytes - previousBytes < LIVE_ITEM_CHECKPOINT_STEP_BYTES
    ) return false

    const current = await readLiveItems(path)
    const entries = current.filter((entry) => entry.item.id !== item.id)
    entries.push({ item, representedSeq })
    await atomicWriteFile(path, serializeLiveItems(entries))
    this.checkpointBytes.set(key, itemBytes)
    return true
  }

  async remove(path: string, threadId: string, itemId: string): Promise<void> {
    this.checkpointBytes.delete(`${threadId}:${itemId}`)
    const current = await readLiveItems(path)
    const entries = current.filter((entry) => entry.item.id !== itemId)
    if (entries.length === current.length) return
    if (entries.length === 0) {
      await rm(path, { force: true })
      return
    }
    await atomicWriteFile(path, serializeLiveItems(entries))
  }

  async reconcileAfterRewrite(
    path: string,
    threadId: string,
    canonical: readonly TurnItem[]
  ): Promise<void> {
    const current = await readLiveItems(path)
    if (current.length === 0) {
      this.clearThread(threadId)
      await rm(path, { force: true })
      return
    }
    const entries = liveItemsAfterCanonicalRewrite(current, canonical)
    if (entries.length === current.length) return
    const retainedIds = new Set(entries.map((entry) => entry.item.id))
    for (const entry of current) {
      if (!retainedIds.has(entry.item.id)) {
        this.checkpointBytes.delete(`${threadId}:${entry.item.id}`)
      }
    }
    if (entries.length === 0) {
      await rm(path, { force: true })
      return
    }
    await atomicWriteFile(path, serializeLiveItems(entries))
  }

  /** Stage the full terminal item so either side of the canonical append is recoverable. */
  async stageFinal(path: string, threadId: string, item: TurnItem): Promise<void> {
    serializeItemRecord(item)
    const current = await readLiveItems(path)
    const index = current.findIndex((entry) => entry.item.id === item.id)
    if (index < 0) return
    current[index] = { ...current[index]!, item }
    await atomicWriteFile(path, serializeLiveItems(current))
    this.checkpointBytes.set(`${threadId}:${item.id}`, liveItemTextBytes(item))
  }

  clearThread(threadId: string): void {
    const prefix = `${threadId}:`
    for (const key of this.checkpointBytes.keys()) {
      if (key.startsWith(prefix)) this.checkpointBytes.delete(key)
    }
  }

  clear(): void {
    this.checkpointBytes.clear()
  }
}

function liveItemTextBytes(item: TurnItem): number {
  if (item.kind === 'assistant_text' || item.kind === 'assistant_reasoning') {
    return Buffer.byteLength(item.text, 'utf8')
  }
  return Buffer.byteLength(JSON.stringify(item), 'utf8')
}

function mergeAssistantDelta(existing: string, fragment: string, offset?: number): string {
  if (!fragment || existing === fragment || existing.startsWith(fragment)) return existing
  if (fragment.startsWith(existing)) return fragment
  if (offset === undefined || !Number.isSafeInteger(offset) || offset < 0 || offset > existing.length) {
    return `${existing}${fragment}`
  }
  const overlapLength = Math.min(existing.length - offset, fragment.length)
  if (existing.slice(offset, offset + overlapLength) !== fragment.slice(0, overlapLength)) {
    if (existing.includes(fragment)) return existing
    return offset === existing.length ? `${existing}${fragment}` : existing
  }
  return existing.slice(0, offset) + fragment + existing.slice(offset + overlapLength)
}

function isTerminalStatus(status: TurnItem['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'aborted' ||
    status === 'cancelled' || status === 'expired'
}
