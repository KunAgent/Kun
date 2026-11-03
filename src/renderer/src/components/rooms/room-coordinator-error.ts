const COORDINATOR_UNAVAILABLE = /room coordinator (lease|ownership)|Conversation service is starting or reconnecting/i

/** The runtime is still taking ownership of the conversation service; the same request succeeds shortly. */
export function isRoomCoordinatorUnavailable(message: string | undefined): boolean {
  return Boolean(message && COORDINATOR_UNAVAILABLE.test(message))
}
