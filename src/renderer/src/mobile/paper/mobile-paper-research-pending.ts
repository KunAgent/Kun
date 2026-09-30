import { isResearchSessionId } from '../../paper/paper-research-sessions'
import { normalizePath } from '../../write/write-workspace-store-helpers'

const STORAGE_KEY = 'kun.mobile.paper.pending-research'
const MAX_PENDING = 20

function readAll(): Record<string, string[]> {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return value as Record<string, string[]>
  } catch { return {} }
}

export function readPendingResearchSessions(root: string): string[] {
  const value = readAll()[normalizePath(root)]
  return Array.isArray(value) ? value.filter(isResearchSessionId).slice(0, MAX_PENDING) : []
}

export function rememberPendingResearchSession(root: string, sessionId: string): void {
  const key = normalizePath(root)
  if (!key || !isResearchSessionId(sessionId)) return
  try {
    const all = readAll()
    all[key] = [sessionId, ...readPendingResearchSessions(key).filter((id) => id !== sessionId)].slice(0, MAX_PENDING)
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch { /* private mode */ }
}

export function forgetPendingResearchSession(root: string, sessionId: string): void {
  const key = normalizePath(root)
  if (!key) return
  try {
    const all = readAll()
    all[key] = readPendingResearchSessions(key).filter((id) => id !== sessionId)
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch { /* private mode */ }
}
