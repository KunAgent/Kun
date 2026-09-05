import {
  syncGuiProviderCatalogToConfig,
  type GuiConfigSyncResult,
  type GuiSharedSettings
} from '../cli/gui-settings-bridge.js'
import { resolveSharedRuntime } from '../cli/shared-runtime.js'

export type GuiCatalogImportResult = {
  sync: GuiConfigSyncResult | null
  warning: string
}

export function isDataDirLeaseConflictError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /already owned by active process|config synchronization is active/i.test(message)
}

/**
 * Import GUI providers into config.json only for cold start.
 * When a Runtime already owns the data dir (normally explicit attach mode),
 * its live Registry is authoritative and a file rewrite would race the owner.
 */
export async function importGuiProviderCatalogForTui(input: {
  dataDir: string
  settings: GuiSharedSettings
  fetch: typeof fetch
  resolveLiveSharedRuntime?: typeof resolveSharedRuntime
  syncCatalog?: typeof syncGuiProviderCatalogToConfig
}): Promise<GuiCatalogImportResult> {
  const resolveLive = input.resolveLiveSharedRuntime ?? resolveSharedRuntime
  const syncCatalog = input.syncCatalog ?? syncGuiProviderCatalogToConfig
  const liveShared = await resolveLive(input.dataDir, input.fetch)
  if (liveShared) {
    return { sync: null, warning: '' }
  }
  try {
    return {
      sync: await syncCatalog(input.dataDir, input.settings),
      warning: ''
    }
  } catch (error) {
    // Race: GUI/Manager claimed the writer lease between the live probe and sync.
    if (isDataDirLeaseConflictError(error)) {
      return { sync: null, warning: '' }
    }
    return {
      sync: null,
      warning: `could not import GUI model catalog: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}
