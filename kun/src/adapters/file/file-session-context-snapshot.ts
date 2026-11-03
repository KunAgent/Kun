import { open } from 'node:fs/promises'
import { ContextSnapshotEvent } from '../../contracts/context-snapshot.js'

const CHUNK_BYTES = 64 * 1024
const MAX_RECORD_BYTES = 4 * 1024 * 1024
const KIND = Buffer.from('"context_snapshot"')

/** Read newest-first without replaying or materializing the conversation log. */
export async function readLatestContextSnapshot(path: string, threadId: string, maxSeq: number): Promise<ContextSnapshotEvent | null> {
  const handle = await open(path, 'r').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (!handle) return null
  try {
    const info = await handle.stat()
    if (!info.isFile()) return null
    let end = info.size
    let carry = Buffer.alloc(0)
    // A JSONL record is committed only after its newline. Ignore the torn tail.
    let skipping = true
    const parse = (bytes: Buffer): ContextSnapshotEvent | null => {
      if (!bytes.includes(KIND)) return null
      try {
        const parsed = ContextSnapshotEvent.safeParse(JSON.parse(bytes.toString('utf8')))
        return parsed.success && parsed.data.threadId === threadId && !parsed.data.child && parsed.data.seq <= maxSeq
          ? parsed.data : null
      } catch { return null }
    }
    while (end > 0) {
      const start = Math.max(0, end - CHUNK_BYTES)
      const chunk = Buffer.alloc(end - start)
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, start)
      if (bytesRead !== chunk.length) return null
      let boundary = chunk.length
      for (let index = chunk.lastIndexOf(0x0a); index >= 0; index = index === 0 ? -1 : chunk.lastIndexOf(0x0a, index - 1)) {
        const fragment = chunk.subarray(index + 1, boundary)
        if (!skipping && fragment.length + carry.length <= MAX_RECORD_BYTES) {
          const result = parse(Buffer.concat([fragment, carry]))
          if (result) return result
        }
        carry = Buffer.alloc(0)
        skipping = false
        boundary = index
      }
      if (!skipping) {
        if (boundary + carry.length > MAX_RECORD_BYTES) {
          skipping = true
          carry = Buffer.alloc(0)
        } else carry = Buffer.concat([chunk.subarray(0, boundary), carry])
      }
      end = start
    }
    return skipping ? null : parse(carry)
  } finally { await handle.close() }
}
