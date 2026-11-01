import type { Room } from '../contracts/rooms.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { RoomStore } from './room-store.js'
import type { RoomRequestState } from './room-runtime-types.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'
import { lifecycleRow, privateRequestCanRun } from '../agents/agent-lifecycle-state.js'
import { roomRunId } from './room-run-recording.js'

type Binding = { store: RoomStore; exclusive<T>(operation: () => Promise<T>): Promise<T>; continuationAllowed?: (request: RoomRequestState) => Promise<boolean>; assistantQueuedAllowed?: (threadId: string, requestId: string) => Promise<boolean>; closed?: boolean }
const bindings = new WeakMap<ThreadStore, Binding>()
export const PRIVATE_QUEUE_LOCKED = Symbol('private-queue-lifecycle-locked')
export function bindPrivateTurnLifecycle(threads: ThreadStore, binding: Binding) {
  bindings.set(threads, binding)
  return () => { if (bindings.get(threads) === binding) binding.closed = true }
}
/** Same Agent mutex as restart; prepare and promotion cannot overtake one another across Runtimes. */
export async function withPrivateQueueAdmission<T>(threads: ThreadStore, threadId: string, operation: () => Promise<T>): Promise<T | null> {
  const binding = bindings.get(threads)
  if (!binding) return operation()
  const thread = await (threads.getMetadata?.(threadId) ?? threads.get(threadId))
  if (thread?.roomContext?.kind !== 'conversation') return operation()
  if (binding.closed) return null
  const room = await binding.store.get<Room>('room', thread.roomContext.roomId)
  const agentId = room?.value.members.find(member => member.id === room.value.defaultMemberId)?.participantAgentId
  if (!agentId) return operation()
  return withManagerDataMutex('agent-lifecycle:' + agentId, () => binding.exclusive(async () => binding.closed ? null : operation()))
}
export async function privateQueuedTurnAllowed(threads: ThreadStore, thread: ThreadRecord, turn: Turn): Promise<boolean> {
  const binding = bindings.get(threads)
  if (thread.roomContext?.kind !== 'conversation') {
    if (!turn.clientRequestId?.startsWith('kun-assistant-handoff-')) return true
    return Boolean(binding && !binding.closed && await binding.assistantQueuedAllowed?.(thread.id, turn.clientRequestId))
  }
  const personal = turn.clientRequestId?.startsWith('private-assistant-continuation-') === true
  if (!binding) return !personal
  if (binding.closed) return false
  const room = await binding.store.get<Room>('room', thread.roomContext.roomId)
  if (!room) return false
  const run = turn.clientRequestId ? await binding.store.get<RoomRunRecord>('room_run', roomRunId(room.id, turn.clientRequestId)) : null
  const request = run?.value.requestId ? await binding.store.get<RoomRequestState>('request', run.value.requestId) : null
  if (personal && !request) return false
  if (request?.value.privateContinuation?.kind === 'personal_assistant') {
    return Boolean(request.roomId === room.id && !request.value.cancellationRequested && run?.value.threadId === thread.id &&
      (!run.value.turnId || run.value.turnId === turn.id) && await binding.continuationAllowed?.(request.value))
  }
  const lifecycle = await lifecycleRow(binding.store, room.value)
  if (!lifecycle) return true // Existing users have no new fence or default-generation migration.
  if (lifecycle.value.state !== 'active' || !turn.clientRequestId) return false
  return Boolean(request && request.roomId === room.id && request.value.privateProtocol && !request.value.cancellationRequested &&
    run?.value.threadId === thread.id && (!run.value.turnId || run.value.turnId === turn.id) &&
    turn.clientRequestId === 'private-' + request.id + '-' + (request.value.stepAttempt ?? 0) &&
    await privateRequestCanRun(binding.store, request.value))
}
