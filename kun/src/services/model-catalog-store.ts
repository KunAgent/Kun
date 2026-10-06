import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { AtomicJsonFile } from '../extensions/atomic-json.js'

/** Derived, account-bound metadata. Selection remains in the connection Registry. */
export type ModelCatalogEntry = {
  fetchedAt: string
  baseUrl?: string
  endpointFormat?: string
  models: string[]
  identity?: string
  configurationRevision?: number
  startedAt?: string
  source?: 'provider' | 'manual'
  stale?: boolean
  identityChanged?: boolean
  lastAttemptAt?: string
  lastAttemptStatus?: 'success' | 'failed'
}

function catalogPath(dataDir: string, providerId: string): string {
  const name = createHash('sha256').update(providerId).digest('hex')
  return join(dataDir, 'model-catalog', 'v2', `${name}.json`)
}

export function modelCatalogIdentity(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function parseEntry(value: unknown): ModelCatalogEntry {
  if (!value || typeof value !== 'object') throw new Error('Invalid model catalog')
  const row = value as ModelCatalogEntry
  if (typeof row.fetchedAt !== 'string' || !Array.isArray(row.models) || row.models.length > 2_000 ||
      row.models.some((id) => typeof id !== 'string' || !id.trim() || id.length > 512)) {
    throw new Error('Invalid model catalog')
  }
  return row
}

export async function writeModelCatalog(dataDir: string, providerId: string, entry: ModelCatalogEntry): Promise<void> {
  const safe = { ...entry }
  if (safe.baseUrl) {
    try {
      const url = new URL(safe.baseUrl)
      url.username = ''; url.password = ''; url.search = ''; url.hash = ''
      safe.baseUrl = url.toString()
    } catch { delete safe.baseUrl }
  }
  const file = new AtomicJsonFile(catalogPath(dataDir, providerId), parseEntry, false)
  await file.update(() => safe, (previous) => {
    if ((previous.configurationRevision ?? -1) > (safe.configurationRevision ?? -1)) return previous
    if (previous.configurationRevision === safe.configurationRevision &&
        Date.parse(previous.startedAt ?? previous.fetchedAt) > Date.parse(safe.startedAt ?? safe.fetchedAt)) return previous
    return safe
  })
}

export async function readModelCatalog(dataDir: string, providerId: string, expectedIdentity?: string): Promise<ModelCatalogEntry | null> {
  let entry: ModelCatalogEntry | null = null
  try {
    const file = new AtomicJsonFile<ModelCatalogEntry | null>(catalogPath(dataDir, providerId), parseEntry, false)
    entry = await file.read(() => null)
    if (!entry) {
      // The old lossy filename is retained for history only, never current validation.
      const name = providerId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128)
      const legacy = new AtomicJsonFile<ModelCatalogEntry | null>(join(dataDir, 'model-catalog', 'providers', `${name}.json`), parseEntry, false)
      const old = await legacy.read(() => null)
      return old ? { ...old, stale: true, identityChanged: true } : null
    }
  } catch { return null }
  const changed = expectedIdentity !== undefined && entry.identity !== expectedIdentity
  return { ...entry, ...(expectedIdentity !== undefined ? {
    stale: entry.lastAttemptStatus === 'failed' || changed || Date.now() - Date.parse(entry.fetchedAt) > 24 * 60 * 60_000,
    identityChanged: changed
  } : {}) }
}
