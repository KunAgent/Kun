import type { RuntimeEvent } from '../contracts/events.js'

export function encodeSseEvent(event: RuntimeEvent): string {
  return `id: ${event.seq}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`
}

export function encodeReplaySynchronized(input: {
  threadId: string
  cursor: number
}): string {
  return `event: replay_synchronized\ndata: ${JSON.stringify({
    kind: 'replay_synchronized',
    threadId: input.threadId,
    cursor: input.cursor
  })}\n\n`
}
