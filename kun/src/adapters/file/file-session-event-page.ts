import { open, stat } from 'node:fs/promises'
import type { RuntimeEvent } from '../../contracts/events.js'
import type { EventHistoryPage, EventHistoryPageOptions } from '../../ports/session-store.js'
import { parseReplayEventRecord } from './file-session-jsonl.js'
import type { JsonlFileAccessCoordinator } from './jsonl-file-access.js'

const READ_CHUNK_BYTES = 64 * 1024

type PageCursor = { dev: number; ino: number; offset: number }

export async function loadFileSessionEventPage(input: {
  path: string
  options: EventHistoryPageOptions
  defaultMaxRecordBytes: number
  fileAccess: JsonlFileAccessCoordinator
  resolveInitialOffset?: () => Promise<number>
}): Promise<EventHistoryPage> {
  return input.fileAccess.withRead(input.path, async () => {
    const info = await stat(input.path).catch(() => null)
    if (!info) return { events: [], hasMore: false, eventBytes: 0 }
    const maxEvents = normalizeLimit(input.options.maxEvents, 256)
    const maxBytes = normalizeLimit(input.options.maxBytes, 512 * 1024)
    const maxRecordBytes = normalizeLimit(
      input.options.maxRecordBytes,
      input.defaultMaxRecordBytes
    )
    const initialOffset = input.options.cursor ? 0 : await input.resolveInitialOffset?.() ?? 0
    const cursor = decodeCursor(input.options.cursor)
    const startOffset = cursor && cursor.dev === info.dev && cursor.ino === info.ino &&
      cursor.offset >= 0 && cursor.offset <= info.size
      ? cursor.offset
      : Math.max(0, Math.min(initialOffset, info.size))
    const handle = await open(input.path, 'r')
    try {
      return await readPage({
        handle,
        fileSize: info.size,
        dev: info.dev,
        ino: info.ino,
        startOffset,
        sinceSeq: input.options.sinceSeq,
        maxEvents,
        maxBytes,
        maxRecordBytes
      })
    } finally {
      await handle.close()
    }
  })
}

async function readPage(input: {
  handle: Awaited<ReturnType<typeof open>>
  fileSize: number
  dev: number
  ino: number
  startOffset: number
  sinceSeq: number
  maxEvents: number
  maxBytes: number
  maxRecordBytes: number
}): Promise<EventHistoryPage> {
  const events: RuntimeEvent[] = []
  let eventBytes = 0
  let position = input.startOffset
  let remainder = Buffer.alloc(0)
  let remainderOffset = position
  while (position < input.fileSize) {
    const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, input.fileSize - position))
    const { bytesRead } = await input.handle.read(chunk, 0, chunk.length, position)
    if (bytesRead === 0) break
    position += bytesRead
    remainder = remainder.length === 0
      ? chunk.subarray(0, bytesRead)
      : Buffer.concat([remainder, chunk.subarray(0, bytesRead)])
    let newline = remainder.indexOf(0x0a)
    while (newline >= 0) {
      const line = remainder.subarray(0, newline)
      const nextOffset = remainderOffset + newline + 1
      if (line.length > input.maxRecordBytes) {
        throw new Error(`event replay record exceeds ${input.maxRecordBytes} bytes`)
      }
      const event = parseReplayEventRecord(line.toString('utf8'), input.maxRecordBytes)
      if (event && event.seq > input.sinceSeq) {
        if (events.length > 0 && (
          events.length >= input.maxEvents || eventBytes + line.length > input.maxBytes
        )) {
          return page(events, eventBytes, input, remainderOffset, true)
        }
        events.push(event)
        eventBytes += line.length
        if (events.length >= input.maxEvents || eventBytes >= input.maxBytes) {
          return page(events, eventBytes, input, nextOffset, nextOffset < input.fileSize)
        }
      }
      remainder = remainder.subarray(newline + 1)
      remainderOffset = nextOffset
      newline = remainder.indexOf(0x0a)
    }
    if (remainder.length > input.maxRecordBytes) {
      throw new Error(`event replay record exceeds ${input.maxRecordBytes} bytes`)
    }
  }
  // Bytes after the final newline are an uncommitted crash tail.
  return page(events, eventBytes, input, position, false)
}

function page(
  events: RuntimeEvent[],
  eventBytes: number,
  input: { dev: number; ino: number },
  nextOffset: number,
  hasMore: boolean
): EventHistoryPage {
  return {
    events,
    eventBytes,
    hasMore,
    ...(hasMore ? { nextCursor: encodeCursor({ dev: input.dev, ino: input.ino, offset: nextOffset }) } : {})
  }
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.floor(value ?? fallback))
}

function encodeCursor(cursor: PageCursor): string {
  return `v1:${cursor.dev}:${cursor.ino}:${cursor.offset}`
}

function decodeCursor(value: string | undefined): PageCursor | null {
  const match = /^v1:(\d+):(\d+):(\d+)$/.exec(value ?? '')
  if (!match) return null
  const [, dev, ino, offset] = match
  const parsed = { dev: Number(dev), ino: Number(ino), offset: Number(offset) }
  return Object.values(parsed).every(Number.isSafeInteger) ? parsed : null
}
