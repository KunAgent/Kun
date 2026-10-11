import type { ProviderAdmission } from '../contracts/provider-configuration.js'

type Waiter = { caller: string; resolve(release: () => void): void; reject(error: Error): void;
  signal: AbortSignal; abort(): void; timer: ReturnType<typeof setTimeout> }
type Lane = { active: number; queued: number; lastCaller?: string; limits: ProviderAdmission;
  callers: string[]; queues: Map<string, Waiter[]> }

export class ProviderAdmissionError extends Error {
  constructor(readonly code: 'account_queue_full' | 'account_queue_timeout') {
    super(code === 'account_queue_full' ? 'Provider account queue is full' : 'Provider account queue wait expired')
  }
}

/** One Runtime owns these account lanes; individual protocol/client adapters do not. */
export class ProviderRequestScheduler {
  private readonly lanes = new Map<string, Lane>()

  acquire(accountId: string, caller: string, limits: ProviderAdmission, signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted()
    let lane = this.lanes.get(accountId)
    if (!lane) {
      lane = { active: 0, queued: 0, limits, callers: [], queues: new Map() }
      this.lanes.set(accountId, lane)
    }
    lane.limits = limits
    if (lane.queued) this.drain(accountId, lane)
    if (this.lanes.get(accountId) !== lane) this.lanes.set(accountId, lane)
    if (lane.active < limits.maxConcurrent && lane.queued === 0) return Promise.resolve(this.grant(accountId, lane, caller, signal))
    const callerQueued = lane.queues.get(caller)?.length ?? 0
    if (lane.queued >= limits.maxQueued || callerQueued >= Math.max(1, Math.ceil(limits.maxQueued / 2))) {
      return Promise.reject(new ProviderAdmissionError('account_queue_full'))
    }
    const current = lane
    return new Promise((resolve, reject) => {
      const remove = (error: Error) => {
        const queue = current.queues.get(caller)
        const index = queue?.indexOf(waiter) ?? -1
        if (index < 0) return
        queue!.splice(index, 1); current.queued--
        this.cleanupWaiter(waiter)
        if (!queue!.length) { current.queues.delete(caller); current.callers = current.callers.filter((id) => id !== caller) }
        reject(error); this.drain(accountId, current)
      }
      const waiter: Waiter = { caller, signal, resolve, reject,
        abort: () => remove(signal.reason instanceof Error ? signal.reason : new Error('Provider request cancelled')),
        timer: setTimeout(() => remove(new ProviderAdmissionError('account_queue_timeout')), limits.queueWaitMs) }
      waiter.timer.unref?.()
      if (!current.queues.has(caller)) { current.queues.set(caller, []); current.callers.push(caller) }
      current.queues.get(caller)!.push(waiter); current.queued++
      signal.addEventListener('abort', waiter.abort, { once: true })
      if (signal.aborted) waiter.abort()
      this.drain(accountId, current)
    })
  }

  status(): Array<{ accountId: string; active: number; queued: number }> {
    return [...this.lanes].map(([accountId, lane]) => ({ accountId, active: lane.active, queued: lane.queued }))
  }

  private grant(accountId: string, lane: Lane, caller: string, signal: AbortSignal): () => void {
    lane.active++; lane.lastCaller = caller
    let released = false
    const release = () => {
      if (released) return
      released = true; signal.removeEventListener('abort', release); lane.active--
      this.drain(accountId, lane)
    }
    signal.addEventListener('abort', release, { once: true })
    if (signal.aborted) release()
    return release
  }

  private drain(accountId: string, lane: Lane): void {
    while (lane.active < lane.limits.maxConcurrent && lane.callers.length) {
      if (lane.callers.length > 1 && lane.callers[0] === lane.lastCaller) lane.callers.push(lane.callers.shift()!)
      const caller = lane.callers.shift()!
      const queue = lane.queues.get(caller)!
      const waiter = queue.shift()!
      lane.queued--
      if (queue.length) lane.callers.push(caller); else lane.queues.delete(caller)
      this.cleanupWaiter(waiter)
      if (waiter.signal.aborted) { waiter.reject(new Error('Provider request cancelled')); continue }
      waiter.resolve(this.grant(accountId, lane, caller, waiter.signal))
    }
    if (lane.active === 0 && lane.queued === 0 && this.lanes.get(accountId) === lane) this.lanes.delete(accountId)
  }

  private cleanupWaiter(waiter: Waiter): void {
    clearTimeout(waiter.timer)
    waiter.signal.removeEventListener('abort', waiter.abort)
  }
}
