import type {
  AppRoute,
  ChatState,
  CompletionAttentionRegistry,
  ThreadCompletionOutcome
} from './chat-store-types'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'

export const UNREAD_COMPLETIONS_STORAGE_KEY = 'kun.unreadCompletions.v2'
export const LEGACY_UNREAD_COMPLETIONS_STORAGE_KEY = 'kun.unreadCompletions.v1'
export const MAX_UNREAD_COMPLETION_IDS = 1_000

type CompletionVisibilityState = Pick<
  ChatState,
  'route' | 'activeThreadId' | 'sideConversations' | 'sidePanel'
>

export type DocumentAttention = {
  visible: boolean
  focused: boolean
}

function normalizedThreadId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizedOutcome(value: unknown): ThreadCompletionOutcome | null {
  if (value === true || value === 'completed') return 'completed'
  if (value === 'failed') return 'failed'
  return null
}

function completionEntries(value: unknown): Array<[unknown, unknown]> {
  if (Array.isArray(value)) return value.map((id) => [id, 'completed'])
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  if (record.outcomes && typeof record.outcomes === 'object' && !Array.isArray(record.outcomes)) {
    return Object.entries(record.outcomes as Record<string, unknown>)
  }
  if (Array.isArray(record.ids)) return record.ids.map((id) => [id, 'completed'])
  return Object.entries(record)
}

export function normalizeUnreadCompletions(value: unknown): CompletionAttentionRegistry {
  const normalized: CompletionAttentionRegistry = {}
  for (const [candidate, rawOutcome] of completionEntries(value)) {
    const threadId = normalizedThreadId(candidate)
    const outcome = normalizedOutcome(rawOutcome)
    if (!threadId || !outcome) continue
    if (normalized[threadId] === 'failed' && outcome === 'completed') continue
    normalized[threadId] = outcome
    if (Object.keys(normalized).length >= MAX_UNREAD_COMPLETION_IDS) break
  }
  return normalized
}

export function readUnreadCompletions(): CompletionAttentionRegistry {
  const candidates = [
    readBrowserStorageItem(UNREAD_COMPLETIONS_STORAGE_KEY),
    readBrowserStorageItem(LEGACY_UNREAD_COMPLETIONS_STORAGE_KEY)
  ]
  for (const raw of candidates) {
    if (!raw) continue
    try {
      return normalizeUnreadCompletions(JSON.parse(raw))
    } catch {
      // A damaged v2 record must not prevent recovery from the legacy v1 list.
    }
  }
  return {}
}

export function persistUnreadCompletions(value: unknown): CompletionAttentionRegistry {
  const normalized = normalizeUnreadCompletions(value)
  writeBrowserStorageItem(
    UNREAD_COMPLETIONS_STORAGE_KEY,
    JSON.stringify({ version: 2, outcomes: normalized })
  )
  return normalized
}

export function unreadCompletionCount(value: unknown): number {
  return Object.keys(normalizeUnreadCompletions(value)).length
}

export function markUnreadCompletion(
  registry: CompletionAttentionRegistry,
  threadId: string,
  outcome: ThreadCompletionOutcome = 'completed'
): CompletionAttentionRegistry {
  const normalized = normalizedThreadId(threadId)
  const current = completionAttentionForThread(registry, normalized)
  if (!normalized || current === outcome || (current === 'failed' && outcome === 'completed')) return registry
  return normalizeUnreadCompletions({ ...registry, [normalized]: outcome })
}

export function clearUnreadCompletion(
  registry: CompletionAttentionRegistry,
  threadId: string
): CompletionAttentionRegistry {
  const normalized = normalizedThreadId(threadId)
  if (!normalized || !completionAttentionForThread(registry, normalized)) return registry
  const next = { ...registry }
  delete next[normalized]
  return normalizeUnreadCompletions(next)
}

export function retainUnreadCompletions(
  registry: CompletionAttentionRegistry,
  validThreadIds: Iterable<string>
): CompletionAttentionRegistry {
  const valid = new Set([...validThreadIds].map(normalizedThreadId).filter(Boolean))
  const next: CompletionAttentionRegistry = {}
  let changed = false
  for (const [threadId, unread] of Object.entries(registry)) {
    const outcome = normalizedOutcome(unread)
    if (outcome && valid.has(threadId)) next[threadId] = outcome
    else changed = true
  }
  return changed ? next : registry
}

export function currentDocumentAttention(): DocumentAttention {
  if (typeof document === 'undefined') return { visible: false, focused: false }
  return {
    visible: document.visibilityState === 'visible',
    focused: typeof document.hasFocus === 'function' && document.hasFocus()
  }
}

function mainConversationRouteIsVisible(route: AppRoute): boolean {
  return route === 'chat' || route === 'claw'
}

export function completionIsCurrentlyVisible(
  state: CompletionVisibilityState,
  threadId: string,
  attention: DocumentAttention = currentDocumentAttention()
): boolean {
  const normalized = normalizedThreadId(threadId)
  if (!normalized || !attention.visible || !attention.focused) return false
  if (state.sideConversations[normalized]) {
    return state.route === 'chat' &&
      state.sidePanel.open &&
      state.sidePanel.activeSideId === normalized
  }
  return mainConversationRouteIsVisible(state.route) && state.activeThreadId === normalized
}

export function clearCurrentlyVisibleUnreadCompletions(
  registry: CompletionAttentionRegistry,
  state: CompletionVisibilityState,
  attention: DocumentAttention = currentDocumentAttention()
): CompletionAttentionRegistry {
  if (!attention.visible || !attention.focused) return registry
  let next = registry
  if (state.activeThreadId && completionIsCurrentlyVisible(state, state.activeThreadId, attention)) {
    next = clearUnreadCompletion(next, state.activeThreadId)
  }
  const activeSideId = state.sidePanel.activeSideId
  if (activeSideId && completionIsCurrentlyVisible(state, activeSideId, attention)) {
    next = clearUnreadCompletion(next, activeSideId)
  }
  return next
}

export function completionAttentionForThread(
  registry: CompletionAttentionRegistry,
  threadId: string
): ThreadCompletionOutcome | null {
  return normalizedOutcome(registry[normalizedThreadId(threadId)])
}

export function completionOutcomeForTurnStatus(
  status: string | null | undefined
): ThreadCompletionOutcome | null {
  const normalized = status?.trim().toLowerCase()
  if (normalized === 'failed' || normalized === 'error') return 'failed'
  if (normalized === 'completed' || normalized === 'success') return 'completed'
  return null
}
