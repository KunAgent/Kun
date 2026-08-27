import type { ChatState } from './chat-store-types'

type SetState = (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void
type GetState = () => ChatState

/**
 * Registry helpers for threads whose live runtime is currently awaiting a
 * `user_input` answer. The sidebar uses this set to show an explicit
 * "awaiting your input" marker instead of a generic running spinner.
 */

export function markThreadAwaitingUserInput(
  set: SetState,
  get: GetState,
  threadId: string | null | undefined
): void {
  const id = threadId?.trim()
  if (!id) return
  set((state) => ({
    awaitingUserInputThreadIds: { ...state.awaitingUserInputThreadIds, [id]: true }
  }))
}

export function clearThreadAwaitingUserInput(
  set: SetState,
  get: GetState,
  threadId: string | null | undefined
): void {
  const id = threadId?.trim()
  if (!id || !get().awaitingUserInputThreadIds[id]) return
  set((state) => {
    const next = { ...state.awaitingUserInputThreadIds }
    delete next[id]
    return { awaitingUserInputThreadIds: next }
  })
}

/** Removes the awaiting marker from a state patch's thread id, if present. */
export function withoutAwaitingUserInput(
  awaiting: Record<string, true> | undefined,
  threadId: string
): Record<string, true> {
  if (!awaiting || !awaiting[threadId]) return awaiting ?? {}
  const next = { ...awaiting }
  delete next[threadId]
  return next
}
