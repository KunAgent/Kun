const STORAGE_KEY = 'kun.colab.kunThreads.v1'
const MAX_REMEMBERED = 200

/**
 * Threads started or picked from the Colab Kun pane. The pane only shows the
 * global active thread when it is one of these, so an unrelated Code-mode
 * conversation never appears (or receives notebook turns) in the sidebar.
 */
export function readColabKunThreadIds(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function rememberColabKunThread(threadId: string): string[] {
  const next = [threadId, ...readColabKunThreadIds().filter((id) => id !== threadId)].slice(0, MAX_REMEMBERED)
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage may be unavailable; the in-memory list still scopes this session.
  }
  return next
}
