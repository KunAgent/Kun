import type { AppSettingsV1 } from '../shared/app-settings'

export type WindowFirstStartupShell = {
  shellSettings: AppSettingsV1
  productionSettingsPath: string
}

export type WindowFirstStartupDeps<Background> = {
  initializeShell: () => Promise<WindowFirstStartupShell | null>
  registerShellIpc: () => void
  transitionShellReady: () => void
  createWindow: (settings: AppSettingsV1) => void
  windowAvailable: () => void
  syncTray: (settings: AppSettingsV1) => void
  startBackground: (shell: WindowFirstStartupShell) => Promise<Background>
}

export type WindowFirstStartupResult<Background> = {
  shell: WindowFirstStartupShell
  background: Background
}

/**
 * Enforces the startup ordering invariant: a usable window shell is created
 * before any Service Manager, migration, Runtime handoff, or lease work is
 * awaited. Keeping this tiny orchestration seam free of Electron/Runtime
 * imports makes the foreground budget regression test runnable in Node too.
 */
export async function startWindowFirstStartup<Background>(
  deps: WindowFirstStartupDeps<Background>
): Promise<WindowFirstStartupResult<Background> | null> {
  const shell = await deps.initializeShell()
  if (!shell) return null

  deps.registerShellIpc()
  deps.transitionShellReady()
  deps.createWindow(shell.shellSettings)
  deps.windowAvailable()
  deps.syncTray(shell.shellSettings)

  const background = await deps.startBackground(shell)
  return { shell, background }
}
