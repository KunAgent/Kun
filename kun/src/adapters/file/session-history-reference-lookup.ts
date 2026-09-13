import { createReadStream } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { TurnItem } from '../../contracts/items.js'

const MAX_RECOVERY_SCAN_BYTES = 8 * 1024 * 1024
const MAX_RECOVERY_RECORD_BYTES = 1024 * 1024
const RecoverySessionSchema = z.object({
  threadId: z.string(), turnId: z.string(), startedAt: z.string(), updatedAt: z.string(),
  items: z.array(z.unknown()), events: z.array(z.unknown()), closed: z.boolean(),
  historyRefId: z.string().min(1).optional()
})

/** Returns true for a matching binding OR uncertain recovery data; GC must fail closed. */
export async function sessionMayReferenceHistory(directory: string, threadId: string, referenceId: string): Promise<boolean> {
  const snapshot = await snapshotReference(directory, threadId, referenceId)
  if (snapshot !== null) return snapshot
  return itemsMayReferenceHistory(join(directory, 'messages.jsonl'), threadId, referenceId)
}

/** null means no snapshot exists: consult the authoritative JSONL user items. */
async function snapshotReference(directory: string, threadId: string, referenceId: string): Promise<boolean | null> {
  let handle
  try {
    handle = await open(join(directory, 'session.json'), 'r')
    if ((await handle.stat()).size > MAX_RECOVERY_SCAN_BYTES) return true
    const parsed = RecoverySessionSchema.safeParse(JSON.parse(await handle.readFile('utf8')))
    if (!parsed.success || parsed.data.threadId !== threadId) return true
    if (parsed.data.historyRefId) return parsed.data.historyRefId === referenceId
    // Older snapshots did not persist the binding. Their existence cannot prove non-use.
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : true
  } finally {
    await handle?.close()
  }
}

/** Bounded, read-only scan of Kun items; never resolves or opens a Codex source path. */
async function itemsMayReferenceHistory(path: string, threadId: string, referenceId: string): Promise<boolean> {
  let remainder = ''
  let bytes = 0
  let sawItems = false
  let knownReference: string | undefined
  const accept = (line: string): boolean => {
    if (!line.trim()) return false
    sawItems = true
    const item = TurnItem.safeParse(JSON.parse(line))
    if (!item.success || item.data.threadId !== threadId) return true
    if (item.data.kind !== 'user_message' || !item.data.historyRefId) return false
    if (knownReference && knownReference !== item.data.historyRefId) return true
    knownReference = item.data.historyRefId
    return knownReference === referenceId
  }
  try {
    for await (const chunk of createReadStream(path, { encoding: 'utf8', highWaterMark: 64 * 1024 })) {
      bytes += Buffer.byteLength(chunk, 'utf8')
      if (bytes > MAX_RECOVERY_SCAN_BYTES) return true
      remainder += chunk
      let newline = remainder.indexOf('\n')
      while (newline >= 0) {
        const line = remainder.slice(0, newline)
        remainder = remainder.slice(newline + 1)
        if (line.length > MAX_RECOVERY_RECORD_BYTES) return true
        if (accept(line)) return true
        newline = remainder.indexOf('\n')
      }
      if (Buffer.byteLength(remainder, 'utf8') > MAX_RECOVERY_RECORD_BYTES) return true
    }
    if (accept(remainder)) return true
    // A legacy item stream without a host binding is ambiguous, not proof of non-use.
    return sawItems && !knownReference
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT'
  }
}
