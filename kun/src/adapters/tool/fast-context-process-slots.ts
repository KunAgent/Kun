import { FAST_CONTEXT_DEFAULT_PROCESS_SLOTS } from './builtin-tool-types.js'

/**
 * Process-wide ceiling for Fast Context rg/git helpers. The loop already
 * bounds one parent thread to four parallel source calls; this second lane
 * keeps several chats (or a room of agents) from multiplying that into dozens
 * of concurrent tree walks.
 */
type Waiter = {
  resolve: (release: () => void) => void
  reject: (error: Error) => void
  signal: AbortSignal
  onAbort: () => void
}

class ProcessSlots {
  private active = 0
  private readonly waiters: Waiter[] = []

  constructor(readonly capacity: number) {}

  acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(new Error('Fast Context source command aborted while queued'))
    if (this.active < this.capacity && this.waiters.length === 0) {
      this.active += 1
      return Promise.resolve(this.releaseOnce())
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        signal,
        onAbort: () => {
          const index = this.waiters.indexOf(waiter)
          if (index >= 0) this.waiters.splice(index, 1)
          reject(new Error('Fast Context source command aborted while queued'))
        }
      }
      signal.addEventListener('abort', waiter.onAbort, { once: true })
      this.waiters.push(waiter)
    })
  }

  snapshot(): { active: number; waiting: number; capacity: number } {
    return { active: this.active, waiting: this.waiters.length, capacity: this.capacity }
  }

  private releaseOnce(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      this.active = Math.max(0, this.active - 1)
      this.drain()
    }
  }

  private drain(): void {
    while (this.active < this.capacity) {
      const waiter = this.waiters.shift()
      if (!waiter) return
      waiter.signal.removeEventListener('abort', waiter.onAbort)
      if (waiter.signal.aborted) {
        waiter.reject(new Error('Fast Context source command aborted while queued'))
        continue
      }
      this.active += 1
      waiter.resolve(this.releaseOnce())
    }
  }
}

function configuredCapacity(): number {
  const raw = Number(process.env.KUN_FAST_CONTEXT_PROCESS_SLOTS)
  return Number.isInteger(raw) && raw >= 1 && raw <= 16 ? raw : FAST_CONTEXT_DEFAULT_PROCESS_SLOTS
}

let slots: ProcessSlots | undefined

function processSlots(): ProcessSlots {
  slots ??= new ProcessSlots(configuredCapacity())
  return slots
}

/** Runs one Fast Context helper process inside the shared process-wide lane. */
export async function withFastContextProcessSlot<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  const release = await processSlots().acquire(signal)
  try {
    return await work()
  } finally {
    release()
  }
}

/** Test-only observability for the shared helper lane. */
export function fastContextProcessSlotSnapshot(): { active: number; waiting: number; capacity: number } {
  return processSlots().snapshot()
}

/** Test-only reset so a changed environment capacity is picked up. */
export function resetFastContextProcessSlotsForTests(): void {
  slots = undefined
}
