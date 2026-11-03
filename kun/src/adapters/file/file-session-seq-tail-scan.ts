import { open, type FileHandle } from 'node:fs/promises'
import { DEFAULT_EVENT_REPLAY_MAX_RECORD_BYTES, parseReplayEventRecord } from './file-session-jsonl.js'

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
 * Read chunks and event records have independent limits: a valid event can
 * span many chunks. Keep bounded byte fragments in reverse order and decode
 * only complete lines so a split UTF-8 character is preserved. Discard the
 * uncommitted suffix as it is read instead of accumulating a torn append.
 */
export async function scanHighestSeqFromTail(options: {
  path: string
  fileSize: number
  chunkBytes?: number
  maxChunkBytes?: number
  maxRecordBytes?: number
  maxLines?: number
}): Promise<TailScanResult> {
  const chunkBytes = Math.max(1, Math.min(
    options.chunkBytes ?? DEFAULT_TAIL_SCAN_CHUNK_BYTES,
    options.maxChunkBytes ?? DEFAULT_TAIL_SCAN_MAX_CHUNK_BYTES
  ))
  const maxRecordBytes = options.maxRecordBytes ?? DEFAULT_EVENT_REPLAY_MAX_RECORD_BYTES
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
    const maxLines = options.maxLines ?? 1_024
    const observe = (seq: number): void => {
      if (seq > highest) highest = seq
      linesSeen += 1
    }
    const parseStrict = (line: string): boolean => {
      if (!line.trim()) return true
      const event = parseReplayEventRecord(line, maxRecordBytes)
      if (!event) return false
      observe(event.seq)
      return true
    }
    let fragments: Buffer[] = []
    let pendingBytes = 0
    const appendFragment = (fragment: Buffer): void => {
      pendingBytes += fragment.length
      if (pendingBytes > maxRecordBytes) {
        throw new Error(`event replay record exceeds ${maxRecordBytes} bytes`)
      }
      if (fragment.length > 0) fragments.push(fragment)
    }
    const finishLine = (): boolean => {
      const line = Buffer.concat(fragments.reverse(), pendingBytes).toString('utf8')
      fragments = []
      pendingBytes = 0
      return parseStrict(line)
    }
    let skippingUncommittedTail = true
    let end = options.fileSize
    while (end > 0 && linesSeen < maxLines) {
      const start = Math.max(0, end - chunkBytes)
      const length = end - start
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, start)
      if (bytesRead !== length) return { ok: false, reason: 'short-file' }
      let cursor = length
      while (cursor > 0) {
        const newline = buffer.lastIndexOf(0x0a, cursor - 1)
        if (skippingUncommittedTail) {
          if (newline < 0) break
          skippingUncommittedTail = false
        } else {
          appendFragment(buffer.subarray(newline + 1, cursor))
          if (newline < 0) break
          if (!finishLine()) return { ok: false, reason: 'malformed-tail' }
          if (linesSeen >= maxLines) return { ok: true, highestSeq: highest }
        }
        cursor = newline
      }
      if (start === 0 && !skippingUncommittedTail && !finishLine()) {
        return { ok: false, reason: 'malformed-tail' }
      }
      end = start
    }
    return { ok: true, highestSeq: highest }
  } finally {
    await handle.close().catch(() => undefined)
  }
}
