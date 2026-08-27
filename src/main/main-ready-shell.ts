import { app, session } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import kunMacLogoPng from '../asset/img/kun_mac.png?url'
import { createAppIcon } from './app-icon'
import { clearDevelopmentRendererHttpCache } from './dev-renderer-cache'
import { inspectPackagedInstallHealth } from './packaged-install-health'
import { runStorageRelocationMaintenance } from './main-migrations'
import { resolveLogDirectory } from './main-paths'
import { SETTINGS_FILE_NAME } from './settings-file-paths'
import { normalizeAppSettings, type AppSettingsV1 } from '../shared/app-settings'
import {
  appEnvironment,
  appIcon,
  developmentRendererUrl,
  mainState,
  pendingStorageRelocationId,
  storageRelocationRecoveryRequired,
  traceStartup
} from './main-app-context'

/**
 * Fast window-shell bootstrap. Runs before the workbench window is created
 * and is bounded to milliseconds: no Service Manager, no migration, no
 * settings store. The heavy initialization continues in the background
 * through initializeMainServices() while the shell is already visible.
 */
export type WindowShell = {
  shellSettings: AppSettingsV1
  productionSettingsPath: string
}

function defaultShellSettings(): AppSettingsV1 {
  return normalizeAppSettings({} as unknown as AppSettingsV1)
}

/**
 * Raw disk read of the production settings file, normalized but without the
 * Manager document backend. Only window-shell decisions (start hidden, title
 * bar mode, initial tray) consume this snapshot; the authoritative store is
 * loaded later inside initializeMainServices().
 */
export async function readShellSettingsSnapshot(
  productionSettingsPath: string
): Promise<AppSettingsV1> {
  try {
    const raw = await readFile(productionSettingsPath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return defaultShellSettings()
    }
    return normalizeAppSettings(parsed as AppSettingsV1)
  } catch {
    return defaultShellSettings()
  }
}

export async function initializeWindowShell(): Promise<WindowShell | null> {
  if (mainState.updateHealthProbeOnly) {
    throw new Error('Update health probes must not initialize desktop services or migrate user data.')
  }
  const installHealth = inspectPackagedInstallHealth({
    isPackaged: app.isPackaged,
    executablePath: process.execPath,
    resourcesPath: process.resourcesPath
  })
  if (!installHealth.ok) {
    throw new Error(
      `Kun installation needs repair. The installed application is incomplete (${installHealth.missing.join(', ')}). Reinstall Kun and try again.`
    )
  }

  try {
    const cleared = await clearDevelopmentRendererHttpCache(
      session.defaultSession,
      developmentRendererUrl()
    )
    if (cleared) traceStartup('development renderer HTTP cache cleared')
  } catch (error) {
    console.warn('[kun-gui] failed to clear the development renderer HTTP cache:', error)
  }

  if (process.platform === 'darwin') {
    const macDockIcon = createAppIcon(kunMacLogoPng)
    app.dock?.setIcon(macDockIcon.isEmpty() ? appIcon : macDockIcon)
  }

  const productionSettingsUserDataPath = appEnvironment.flavor === 'production'
    ? app.getPath('userData')
    : join(app.getPath('appData'), 'Kun')
  const productionSettingsPath = join(productionSettingsUserDataPath, SETTINGS_FILE_NAME)
  // Storage relocation maintenance restarts the whole app, so it must stay
  // in front of window creation by design (unchanged semantics).
  if (storageRelocationRecoveryRequired) {
    traceStartup('storage relocation maintenance:start', {
      operationId: pendingStorageRelocationId ?? 'repair'
    })
    await runStorageRelocationMaintenance(productionSettingsPath)
    return null
  }

  const shellSettings = await readShellSettingsSnapshot(productionSettingsPath)
  traceStartup('window shell settings loaded', {
    startHiddenCandidate: shellSettings.appBehavior.startMinimized,
    useSystemTitleBar: shellSettings.appBehavior.useSystemTitleBar
  })
  mainState.logDir = resolveLogDirectory(app)
  return { shellSettings, productionSettingsPath }
}
