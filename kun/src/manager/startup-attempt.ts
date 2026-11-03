import { randomUUID } from 'node:crypto'

export type StartupStage = 'profile' | 'previous-processes' | 'manager-launch' | 'manager-ready' | 'runtime-launch' | 'ready' | 'cleanup'
export type StartupProgress = { attemptId: string; stage: StartupStage; elapsedMs: number; remainingMs: number }
export class StartupDeadlineError extends Error {
  readonly code = 'startup_deadline'
  constructor(readonly progress: StartupProgress) {
    super(`Kun startup timed out during ${progress.stage} after ${progress.elapsedMs}ms`)
    this.name = 'StartupDeadlineError'
  }
}

/** One monotonic budget, including cleanup, reused across safe retries. */
export class StartupAttempt {
  readonly id = randomUUID()
  private readonly started = performance.now()
  readonly deadline: number
  readonly workDeadline: number
  readonly signal: AbortSignal
  private readonly cancel = new AbortController()
  private readonly timer: ReturnType<typeof setTimeout>
  private stage: StartupStage = 'profile'
  private lastReported = -Infinity

  constructor(timeoutMs = 45_000, signal?: AbortSignal, private readonly onProgress?: (progress: StartupProgress) => void) {
    this.deadline = this.started + Math.max(1, timeoutMs)
    this.workDeadline = this.deadline - Math.min(2_000, Math.max(0, timeoutMs / 10))
    this.signal = signal ? AbortSignal.any([signal, this.cancel.signal]) : this.cancel.signal
    this.timer = setTimeout(() => this.cancel.abort(new StartupDeadlineError(this.progress())), Math.max(1, this.workDeadline - performance.now()))
    this.timer.unref()
  }
  progress(): StartupProgress {
    return { attemptId: this.id, stage: this.stage, elapsedMs: Math.round(performance.now() - this.started),
      remainingMs: Math.max(0, Math.round(this.deadline - performance.now())) }
  }
  check(): void {
    if (performance.now() >= this.workDeadline && !this.signal.aborted) this.cancel.abort(new StartupDeadlineError(this.progress()))
    this.signal.throwIfAborted()
  }
  note(stage: StartupStage): void {
    if (stage === this.stage && performance.now() - this.lastReported < 1_000) return
    this.stage = stage
    this.lastReported = performance.now()
    this.onProgress?.(this.progress())
  }
  cleanupMs(): number { return Math.max(1, Math.min(2_000, Math.ceil(this.deadline - performance.now()))) }
  abort(reason: Error): void { this.cancel.abort(reason) }
  dispose(): void { clearTimeout(this.timer) }
}
