import type { NormalizedThread } from '../agent/types'
import {
  isWriteAssistantThread,
  WRITE_ASSISTANT_THREAD_TITLE,
  writeFileKey,
  writeWorkspaceForThreadId,
  writeWorkspaceKey,
  type WriteThreadRegistry
} from './write-thread-registry'
import { WRITE_CONTEXT_HEADING } from './quoted-selection'
import { researchSessionIdFromPath } from '../paper/paper-research-sessions'

/** What a Work session is attached to; opening the session opens it too. */
export type WorkSessionAnchor =
  | { kind: 'space' }
  | { kind: 'file'; path: string }
  | { kind: 'whiteboard'; boardId: string }
  | { kind: 'paper'; path: string }
  | { kind: 'research'; sessionId: string }

export type WorkSessionEntry = {
  id: string
  /** '' when the thread still has its placeholder title. */
  title: string
  updatedAt: string | null
  anchor: WorkSessionAnchor
}

export type WorkSessionBoard = { id: string; workspaceRoot: string; threadIds: string[] }

function updatedMs(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : 0
}

/** A placeholder title means the backend titler has not named the session yet. */
export function workSessionDisplayTitle(title: string | undefined): string {
  const trimmed = title?.trim() ?? ''
  if (!trimmed || trimmed === WRITE_ASSISTANT_THREAD_TITLE || trimmed.startsWith(WRITE_CONTEXT_HEADING)) return ''
  return trimmed
}

/** thread id → resource path, preferring the resource whose active thread it is. */
export function workSessionResourceIndex(
  registry: WriteThreadRegistry,
  workspaceRoot: string
): Map<string, string> {
  const record = registry.workspaces[writeWorkspaceKey(workspaceRoot)]
  const index = new Map<string, string>()
  if (!record) return index
  for (const [fileKey, threadId] of Object.entries(record.fileThreadIds)) {
    if (!index.has(threadId)) index.set(threadId, fileKey)
  }
  for (const [fileKey, threadIds] of Object.entries(record.fileThreadHistoryIds)) {
    for (const threadId of threadIds) if (!index.has(threadId)) index.set(threadId, fileKey)
  }
  return index
}

function hasFileExtension(path: string): boolean {
  const name = path.split('/').pop() ?? ''
  return /\.[A-Za-z0-9]{1,8}$/.test(name)
}

function anchorFor(input: {
  threadId: string
  resources: Map<string, string>
  boards: readonly WorkSessionBoard[]
}): WorkSessionAnchor {
  const board = input.boards.find((candidate) => candidate.threadIds.includes(input.threadId))
  if (board) return { kind: 'whiteboard', boardId: board.id }
  const path = input.resources.get(input.threadId)
  if (!path) return { kind: 'space' }
  const research = researchSessionIdFromPath(path)
  if (research) return { kind: 'research', sessionId: research }
  // Paper sessions are keyed by the unit directory, documents by the file.
  if (!hasFileExtension(path)) return { kind: 'paper', path }
  return { kind: 'file', path }
}

function belongsTo(thread: NormalizedThread, root: string, registry: WriteThreadRegistry): boolean {
  const registered = writeWorkspaceForThreadId(thread.id, registry)
  return writeWorkspaceKey(registered || thread.workspace) === writeWorkspaceKey(root)
}

/** The Work sessions of one space, newest first. */
export function buildWorkSessions(input: {
  root: string
  threads: readonly NormalizedThread[]
  registry: WriteThreadRegistry
  boards?: readonly WorkSessionBoard[]
  query?: string
}): WorkSessionEntry[] {
  const key = writeWorkspaceKey(input.root)
  if (!key) return []
  const query = input.query?.trim().toLocaleLowerCase() ?? ''
  const resources = workSessionResourceIndex(input.registry, input.root)
  const boards = (input.boards ?? []).filter((board) => writeWorkspaceKey(board.workspaceRoot) === key)
  const seen = new Set<string>()
  return input.threads
    .filter((thread) =>
      thread.archived !== true &&
      thread.relation !== 'side' &&
      !thread.executionUnit &&
      isWriteAssistantThread(thread, input.registry) &&
      belongsTo(thread, input.root, input.registry))
    .filter((thread) => (seen.has(thread.id) ? false : (seen.add(thread.id), true)))
    .sort((left, right) => updatedMs(right.updatedAt) - updatedMs(left.updatedAt))
    .map((thread): WorkSessionEntry => ({
      id: thread.id,
      title: workSessionDisplayTitle(thread.title),
      updatedAt: thread.updatedAt || null,
      anchor: anchorFor({ threadId: thread.id, resources, boards })
    }))
    .filter((session) => !query || session.title.toLocaleLowerCase().includes(query) ||
      ('path' in session.anchor && writeFileKey(session.anchor.path).toLocaleLowerCase().includes(query)))
}
