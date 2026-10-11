import type { RoomMessage } from '@shared/rooms-api'

const GROUP_WINDOW_MS = 5 * 60 * 1000

/** Keep grouping presentational: message order and persisted records never change. */
export function roomMessageLayout(previous: RoomMessage | undefined, current: RoomMessage) {
  const currentTime = Date.parse(current.createdAt)
  const previousTime = previous ? Date.parse(previous.createdAt) : NaN
  const newDay = !previous || !Number.isFinite(currentTime) || !Number.isFinite(previousTime) ||
    new Date(currentTime).toDateString() !== new Date(previousTime).toDateString()
  const continuation = Boolean(previous && !newDay && current.authorKind !== 'system' &&
    previous.authorKind === current.authorKind &&
    previous.authorMemberId === current.authorMemberId &&
    previous.authorAgentId === current.authorAgentId &&
    !previous.presentationKind && !current.presentationKind &&
    currentTime >= previousTime && currentTime - previousTime <= GROUP_WINDOW_MS)
  return { newDay, continuation }
}
