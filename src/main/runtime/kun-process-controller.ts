import type { ChildProcess } from 'node:child_process'

export type RuntimeStopReason =
  | 'app-quit'
  | 'settings-restart'
  | 'provider-change'
  | 'manual-restart'
  | 'health-recovery'
  | 'update-relaunch'
  | 'safe-mode-restart'
  | 'unknown'

export type RuntimeProcessGeneration = {
  generation: number
  pid?: number
  startedAt?: string
  readyAt?: string
  requestedStopReason?: RuntimeStopReason
  exitCode?: number | null
  signal?: NodeJS.Signals | null
}

export type KunUnexpectedExitInfo = {
  code: number | null
  signal: NodeJS.Signals | null
  stderrTail: string
  generation: number
}

export type KunProcessExitEvent = {
  generation: RuntimeProcessGeneration
  expected: boolean
  reason: RuntimeStopReason
  /** True when an older process emitted after a newer process was registered. */
  stale: boolean
}

type TrackedGeneration = RuntimeProcessGeneration & { exited: boolean }

/**
 * Owns the mutable lifecycle state for the one GUI-managed Kun child.
 *
 * Process spawning, readiness, logging, and stop policy remain in their focused
 * adapters; this owner prevents those adapters from inventing independent
 * module globals or single-flight rules.
 */
export class KunProcessController<LogCapture> {
  child: ChildProcess | null = null
  childPort: number | null = null
  logCapture: LogCapture | null = null
  lastResolvedBinary: string | null = null
  stderrTail = ''

  private startPromise: Promise<void> | null = null
  private readonly generations = new WeakMap<ChildProcess, TrackedGeneration>()
  private nextGeneration = 0
  private activeGeneration = 0
  private unexpectedExitHandler: ((info: KunUnexpectedExitInfo) => void) | null = null

  isRunning(): boolean {
    return this.child !== null && this.child.exitCode === null && this.child.signalCode === null
  }

  isCurrentPid(pid: number): boolean {
    return Boolean(this.child?.pid === pid && this.isRunning())
  }

  setUnexpectedExitHandler(
    handler: ((info: KunUnexpectedExitInfo) => void) | null
  ): void {
    this.unexpectedExitHandler = handler
  }

  reportUnexpectedExit(info: KunUnexpectedExitInfo): void {
    this.unexpectedExitHandler?.(info)
  }

  /** Register a newly spawned child before wiring its event listeners. */
  registerChild(child: ChildProcess): RuntimeProcessGeneration {
    const generation: TrackedGeneration = {
      generation: ++this.nextGeneration,
      ...(typeof child.pid === 'number' ? { pid: child.pid } : {}),
      startedAt: new Date().toISOString(),
      exited: false
    }
    this.generations.set(child, generation)
    this.activeGeneration = generation.generation
    this.child = child
    return generation
  }

  markIntentionalStop(child: ChildProcess, reason: RuntimeStopReason = 'manual-restart'): void {
    const generation = this.generations.get(child)
    if (generation && !generation.exited) generation.requestedStopReason = reason
  }

  markReady(child: ChildProcess): void {
    const generation = this.generations.get(child)
    if (generation && !generation.exited) generation.readyAt = new Date().toISOString()
  }

  /**
   * Classify exactly one exit notification. Duplicate notifications are
   * ignored, while an old generation is returned as stale and never promoted
   * to a supervisor crash event.
   */
  recordExit(
    child: ChildProcess,
    exit: { code: number | null; signal: NodeJS.Signals | null }
  ): KunProcessExitEvent | null {
    const generation = this.generations.get(child)
    if (!generation || generation.exited) return null
    generation.exited = true
    generation.exitCode = exit.code
    generation.signal = exit.signal
    const stale = this.child !== child || this.activeGeneration !== generation.generation
    return {
      generation,
      expected: Boolean(generation.requestedStopReason),
      reason: generation.requestedStopReason ?? 'unknown',
      stale
    }
  }

  /** Kept as a narrow readiness predicate for callers that only need a boolean. */
  shouldReportUnexpectedExit(child: ChildProcess): boolean {
    const generation = this.generations.get(child)
    return Boolean(generation?.readyAt && !generation.requestedStopReason && !generation.exited)
  }

  waitForStartupSettled(): Promise<void> {
    return this.startPromise?.catch(() => undefined) ?? Promise.resolve()
  }

  start(factory: () => Promise<void>): Promise<void> {
    if (this.startPromise) return this.startPromise
    let promise: Promise<void>
    promise = Promise.resolve().then(factory).finally(() => {
      if (this.startPromise === promise) this.startPromise = null
    })
    this.startPromise = promise
    return promise
  }

  clearChild(expected: ChildProcess): boolean {
    if (this.child !== expected) return false
    this.child = null
    this.childPort = null
    return true
  }
}
