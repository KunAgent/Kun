import { createHash } from 'node:crypto'
import type { AssistantTaskView } from '../../shared/assistant-mailbox'
/** A read cursor, not an authorization or a replacement for the message's stable id. */
export function taskRevision(task: AssistantTaskView): string {
  return createHash('sha256').update(JSON.stringify([task.id, task.status, task.updatedAt, task.updates.length,
    task.delivery, task.cancellationId, task.cancellationError])).digest('hex')
}
