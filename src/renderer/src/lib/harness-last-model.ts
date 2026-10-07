import { readBrowserStorageItem, writeBrowserStorageItem } from './browser-storage'

const HARNESS_LAST_MODEL_STORAGE_KEY = 'kun.harnessLastModel.v1'
const MAX_HARNESS_LAST_MODELS = 100

export type HarnessLastModel = { model: string; providerId: string }
type HarnessLastModelMap = Record<string, HarnessLastModel>

function storageKey(harnessId: string, credentialMode: string): string {
  return `${harnessId.trim()}\u0000${credentialMode.trim()}`
}

function loadMap(): HarnessLastModelMap {
  try {
    const parsed: unknown = JSON.parse(readBrowserStorageItem(HARNESS_LAST_MODEL_STORAGE_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const map: HarnessLastModelMap = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = value as Partial<HarnessLastModel> | null
      if (entry && typeof entry.model === 'string' && entry.model.trim()) {
        map[key] = { model: entry.model, providerId: typeof entry.providerId === 'string' ? entry.providerId : '' }
      }
    }
    return map
  } catch {
    return {}
  }
}

/** The model the user last picked for this external Agent and credential path. */
export function readHarnessLastModel(harnessId: string, credentialMode: string): HarnessLastModel | undefined {
  if (!harnessId.trim() || harnessId === 'kun') return undefined
  return loadMap()[storageKey(harnessId, credentialMode)]
}

/** Remember an explicit picker choice so new drafts reopen on the same model. */
export function rememberHarnessLastModel(
  harnessId: string, credentialMode: string, model: string, providerId: string
): void {
  const trimmed = model.trim()
  if (!harnessId.trim() || harnessId === 'kun' || !trimmed) return
  const map = loadMap()
  const key = storageKey(harnessId, credentialMode)
  delete map[key]
  map[key] = { model: trimmed, providerId: providerId.trim() }
  const keys = Object.keys(map)
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_HARNESS_LAST_MODELS))) delete map[stale]
  writeBrowserStorageItem(HARNESS_LAST_MODEL_STORAGE_KEY, JSON.stringify(map))
}
