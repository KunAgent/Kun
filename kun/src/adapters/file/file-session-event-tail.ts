import { createHash } from 'node:crypto'
import { open, writeFile } from 'node:fs/promises'
import { RuntimeEvent } from '../../contracts/events.js'

const SCAN_CHUNK_BYTES = 64 * 1024
const EVIDENCE_SAMPLE_BYTES = 16 * 1024

export type EventTailRepairResult = {
  repaired: boolean
  truncatedBytes: number
  appendedNewline: boolean
}

export async function ensureEventTailReady(input: {
  verified: Set<string>
  threadId: string
  path: string
  evidencePath: string
}): Promise<void> {
  if (input.verified.has(input.threadId)) return
  await repairIncompleteEventTail(input)
}

/**
 * Complete a valid final event record that lost only its JSONL newline. Other
 * unterminated bytes are crash tails and must be preserved as evidence then
 * removed before a later append can concatenate them with a valid record.
 */
export async function repairIncompleteEventTail(input: {
  path: string
  evidencePath: string
}): Promise<EventTailRepairResult> {
  let handle
  try {
    handle = await open(input.path, 'r+')
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      return { repaired: false, truncatedBytes: 0, appendedNewline: false }
    }
    throw error
  }
  try {
    const info = await handle.stat()
    if (info.size === 0) return { repaired: false, truncatedBytes: 0, appendedNewline: false }
    const finalByte = Buffer.allocUnsafe(1)
    await handle.read(finalByte, 0, 1, info.size - 1)
    if (finalByte[0] === 0x0a) return { repaired: false, truncatedBytes: 0, appendedNewline: false }

    let cursor = info.size
    let truncateAt = 0
    while (cursor > 0) {
      const start = Math.max(0, cursor - SCAN_CHUNK_BYTES)
      const chunk = Buffer.allocUnsafe(cursor - start)
      await handle.read(chunk, 0, chunk.length, start)
      const newline = chunk.lastIndexOf(0x0a)
      if (newline >= 0) {
        truncateAt = start + newline + 1
        break
      }
      cursor = start
    }

    const tailLength = info.size - truncateAt
    const tail = Buffer.alloc(tailLength)
    await handle.read(tail, 0, tail.length, truncateAt)
    try {
      const parsed = RuntimeEvent.safeParse(JSON.parse(tail.toString('utf8')))
      if (parsed.success) {
        await handle.write(Buffer.from('\n'), 0, 1, info.size)
        await handle.sync()
        return { repaired: true, truncatedBytes: 0, appendedNewline: true }
      }
    } catch {
      // The evidence and truncation path below handles invalid JSON.
    }

    const sampleLength = Math.min(tailLength, EVIDENCE_SAMPLE_BYTES)
    const sample = tail.subarray(0, sampleLength)
    await writeFile(input.evidencePath, `${JSON.stringify({
      repairedAt: new Date().toISOString(),
      truncatedBytes: tailLength,
      sha256: createHash('sha256').update(sample).digest('hex'),
      sampleBase64: sample.toString('base64'),
      sampleTruncated: tailLength > sampleLength
    })}\n`, { encoding: 'utf8', mode: 0o600 })
    await handle.truncate(truncateAt)
    await handle.sync()
    return { repaired: true, truncatedBytes: tailLength, appendedNewline: false }
  } finally {
    await handle.close()
  }
}
