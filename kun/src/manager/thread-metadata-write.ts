import { z } from 'zod'
import { stripThreadItemBodies } from '../adapters/hybrid/hybrid-thread-projection.js'
import { ThreadSchema, type ThreadRecord } from '../contracts/threads.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadStore, ThreadStoreConditionalWrite } from '../ports/thread-store.js'
import { projectSessionItemsOntoExistingTurns } from '../services/thread-item-projection.js'

const RequestSchema = z.object({
  thread: ThreadSchema,
  metadataOnly: z.literal(true).optional(),
  expectedRevision: z.number().int().nonnegative().optional()
}).strict()

/** History stays inside Manager; keep listing previews/counts accurate on metadata writes. */
export async function writeThreadMetadata(
  threadStore: ThreadStore,
  sessionStore: SessionStore,
  value: unknown,
  conditional: boolean,
  assertCurrent?: () => void
): Promise<ThreadRecord | ThreadStoreConditionalWrite> {
  const body = RequestSchema.parse(value)
  if (conditional && body.expectedRevision === undefined) throw new Error('expectedRevision is required')
  let thread = body.thread
  if (body.metadataOnly) {
    const items = await sessionStore.loadItems(thread.id)
    thread = projectSessionItemsOntoExistingTurns(stripThreadItemBodies(thread), items) ?? thread
  }
  assertCurrent?.()
  if (conditional) {
    const result = await threadStore.upsertIfRevision!(thread, body.expectedRevision!)
    return body.metadataOnly && result.thread
      ? { ...result, thread: stripThreadItemBodies(result.thread) }
      : result
  }
  const stored = await threadStore.upsert(thread)
  return body.metadataOnly ? stripThreadItemBodies(stored) : stored
}

/** Keep the ThreadStore return contract without another hydrated HTTP response. */
export function restoreThreadBodies(stored: ThreadRecord, source: ThreadRecord): ThreadRecord {
  const originals = new Map(source.turns.map((turn) => [turn.id, turn]))
  return {
    ...stored,
    turns: stored.turns.map((turn) => {
      const original = originals.get(turn.id)
      return original ? { ...turn, prompt: original.prompt, items: original.items } : turn
    })
  }
}
