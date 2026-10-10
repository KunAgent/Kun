/**
 * Composer guidance for an ACP engine whose concurrent `session/prompt` joins
 * the running loop (ProviderAcpHooks.liveSteering, e.g. OpenCode/CodeMaker).
 *
 * While the turn's main prompt runs, each guidance admitted by Kun is
 * persisted as a user item of the turn and sent as another `session/prompt`
 * on the same session; the engine records the message and answers it at its
 * next step, and that request resolves together with the main one. When the
 * main prompt settles, admission closes; guidance that won the race has no
 * loop left to join, so it goes out as an awaited follow-up prompt within the
 * same Kun turn. Results are handed back so their usage can be booked.
 */
import type { SteeringEntry } from '../../contracts/turns.js'
import type { DelegatedSteering } from '../../services/delegated-steering.js'

export type AcpLiveSteeringInput = {
  steering: DelegatedSteering
  /** Send guidance as one `session/prompt`; resolves with its raw result. */
  send(entries: SteeringEntry[]): Promise<unknown>
  /** A guidance prompt resolved. */
  onResult(raw: unknown): Promise<void> | void
  /** A guidance prompt failed; the main prompt keeps running. */
  onError(error: unknown): void
}

export class AcpLiveSteering {
  private readonly inflight = new Set<Promise<void>>()
  private pumping: Promise<void> = Promise.resolve()
  private open = true
  private readonly unsubscribe: () => void

  constructor(private readonly input: AcpLiveSteeringInput) {
    this.unsubscribe = input.steering.subscribe(() => this.schedule())
    // Guidance admitted between reopening and subscribing.
    this.schedule()
  }

  private schedule(): void {
    if (!this.open) return
    this.pumping = this.pumping
      .then(() => this.deliver())
      .catch((error) => this.input.onError(error))
  }

  private async deliver(): Promise<void> {
    if (!this.open) return
    const entries = await this.input.steering.take()
    if (!entries.length) return
    const request: Promise<void> = this.input.send(entries)
      .then((raw) => this.input.onResult(raw), (error) => this.input.onError(error))
      .finally(() => { this.inflight.delete(request) })
    this.inflight.add(request)
  }

  /**
   * The main prompt settled. Close admission, send guidance that arrived too
   * late to join as follow-up prompts, and wait for every guidance request.
   * With `followUp: false` (cancelled or failed turn) late guidance is still
   * persisted, never sent.
   */
  async finish(options: { followUp: boolean }): Promise<void> {
    this.open = false
    this.unsubscribe()
    await this.pumping
    while (!this.input.steering.sealIfEmpty()) {
      const entries = await this.input.steering.take()
      if (!entries.length || !options.followUp) continue
      await this.input.send(entries).then((raw) => this.input.onResult(raw))
    }
    await Promise.allSettled([...this.inflight])
  }
}
