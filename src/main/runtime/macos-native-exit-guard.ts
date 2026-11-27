import { spawn } from 'node:child_process'
import { writeSync } from 'node:fs'
import type { App } from 'electron'

/** Runs outside Electron's event loop, which can already be gone during native teardown. */
function watchQuittingParent(): void {
  const parent = Number(process.argv[1])
  if (!Number.isSafeInteger(parent) || parent <= 1 || process.ppid !== parent) return
  const deadline = Date.now() + 10_000
  const check = (): void => {
    // The kernel reparents this child when the original GUI exits. Never signal
    // a recycled PID or a replacement app, and never signal a process group.
    if (process.ppid !== parent) return
    if (Date.now() < deadline) { setTimeout(check, 250); return }
    try { if (process.ppid === parent) process.kill(parent, 'SIGKILL') } catch { /* parent exited */ }
  }
  check()
}

export const MACOS_NATIVE_EXIT_GUARD_SOURCE = `(${watchQuittingParent.toString()})()`

/**
 * Electron can stall after its final quit event in macOS native thread-pool
 * teardown (electron/electron#55647). Only arm after normal window closure AND
 * confirmed application-owned resource cleanup; never replace the quit barrier.
 */
export function installMacosNativeExitGuard(
  app: Pick<App, 'once'>,
  cleanupComplete: () => boolean,
  platform: NodeJS.Platform = process.platform
): void {
  if (platform !== 'darwin') return
  app.once('quit', (_event, exitCode) => {
    const confirmed = cleanupComplete() && exitCode === 0
    // Synchronous because Electron may end its JS loop immediately after quit.
    try { writeSync(2, `[kun-gui] final quit: cleanupConfirmed=${confirmed}, exitCode=${exitCode}\n`) } catch { /* closed stderr */ }
    if (!confirmed) return
    try {
      const guard = spawn(process.execPath, ['-e', MACOS_NATIVE_EXIT_GUARD_SOURCE, String(process.pid)], {
        detached: true, stdio: 'ignore', env: { ELECTRON_RUN_AS_NODE: '1' }
      })
      guard.once('error', () => { /* normal quit remains the primary exit path */ })
      guard.unref()
    } catch { /* failure to arm must not interrupt Electron's ordinary quit */ }
  })
}
