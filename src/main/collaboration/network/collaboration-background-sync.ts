import type {
  CollaborationNetworkCommand,
  CollaborationNetworkStatus
} from '../../../shared/collaboration/contracts'

type Timer = ReturnType<typeof setInterval> & { unref?: () => void }

export class CollaborationBackgroundSync {
  private timer: Timer | null = null
  private inFlight = false
  private nextAttemptAt = 0
  private retryMs: number

  constructor(private readonly options: {
    status: () => Promise<CollaborationNetworkStatus>
    dispatch: (command: CollaborationNetworkCommand) => Promise<unknown>
    afterSync?: (meetingId: string) => Promise<void>
    now?: () => number
    intervalMs?: number
    baseRetryMs?: number
    maxRetryMs?: number
  }) {
    this.retryMs = options.baseRetryMs ?? 5_000
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => { void this.runOnce() }, this.options.intervalMs ?? 5_000) as Timer
    this.timer.unref?.()
    void this.runOnce()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async runOnce(): Promise<void> {
    const now = (this.options.now ?? Date.now)()
    if (this.inFlight || now < this.nextAttemptAt) return
    this.inFlight = true
    try {
      const status = await this.options.status()
      if (
        status.e2eeState !== 'ready' || !status.activeMeetingId ||
        status.state === 'SECURITY_SYNC_REQUIRED' || status.state === 'connecting'
      ) return
      await this.options.dispatch({ kind: 'network_sync', meetingId: status.activeMeetingId })
      await this.options.afterSync?.(status.activeMeetingId)
      this.retryMs = this.options.baseRetryMs ?? 5_000
      this.nextAttemptAt = 0
    } catch {
      this.nextAttemptAt = now + this.retryMs
      this.retryMs = Math.min(this.retryMs * 2, this.options.maxRetryMs ?? 60_000)
    } finally {
      this.inFlight = false
    }
  }
}
