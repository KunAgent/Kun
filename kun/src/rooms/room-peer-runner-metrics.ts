import { readRoomTurnUsage as readPeerTurnUsage } from './room-run-usage.js'
export { captureRoomTurnUsageBaseline as capturePeerUsageBaseline, readRoomTurnUsage as readPeerTurnUsage } from './room-run-usage.js'
import type { RoomMessage } from '../contracts/rooms.js'
import type { Turn } from '../contracts/turns.js'
import type { RoomRuntimeDeps } from './room-runtime-types.js'
import type { RoomStoredDocument } from './room-store.js'
import type { RoomPeerMemberState, RoomPeerTopic } from './room-peer-types.js'
import { recordPeerMetric } from './room-peer-runner-state.js'

export async function recordPeerResponseMetric(deps: RoomRuntimeDeps, topic: RoomPeerTopic,
  member: RoomStoredDocument<RoomPeerMemberState>, outcome: string, turn?: Turn,
  message?: RoomMessage): Promise<void> {
  const active = member.value.activation
  if (!active) return
  const source = message && outcome === 'published'
    ? await deps.store.get<RoomMessage>('message', topic.sourceMessageId) : null
  const duration = turn?.startedAt && turn.finishedAt ? Date.parse(turn.finishedAt) - Date.parse(turn.startedAt) : undefined
  const firstResponseMs = source && message ? Date.parse(message.createdAt) - Date.parse(source.value.createdAt) : undefined
  await recordPeerMetric(deps, { id: active.clientRequestId, roomId: topic.roomId,
    rootRequestId: topic.rootRequestId, memberId: member.value.memberId, generation: active.generation,
    threadId: active.threadId, turnId: active.turnId, phase: 'response', outcome, holds: active.holds,
    ...await readPeerTurnUsage(deps, active), elapsedMs: duration !== undefined && duration >= 0 ? duration : undefined,
    // Consumers take the minimum successful publication latency per generation.
    firstResponseMs: firstResponseMs !== undefined && firstResponseMs >= 0 ? firstResponseMs : undefined })
}
