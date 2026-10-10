/**
 * Composer guidance for a session transport whose engine takes user input
 * while a run is in flight (`HarnessSession.steer`: Codex `turn/steer`, Pi
 * `steer`). The agent loop seals steering before it hands a delegated turn
 * over; `begin` reopens admission through `DelegatedSteering`, then each
 * guidance Kun admits is persisted as a user item of the turn and sent into
 * the running engine.
 *
 * A guidance the engine refuses — the run ended between admission and
 * delivery — is returned by `end` together with whatever was admitted after
 * the last delivery, so the runtime can run it as a follow-up inside the same
 * Kun turn instead of losing it.
 */
import type { SteeringEntry } from '../contracts/turns.js'
import type { DelegatedSteering } from '../services/delegated-steering.js'

export type SessionLiveSteeringInput = {
  steering: DelegatedSteering
  /** Deliver one guidance into the running engine; rejects when no run is in flight. */
  steer(text: string): Promise<void>
  diagnostic(summary: string): void
}

export class SessionLiveSteering {
  private unsubscribe: (() => void) | undefined
  private pumping: Promise<void> = Promise.resolve()
  private stranded: SteeringEntry[] = []
  private open = false

  constructor(private readonly input: SessionLiveSteeringInput) {}

  /** A run is about to start: deliver guidance admitted from now on. */
  begin(): void {
    this.open = true
    this.unsubscribe?.()
    this.unsubscribe = this.input.steering.subscribe(() => this.schedule())
    // Guidance admitted before the subscription existed.
    this.schedule()
  }

  /** The run ended (or the turn is being torn down): stop delivering. */
  dispose(): void {
    this.open = false
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }

  /**
   * The run ended. Stop delivering, wait for deliveries in flight and return
   * the guidance the engine never received, oldest first. It is already
   * persisted as user items of the turn.
   */
  async end(): Promise<SteeringEntry[]> {
    this.dispose()
    await this.pumping
    const rest = await this.input.steering.take()
    const late = [...this.stranded, ...rest]
    this.stranded = []
    return late
  }

  /** Close admission when nothing is pending; false means `end` again. */
  sealIfEmpty(): boolean {
    return this.input.steering.sealIfEmpty()
  }

  private schedule(): void {
    if (!this.open) return
    this.pumping = this.pumping
      .then(() => this.deliver())
      .catch((error) => this.input.diagnostic(`guidance delivery failed: ${String(error).slice(0, 300)}`))
  }

  private async deliver(): Promise<void> {
    if (!this.open) return
    const entries = await this.input.steering.take()
    for (const entry of entries) {
      try {
        await this.input.steer(entry.text)
      } catch (error) {
        this.stranded.push(entry)
        this.input.diagnostic(`guidance not delivered, running it as a follow-up: ${String(error).slice(0, 200)}`)
      }
    }
  }
}

/** The prompt for a follow-up run that answers guidance the engine never received. */
export function followUpTurnInput<T extends {
  instructionBlocks: readonly string[]
  userText: string
  images: readonly unknown[]
  attachmentPaths: readonly string[]
  fileReferences: readonly unknown[]
  handoffBrief?: string
  historyTranscript?: string
}>(input: T, entries: readonly SteeringEntry[]): T {
  const { handoffBrief: _handoff, historyTranscript: _history, ...rest } = input
  return {
    ...rest,
    // The native session already holds the instructions, brief and history.
    instructionBlocks: [],
    userText: entries.map((entry) => entry.text).join('\n\n'),
    images: [],
    attachmentPaths: [],
    fileReferences: []
  } as unknown as T
}
