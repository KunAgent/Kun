import { open, stat } from 'node:fs/promises'
import { parseReplayEventRecord } from './file-session-jsonl.js'

const READ_CHUNK_BYTES = 64 * 1024

/** Find a valid event near the retained byte tail without loading history. */
export async function eventReplayFloorForRetainedTail(input: {
  path: string
  retainBytes: number
  maxRecordBytes: number
}): Promise<number> {
  const info = await stat(input.path).catch(() => null)
  if (!info || info.size <= input.retainBytes) return 0
  const handle = await open(input.path, 'r')
  try {
    let position = Math.max(0, info.size - input.retainBytes)
    let remainder = Buffer.alloc(0)
    let discardPartial = position > 0
    while (position < info.size) {
      const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, info.size - position))
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position)
      if (bytesRead === 0) break
      position += bytesRead
      remainder = remainder.length === 0
        ? chunk.subarray(0, bytesRead)
        : Buffer.concat([remainder, chunk.subarray(0, bytesRead)])
      let newline = remainder.indexOf(0x0a)
      while (newline >= 0) {
        const line = remainder.subarray(0, newline)
        remainder = remainder.subarray(newline + 1)
        if (discardPartial) {
          discardPartial = false
        } else {
          if (line.length > input.maxRecordBytes) {
            throw new Error(`event replay record exceeds ${input.maxRecordBytes} bytes`)
          }
          const event = parseReplayEventRecord(line.toString('utf8'), input.maxRecordBytes)
          if (event) return event.seq
        }
        newline = remainder.indexOf(0x0a)
      }
      if (remainder.length > input.maxRecordBytes) {
        throw new Error(`event replay record exceeds ${input.maxRecordBytes} bytes`)
      }
    }
    return 0
  } finally {
    await handle.close()
  }
}

export class FileSessionEventRetention {
  private readonly maxBytes: number
  private readonly retainBytes: number

  constructor(private readonly options: {
    maxBytes: number
    retainBytes: number
    maxRecordBytes: number
    pathFor: (threadId: string) => string
    trim: (threadId: string, floor: number) => Promise<unknown>
  }) {
    this.maxBytes = Math.max(1, Math.floor(options.maxBytes))
    this.retainBytes = Math.min(this.maxBytes, Math.max(1, Math.floor(options.retainBytes)))
  }

  shouldSchedule(size: number): boolean {
    return size > this.maxBytes
  }

  async compact(threadId: string): Promise<void> {
    const path = this.options.pathFor(threadId)
    const info = await stat(path).catch(() => null)
    if (!info || !this.shouldSchedule(info.size)) return
    const floor = await eventReplayFloorForRetainedTail({
      path,
      retainBytes: this.retainBytes,
      maxRecordBytes: this.options.maxRecordBytes
    })
    if (floor > 0) await this.options.trim(threadId, floor)
  }
}
