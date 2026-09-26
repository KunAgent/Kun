import type { ThreadStore } from '../ports/thread-store.js'

export type RoomContinuation = {
  threadId: string
  sourceTurnId: string
  key: string
  prompt: string
  kind: 'goal' | 'restart' | 'background_subagent' | 'background_shell'
}

type Dispatcher = (input: RoomContinuation) => Promise<'queued' | 'ignored'>
const dispatchers = new WeakMap<ThreadStore, Dispatcher>()

/** The room owner admits continuations before execution; no history scanning. */
export function bindRoomContinuationDispatcher(store: ThreadStore, dispatch: Dispatcher): () => void {
  dispatchers.set(store, dispatch)
  return () => { if (dispatchers.get(store) === dispatch) dispatchers.delete(store) }
}

export async function dispatchRoomContinuation(
  store: ThreadStore,
  input: RoomContinuation
): Promise<'not-room' | 'queued' | 'ignored'> {
  const thread = await (store.getMetadata?.(input.threadId) ?? store.get(input.threadId))
  if (!thread?.roomContext) return 'not-room'
  if (thread.roomContext.kind !== 'conversation') return 'ignored'
  const dispatch = dispatchers.get(store)
  // A missing owner must not fall back to an untracked generic turn.
  if (!dispatch) throw new Error('Room continuation owner is temporarily unavailable')
  return dispatch(input)
}
