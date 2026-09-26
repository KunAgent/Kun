/**
 * Registry of live remote-stream subscribers outside the chat store (rooms,
 * room-run viewers, ...). `remote:sender-reset` means every registration made
 * through the previous Remote sender is gone, so each subscriber must rebuild
 * its own stream. Thread streams are intentionally not listed: their recovery
 * path runs through the chat store (`recoverActiveTurn`).
 */
const resubscribers = new Set<() => void>()

export function registerRemoteStreamResubscriber(resubscribe: () => void): () => void {
  resubscribers.add(resubscribe)
  return () => {
    resubscribers.delete(resubscribe)
  }
}

export function resubscribeAllRemoteStreams(): void {
  for (const resubscribe of [...resubscribers]) {
    try {
      resubscribe()
    } catch {
      // One subscriber's failure must not stop the rest from recovering.
    }
  }
}
