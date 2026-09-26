import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * On-disk cache of the most recently discovered model list per provider
 * (`<dataDir>/model-catalog/providers/<id>.json`). Both the GUI and the TUI
 * read it to render "enabled N / available M · fetched X ago" without a
 * live probe. Writes are best-effort — a cache failure must never fail a
 * successful probe.
 */
export type ModelCatalogEntry = {
  fetchedAt: string
  baseUrl?: string
  endpointFormat?: string
  models: string[]
}

function catalogPath(dataDir: string, providerId: string): string {
  // Provider ids are normalized to a safe file name; they originate from
  // profile ids which are already slug-safe, but never trust that here.
  const safe = providerId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128)
  return join(dataDir, 'model-catalog', 'providers', `${safe}.json`)
}

export async function writeModelCatalog(
  dataDir: string,
  providerId: string,
  entry: ModelCatalogEntry
): Promise<void> {
  const path = catalogPath(dataDir, providerId)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, JSON.stringify(entry), 'utf8')
}

export async function readModelCatalog(
  dataDir: string,
  providerId: string
): Promise<ModelCatalogEntry | null> {
  try {
    const raw = await readFile(catalogPath(dataDir, providerId), 'utf8')
    const parsed = JSON.parse(raw) as Partial<ModelCatalogEntry>
    if (!parsed || typeof parsed.fetchedAt !== 'string' || !Array.isArray(parsed.models)) {
      return null
    }
    return {
      fetchedAt: parsed.fetchedAt,
      ...(typeof parsed.baseUrl === 'string' ? { baseUrl: parsed.baseUrl } : {}),
      ...(typeof parsed.endpointFormat === 'string' ? { endpointFormat: parsed.endpointFormat } : {}),
      models: parsed.models.filter((m): m is string => typeof m === 'string')
    }
  } catch {
    return null
  }
}
