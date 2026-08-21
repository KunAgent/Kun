import { browserStorage, type BrowserStorageLike } from './browser-storage'

export const THREAD_RIGHT_PANEL_EXPANSION_KEY =
  'kun.layout.codeRightPanelExpansionByThread.v1'
export const MAX_THREAD_RIGHT_PANEL_EXPANSION_ENTRIES = 500

export type ThreadRightPanelExpansionRegistry = {
  version: 1
  threads: Record<string, boolean>
}

export function emptyThreadRightPanelExpansionRegistry(): ThreadRightPanelExpansionRegistry {
  return { version: 1, threads: {} }
}

function normalizeThreadId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function trimThreadEntries(
  threads: ThreadRightPanelExpansionRegistry['threads']
): ThreadRightPanelExpansionRegistry['threads'] {
  return Object.fromEntries(
    Object.entries(threads).slice(-MAX_THREAD_RIGHT_PANEL_EXPANSION_ENTRIES)
  )
}

export function normalizeThreadRightPanelExpansionRegistry(
  value: unknown
): ThreadRightPanelExpansionRegistry {
  if (!value || typeof value !== 'object') return emptyThreadRightPanelExpansionRegistry()
  const source = value as { version?: unknown; threads?: unknown }
  if (source.version !== 1 || !source.threads || typeof source.threads !== 'object') {
    return emptyThreadRightPanelExpansionRegistry()
  }

  const threads: Record<string, boolean> = {}
  for (const [key, expanded] of Object.entries(source.threads as Record<string, unknown>)) {
    const threadId = normalizeThreadId(key)
    if (!threadId || typeof expanded !== 'boolean') continue
    delete threads[threadId]
    threads[threadId] = expanded
  }
  return { version: 1, threads: trimThreadEntries(threads) }
}

export function readThreadRightPanelExpansionRegistry(
  storage: BrowserStorageLike | null = browserStorage()
): ThreadRightPanelExpansionRegistry {
  if (!storage) return emptyThreadRightPanelExpansionRegistry()
  try {
    const raw = storage.getItem(THREAD_RIGHT_PANEL_EXPANSION_KEY)
    return normalizeThreadRightPanelExpansionRegistry(raw ? JSON.parse(raw) : null)
  } catch {
    return emptyThreadRightPanelExpansionRegistry()
  }
}

export function saveThreadRightPanelExpansionRegistry(
  registry: ThreadRightPanelExpansionRegistry,
  storage: BrowserStorageLike | null = browserStorage()
): void {
  if (!storage) return
  try {
    storage.setItem(
      THREAD_RIGHT_PANEL_EXPANSION_KEY,
      JSON.stringify(normalizeThreadRightPanelExpansionRegistry(registry))
    )
  } catch {
    /* ignore storage failures */
  }
}

export function threadRightPanelExpanded(
  threadId: string | null | undefined,
  registry: ThreadRightPanelExpansionRegistry = readThreadRightPanelExpansionRegistry()
): boolean {
  const id = normalizeThreadId(threadId)
  return id ? registry.threads[id] === true : false
}

export function rememberThreadRightPanelExpansion(
  threadId: string,
  expanded: boolean,
  registry: ThreadRightPanelExpansionRegistry = readThreadRightPanelExpansionRegistry()
): ThreadRightPanelExpansionRegistry {
  const id = normalizeThreadId(threadId)
  if (!id) return normalizeThreadRightPanelExpansionRegistry(registry)
  const threads = { ...registry.threads }
  delete threads[id]
  threads[id] = expanded
  return normalizeThreadRightPanelExpansionRegistry({ version: 1, threads })
}

export function forgetThreadRightPanelExpansion(
  threadId: string,
  registry: ThreadRightPanelExpansionRegistry = readThreadRightPanelExpansionRegistry()
): ThreadRightPanelExpansionRegistry {
  const id = normalizeThreadId(threadId)
  if (!id || !(id in registry.threads)) {
    return normalizeThreadRightPanelExpansionRegistry(registry)
  }
  const threads = { ...registry.threads }
  delete threads[id]
  return normalizeThreadRightPanelExpansionRegistry({ version: 1, threads })
}

export function forgetStoredThreadRightPanelExpansion(
  threadId: string,
  storage: BrowserStorageLike | null = browserStorage()
): void {
  if (!storage) return
  saveThreadRightPanelExpansionRegistry(
    forgetThreadRightPanelExpansion(threadId, readThreadRightPanelExpansionRegistry(storage)),
    storage
  )
}
