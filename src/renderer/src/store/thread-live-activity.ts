/**
 * When this device last received a runtime event for each thread. A running
 * turn compares it with the clock to tell a long tool run from a stalled turn.
 * In memory only: after a reload the count restarts from the new subscription.
 */
const lastEventAt = new Map<string, number>()

export function noteThreadLiveActivity(threadId: string, now = Date.now()): void {
  lastEventAt.set(threadId, now)
}

export function threadLiveActivityAt(threadId: string): number | undefined {
  return lastEventAt.get(threadId)
}

export function resetThreadLiveActivityForTests(): void {
  lastEventAt.clear()
}
