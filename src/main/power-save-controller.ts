import type { PowerSaveBlockerLike } from './schedule-runtime-helpers'

/**
 * Shared power-save blocker with reference counting.
 *
 * ScheduleRuntime and DaemonRuntime hold independent references while their
 * background work needs the computer awake. The desktop-wide app preference
 * owns one additional idempotent reference. All three use the same controller,
 * so one owner cannot stop the Electron blocker while another still needs it.
 * WorkflowRuntime currently owns a separate native blocker id. `reset()`
 * force-releases this controller during desktop-service teardown.
 */
export class PowerSaveController {
  private refCount = 0
  private blockerId: number | null = null
  private appKeepAwakeRequested = false
  private appKeepAwakeHeld = false

  constructor(private readonly blocker: PowerSaveBlockerLike) {}

  acquire(): boolean {
    const acquired = this.acquireReference()
    if (acquired && this.appKeepAwakeRequested && !this.appKeepAwakeHeld) {
      this.refCount += 1
      this.appKeepAwakeHeld = true
    }
    return acquired
  }

  private acquireReference(): boolean {
    this.refCount += 1
    if (this.refCount > 1) return this.blockerId != null
    try {
      this.blockerId = this.blocker.start('prevent-app-suspension')
      return true
    } catch {
      this.refCount = 0
      this.blockerId = null
      return false
    }
  }

  /** Apply the desktop-wide preference without leaking duplicate references. */
  setAppKeepAwake(enabled: boolean): void {
    this.appKeepAwakeRequested = enabled
    if (enabled) {
      if (!this.appKeepAwakeHeld) this.appKeepAwakeHeld = this.acquireReference()
      return
    }
    if (!this.appKeepAwakeHeld) return
    this.appKeepAwakeHeld = false
    this.release()
  }

  release(): void {
    if (this.refCount <= 0) return
    this.refCount -= 1
    if (this.refCount === 0) this.stopBlocker()
  }

  isActive(): boolean {
    if (this.refCount <= 0 || this.blockerId == null) return false
    try {
      return this.blocker.isStarted(this.blockerId)
    } catch {
      return false
    }
  }

  /** Force-release every reference (runtime teardown). */
  reset(): void {
    this.appKeepAwakeRequested = false
    this.appKeepAwakeHeld = false
    this.refCount = 0
    this.stopBlocker()
  }

  private stopBlocker(): void {
    const id = this.blockerId
    this.blockerId = null
    if (id == null) return
    try {
      if (this.blocker.isStarted(id)) this.blocker.stop(id)
    } catch {
      /* best-effort */
    }
  }
}

export function createPowerSaveController(blocker: PowerSaveBlockerLike): PowerSaveController {
  return new PowerSaveController(blocker)
}
