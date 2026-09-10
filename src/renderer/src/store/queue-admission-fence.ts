import type { QueuedUserMessage } from './chat-store-types'

// Waiting edit/remove actions join the original admission; they never issue a
// second submission or declare cancellation before a server turn id exists.
const admissions = new Map<string, Promise<void>>()
export function beginQueueAdmission(id: string): () => void {
  let finish!: () => void
  const pending = new Promise<void>((resolve) => { finish = resolve })
  admissions.set(id, pending)
  return () => {
    if (admissions.get(id) === pending) admissions.delete(id)
    finish()
  }
}
export async function awaitQueueAdmission(message: QueuedUserMessage): Promise<void> {
  await admissions.get(message.id)
}
export function queueAdmissionPending(id: string): boolean { return admissions.has(id) }
