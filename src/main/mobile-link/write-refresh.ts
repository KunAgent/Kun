import type { LiveKind } from './live-history'

/** Phone writes that add the sender's own message to a conversation the phone may be watching. */
const CONVERSATION_WRITES = new Set(['code.turn.start', 'agent.message.send', 'execution.queue.enqueue', 'execution.steer'])

export interface WrittenHistory { kind: LiveKind; id: string }

/**
 * The history an applied write changed, or nothing. Only an applied receipt counts: a rejected or still
 * uncertain write changed nothing the phone could see yet.
 */
export function writtenHistory(method: string, params: unknown, result: unknown): WrittenHistory | null {
  if (!CONVERSATION_WRITES.has(method) || !params || typeof params !== 'object') return null
  const receipt = (result as { receipt?: { status?: unknown } } | null)?.receipt
  if (receipt?.status !== 'applied') return null
  const p = params as Record<string, unknown>
  const id = method === 'agent.message.send' ? p.agentId : p.threadId
  if (typeof id !== 'string' || !id) return null
  return { kind: method === 'agent.message.send' ? 'agent' : 'code', id }
}

/**
 * After a phone's own write is applied, re-read the page that phone is watching now instead of waiting for
 * the runtime's next event. The live subscription keeps its read spacing and one read at a time, so a burst
 * of writes still costs at most one read per spacing.
 */
export function refreshAfterWrite(
  live: { touch(device: string, kind: LiveKind, id: string): boolean },
  device: string,
  method: string,
  params: unknown,
  result: unknown
): boolean {
  const written = writtenHistory(method, params, result)
  return written ? live.touch(device, written.kind, written.id) : false
}
