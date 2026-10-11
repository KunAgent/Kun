type Deferred<Value> = {
  promise: Promise<Value>
  resolve: (value: Value | PromiseLike<Value>) => void
  reject: (reason?: unknown) => void
}

type EnsureOperation<Settings> = Deferred<Settings> & {
  kind: 'ensure'
  fingerprint: string
  operation: () => Promise<Settings>
}

type RestartOperation = Deferred<void> & {
  kind: 'restart'
  operation: () => Promise<void>
}

type ReplaceOperation = Deferred<void> & {
  kind: 'replace'
  operation: () => Promise<void>
}

type SettingsApplyOperation = Deferred<void> & {
  kind: 'settings'
  coalesceKey: string
  operation: () => Promise<void>
  onError: (error: unknown) => void
}

type ManagedRuntimeOperation<Settings> =
  | EnsureOperation<Settings>
  | RestartOperation
  | ReplaceOperation
  | SettingsApplyOperation

function createDeferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value | PromiseLike<Value>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<Value>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

/**
 * Serializes the main process operations that can replace or reconfigure the
 * single managed Kun runtime. The coordinator owns concurrency only; callers
 * retain runtime policy and I/O.
 */
export class ManagedRuntimeOperationCoordinator<Settings> {
  private readonly queue: ManagedRuntimeOperation<Settings>[] = []
  private activeOperation: ManagedRuntimeOperation<Settings> | null = null
  private draining = false
  private latestSettings: Settings | null = null
  private generation = 0

  hasPendingOperation(): boolean {
    return this.activeOperation !== null || this.queue.length > 0
  }

  /** Advances whenever a restart, replacement, or settings apply starts or ends. */
  lifecycleGeneration(): number {
    return this.generation
  }

  latestOr(fallback: Settings): Settings {
    return this.latestSettings ?? fallback
  }

  noteLatest(settings: Settings): void {
    this.latestSettings = settings
  }

  ensure(fingerprint: string, operation: () => Promise<Settings>): Promise<Settings> {
    const tail = this.tailOperation()
    // An ensure can only share its immediately adjacent owner. Any intervening
    // restart, settings apply, or different fingerprint is a FIFO barrier and
    // starts a new lifecycle generation.
    if (tail?.kind === 'ensure' && tail.fingerprint === fingerprint) {
      return tail.promise
    }

    const deferred = createDeferred<Settings>()
    const queued: EnsureOperation<Settings> = {
      kind: 'ensure',
      fingerprint,
      operation,
      ...deferred
    }
    this.queue.push(queued)
    this.startDrain()
    return queued.promise
  }

  restart(operation: () => Promise<void>): Promise<void> {
    const tail = this.tailOperation()
    // Preserve restart single-flight for adjacent callers without allowing a
    // restart to jump over an already queued lifecycle barrier.
    if (tail?.kind === 'restart') return tail.promise

    const deferred = createDeferred<void>()
    const queued: RestartOperation = { kind: 'restart', operation, ...deferred }
    this.queue.push(queued)
    this.startDrain()
    return queued.promise
  }

  /**
   * An explicit serve replacement is intentionally distinct from a normal
   * restart. A watchdog restart must never cause a user-confirmed replacement
   * to lose its verified cleanup policy, while repeated explicit clicks still
   * share one operation.
   */
  replace(operation: () => Promise<void>): Promise<void> {
    const tail = this.tailOperation()
    if (tail?.kind === 'replace') return tail.promise

    const deferred = createDeferred<void>()
    const queued: ReplaceOperation = { kind: 'replace', operation, ...deferred }
    this.queue.push(queued)
    this.startDrain()
    return queued.promise
  }

  enqueueSettingsApply(
    operation: () => Promise<void>,
    onError: (error: unknown) => void,
    coalesceKey = 'runtime-settings'
  ): void {
    const deferred = createDeferred<void>()
    const queued: SettingsApplyOperation = {
      kind: 'settings',
      coalesceKey,
      operation,
      onError,
      ...deferred
    }

    // Automatic settings saves can arrive much faster than Kun can apply
    // them. Replace only an adjacent, not-yet-started apply. A running apply or
    // an intervening ensure/restart remains an ordering barrier.
    const tailIndex = this.queue.length - 1
    const tail = this.queue[tailIndex]
    if (tail?.kind === 'settings' && tail.coalesceKey === coalesceKey) {
      this.queue[tailIndex] = queued
      tail.resolve()
    } else {
      this.queue.push(queued)
    }
    this.startDrain()
  }

  /** Wait from outside the lane until all work currently reachable is settled. */
  async waitForIdle(): Promise<void> {
    for (;;) {
      const operation = this.queue[this.queue.length - 1] ?? this.activeOperation
      if (!operation) return
      try {
        await operation.promise
      } catch {
        // Failed ensure/restart work is still settled work. Continue until the
        // lane has drained successors queued behind it.
      }
    }
  }

  private tailOperation(): ManagedRuntimeOperation<Settings> | null {
    return this.queue[this.queue.length - 1] ?? this.activeOperation
  }

  private startDrain(): void {
    if (this.draining) return
    this.draining = true
    void this.drain()
  }

  private async drain(): Promise<void> {
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift()
        if (!next) continue
        this.activeOperation = next
        if (next.kind !== 'ensure') this.generation += 1
        await this.execute(next)
        if (this.activeOperation === next) this.activeOperation = null
      }
    } finally {
      this.activeOperation = null
      this.draining = false
      // No await separates the final queue check from clearing `draining`, but
      // keep this guard so future enqueue paths cannot strand work.
      if (this.queue.length > 0) this.startDrain()
    }
  }

  private async execute(next: ManagedRuntimeOperation<Settings>): Promise<void> {
    if (next.kind === 'settings') {
      try {
        await next.operation()
      } catch (error) {
        try {
          next.onError(error)
        } catch {
          // Error reporting must not poison the lifecycle lane.
        }
      }
      if (this.activeOperation === next) this.activeOperation = null
      this.generation += 1
      next.resolve()
      return
    }

    try {
      const result = await next.operation()
      if (this.activeOperation === next) this.activeOperation = null
      if (next.kind === 'ensure') {
        next.resolve(result as Settings)
      } else {
        this.generation += 1
        next.resolve()
      }
    } catch (error) {
      if (this.activeOperation === next) this.activeOperation = null
      if (next.kind !== 'ensure') this.generation += 1
      next.reject(error)
    }
  }
}
