import { stat } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import type { TurnItem } from '../../contracts/items.js'
import type { ItemHistoryCompactionResult } from '../../ports/session-store.js'
import { atomicWriteFile } from './atomic-write.js'
import { readLatestItemsFromJsonl } from './file-session-jsonl.js'
import { serializeItemRecords } from './file-session-live-items.js'
import { assertLegacyRepairDiskSpace, shouldRepairLegacyHistory } from './file-session-repair.js'
import type { JsonlFileAccessCoordinator } from './jsonl-file-access.js'
import { ensureItemTailReady } from './file-session-item-tail.js'

type CleanHistory = { signature: string; itemCount: number }
// Maintenance must not repeatedly scan a large unchanged history that cannot
// fit in the item cache. Scope this bounded hint to its file-access owner.
const cleanHistories = new WeakMap<JsonlFileAccessCoordinator, Map<string, CleanHistory>>()
const CLEAN_HISTORY_LIMIT = 128
const signature = (info: Stats, revision: number): string =>
  `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}:${revision}`

export async function compactFileSessionItems(input: {
  path: string
  threadId: string
  evidencePath: string
  force: boolean
  minimumBytes: number
  cachedItemCount: () => number
  fileAccess: JsonlFileAccessCoordinator
  readRevision: () => number
  bumpRevision: () => void
  bumpItemsVersion: () => void
  cacheItems: (items: TurnItem[]) => void
  refreshIndex: (items: readonly TurnItem[]) => Promise<void>
  scheduleRetry: () => void
  withThreadWrite: <T>(operation: () => Promise<T>) => Promise<T>
}): Promise<ItemHistoryCompactionResult> {
  await input.fileAccess.withRead(input.path, () => ensureItemTailReady({
    verified: new Set<string>(),
    threadId: input.threadId,
    path: input.path,
    evidencePath: input.evidencePath
  }))
  const info = await stat(input.path).catch(() => null)
  if (!info) return unchanged(0, 0, 0)
  if (!input.force && info.size < input.minimumBytes) {
    return unchanged(info.size, info.size, input.cachedItemCount())
  }

  const revisionBefore = input.readRevision()
  const beforeSignature = signature(info, revisionBefore)
  const clean = cleanHistories.get(input.fileAccess) ?? new Map<string, CleanHistory>()
  cleanHistories.set(input.fileAccess, clean)
  const prior = clean.get(input.path)
  if (!input.force && prior?.signature === beforeSignature) {
    return unchanged(info.size, info.size, prior.itemCount)
  }
  clean.delete(input.path)
  const rememberClean = async (itemCount: number): Promise<void> => {
    const latest = await stat(input.path).catch(() => null)
    if (!latest || signature(latest, input.readRevision()) !== beforeSignature) return
    clean.set(input.path, { signature: beforeSignature, itemCount })
    while (clean.size > CLEAN_HISTORY_LIMIT) clean.delete(clean.keys().next().value!)
  }
  const parsed = await input.fileAccess.withRead(
    input.path,
    () => readLatestItemsFromJsonl(input.path)
  )
  const output = serializeItemRecords(parsed.items)
  const afterBytes = Buffer.byteLength(output, 'utf8')
  if (!input.force && !shouldRepairLegacyHistory({
    sourceBytes: info.size,
    canonicalBytes: afterBytes,
    rawCount: parsed.rawCount,
    uniqueCount: parsed.items.length,
    minimumBytes: input.minimumBytes
  }) && parsed.rawCount === parsed.items.length) {
    if (parsed.malformedCount === 0 && !parsed.incompleteTrailingRecord) {
      await rememberClean(parsed.items.length)
    }
    return unchanged(info.size, info.size, parsed.items.length)
  }

  await assertLegacyRepairDiskSpace(input.path, info.size)
  return input.withThreadWrite(() => input.fileAccess.withReplacement(
    input.path,
    async () => {
      const currentInfo = await stat(input.path).catch(() => null)
      if (
        input.readRevision() !== revisionBefore ||
        !currentInfo ||
        currentInfo.size !== info.size ||
        currentInfo.mtimeMs !== info.mtimeMs
      ) {
        input.scheduleRetry()
        return unchanged(info.size, info.size, parsed.items.length)
      }
      const malformed = parsed.malformedCount + (parsed.incompleteTrailingRecord ? 1 : 0)
      if (malformed > 0) throw new Error(`item history contains ${malformed} malformed record(s)`)
      if (afterBytes >= currentInfo.size) {
        await rememberClean(parsed.items.length)
        input.cacheItems(parsed.items)
        return unchanged(currentInfo.size, currentInfo.size, parsed.items.length)
      }
      await atomicWriteFile(input.path, output, { allowDirectWriteFallback: false })
      await input.refreshIndex(parsed.items)
      input.bumpItemsVersion()
      input.cacheItems(parsed.items)
      input.bumpRevision()
      return {
        compacted: true,
        beforeBytes: info.size,
        afterBytes,
        itemCount: parsed.items.length
      }
    }
  ))
}

function unchanged(
  beforeBytes: number,
  afterBytes: number,
  itemCount: number
): ItemHistoryCompactionResult {
  return { compacted: false, beforeBytes, afterBytes, itemCount }
}
