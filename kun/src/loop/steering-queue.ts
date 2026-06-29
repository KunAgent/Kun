/**
 * Mid-turn steering queue. The renderer posts steering text while a
 * turn is running; the queue collects those messages and injects them
 * as user inputs at the next safe loop boundary. The queue is cleared
 * on turn completion or interruption.
 */
export type SteeringEntry = {
  text: string
  displayText?: string
  messageSource?: 'background_shell'
}

export class SteeringQueue {
  private readonly buffer: SteeringEntry[] = []
  private turnId: string | null = null

  setTurn(turnId: string | null): void {
    if (this.turnId !== turnId) {
      this.buffer.length = 0
    }
    this.turnId = turnId
  }

  enqueue(turnId: string, entry: SteeringEntry): void {
    if (this.turnId !== turnId) {
      this.buffer.length = 0
      this.turnId = turnId
    }
    const text = entry.text.trim()
    if (!text) return
    this.buffer.push({
      text,
      ...(entry.displayText?.trim() ? { displayText: entry.displayText.trim() } : {}),
      ...(entry.messageSource ? { messageSource: entry.messageSource } : {})
    })
  }

  /**
   * Drain queued steering messages and return them. The loop calls
   * this at safe boundaries (after a model response, before the next
   * model request). Returns an empty array when nothing is pending.
   */
  drain(): SteeringEntry[] {
    if (this.buffer.length === 0) return []
    const out = [...this.buffer]
    this.buffer.length = 0
    return out
  }

  /**
   * Peek at the queued text without removing it. Used by the UI to
   * show pending steering in a "pending injection" indicator.
   */
  peek(): SteeringEntry[] {
    return [...this.buffer]
  }

  clear(): void {
    this.buffer.length = 0
    this.turnId = null
  }
}
