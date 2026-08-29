import type { ToolHostContext } from '../ports/tool-host.js'

export const FAST_CONTEXT_SOURCE_TOOL_CAPACITY = 4
const FAST_CONTEXT_SOURCE_TOOL_NAMES = new Set(['grep', 'glob', 'read'])

type Waiter = {
  resolve: (release: () => void) => void
  reject: (error: Error) => void
  signal: AbortSignal
  onAbort: () => void
}

/** One parent-session source-tool budget. */
export class FastContextSourceSemaphore {
  private active = 0
  private readonly waiters: Waiter[] = []

  constructor(
    private readonly capacity = FAST_CONTEXT_SOURCE_TOOL_CAPACITY,
    private readonly onIdle?: () => void
  ) {}

  acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) {
      this.notifyIdle()
      return Promise.reject(new Error('Fast Context source tool aborted while queued'))
    }
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
          signal.removeEventListener('abort', waiter.onAbort)
          reject(new Error('Fast Context source tool aborted while queued'))
          this.notifyIdle()
        }
      }
      signal.addEventListener('abort', waiter.onAbort, { once: true })
      this.waiters.push(waiter)
      this.drain()
    })
  }

  async run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    const release = await this.acquire(signal)
    try {
      return await work()
    } finally {
      release()
    }
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
      this.notifyIdle()
    }
  }

  private drain(): void {
    while (this.active < this.capacity) {
      const waiter = this.waiters.shift()
      if (!waiter) return
      waiter.signal.removeEventListener('abort', waiter.onAbort)
      if (waiter.signal.aborted) {
        waiter.reject(new Error('Fast Context source tool aborted while queued'))
        continue
      }
      this.active += 1
      waiter.resolve(this.releaseOnce())
    }
    this.notifyIdle()
  }

  private notifyIdle(): void {
    if (this.active === 0 && this.waiters.length === 0) this.onIdle?.()
  }
}

const scopedSemaphores = new Map<string, FastContextSourceSemaphore>()

export function withFastContextSourceToolSlot<T>(input: {
  context: ToolHostContext
  toolName: string
  work: () => Promise<T>
}): Promise<T> {
  if (input.context.fastContext !== true || !FAST_CONTEXT_SOURCE_TOOL_NAMES.has(input.toolName)) {
    return input.work()
  }
  const scopeId = input.context.fastContextScopeId?.trim() || input.context.threadId
  let semaphore = scopedSemaphores.get(scopeId)
  if (!semaphore) {
    semaphore = new FastContextSourceSemaphore(FAST_CONTEXT_SOURCE_TOOL_CAPACITY, () => {
      if (scopedSemaphores.get(scopeId) === semaphore) scopedSemaphores.delete(scopeId)
    })
    scopedSemaphores.set(scopeId, semaphore)
  }
  return semaphore.run(input.context.abortSignal, input.work)
}

/** Test-only observability for one parent-session lane. */
export function fastContextSourceToolSemaphoreSnapshot(
  scopeId: string
): { active: number; waiting: number; capacity: number; exists: boolean } {
  const semaphore = scopedSemaphores.get(scopeId)
  return semaphore
    ? { ...semaphore.snapshot(), exists: true }
    : {
        active: 0,
        waiting: 0,
        capacity: FAST_CONTEXT_SOURCE_TOOL_CAPACITY,
        exists: false
      }
}
