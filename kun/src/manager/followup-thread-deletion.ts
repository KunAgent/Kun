import type { RoomStore } from '../rooms/room-store.js'
import { NativeFollowUpPermitError } from './native-followup-write-scope.js'
import type { ManagerFollowUpWriteArbitration } from './followup-arbitration.js'
import type { ThreadDeletionGuard } from './thread-admission-context.js'

/** Keep target deletion and ownership changes on the same physical serialization boundary. */
export function managerFollowUpThreadDeletionGuard(input: {
  rooms: RoomStore
  writes: ManagerFollowUpWriteArbitration
  assertCurrent?: () => void
}): ThreadDeletionGuard {
  return (threads, threadId, write) => input.writes.run(async () => {
    const owners = await input.rooms.collaborationQuery({ kind: 'owned_thread', threadId })
    const current = await (threads.getMetadata ? threads.getMetadata(threadId) : threads.get(threadId))
    const activeTurns = new Set(current?.turns.filter((turn) => turn.status === 'queued' || turn.status === 'running')
      .map((turn) => turn.id) ?? [])
    const unsettled = current?.nativeFollowUpRequests?.some((row) =>
      activeTurns.has(row.turnId) || row.phase !== 'known_not_admitted' && !row.terminalStatus) ?? false
    if (owners.length || unsettled) {
      throw new NativeFollowUpPermitError('owned or unsettled native target cannot be deleted')
    }
    input.assertCurrent?.()
    return write()
  })
}
