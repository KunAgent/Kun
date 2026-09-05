import { RuntimeEvent, type RuntimeEvent as RuntimeEventValue } from '../contracts/events.js'

export type SseFrame = {
  id?: string
  event?: string
  data: string
}

export type ReplayResetRequired = {
  threadId: string
  floorSeq: number
}

export class IncrementalSseParser {
  private buffer = ''
  private readonly decoder = new TextDecoder()

  push(chunk: Uint8Array): SseFrame[] {
    this.buffer += this.decoder.decode(chunk, { stream: true }).replaceAll('\r\n', '\n').replaceAll('\r', '\n')
    return this.drain(false)
  }

  finish(): SseFrame[] {
    this.buffer += this.decoder.decode()
    return this.drain(true)
  }

  private drain(flush: boolean): SseFrame[] {
    const frames: SseFrame[] = []
    for (;;) {
      const boundary = this.buffer.indexOf('\n\n')
      if (boundary < 0) break
      const block = this.buffer.slice(0, boundary)
      this.buffer = this.buffer.slice(boundary + 2)
      const frame = parseSseBlock(block)
      if (frame) frames.push(frame)
    }
    if (flush && this.buffer.trim()) {
      const frame = parseSseBlock(this.buffer)
      this.buffer = ''
      if (frame) frames.push(frame)
    }
    return frames
  }
}

export function parseRuntimeEventFrame(frame: SseFrame): RuntimeEventValue | null {
  if (!frame.data.trim()) return null
  let json: unknown
  try {
    json = JSON.parse(frame.data)
  } catch {
    throw new Error('runtime event stream returned invalid JSON')
  }
  const parsed = RuntimeEvent.safeParse(json)
  if (!parsed.success) {
    if (frame.event === 'error') {
      const message = typeof json === 'object' && json && 'message' in json
        ? String((json as { message?: unknown }).message ?? 'runtime event stream error')
        : 'runtime event stream error'
      throw new Error(message)
    }
    // Forward compatibility: a newer server can add event variants. The TUI
    // keeps the connection alive and waits for events it understands.
    return null
  }
  return parsed.data
}

export function parseReplayResetRequiredFrame(frame: SseFrame): ReplayResetRequired | null {
  if (frame.event !== 'replay_reset_required') return null
  let value: unknown
  try {
    value = JSON.parse(frame.data)
  } catch {
    throw new Error('runtime replay reset returned invalid JSON')
  }
  if (!value || typeof value !== 'object') {
    throw new Error('runtime replay reset returned an invalid payload')
  }
  const reset = value as { threadId?: unknown; floorSeq?: unknown }
  if (
    typeof reset.threadId !== 'string' ||
    !reset.threadId ||
    typeof reset.floorSeq !== 'number' ||
    !Number.isSafeInteger(reset.floorSeq) ||
    reset.floorSeq < 0
  ) {
    throw new Error('runtime replay reset returned an invalid payload')
  }
  return { threadId: reset.threadId, floorSeq: reset.floorSeq }
}

function parseSseBlock(block: string): SseFrame | null {
  let id: string | undefined
  let event: string | undefined
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    let value = colon < 0 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'id' && !value.includes('\0')) id = value
    else if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  if (data.length === 0 && id === undefined && event === undefined) return null
  return { ...(id !== undefined ? { id } : {}), ...(event ? { event } : {}), data: data.join('\n') }
}
