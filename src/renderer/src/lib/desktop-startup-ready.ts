import type { DesktopStartupStatePayload } from '@shared/desktop-startup-state'

/**
 * Resolves once the desktop main process reports `ready`. Its IPC for settings,
 * art and the runtime is registered only after its services are up, so a read
 * made at renderer boot would reach a channel that has no handler yet. Resolves
 * at once where there is no desktop startup channel (remote web, tests), and
 * never when startup ends in recovery, which has no workbench to serve.
 */
export function whenDesktopStartupReady(): Promise<void> {
  const startup = typeof window === 'undefined' ? undefined : window.kunGui?.startup
  if (!startup) return Promise.resolve()
  return new Promise((resolve) => {
    let settled = false
    let unsubscribe: (() => void) | undefined
    const accept = (payload: DesktopStartupStatePayload): void => {
      if (settled || payload.phase !== 'ready') return
      settled = true
      unsubscribe?.()
      resolve()
    }
    unsubscribe = startup.onState(accept)
    if (settled) unsubscribe()
    void startup.getState().then(accept, () => undefined)
  })
}
