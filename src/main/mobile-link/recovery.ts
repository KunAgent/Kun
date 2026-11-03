type PowerPhase = 'suspend' | 'resume'
export class MobileLinkRecovery {
  private timer: ReturnType<typeof setInterval>
  private removePower: () => void
  private stopped = false
  private suspended = false
  private lastTick: number
  private wasOnline: boolean
  private network: string
  constructor(private deps: {
    online(): boolean
    network(): string
    suspend(): void
    reconnect(reason: string): void
    power(listener: (phase: PowerPhase) => void): () => void
    now?: () => number
  }) {
    this.lastTick = this.now()
    this.wasOnline = deps.online()
    this.network = deps.network()
    this.removePower = deps.power((phase) => {
      if (this.stopped) return
      if (phase === 'suspend') {
        this.suspended = true
        deps.suspend()
      }
      else {
        this.suspended = false
        this.lastTick = this.now()
        this.wasOnline = deps.online()
        this.network = deps.network()
        deps.reconnect('HOST_RESUMED')
      }
    })
    this.timer = setInterval(() => this.poll(), 5000)
    this.timer.unref?.()
  }
  private now() { return this.deps.now?.() ?? Date.now() }
  private poll() {
    if (this.stopped) return
    const now = this.now(), online = this.deps.online(), network = this.deps.network()
    const gap = Math.abs(now - this.lastTick) > 30000
    const reason = gap ? 'HOST_CLOCK_GAP'
      : online && !this.wasOnline ? 'NETWORK_ONLINE'
        : network !== this.network ? 'NETWORK_CHANGED' : undefined
    this.lastTick = now
    this.wasOnline = online
    this.network = network
    if (this.suspended && !gap) return
    if (gap) this.suspended = false
    // OS "online" is only a hint, not proof of Internet connectivity. A false
    // signal must not tear down a healthy socket through a proxy or VPN.
    if (reason) this.deps.reconnect(reason)
  }
  dispose() {
    if (this.stopped) return
    this.stopped = true
    clearInterval(this.timer)
    this.removePower()
  }
}
