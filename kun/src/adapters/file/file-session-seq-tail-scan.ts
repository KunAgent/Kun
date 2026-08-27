import { open, type FileHandle } from 'node:fs/promises'
import { parseReplayEventRecord } from './file-session-jsonl.js'

/**
 * Fast tail scan for the highest committed event seq.
 *
 * A JSONL record becomes durable only once its trailing newline is written.
 * Any bytes after the final newline are an in-flight append, even when they
 * already contain a readable complete JSON value. The durable high-water
 * mark must therefore stay on the last complete newline-terminated event.
 *
 * Complete interior records are schema-validated. A corrupt interior record
 * degrades to `{ ok: false }` so the caller falls back to the same bounded
 * forward scan semantics instead of trusting bytes from a torn write.
 */
const DEFAULT_TAIL_SCAN_CHUNK_BYTES = 64 * 1024
const DEFAULT_TAIL_SCAN_MAX_CHUNK_BYTES = 1024 * 1024

export type TailScanResult =
  | { ok: true; highestSeq: number }
  | { ok: false; reason: 'handle-unavailable' | 'short-file' | 'malformed-tail' }

/**
 * Read newline-terminated lines from the end of a JSONL file backwards and
 * return the highest `seq` among them.
 *
 * Chunk boundaries split lines on both sides. `carry` holds the end-fragment
 * of a line whose beginning lies in the next-older chunk: chunk text is
 * older, so `text + carry` restores file order and the final split element
 * is a complete line. Only the very first (newest) read can end with a torn
 * in-flight append after its last newline; that fragment never becomes a
 * carry and is never treated as malformed.
 */
export async function scanHighestSeqFromTail(options: {
  path: string
  fileSize: number
  chunkBytes?: number
  maxChunkBytes?: number
  maxLines?: number
}): Promise<TailScanResult> {
  const chunkBytes = Math.min(
    options.chunkBytes ?? DEFAULT_TAIL_SCAN_CHUNK_BYTES,
    options.maxChunkBytes ?? DEFAULT_TAIL_SCAN_MAX_CHUNK_BYTES
  )
  if (options.fileSize <= 0) return { ok: true, highestSeq: 0 }
  let handle: FileHandle
  try {
    handle = await open(options.path, 'r')
  } catch {
    return { ok: false, reason: 'handle-unavailable' }
  }
  try {
    let highest = 0
    let linesSeen = 0
    let budgetExhausted = false
    const maxLines = options.maxLines ?? 1_024
    const observe = (seq: number): void => {
      if (seq > highest) highest = seq
      linesSeen += 1
    }
    const parseStrict = (line: string): boolean => {
      if (!line.trim()) return true
      const event = parseReplayEventRecord(line, options.maxChunkBytes ?? DEFAULT_TAIL_SCAN_MAX_CHUNK_BYTES)
      if (!event) return false
      observe(event.seq)
      return true
    }
    let carry = ''
    let newest = true
    let end = options.fileSize
    while (end > 0 && !budgetExhausted) {
      const start = Math.max(0, end - chunkBytes)
      const length = end - start
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, start)
      if (bytesRead !== length) return { ok: false, reason: 'short-file' }
      const combined = buffer.toString('utf-8') + carry
      if (start === 0) {
        const parts = combined.split('\n')
        // The final split part is an unterminated append fragment. Ignore it
        // even if JSON.parse would accept it; no commit marker has arrived.
        const lastIndex = newest ? parts.length - 1 : parts.length
        for (let i = 0; i < lastIndex; i++) {
          if (!parseStrict(parts[i])) return { ok: false, reason: 'malformed-tail' }
        }
        return { ok: true, highestSeq: highest }
      }
      const firstNewline = combined.indexOf('\n')
      if (firstNewline < 0) {
        // The whole window is one line's end-fragment; defer to older bytes.
        carry = combined
        end = start
        continue
      }
      carry = combined.slice(0, firstNewline)
      const lastNewline = combined.lastIndexOf('\n')
      // On the newest window, bytes after the last newline are uncommitted.
      const body = newest
        ? (lastNewline > firstNewline ? combined.slice(firstNewline + 1, lastNewline) : '')
        : combined.slice(firstNewline + 1)
      for (const line of body ? body.split('\n') : []) {
        if (!parseStrict(line)) return { ok: false, reason: 'malformed-tail' }
      }
      if (linesSeen >= maxLines) budgetExhausted = true
      newest = false
      end = start
    }
    return { ok: true, highestSeq: highest }
  } finally {
    await handle.close().catch(() => undefined)
  }
}
