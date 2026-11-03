import { open } from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'

/** One read buffer per scan. Electron's allocator makes a fresh 64 KiB buffer per read slow. */
export const JSONL_SCAN_CHUNK_BYTES = 1024 * 1024

export type JsonlLine = {
  line: string
  bytes: number
  /** True for bytes after the final newline (for example an in-flight append). */
  trailing: boolean
}

/**
 * Split a JSONL file into records in time linear in its size.
 *
 * Appending decoded chunks to one string and searching it from the start
 * after every chunk copies and rescans a record once per chunk, so a 1 MiB
 * tool result read in 64 KiB chunks cost ~16 passes. This keeps raw bytes
 * until their newline arrives and decodes each record once. Splitting at the
 * 0x0a byte is safe because it never occurs inside a UTF-8 sequence.
 */
export async function* scanJsonlLines(
  path: string,
  options: {
    start?: number
    chunkBytes?: number
    maxPendingBytes: number
    pendingTooLarge: () => Error
  }
): AsyncGenerator<JsonlLine> {
  const handle = await open(path, 'r')
  try {
    const size = (await handle.stat()).size
    const chunk = Buffer.allocUnsafe(Math.max(1, Math.min(
      options.chunkBytes ?? JSONL_SCAN_CHUNK_BYTES,
      // The file may still grow; this only sizes the reusable buffer.
      Math.max(4096, size - (options.start ?? 0))
    )))
    let position = Math.max(0, options.start ?? 0)
    // Partial records are decoded as they arrive (the read buffer is reused);
    // the decoder carries a UTF-8 sequence split across two reads.
    const decoder = new StringDecoder('utf8')
    let pending: string[] = []
    let pendingBytes = 0
    const take = (tail: Buffer): { line: string; bytes: number } => {
      const bytes = pendingBytes + tail.length
      let line: string
      if (pending.length === 0) line = tail.toString('utf-8')
      else {
        pending.push(decoder.end(tail))
        line = pending.join('')
      }
      pending = []
      pendingBytes = 0
      return { line, bytes }
    }
    for (;;) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position)
      if (bytesRead === 0) break
      position += bytesRead
      const view = chunk.subarray(0, bytesRead)
      let start = 0
      let newline = view.indexOf(0x0a, start)
      while (newline >= 0) {
        yield { ...take(view.subarray(start, newline)), trailing: false }
        start = newline + 1
        newline = view.indexOf(0x0a, start)
      }
      if (start < view.length) {
        pending.push(decoder.write(view.subarray(start)))
        pendingBytes += view.length - start
      }
      if (pendingBytes > options.maxPendingBytes) throw options.pendingTooLarge()
    }
    if (pendingBytes > 0) yield { ...take(Buffer.alloc(0)), trailing: true }
  } finally {
    await handle.close()
  }
}
