import { assertProviderConfigurationUrls } from '../contracts/provider-safe-url.js'
import { chmod, lstat } from 'node:fs/promises'
import { managerAtomicJsonConfig } from '../extensions/atomic-json.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'
import { join } from 'node:path'
import { AtomicJsonFile } from '../extensions/atomic-json.js'

export const PROVIDER_REGISTRY_FILE = 'model-connections.v2.json'
export const LEGACY_PROVIDER_REGISTRY_FILE = 'model-connections.v1.json'

/** Retain v1 as a recovery source; only the v2 file receives subsequent mutations. */
export async function migrateProviderRegistry<T extends { revision: number; schemaVersion: number }>(input: {
  dataDir: string
  file: AtomicJsonFile<T>
  empty(): T
  validate(value: unknown): T
  prepareLegacy?(value: T): Promise<T>
}): Promise<void> {
  await withManagerDataMutex(`provider-registry-migration:${input.dataDir}`, async () => {
  const raw = new AtomicJsonFile<unknown>(join(input.dataDir, PROVIDER_REGISTRY_FILE), (value) => value, false)
  const canonical = await raw.read(() => null)
  if (canonical !== null) {
    if (!canonical || typeof canonical !== 'object' || (canonical as { schemaVersion?: unknown }).schemaVersion !== 2) {
      throw new Error('Canonical provider Registry has an unsupported version; preserve this file and update Kun or use controlled recovery')
    }
    return
  }
  const legacy = new AtomicJsonFile<unknown>(join(input.dataDir, LEGACY_PROVIDER_REGISTRY_FILE), (value) => value, false)
  if (!managerAtomicJsonConfig(legacy.path)) {
    try {
      const info = await lstat(legacy.path)
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Provider recovery source must be a protected regular file')
      await chmod(legacy.path, 0o600)
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  const previous = await legacy.read(() => null)
  if (previous !== null) assertProviderConfigurationUrls(previous)
  let next = previous === null ? input.empty() : input.validate(previous)
  if (previous !== null) {
    const document = next as T & { profiles?: Record<string, unknown>; configuration?: { connections: Record<string, Record<string, unknown>> } }
    if (document.profiles && document.configuration) for (const id of Object.keys(document.profiles)) {
      document.configuration.connections[id] = { enabled: true, inherit: [], manualModels: [], ...document.configuration.connections[id],
        migrationOrigin: { schemaVersion: 1, migratedAt: new Date().toISOString() } }
    }
  }
  if (input.prepareLegacy) next = await input.prepareLegacy(next)
  await input.file.update(input.empty, (current) => current.revision > 0 ? current : next)
  })
}

export function upgradeProviderRegistry(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const document = value as Record<string, unknown>
  if (document.schemaVersion !== 1 && document.schemaVersion !== 2) {
    throw new Error('Unsupported provider Registry version; update Kun before editing this configuration')
  }
  return { ...document, schemaVersion: 2 }
}
