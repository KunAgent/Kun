/**
 * Composer guidance for an ACP turn. ACP has no steer method, so guidance is
 * delivered one of two ways:
 *
 * - live (ProviderAcpHooks.liveSteering, e.g. OpenCode/CodeMaker): a
 *   concurrent `session/prompt` joins the running loop; the engine answers it
 *   at its next step and that request resolves together with the main one.
 * - deferred (every other engine, e.g. Devin): the engine would queue a
 *   concurrent prompt as its own next run and answer the request early with
 *   the current run's result, so guidance waits instead. When the main prompt
 *   settles it goes out as an awaited follow-up prompt on the same session,
 *   within the same Kun turn.
 *
 * Admission reopens as soon as the turn is handed to the runtime, before the
 * Agent has started, and each guidance Kun admits is persisted as a user item
 * of the turn right away. Live guidance that arrives too late to join the run
 * becomes a follow-up as well. Results are handed back so their usage can be
 * booked.
 */
import type { SteeringEntry } from '../../contracts/turns.js'
import type { DelegatedSteering } from '../../services/delegated-steering.js'

export type AcpGuidanceMode = 'live' | 'deferred'

export type AcpGuidanceDelivery = {
  /** Send guidance as one `session/prompt`; resolves with its raw result. */
  send(entries: SteeringEntry[]): Promise<unknown>
  /** A guidance prompt resolved. */
  onResult(raw: unknown): Promise<void> | void
  /** A live guidance prompt failed; the main prompt keeps running. */
  onError(error: unknown): void
  /** The previous prompt settled and a follow-up is about to go out. */
  beforeFollowUp?(): Promise<void> | void
  /** False once the turn was stopped: remaining guidance is kept, not sent. */
  canFollowUp?(): boolean
}

export type AcpLiveSteeringInput = {
  steering: DelegatedSteering
  mode: AcpGuidanceMode
  debug?: (summary: string) => void
}

export class AcpLiveSteering {
  readonly mode: AcpGuidanceMode
  private readonly inflight = new Set<Promise<void>>()
  private readonly deferred: SteeringEntry[] = []
  private pumping: Promise<void> = Promise.resolve()
  private delivery: AcpGuidanceDelivery | undefined
  private state: 'waiting' | 'running' | 'closed' = 'waiting'
  private finishing: Promise<void> | undefined
  private readonly unsubscribe: () => void

  constructor(private readonly input: AcpLiveSteeringInput) {
    this.mode = input.mode
    this.unsubscribe = input.steering.subscribe(() => this.schedule())
    // Guidance admitted before the subscription existed.
    this.schedule()
  }

  /** The main prompt is going out: live guidance may join it from now on. */
  start(delivery: AcpGuidanceDelivery): void {
    if (this.state !== 'waiting') return
    this.delivery = delivery
    this.state = 'running'
    this.schedule()
  }

  private schedule(): void {
    if (this.state === 'closed') return
    // Live guidance stays pending until there is a run to join.
    if (this.mode === 'live' && this.state === 'waiting') return
    this.pumping = this.pumping
      .then(() => this.deliver())
      .catch((error) => this.reportError(error))
  }

  private async deliver(): Promise<void> {
    if (this.state === 'closed') return
    const entries = await this.input.steering.take()
    if (!entries.length) return
    const delivery = this.delivery
    if (this.mode === 'deferred' || !delivery) {
      this.deferred.push(...entries)
      return
    }
    const request: Promise<void> = delivery.send(entries)
      .then((raw) => delivery.onResult(raw), (error) => delivery.onError(error))
      .finally(() => { this.inflight.delete(request) })
    this.inflight.add(request)
  }

  private reportError(error: unknown): void {
    if (this.delivery) this.delivery.onError(error)
    else this.input.debug?.(`guidance admission failed: ${String(error).slice(0, 300)}`)
  }

  /**
   * The main prompt settled (or the turn is being torn down). Close admission
   * once nothing is pending: guidance still waiting goes out as awaited
   * follow-up prompts, one per batch, while admission stays open for more.
   * With `followUp: false` (stopped, failed or never started) it is kept as
   * user items of the turn but never sent. Idempotent: later calls share the
   * first call's outcome.
   */
  finish(options: { followUp: boolean }): Promise<void> {
    this.finishing ??= this.finishOnce(options.followUp)
    return this.finishing
  }

  private async finishOnce(followUp: boolean): Promise<void> {
    this.state = 'closed'
    this.unsubscribe()
    await this.pumping
    await Promise.allSettled([...this.inflight])
    let sending = followUp
    let failure: { error: unknown } | undefined
    let pending = this.deferred.splice(0)
    for (;;) {
      if (!pending.length) {
        if (this.input.steering.sealIfEmpty()) break
        pending = await this.input.steering.take()
        continue
      }
      const delivery = this.delivery
      if (sending && delivery && delivery.canFollowUp?.() !== false) {
        try {
          await delivery.beforeFollowUp?.()
          await delivery.onResult(await delivery.send(pending))
        } catch (error) {
          // Seal before failing the turn; later guidance is kept, not sent.
          failure = { error }
          sending = false
        }
      }
      pending = []
    }
    if (failure) throw failure.error
  }
}
