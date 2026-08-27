import type { BrowserStorageMutation } from './browser-storage'

export const SHARED_BUSINESS_KEYS = [
  'kun.codeWorkspaceRoots.v1',
  'kun.write.threadRegistry.v1',
  'kun.design.threadRegistry.v1',
  'kun.design-assistant.threadRegistry.v1',
  'kun.threadWorktrees.v1',
  'kun.threadForks.v1',
  'kun.sdd.threadRegistry.v1',
  'kun.plan.registry.v1'
] as const

export type SharedEntries = Record<string, string>

export type SharedBusinessStorageJournal = {
  version: 1
  acknowledgedRevision: number
  acknowledgedEntries: SharedEntries
  dirtyKeys: string[]
}

export const SHARED_BUSINESS_STORAGE_JOURNAL_KEY = 'kun.sharedBusinessStorageSync.v1'

const sharedKeySet = new Set<string>(SHARED_BUSINESS_KEYS)

export function isSharedBusinessKey(key: string): boolean {
  return sharedKeySet.has(key)
}

export function readSharedBusinessStorageJournal(): SharedBusinessStorageJournal | null {
  try {
    const raw = localStorage.getItem(SHARED_BUSINESS_STORAGE_JOURNAL_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const value = parsed as Record<string, unknown>
    if (value.version !== 1 || !Number.isInteger(value.acknowledgedRevision) ||
      (value.acknowledgedRevision as number) < 0) return null
    const acknowledgedEntries = sharedEntriesFrom(value.acknowledgedEntries)
    const dirtyKeys = Array.isArray(value.dirtyKeys)
      ? [...new Set(value.dirtyKeys.filter(
          (key): key is string => typeof key === 'string' && isSharedBusinessKey(key)
        ))]
      : []
    return {
      version: 1,
      acknowledgedRevision: value.acknowledgedRevision as number,
      acknowledgedEntries,
      dirtyKeys
    }
  } catch {
    return null
  }
}

export function writeSharedBusinessStorageJournal(
  journal: SharedBusinessStorageJournal
): void {
  try {
    localStorage.setItem(SHARED_BUSINESS_STORAGE_JOURNAL_KEY, JSON.stringify({
      version: 1,
      acknowledgedRevision: Math.max(0, Math.floor(journal.acknowledgedRevision)),
      acknowledgedEntries: sharedEntriesFrom(journal.acknowledgedEntries),
      dirtyKeys: [...new Set(journal.dirtyKeys.filter(isSharedBusinessKey))]
    }))
  } catch {
    // Business values remain authoritative even if journal persistence is unavailable.
  }
}

export function updateJournalForMutation(mutation: BrowserStorageMutation): void {
  if (!isSharedBusinessKey(mutation.key)) return
  const journal = readSharedBusinessStorageJournal()
  if (!journal) return
  const acknowledged = journal.acknowledgedEntries[mutation.key]
  const dirtyKeys = new Set(journal.dirtyKeys)
  if (acknowledged === mutation.value || (acknowledged === undefined && mutation.value === null)) {
    dirtyKeys.delete(mutation.key)
  } else {
    dirtyKeys.add(mutation.key)
  }
  writeSharedBusinessStorageJournal({ ...journal, dirtyKeys: [...dirtyKeys] })
}

export function readSharedLocalEntries(): SharedEntries {
  const entries: SharedEntries = {}
  for (const key of SHARED_BUSINESS_KEYS) {
    const value = localStorage.getItem(key)
    if (value !== null) entries[key] = value
  }
  return entries
}

export function sharedEntriesFrom(value: unknown): SharedEntries {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const entries: SharedEntries = {}
  for (const key of SHARED_BUSINESS_KEYS) {
    if (typeof source[key] === 'string') entries[key] = source[key]
  }
  return entries
}

export function changedSharedKeys(previous: SharedEntries, current: SharedEntries): string[] {
  return SHARED_BUSINESS_KEYS.filter((key) => previous[key] !== current[key])
}
