export type StreamTextReplayResult =
  | { kind: 'emit'; text: string }
  | { kind: 'suppress' }
  | { kind: 'conflict' }

/**
 * Reconciles final-text deltas when an interrupted model request is replayed.
 * Text already delivered by an earlier attempt is treated as the required
 * prefix: matching bytes are suppressed and only the unseen suffix is emitted.
 */
export class StreamTextReplayReconciler {
  private deliveredText = ''
  private replayPrefix = ''
  private attemptText = ''

  beginAttempt(): void {
    this.replayPrefix = this.deliveredText
    this.attemptText = ''
  }

  accept(delta: string): StreamTextReplayResult {
    const previousLength = this.attemptText.length
    this.attemptText += delta

    if (!this.replayPrefix) {
      this.deliveredText += delta
      return delta ? { kind: 'emit', text: delta } : { kind: 'suppress' }
    }
    if (this.replayPrefix.startsWith(this.attemptText)) {
      return { kind: 'suppress' }
    }
    if (!this.attemptText.startsWith(this.replayPrefix)) {
      return { kind: 'conflict' }
    }

    const unseen = this.attemptText.slice(Math.max(previousLength, this.replayPrefix.length))
    if (!unseen) return { kind: 'suppress' }
    this.deliveredText += unseen
    return { kind: 'emit', text: unseen }
  }

  /** A retry cannot commit another output kind until it has replayed the visible text. */
  get waitingForReplayPrefix(): boolean {
    return this.replayPrefix.length > 0 && this.attemptText.length < this.replayPrefix.length
  }

  get hasDeliveredText(): boolean {
    return this.deliveredText.length > 0
  }
}
