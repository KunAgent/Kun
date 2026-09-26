/**
 * R2.3 side-by-side scroll/zoom sync between the primary reader and the
 * translated mirror of the same file. Keyed by file path; each reader owns a
 * unique id and ignores its own messages. Applying an incoming scroll is
 * guarded by `isApplying` on the consumer side to prevent ping-pong loops.
 */

export type PaperReaderSyncMessage = {
  originId: number
  /** `scrollTop / (scrollHeight - clientHeight)` of the sending scroller. */
  scrollRatio?: number
  zoom?: number
  /** A freshly mounted mirror asks the primary to republish its state. */
  requestSync?: boolean
}

type Listener = (message: PaperReaderSyncMessage) => void

const channels = new Map<string, Set<Listener>>()
let nextReaderId = 1

export function claimPaperReaderSyncId(): number {
  return nextReaderId++
}

export function publishPaperReaderSync(filePath: string, message: PaperReaderSyncMessage): void {
  const listeners = channels.get(filePath)
  if (!listeners) return
  for (const listener of listeners) listener(message)
}

export function subscribePaperReaderSync(filePath: string, listener: Listener): () => void {
  let listeners = channels.get(filePath)
  if (!listeners) {
    listeners = new Set()
    channels.set(filePath, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) channels.delete(filePath)
  }
}
