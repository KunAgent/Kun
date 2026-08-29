export type SlotLease = () => void

type SlotWaiter = {
  resolve: (lease: SlotLease) => void
  reject: (error: unknown) => void
  signal: AbortSignal
  onAbort: () => void
  timer?: ReturnType<typeof setTimeout>
  settled: boolean
}

export class ChildQueueTimeoutError extends Error {
  readonly code = 'child_queue_timeout'

  constructor(readonly timeoutMs: number) {
    super(`Child run could not start within ${timeoutMs}ms because all execution slots remained occupied.`)
    this.name = 'ChildQueueTimeoutError'
  }
}

/** FIFO scheduler whose capacity may change while work is queued. */
export class SlotScheduler {
  private active = 0
  private readonly waiters: SlotWaiter[] = []

  constructor(
    private readonly capacity: () => number,
    private readonly onIdle?: () => void
  ) {}

  get activeCount(): number {
    return this.active
  }

  get waitingCount(): number {
    return this.waiters.length
  }

  acquire(signal: AbortSignal, queueTimeoutMs?: number): Promise<SlotLease> {
    if (signal.aborted) {
      this.notifyIdle()
      return Promise.reject(new Error('aborted while queued'))
    }
    if (this.waiters.length === 0 && this.active < this.limit()) {
      this.active += 1
      return Promise.resolve(this.releaseOnce())
    }
    return new Promise<SlotLease>((resolve, reject) => {
      const rejectOnce = (waiter: SlotWaiter, error: Error): void => {
        if (waiter.settled) return
        waiter.settled = true
        this.remove(waiter)
        reject(error)
        this.drain()
        this.notifyIdle()
      }
      const waiter: SlotWaiter = {
        resolve,
        reject,
        signal,
        settled: false,
        onAbort: () => rejectOnce(waiter, new Error('aborted while queued'))
      }
      signal.addEventListener('abort', waiter.onAbort, { once: true })
      if (queueTimeoutMs !== undefined && Number.isFinite(queueTimeoutMs) && queueTimeoutMs >= 0) {
        waiter.timer = setTimeout(
          () => rejectOnce(waiter, new ChildQueueTimeoutError(queueTimeoutMs)),
          queueTimeoutMs
        )
      }
      this.waiters.push(waiter)
      this.drain()
    })
  }

  /** Re-evaluate queued work after a dynamic capacity change. */
  refresh(): void {
    this.drain()
  }

  private limit(): number {
    return Math.max(0, Math.floor(this.capacity()))
  }

  private drain(): void {
    while (this.active < this.limit()) {
      const waiter = this.waiters.shift()
      if (!waiter) return
      this.cleanup(waiter)
      if (waiter.settled) continue
      waiter.settled = true
      if (waiter.signal.aborted) {
        waiter.reject(new Error('aborted while queued'))
        continue
      }
      this.active += 1
      waiter.resolve(this.releaseOnce())
    }
    this.notifyIdle()
  }

  private releaseOnce(): SlotLease {
    let released = false
    return () => {
      if (released) return
      released = true
      this.active = Math.max(0, this.active - 1)
      this.drain()
      this.notifyIdle()
    }
  }

  private remove(waiter: SlotWaiter): void {
    const index = this.waiters.indexOf(waiter)
    if (index >= 0) this.waiters.splice(index, 1)
    this.cleanup(waiter)
  }

  private cleanup(waiter: SlotWaiter): void {
    waiter.signal.removeEventListener('abort', waiter.onAbort)
    if (waiter.timer) clearTimeout(waiter.timer)
  }

  private notifyIdle(): void {
    if (this.active === 0 && this.waiters.length === 0) this.onIdle?.()
  }
}

/** Independent FIFO lanes keyed by the parent chat thread. */
export class ScopedSlotScheduler {
  private readonly lanes = new Map<string, SlotScheduler>()

  constructor(private readonly capacity: () => number) {}

  get activeCount(): number {
    let total = 0
    for (const lane of this.lanes.values()) total += lane.activeCount
    return total
  }

  get scopeCount(): number {
    return this.lanes.size
  }

  refresh(): void {
    for (const lane of this.lanes.values()) lane.refresh()
  }

  acquire(scopeId: string, signal: AbortSignal, queueTimeoutMs?: number): Promise<SlotLease> {
    let lane = this.lanes.get(scopeId)
    if (!lane) {
      lane = new SlotScheduler(
        this.capacity,
        () => {
          if (this.lanes.get(scopeId) === lane && lane!.activeCount === 0 && lane!.waitingCount === 0) {
            this.lanes.delete(scopeId)
          }
        }
      )
      this.lanes.set(scopeId, lane)
    }
    return lane.acquire(signal, queueTimeoutMs)
  }
}
