import { createReadStream } from 'node:fs'
import type { RuntimeEvent } from '../../contracts/events.js'
import { RuntimeEvent as RuntimeEventSchema } from '../../contracts/events.js'
import { DEFAULT_EVENT_REPLAY_MAX_RECORD_BYTES } from '../file/file-session-store.js'
import type { UsageRuntimeEvent } from './hybrid-thread-support.js'

const ERROR_SNIPPET_MAX_CHARS = 120

function recordLimitError(path: string, maxRecordBytes: number): Error {
  return new Error(`usage backfill record in ${path} exceeds ${maxRecordBytes} bytes`)
}

function malformedLineError(path: string, lineNumber: number, line: string, error: unknown): Error {
  const reason = error instanceof Error ? error.message : String(error)
  const snippet = line.length > ERROR_SNIPPET_MAX_CHARS
    ? `${line.slice(0, ERROR_SNIPPET_MAX_CHARS)}...`
    : line
  return new Error(
    `malformed JSONL record in ${path} at line ${lineNumber}: ${reason}; line=${JSON.stringify(snippet)}`,
    { cause: error }
  )
}

function parseStrictEvent(
  path: string,
  line: string,
  lineNumber: number,
  maxRecordBytes: number
): RuntimeEvent | null {
  if (!line.trim()) return null
  if (Buffer.byteLength(line, 'utf-8') > maxRecordBytes) {
    throw recordLimitError(path, maxRecordBytes)
  }
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch (error) {
    throw malformedLineError(path, lineNumber, line, error)
  }
  const parsed = RuntimeEventSchema.safeParse(value)
  if (!parsed.success) {
    throw malformedLineError(path, lineNumber, line, parsed.error)
  }
  return parsed.data
}

/**
 * Single streaming pass over events.jsonl for usage backfill.
 *
 * Only a missing file is treated as an empty log. Permission and I/O errors
 * propagate so the caller can defer the backfill instead of marking it done.
 * The final unterminated record is an in-flight append and is ignored when it
 * cannot be parsed; newline-terminated corrupt records fail the scan.
 */
export async function scanEventsForUsageBackfill(
  path: string,
  options: { maxRecordBytes?: number } = {}
): Promise<{ highWater: number; usage: UsageRuntimeEvent[] }> {
  const maxRecordBytes = Math.max(
    1,
    Math.floor(options.maxRecordBytes ?? DEFAULT_EVENT_REPLAY_MAX_RECORD_BYTES)
  )
  let highWater = 0
  const usage: UsageRuntimeEvent[] = []
  let remainder = ''
  let lineNumber = 0

  const acceptEvent = (event: RuntimeEvent | null): void => {
    if (!event) return
    if (event.seq > highWater) highWater = event.seq
    if (event.kind === 'usage') usage.push(event)
  }

  try {
    const stream = createReadStream(path, {
      encoding: 'utf-8',
      // Keep raw chunks well below one record budget so a malformed line
      // without a newline cannot force a whole-log allocation.
      highWaterMark: Math.min(maxRecordBytes, 64 * 1024)
    })
    for await (const chunk of stream) {
      remainder += typeof chunk === 'string' ? chunk : chunk.toString('utf-8')
      let newline = remainder.indexOf('\n')
      while (newline >= 0) {
        const line = remainder.slice(0, newline)
        remainder = remainder.slice(newline + 1)
        lineNumber += 1
        acceptEvent(parseStrictEvent(path, line, lineNumber, maxRecordBytes))
        newline = remainder.indexOf('\n')
      }
      if (Buffer.byteLength(remainder, 'utf-8') > maxRecordBytes) {
        throw recordLimitError(path, maxRecordBytes)
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      return { highWater: 0, usage: [] }
    }
    throw error
  }

  if (remainder.trim()) {
    // Bytes after the final newline belong to an in-flight append. A valid
    // complete record still counts; a torn append is ignored.
    try {
      acceptEvent(parseStrictEvent(path, remainder, lineNumber + 1, maxRecordBytes))
    } catch {
      // ignore torn trailing record
    }
  }

  return { highWater, usage }
}
