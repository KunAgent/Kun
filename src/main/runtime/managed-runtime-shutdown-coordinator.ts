import type { RuntimeStopReason } from './kun-process-controller'

/** Owns application quit intent and single-flight managed-runtime shutdown. */
export class ManagedRuntimeShutdownCoordinator {
  private quitRequested = false
  private updateInstallQuit = false
  private stoppedForQuit = false
  private stopPromise: Promise<void> | null = null

  constructor(private readonly stopManagedRuntimes: (reason: RuntimeStopReason) => Promise<void>) {}

  get isQuitRequested(): boolean {
    return this.quitRequested
  }

  get isUpdateInstallQuit(): boolean {
    return this.updateInstallQuit
  }

  get isStoppedForQuit(): boolean {
    return this.stoppedForQuit
  }

  get isQuitInProgress(): boolean {
    return this.quitRequested || this.updateInstallQuit
  }

  requestQuit(): void {
    this.quitRequested = true
  }

  setUpdateInstallQuit(active: boolean): void {
    this.updateInstallQuit = active
  }

  stop(reason: RuntimeStopReason = 'manual-restart'): Promise<void> {
    if (this.stopPromise) return this.stopPromise
    let tracked: Promise<void>
    tracked = this.stopManagedRuntimes(reason).finally(() => {
      if (this.stopPromise === tracked) this.stopPromise = null
    })
    this.stopPromise = tracked
    return tracked
  }

  async stopForQuit(): Promise<void> {
    this.requestQuit()
    if (this.stoppedForQuit) return
    try {
      await this.stop(this.updateInstallQuit ? 'update-relaunch' : 'app-quit')
    } finally {
      // Quit remains terminal even when one adapter reports a stop error: the
      // supervisor must never spawn a replacement child after this point.
      this.stoppedForQuit = true
    }
  }
}
