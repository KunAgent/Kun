import type { ServerRuntime } from '../../../server/routes/server-runtime.js'
const runners = new WeakMap<ServerRuntime, HistoryRecovery>()
export function historyRecovery(runtime: ServerRuntime, resume: (key: string) => Promise<unknown>) {
  let runner = runners.get(runtime)
  if (!runner) { runner = new HistoryRecovery(runtime, resume); runners.set(runtime, runner) }
  return runner
}
/** Local startup reconciliation of already admitted WALs; never starts a turn or contacts cloud services. */
export class HistoryRecovery {
  private flights = new Map<string, Promise<unknown>>()
  private timer?: ReturnType<typeof setTimeout>
  private scan?: Promise<void>
  private closed = false
  constructor(private runtime: ServerRuntime, private resume: (key: string) => Promise<unknown>) {
    if (runtime.registerRemoteCleanup) {
      runtime.registerRemoteCleanup(() => this.close())
      this.schedule(0)
    }
  }
  run(key: string): Promise<unknown> {
    if (this.closed) return Promise.resolve(undefined)
    const old = this.flights.get(key)
    if (old) return old
    const work = Promise.resolve().then(() => this.closed ? undefined : this.resume(key)).catch(() => undefined)
    this.flights.set(key, work)
    void work.finally(() => { if (this.flights.get(key) === work) this.flights.delete(key) }).catch(() => {})
    return work
  }
  private schedule(attempt: number) {
    if (this.closed) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      const work = this.pass().then(incomplete => {
        if (!incomplete || this.closed) return
        if (attempt < 3) this.schedule(attempt + 1)
        else console.warn('[kun] REMOTE_HISTORY_RECOVERY_INCOMPLETE')
      }).catch(() => {
        if (!this.closed && attempt < 3) this.schedule(attempt + 1)
        else if (!this.closed) console.warn('[kun] REMOTE_HISTORY_RECOVERY_UNAVAILABLE')
      })
      this.scan = work
      void work.finally(() => { if (this.scan === work) this.scan = undefined }).catch(() => {})
    }, [0, 1000, 10000, 60000][attempt])
    this.timer.unref?.()
  }
  private async pass() {
    let beforeSeq: number | undefined, count = 0, incomplete = false
    while (!this.closed && count < 200) {
      const rows = await this.runtime.rooms!.deps.store.list<{ kind?: string }>('remote_history', { status: 'pending', beforeSeq, limit: 20 })
      for (const row of rows) {
        if (this.closed) return false
        if (row.value.kind === 'rewind_commit' && await this.run(row.id) === undefined) incomplete = true
        count++
      }
      if (rows.length < 20) return incomplete
      const next = rows.at(-1)!.seq
      if (beforeSeq !== undefined && next >= beforeSeq) throw Error('INVALID_RECOVERY_CURSOR')
      beforeSeq = next
    }
    return !this.closed
  }
  async close() {
    this.closed = true; clearTimeout(this.timer); this.timer = undefined
    await this.scan?.catch(() => {})
    await Promise.all([...this.flights.values()].map(work => work.catch(() => {})))
  }
}
