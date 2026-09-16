import {
  ContextWindowModeSchema,
  ContextWindowTurnModeSnapshotSchema,
  type ContextWindowMode,
  type ContextWindowTurnModeSnapshot
} from '../contracts/context-windows.js'

export type ContextWindowModeReader = () => ContextWindowMode

/**
 * Per-turn mode snapshots frozen at turn acceptance. Hot config updates only
 * affect turns admitted afterwards; an active turn keeps its accepted mode
 * until it finishes. The registry also remembers each thread's last accepted
 * mode so continuation runs and child-agent threads inherit it (child agents
 * get their own thread, hence their own window state and data isolation).
 */
export class ContextWindowTurnModes {
  private readonly turnModes = new Map<string, ContextWindowMode>()
  private readonly threadModes = new Map<string, ContextWindowMode>()
  private readonly windows = new Map<string, { windowId: string; windowSeq: number }>()

  constructor(private readonly live: ContextWindowModeReader) {}

  private turnKey(threadId: string, turnId: string): string {
    return `${threadId}${turnId}`
  }

  /** Live-config fallback for turns admitted before any freeze existed. */
  private liveMode(): ContextWindowMode {
    const mode = this.live()
    return ContextWindowModeSchema.parse(mode)
  }

  /**
   * Resolve the mode for a newly admitted turn. A thread forked or delegated
   * from a parent thread inherits the parent's last accepted mode; every
   * other turn reads the current effective config.
   */
  resolveForNewTurn(parentThreadId?: string | null): ContextWindowMode {
    if (parentThreadId) {
      const inherited = this.threadModes.get(parentThreadId)
      if (inherited) return inherited
    }
    return this.liveMode()
  }

  /** Freeze the accepted mode for one turn; returns the full snapshot. */
  freeze(input: {
    threadId: string
    turnId: string
    mode?: ContextWindowMode
    parentThreadId?: string | null
  }): ContextWindowTurnModeSnapshot {
    const mode = input.mode ?? this.resolveForNewTurn(input.parentThreadId ?? null)
    this.turnModes.set(this.turnKey(input.threadId, input.turnId), mode)
    this.threadModes.set(input.threadId, mode)
    return this.snapshot(input.threadId, input.turnId)
  }

  /** Accepted mode for an active or historical turn. */
  modeFor(threadId: string, turnId: string | undefined): ContextWindowMode {
    if (turnId) {
      const frozen = this.turnModes.get(this.turnKey(threadId, turnId))
      if (frozen) return frozen
    }
    return this.modeForThread(threadId)
  }

  /** Last mode accepted by any turn of the thread (live config fallback). */
  modeForThread(threadId: string): ContextWindowMode {
    return this.threadModes.get(threadId) ?? this.liveMode()
  }

  /** Full snapshot (mode + current window identity) for one turn. */
  snapshot(threadId: string, turnId: string): ContextWindowTurnModeSnapshot {
    return ContextWindowTurnModeSnapshotSchema.parse({
      mode: this.modeFor(threadId, turnId),
      ...(this.windows.get(threadId) ?? { windowId: null, windowSeq: null })
    })
  }

  /** Record the active window identity after a committed transition. */
  setWindow(threadId: string, window: { windowId: string; windowSeq: number }): void {
    this.windows.set(threadId, { windowId: window.windowId, windowSeq: window.windowSeq })
  }

  windowFor(threadId: string): { windowId: string; windowSeq: number } | undefined {
    const window = this.windows.get(threadId)
    return window ? { ...window } : undefined
  }
}
