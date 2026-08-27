import { setBrowserStorageMutationObserver } from './browser-storage'
import {
  SHARED_BUSINESS_KEYS,
  changedSharedKeys,
  readSharedBusinessStorageJournal,
  readSharedLocalEntries,
  sharedEntriesFrom,
  updateJournalForMutation,
  writeSharedBusinessStorageJournal,
  type SharedBusinessStorageJournal,
  type SharedEntries
} from './shared-business-storage-journal'

type SharedClientStateSnapshot = {
  revision: number
  value: SharedEntries
}

type SharedClientStateApi = {
  read: () => Promise<SharedClientStateSnapshot>
  write: (revision: number, value: SharedEntries) => Promise<SharedClientStateSnapshot>
}

export type SharedBusinessStorageCursor = {
  baseline: SharedEntries
  revision: number
}

export type SharedBusinessStorageSyncResult = SharedBusinessStorageCursor & {
  retry: boolean
}

const POLL_INTERVAL_MS = 1_000
const INITIAL_READ_ATTEMPTS = 3
const INITIAL_READ_RETRY_DELAY_MS = 300
const UNLOAD_FLUSH_DEADLINE_MS = 250

let installPromise: Promise<void> | null = null
let installedCleanup: (() => void) | null = null
let activeFlush: (() => Promise<void>) | null = null

export function resetSharedBusinessStorageInstallForTests(): void {
  installedCleanup?.()
  installedCleanup = null
  activeFlush = null
  installPromise = null
  setBrowserStorageMutationObserver(null)
}

export function flushSharedBusinessStorage(): Promise<void> {
  return activeFlush?.() ?? Promise.resolve()
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

async function readInitialSnapshot(api: SharedClientStateApi): Promise<SharedClientStateSnapshot> {
  let lastError: unknown
  for (let attempt = 0; attempt < INITIAL_READ_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await delay(INITIAL_READ_RETRY_DELAY_MS)
    try {
      return await api.read()
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export async function installSharedBusinessStorage(): Promise<void> {
  if (installPromise) return installPromise
  const promise = doInstallSharedBusinessStorage()
  installPromise = promise
  try {
    await promise
  } catch (error) {
    if (installPromise === promise) installPromise = null
    throw error
  }
}

async function doInstallSharedBusinessStorage(): Promise<void> {
  const api = window.kunGui?.sharedClientState
  if (!api || typeof localStorage === 'undefined') return

  setBrowserStorageMutationObserver(updateJournalForMutation)
  const localAtStartup = readSharedLocalEntries()
  let snapshot = await readInitialSnapshot(api)
  let journal = readSharedBusinessStorageJournal()
  if (!journal) {
    const dirtyKeys = SHARED_BUSINESS_KEYS.filter((key) =>
      localAtStartup[key] !== undefined && localAtStartup[key] !== snapshot.value[key]
    )
    journal = {
      version: 1,
      acknowledgedRevision: snapshot.revision,
      acknowledgedEntries: sharedEntriesFrom(snapshot.value),
      dirtyKeys
    }
    writeSharedBusinessStorageJournal(journal)
  }

  const startupDirty = new Set([
    ...journal.dirtyKeys,
    ...changedSharedKeys(journal.acknowledgedEntries, localAtStartup)
  ])
  applyEntries(snapshot.value, startupDirty)
  let baseline = journal.acknowledgedEntries
  let revision = journal.acknowledgedRevision
  let syncing: Promise<void> | null = null

  const sync = (allowImmediateRetry = true): Promise<void> => {
    if (syncing) return syncing
    let retry = false
    const current = (async () => {
      try {
        const result = await syncSharedBusinessStorageOnce(api, { baseline, revision })
        baseline = result.baseline
        revision = result.revision
        retry = result.retry
      } catch {
        // Keep the profile-local mirror and durable journal intact for retry.
      }
    })()
    syncing = current
    void current.finally(() => {
      if (syncing === current) syncing = null
      if (retry && allowImmediateRetry) queueMicrotask(() => void sync(false))
    })
    return current
  }
  activeFlush = sync

  if (startupDirty.size > 0) await sync()
  else {
    baseline = sharedEntriesFrom(snapshot.value)
    revision = snapshot.revision
    persistAcknowledgement(snapshot, readSharedLocalEntries())
  }

  const timer = window.setInterval(() => void sync(), POLL_INTERVAL_MS)
  const handleUnload = (): void => {
    window.clearInterval(timer)
    persistDirtyAgainstAcknowledgement()
    void Promise.race([sync(), delay(UNLOAD_FLUSH_DEADLINE_MS)])
  }
  window.addEventListener('beforeunload', handleUnload, { once: true })
  window.addEventListener('pagehide', handleUnload, { once: true })
  installedCleanup = () => {
    window.clearInterval(timer)
    window.removeEventListener('beforeunload', handleUnload)
    window.removeEventListener('pagehide', handleUnload)
  }
}

export async function syncSharedBusinessStorageOnce(
  api: SharedClientStateApi,
  cursor: SharedBusinessStorageCursor
): Promise<SharedBusinessStorageSyncResult> {
  let remote = await api.read()
  const journal = readSharedBusinessStorageJournal()
  const acknowledged = journal?.acknowledgedEntries ?? cursor.baseline
  let localSnapshot = readSharedLocalEntries()
  let pendingKeys = new Set([
    ...(journal?.dirtyKeys ?? []),
    ...changedSharedKeys(acknowledged, localSnapshot)
  ])
  let submittedLocal = localSnapshot
  let wrotePendingKeys = false

  if (pendingKeys.size > 0) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      localSnapshot = readSharedLocalEntries()
      pendingKeys = new Set([
        ...(readSharedBusinessStorageJournal()?.dirtyKeys ?? []),
        ...changedSharedKeys(acknowledged, localSnapshot)
      ])
      if (pendingKeys.size === 0) break
      submittedLocal = localSnapshot
      const merged = { ...remote.value }
      for (const key of pendingKeys) {
        const value = submittedLocal[key]
        if (value === undefined) delete merged[key]
        else merged[key] = value
      }
      try {
        remote = await api.write(remote.revision, merged)
        wrotePendingKeys = true
        break
      } catch {
        remote = await api.read()
      }
    }
  }

  const latestLocal = readSharedLocalEntries()
  const protectedKeys = new Set(changedSharedKeys(submittedLocal, latestLocal))
  if (pendingKeys.size > 0 && !wrotePendingKeys) {
    for (const key of pendingKeys) protectedKeys.add(key)
  }
  applyEntries(remote.value, protectedKeys)
  const afterApply = readSharedLocalEntries()
  const remainingDirty = new Set(changedSharedKeys(remote.value, afterApply))
  for (const key of protectedKeys) remainingDirty.add(key)
  writeSharedBusinessStorageJournal({
    version: 1,
    acknowledgedRevision: remote.revision,
    acknowledgedEntries: sharedEntriesFrom(remote.value),
    dirtyKeys: [...remainingDirty]
  })
  return {
    baseline: sharedEntriesFrom(remote.value),
    revision: remote.revision,
    retry: remainingDirty.size > 0
  }
}

function persistAcknowledgement(snapshot: SharedClientStateSnapshot, local: SharedEntries): void {
  writeSharedBusinessStorageJournal({
    version: 1,
    acknowledgedRevision: snapshot.revision,
    acknowledgedEntries: sharedEntriesFrom(snapshot.value),
    dirtyKeys: changedSharedKeys(snapshot.value, local)
  })
}

function persistDirtyAgainstAcknowledgement(): void {
  const journal = readSharedBusinessStorageJournal()
  if (!journal) return
  writeSharedBusinessStorageJournal({
    ...journal,
    dirtyKeys: [...new Set([
      ...journal.dirtyKeys,
      ...changedSharedKeys(journal.acknowledgedEntries, readSharedLocalEntries())
    ])]
  })
}

function applyEntries(entries: SharedEntries, protectedKeys: ReadonlySet<string> = new Set()): void {
  for (const key of SHARED_BUSINESS_KEYS) {
    if (protectedKeys.has(key)) continue
    const next = entries[key]
    const previous = localStorage.getItem(key)
    if (next === undefined) {
      if (previous !== null) localStorage.removeItem(key)
    } else if (previous !== next) {
      localStorage.setItem(key, next)
    }
  }
}
