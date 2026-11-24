// Older relays and interrupted renewals need a lookup within the controller's 20s opening window.
export const PAIRING_FALLBACK_MS = 10_000
const jitter = (maximum: number) => maximum * (0.8 + Math.random() * 0.2)

/** One host and one consent switch. Only a real wakeup can queue a follow-up to an in-flight read. */
export class PairingWatch {
  private timer?: ReturnType<typeof setTimeout>
  private active = true
  private reading = false
  private notified = false
  private covered = false
  private failures = 0
  constructor(private readonly read: () => Promise<void>) {}

  stop() {
    this.active = false
    clearTimeout(this.timer)
  }
  setCovered(covered: boolean) {
    if (covered === this.covered) return
    this.covered = covered
    if (!this.reading && !this.failures) this.schedule()
  }
  reconnect() {
    this.covered = false
    this.failures = 0
    this.wake()
  }
  wake() {
    if (!this.active) return
    if (this.reading) { this.notified = true; return }
    if (this.failures && this.timer) return
    clearTimeout(this.timer)
    this.timer = undefined
    this.reading = true
    void this.run()
  }
  private async run() {
    try {
      await this.read()
      this.failures = 0
    } catch {
      this.failures = Math.min(4, this.failures + 1)
    } finally {
      this.reading = false
      const followUp = this.notified && !this.failures
      this.notified = false
      if (followUp) this.wake()
      else this.schedule()
    }
  }
  private schedule() {
    clearTimeout(this.timer)
    this.timer = undefined
    if (!this.active || (this.covered && !this.failures)) return
    const delay = Math.min(60_000, PAIRING_FALLBACK_MS * 2 ** this.failures)
    this.timer = setTimeout(() => { this.timer = undefined; this.wake() }, jitter(delay))
    this.timer.unref?.()
  }
}
