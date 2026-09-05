import { ScopedSlotScheduler, SlotScheduler, type SlotLease } from './delegation-slot-waiter.js'

export type { SlotLease }

/** Enforces both lane fairness and one process-wide child ceiling. */
export class ChildAdmissionScheduler {
  private readonly global: SlotScheduler
  private readonly ordinary: SlotScheduler
  private readonly fastContext: ScopedSlotScheduler

  constructor(private readonly capacity: () => number) {
    this.global = new SlotScheduler(capacity)
    this.ordinary = new SlotScheduler(capacity)
    this.fastContext = new ScopedSlotScheduler(() => capacity() > 0 ? 1 : 0)
  }

  get activeCount(): number {
    return this.global.activeCount
  }

  refresh(): void {
    this.global.refresh()
    this.ordinary.refresh()
    this.fastContext.refresh()
  }

  async acquire(input: {
    fastContext: boolean
    parentThreadId: string
    signal: AbortSignal
    queueTimeoutMs?: number
    /** Nested Fast Context borrows the already-admitted parent child slot. */
    borrowGlobal?: boolean
  }): Promise<SlotLease> {
    const queuedAt = Date.now()
    const lane = input.fastContext
      ? await this.fastContext.acquire(
          input.parentThreadId, input.signal, input.queueTimeoutMs
        )
      : await this.ordinary.acquire(input.signal, input.queueTimeoutMs)
    try {
      if (input.borrowGlobal) return lane
      const remaining = input.queueTimeoutMs === undefined
        ? undefined
        : Math.max(0, input.queueTimeoutMs - (Date.now() - queuedAt))
      const global = await this.global.acquire(input.signal, remaining)
      let released = false
      return () => {
        if (released) return
        released = true
        global()
        lane()
      }
    } catch (error) {
      lane()
      throw error
    }
  }
}
