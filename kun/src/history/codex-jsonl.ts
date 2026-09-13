import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { createZstdDecompress } from 'node:zlib'
import type { HistorySourceFile } from '../contracts/history-reference.js'

export type JsonObject = Record<string, unknown>
export const object = (value: unknown): JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
export const string = (value: unknown): string => typeof value === 'string' ? value : ''
export const MAX_RECORD_BYTES = 16 * 1024 * 1024

export interface CodexLine {
  value: JsonObject
  offset: number
  end: number
  ordinal: number
  sha256: string
  malformed: boolean
}

/** One record of transient body memory; offsets always refer to decoded bytes. */
export async function* readCodexLines(path: string, byteLimit?: number): AsyncGenerator<CodexLine> {
  const file = createReadStream(path, { highWaterMark: 64 * 1024 })
  const decoded = path.toLowerCase().endsWith('.zst') ? file.pipe(createZstdDecompress()) : file
  const forwardError = (error: Error): void => { decoded.destroy(error) }
  if (decoded !== file) file.on('error', forwardError)
  let parts: Buffer[] = []
  let size = 0
  let offset = 0
  let ordinal = 0
  let oversized = false
  const hash = createHash('sha256')
  try {
    for await (const rawChunk of decoded) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk)
      let start = 0
      while (start < chunk.length) {
        const newline = chunk.indexOf(10, start)
        const end = newline < 0 ? chunk.length : newline + 1
        let part = chunk.subarray(start, end)
        if (byteLimit !== undefined && offset + size + part.length > byteLimit) {
          part = part.subarray(0, Math.max(0, byteLimit - offset - size))
        }
        if (part.length === 0) return
        hash.update(part)
        size += part.length
        if (size > MAX_RECORD_BYTES) { oversized = true; parts = [] }
        if (!oversized) parts.push(part)
        const complete = part[part.length - 1] === 10
        if (complete) {
          let value: JsonObject = {}
          let malformed = oversized
          if (!oversized) {
            try { value = object(JSON.parse(Buffer.concat(parts, size).toString('utf8'))) }
            catch { malformed = true }
          }
          ordinal += 1
          yield { value, offset, end: offset + size, ordinal, sha256: hash.copy().digest('hex'), malformed }
          offset += size
          size = 0
          parts = []
          oversized = false
        }
        if (byteLimit !== undefined && offset + size >= byteLimit) return
        start = end
      }
    }
    // An unfinished tail is never a valid branch boundary.
    if (size > 0) yield {
      value: {}, offset, end: offset, ordinal: ordinal + 1,
      sha256: hash.copy().digest('hex'), malformed: true
    }
  } finally {
    decoded.destroy()
    file.destroy()
    file.off('error', forwardError)
  }
}

export class HistorySourceError extends Error {
  constructor(readonly status: 'missing' | 'changed' | 'partial', message: string) {
    super(message)
    this.name = 'HistorySourceError'
  }
}

export async function validateSourceFile(file: HistorySourceFile): Promise<void> {
  let last: CodexLine | undefined
  try {
    for await (const line of readCodexLines(file.path, file.byteLength)) last = line
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new HistorySourceError('missing', 'Source history source is missing. Relink the original file.')
    }
    throw new HistorySourceError('changed', 'Source history source cannot be decoded.')
  }
  if (!last || last.end !== file.byteLength || last.sha256 !== file.sha256) {
    throw new HistorySourceError('changed', 'Source history before the branch point has changed or was truncated.')
  }
}
