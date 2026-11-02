import type { DesktopStartupState } from './desktop-startup-state'

/**
 * Updater IPC is registered while the shell is visible but the runtime is still
 * starting. A probe at that point would spend a health attempt and defer normal
 * recovery cleanup for six hours, even when startup succeeds moments later.
 * Wait for lifecycle readiness; still run the real authenticated API probe.
 */
export async function probeUpdateRuntimeAfterStartup<T>(
  startup: Pick<DesktopStartupState, 'whenReady'>,
  loadSettings: () => Promise<T>,
  probe: (settings: T) => Promise<{ ok: boolean }>
): Promise<boolean> {
  if (!await startup.whenReady()) return false
  return (await probe(await loadSettings())).ok
}
