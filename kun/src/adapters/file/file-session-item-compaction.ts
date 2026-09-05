import { stat } from 'node:fs/promises'
import type { TurnItem } from '../../contracts/items.js'
import type { ItemHistoryCompactionResult } from '../../ports/session-store.js'
import { atomicWriteFile } from './atomic-write.js'
import { readLatestItemsFromJsonl } from './file-session-jsonl.js'
import { serializeItemRecords } from './file-session-live-items.js'
import { assertLegacyRepairDiskSpace, shouldRepairLegacyHistory } from './file-session-repair.js'
import type { JsonlFileAccessCoordinator } from './jsonl-file-access.js'
import { ensureItemTailReady } from './file-session-item-tail.js'

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
    return unchanged(info.size, info.size, parsed.items.length)
  }

  await assertLegacyRepairDiskSpace(input.path, info.size)
  return input.fileAccess.withReplacement(
    input.path,
    () => input.withThreadWrite(async () => {
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
    })
  )
}

function unchanged(
  beforeBytes: number,
  afterBytes: number,
  itemCount: number
): ItemHistoryCompactionResult {
  return { compacted: false, beforeBytes, afterBytes, itemCount }
}
