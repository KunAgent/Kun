import { useEffect, useMemo, useReducer } from 'react'
import { SHARED_BUSINESS_STORAGE_CHANGED_EVENT } from './shared-business-storage'
import { browserStorage, type BrowserStorageLike } from './browser-storage'
import {
  readThreadWorktreeRegistry,
  THREAD_WORKTREE_REGISTRY_KEY,
  type ThreadWorktreeRegistry
} from './thread-worktree-registry'
import {
  readWriteThreadRegistry,
  WRITE_THREAD_REGISTRY_KEY,
  type WriteThreadRegistry
} from '../write/write-thread-registry'
import {
  readDesignThreadRegistry,
  DESIGN_THREAD_REGISTRY_KEY,
  LEGACY_DESIGN_ASSISTANT_THREAD_REGISTRY_KEY,
  type DesignThreadRegistry
} from '../design/design-thread-registry'
import {
  readSddThreadRegistry,
  SDD_THREAD_REGISTRY_KEY,
  type SddThreadRegistry
} from '../sdd/sdd-thread-registry'

export type ThreadClassificationRegistries = {
  threadWorktrees: ThreadWorktreeRegistry['worktrees']
  writeRegistry: WriteThreadRegistry
  designRegistry: DesignThreadRegistry
  sddRegistry: SddThreadRegistry
}

type CacheEntry = {
  fingerprint: string
  storage: BrowserStorageLike | null
  value: unknown
}

const parsedCache = new Map<string, CacheEntry>()
let assembled: {
  parts: readonly unknown[]
  value: ThreadClassificationRegistries
} | null = null

function fingerprintKeys(storage: BrowserStorageLike | null, keys: readonly string[]): string | null {
  if (!storage) return ''
  try {
    return keys.map((key) => storage.getItem(key) ?? '').join('\u0000')
  } catch {
    // Unreadable storage must not poison the cache — re-read every time.
    return null
  }
}

function readCachedRegistry<T>(
  name: string,
  keys: readonly string[],
  read: (storage: BrowserStorageLike | null) => T,
  storage: BrowserStorageLike | null
): T {
  const fingerprint = fingerprintKeys(storage, keys)
  const hit = fingerprint === null ? undefined : parsedCache.get(name)
  if (hit && hit.fingerprint === fingerprint && hit.storage === storage) return hit.value as T
  const value = read(storage)
  if (fingerprint !== null) parsedCache.set(name, { fingerprint, storage, value })
  return value
}

/**
 * Read the four thread-classification registries once, keyed by their raw
 * storage strings. A `getItem` costs far less than `JSON.parse` + normalize,
 * so thread-list churn re-checks the fingerprint but skips re-parsing — and
 * the returned object keeps identity while the stored values are unchanged.
 */
export function readThreadClassificationRegistries(
  storage: BrowserStorageLike | null = browserStorage()
): ThreadClassificationRegistries {
  const threadWorktrees = readCachedRegistry(
    'worktrees', [THREAD_WORKTREE_REGISTRY_KEY],
    (s) => readThreadWorktreeRegistry(s).worktrees, storage
  )
  const writeRegistry = readCachedRegistry(
    'write', [WRITE_THREAD_REGISTRY_KEY], readWriteThreadRegistry, storage
  )
  // The design reader merges a legacy key on first read, so both keys take
  // part in the fingerprint.
  const designRegistry = readCachedRegistry(
    'design', [DESIGN_THREAD_REGISTRY_KEY, LEGACY_DESIGN_ASSISTANT_THREAD_REGISTRY_KEY],
    readDesignThreadRegistry, storage
  )
  const sddRegistry = readCachedRegistry(
    'sdd', [SDD_THREAD_REGISTRY_KEY], readSddThreadRegistry, storage
  )
  const parts = [threadWorktrees, writeRegistry, designRegistry, sddRegistry] as const
  if (assembled && assembled.parts.every((part, index) => part === parts[index])) {
    return assembled.value
  }
  const value: ThreadClassificationRegistries = {
    threadWorktrees, writeRegistry, designRegistry, sddRegistry
  }
  assembled = { parts, value }
  return value
}

/**
 * The classification registries live in profile storage, outside the chat
 * store. `trigger` (usually the thread list) decides when to re-check the raw
 * storage; the parsed registries stay identity-stable until their stored
 * values actually change, so memoized consumers do not re-run on every
 * unrelated thread update.
 */
export function useThreadClassificationRegistries(
  trigger: unknown
): ThreadClassificationRegistries {
  // Registry edits synced from another client (desktop reclassifying a thread,
  // a new worktree record) need not change the thread list, so the shared
  // storage change event also re-checks the stored strings.
  const [storageRevision, bumpStorageRevision] = useReducer((value: number) => value + 1, 0)
  useEffect(() => {
    const onChange = (): void => bumpStorageRevision()
    window.addEventListener(SHARED_BUSINESS_STORAGE_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(SHARED_BUSINESS_STORAGE_CHANGED_EVENT, onChange)
  }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => readThreadClassificationRegistries(), [trigger, storageRevision])
}

/** Test hook: drop the raw-string caches between cases. */
export function resetThreadClassificationRegistriesForTests(): void {
  parsedCache.clear()
  assembled = null
}
