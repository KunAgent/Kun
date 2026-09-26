import type { NormalizedThread } from '../agent/types'
import { normalizePath } from '../write/write-workspace-store-helpers'
import {
  readWriteThreadRegistry,
  writeFileKey,
  writeWorkspaceKey,
  type WriteThreadRegistry
} from '../write/write-thread-registry'

/**
 * Agent research sessions: each one is an ordinary Work thread bound to a
 * virtual resource path `<library>/.kun-research/<sessionId>`. The path never
 * exists on disk; it only keys the write-thread registry so selection,
 * sending and history reuse the Work resource → thread machinery.
 */

export const RESEARCH_DIR = '.kun-research'
/** Resource used while the "new research" empty state is shown (never bound). */
export const RESEARCH_DRAFT_SESSION_ID = 'draft'

const SESSION_ID_RE = /^rs-[a-z0-9-]{4,64}$/

export function newResearchSessionId(now = Date.now(), random = Math.random): string {
  return `rs-${now.toString(36)}-${Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0')}`
}

export function isResearchSessionId(value: string | null | undefined): value is string {
  return typeof value === 'string' && SESSION_ID_RE.test(value)
}

export function researchResourcePath(libraryRoot: string, sessionId: string | null | undefined): string {
  const root = normalizePath(libraryRoot).replace(/\/+$/, '')
  const id = isResearchSessionId(sessionId) ? sessionId : RESEARCH_DRAFT_SESSION_ID
  return `${root}/${RESEARCH_DIR}/${id}`
}

/** Session id of a research resource path, or null for any other path. */
export function researchSessionIdFromPath(path: string | null | undefined): string | null {
  const match = normalizePath(path ?? '').match(/\/\.kun-research\/([^/]+)$/)
  return match && isResearchSessionId(match[1]) ? match[1] : null
}

export function isResearchResourcePath(path: string | null | undefined): boolean {
  return /\/\.kun-research\/[^/]+$/.test(normalizePath(path ?? ''))
}

export type ResearchSessionSummary = {
  sessionId: string
  threadId: string
  title: string
  updatedAt: string | null
  status?: string
  latestTurnStatus?: string
}

/**
 * Research sessions of one library, newest first: registry file bindings
 * under `.kun-research/` joined with the live thread list (archived and
 * missing threads are dropped).
 */
export function listResearchSessions(
  libraryRoot: string,
  threads: readonly NormalizedThread[],
  registry: WriteThreadRegistry = readWriteThreadRegistry()
): ResearchSessionSummary[] {
  const record = registry.workspaces[writeWorkspaceKey(libraryRoot)]
  if (!record) return []
  // writeFileKey drops trailing slashes; key the directory, then add one.
  const prefix = `${writeFileKey(`${normalizePath(libraryRoot).replace(/\/+$/, '')}/${RESEARCH_DIR}`)}/`
  const byId = new Map(threads.map((thread) => [thread.id, thread]))
  const out: ResearchSessionSummary[] = []
  for (const [fileKey, threadId] of Object.entries(record.fileThreadIds)) {
    if (!fileKey.startsWith(prefix)) continue
    const sessionId = fileKey.slice(prefix.length)
    if (!isResearchSessionId(sessionId)) continue
    const thread = byId.get(threadId)
    if (!thread || thread.archived === true) continue
    out.push({
      sessionId,
      threadId,
      title: thread.title?.trim() || sessionId,
      updatedAt: thread.updatedAt ?? null,
      ...(thread.status ? { status: thread.status } : {}),
      ...(thread.latestTurnStatus ? { latestTurnStatus: thread.latestTurnStatus } : {})
    })
  }
  return out.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
}

/**
 * All Agent research sessions across every configured library, newest first.
 * Each summary carries its normalized `libraryRoot` so callers can mount the
 * right workspace before opening a session.
 */
export function listResearchSessionsAcrossLibraries(
  libraries: readonly string[],
  threads: readonly NormalizedThread[],
  registry: WriteThreadRegistry = readWriteThreadRegistry()
): Array<ResearchSessionSummary & { libraryRoot: string }> {
  const seen = new Set<string>()
  const out: Array<ResearchSessionSummary & { libraryRoot: string }> = []
  for (const item of libraries) {
    const root = normalizePath(item)
    if (!root || seen.has(root)) continue
    seen.add(root)
    for (const session of listResearchSessions(root, threads, registry)) {
      out.push({ ...session, libraryRoot: root })
    }
  }
  return out.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
}

// ---- last selected session per library (per-viewer convenience) -----------

const LAST_SESSION_KEY = 'kun.paper.research.lastSession'

function readLastSessions(): Record<string, string> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(LAST_SESSION_KEY) ?? '{}') as unknown
    return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export function readLastResearchSession(libraryRoot: string): string | null {
  const value = readLastSessions()[writeWorkspaceKey(libraryRoot)]
  return isResearchSessionId(value) ? value : null
}

export function writeLastResearchSession(libraryRoot: string, sessionId: string | null): void {
  try {
    const all = readLastSessions()
    const key = writeWorkspaceKey(libraryRoot)
    if (!key) return
    if (sessionId) all[key] = sessionId
    else delete all[key]
    window.localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(all))
  } catch {
    // Storage can be unavailable; the list still works without the memory.
  }
}
