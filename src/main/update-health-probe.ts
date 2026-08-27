import { app } from 'electron'
import { inspectPackagedInstallHealth } from './packaged-install-health'

export type UpdateHealthProbeDeps = {
  isPackaged: () => boolean
  executablePath: () => string
  resourcesPath: () => string
  inspectInstall: typeof inspectPackagedInstallHealth
  loadRuntimeAdapter: () => Promise<unknown>
}

const defaultDeps: UpdateHealthProbeDeps = {
  isPackaged: () => app.isPackaged,
  executablePath: () => process.execPath,
  resourcesPath: () => process.resourcesPath,
  inspectInstall: inspectPackagedInstallHealth,
  loadRuntimeAdapter: () => import('./runtime/kun-adapter')
}

/**
 * Check only the candidate payload before its installation transaction commits.
 * Data migrations and all persistent services intentionally begin on the first
 * normal launch after CommitUpdateTransaction succeeds.
 */
export async function runMinimalUpdateProbe(
  deps: UpdateHealthProbeDeps = defaultDeps
): Promise<void> {
  await app.whenReady()
  // Calling getVersion confirms Electron's main-process binding is available.
  app.getVersion()

  const installHealth = deps.inspectInstall({
    isPackaged: deps.isPackaged(),
    executablePath: deps.executablePath(),
    resourcesPath: deps.resourcesPath()
  })
  if (!installHealth.ok) {
    throw new Error(`Kun installation is incomplete (${installHealth.missing.join(', ')}).`)
  }

  // This verifies the packaged runtime module graph without resolving settings,
  // starting a Manager/Runtime, or touching user data.
  await deps.loadRuntimeAdapter()
}
