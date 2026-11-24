import type { MobileLinkStatus } from '../../shared/mobile-link'

/** Passive UI refreshes can display a recent listing. Authorization and manual actions always load fresh data. */
export class HostDirectory {
  private pending?: { generation: number; version: number; task: Promise<MobileLinkStatus> }
  private cached?: { generation: number; version: number; at: number; failures: number; value: MobileLinkStatus }

  invalidate() {
    this.pending = undefined
    this.cached = undefined
  }

  read(generation: number, version: number, maxAge: number, load: () => Promise<MobileLinkStatus>,
    present: (cached: MobileLinkStatus) => MobileLinkStatus) {
    if (this.pending?.generation === generation && this.pending.version === version) return this.pending.task
    const previous = this.cached?.generation === generation && this.cached.version === version ? this.cached : undefined
    if (previous && maxAge > 0) {
      const ttl = previous.failures ? Math.min(60_000, 5000 * 2 ** previous.failures) : maxAge
      if (performance.now() - previous.at < ttl) return Promise.resolve(present(previous.value))
    }
    const task = load()
    this.pending = { generation, version, task }
    void task.then(value => {
      if (this.pending?.task !== task) return
      this.pending = undefined
      const failures = value.error ? Math.min(4, (previous?.failures ?? 0) + 1) : 0
      this.cached = { generation, version, at: performance.now(), failures, value }
    }, () => { if (this.pending?.task === task) this.invalidate() })
    return task
  }
}
