/** Only emitted before the durable file-start boundary, so retry is provably safe. */
export class SharedFileNotStarted extends Error {
  constructor() { super('BACKPRESSURE'); this.name = 'SharedFileNotStarted' }
}

/** Keep real native work charged after the outward operation has timed out. */
export class SharedFileWorkPool {
  private active = new Set<SharedFileWork>()
  acquire(): SharedFileWork {
    if (this.active.size >= 2) throw new SharedFileNotStarted()
    const work = new SharedFileWork(() => this.active.delete(work))
    this.active.add(work)
    return work
  }
}

export class SharedFileWork {
  private pending = new Set<Promise<unknown>>()
  private finished = false
  constructor(private release: () => void) {}
  private observe<T>(start: () => Promise<T>): Promise<T> {
    const operation = Promise.resolve().then(start)
    this.pending.add(operation)
    void operation.finally(() => {
      this.pending.delete(operation)
      if (this.finished && this.pending.size === 0) this.release()
    }).catch(() => {})
    return operation
  }
  async run<T>(start: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw new Error('TRANSFER_CANCELLED')
    let abort: (() => void) | undefined
    const stopped = new Promise<never>((_, reject) => {
      abort = () => reject(new Error('TRANSFER_CANCELLED'))
      signal.addEventListener('abort', abort, { once: true })
    })
    try {
      const result = await Promise.race([this.observe(() => {
        if (signal.aborted) throw new Error('TRANSFER_CANCELLED')
        return start()
      }), stopped])
      if (signal.aborted) throw new Error('TRANSFER_CANCELLED')
      return result
    } finally { if (abort) signal.removeEventListener('abort', abort) }
  }
  async limited<T>(start: () => Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
    const deadline = new AbortController(), abort = () => deadline.abort()
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) deadline.abort()
    const timer = setTimeout(abort, timeoutMs)
    try { return await this.run(start, deadline.signal) }
    finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
  }
  /** Cancellation/cleanup must never make an otherwise bounded operation wait. */
  cleanup(start: () => Promise<unknown>): void { void this.observe(start).catch(() => {}) }
  finish(): void {
    this.finished = true
    if (this.pending.size === 0) this.release()
  }
}
