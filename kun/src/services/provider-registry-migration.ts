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
  if (await raw.read(() => null) !== null) return
  const legacy = new AtomicJsonFile<unknown>(join(input.dataDir, LEGACY_PROVIDER_REGISTRY_FILE), (value) => value, false)
  const previous = await legacy.read(() => null)
  let next = previous === null ? input.empty() : input.validate(previous)
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
