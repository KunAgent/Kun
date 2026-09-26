import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { TurnItem } from '../contracts/items.js'
import type { RuntimeEventObserver } from '../services/runtime-event-recorder.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { TaskWorkspaceService } from '../workspace-tasks/task-workspace-service.js'
import type { FileTeamStore } from './team-store.js'
import type { FileDispatchStore } from './dispatch-store.js'
import { lineHashesFor, type AttributionLedger } from './attribution-ledger.js'

/**
 * Ledger feed (docs/ade/11 §6.1): watches `item_created` events for
 * file-change tool items across every runtime — Kun `write`/`edit` args,
 * ACP `fs/write_text_file` + tool-call `diff` content, and Claude/Cursor
 * SDK edit-tool arguments (their new-text fragments).
 *
 * Recording at tool_call time is safe on failure: the ledger only stores
 * line hashes, and `attribute()` matches against the file's real content —
 * lines a failed write never produced simply match nothing.
 */
export type AttributionObserverDeps = {
  ledger: Pick<AttributionLedger, 'record'>
  taskWorkspaces: Pick<TaskWorkspaceService, 'list'>
  threads: Pick<ThreadStore, 'get'>
  /** Worker dispatch context for the "dispatch dsp_…" hover; optional. */
  teams?: Pick<FileTeamStore, 'list'>
  dispatches?: Pick<FileDispatchStore, 'listByWorker'>
  nowIso: () => string
}

type WriteFragment = { path?: string; text: string }

const PATH_KEYS = ['path', 'file_path', 'filePath', 'notebook_path', 'filename', 'target_file']
const TEXT_KEYS = ['content', 'new_string', 'newText', 'newSource', 'new_source']
const EDIT_LIST_KEYS = ['edits', 'changes']

function stringsOf(value: unknown, keys: readonly string[]): string[] {
  if (typeof value !== 'object' || value === null) return []
  const record = value as Record<string, unknown>
  return keys
    .map((key) => record[key])
    .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
}

/** New-text fragments a tool item writes, keyed per file path when known. */
export function writeFragmentsFromItem(item: TurnItem): WriteFragment[] {
  if (item.kind === 'tool_call' && item.toolKind === 'file_change') {
    const args = item.arguments
    const path = stringsOf(args, PATH_KEYS)[0]
    const fragments = stringsOf(args, TEXT_KEYS).map((text) => ({ path, text }))
    for (const key of EDIT_LIST_KEYS) {
      const list = args[key]
      if (!Array.isArray(list)) continue
      for (const edit of list) {
        for (const text of stringsOf(edit, TEXT_KEYS)) fragments.push({ path, text })
      }
    }
    return fragments
  }
  if (item.kind === 'tool_result') {
    const output = item.output
    const diffs = typeof output === 'object' && output !== null
      ? (output as { diffs?: unknown }).diffs
      : undefined
    if (!Array.isArray(diffs)) return []
    const fragments: WriteFragment[] = []
    for (const diff of diffs) {
      const record = typeof diff === 'object' && diff !== null
        ? diff as { path?: unknown; newText?: unknown }
        : {}
      if (typeof record.newText === 'string' && record.newText.length) {
        fragments.push({
          path: typeof record.path === 'string' ? record.path : undefined,
          text: record.newText
        })
      }
    }
    return fragments
  }
  return []
}

export function createAttributionObserver(deps: AttributionObserverDeps): RuntimeEventObserver {
  // dispatchId churns per task; a short memo bounds the per-write team scan.
  const metaCache = new Map<string, { harnessId: string; dispatchId?: string; at: number }>()
  const metaFor = async (threadId: string): Promise<{ harnessId: string; dispatchId?: string }> => {
    const cached = metaCache.get(threadId)
    if (cached && Date.now() - cached.at < 15_000) return cached
    const thread = await deps.threads.get(threadId).catch(() => null)
    let dispatchId: string | undefined
    if (deps.teams && deps.dispatches) {
      const teams = await deps.teams.list().catch(() => [])
      const team = teams.find((entry) =>
        entry.workers.some((worker) => worker.workerId === threadId))
      if (team) {
        const latest = (await deps.dispatches.listByWorker(team.teamId, threadId).catch(() => [])).at(-1)
        dispatchId = latest?.dispatchId
      }
    }
    const meta = { harnessId: thread?.harnessId ?? 'kun', dispatchId, at: Date.now() }
    if (metaCache.size > 2_000) metaCache.clear()
    metaCache.set(threadId, meta)
    return meta
  }

  const handle = async (threadId: string, item: TurnItem): Promise<void> => {
    const fragments = writeFragmentsFromItem(item)
    if (!fragments.length) return
    const bound = deps.taskWorkspaces.list({ boundThreadId: threadId })
    if (!bound.length) return
    const meta = await metaFor(threadId)
    const at = deps.nowIso()
    // Group fragments per workspace-relative path before recording.
    const perFile = new Map<string, { workspaceId: string; rel: string; texts: string[] }>()
    for (const fragment of fragments) {
      const path = fragment.path
      if (!path) continue
      const match = bound
        .map((record) => ({
          record,
          // Ledger paths are always '/'-separated workspace-relative.
          rel: relative(record.path, resolve(record.path, path))
            .split(sep).join('/')
        }))
        .filter((entry) => entry.rel && !entry.rel.startsWith('..') && !isAbsolute(entry.rel))
        .sort((a, b) => b.rel.length - a.rel.length || a.rel.localeCompare(b.rel))[0]
      if (!match) continue
      const key = `${match.record.workspaceId}\0${match.rel}`
      const entry = perFile.get(key) ?? {
        workspaceId: match.record.workspaceId,
        rel: match.rel,
        texts: []
      }
      entry.texts.push(fragment.text)
      perFile.set(key, entry)
    }
    for (const file of perFile.values()) {
      const lineHashes = [...new Set(file.texts.flatMap(lineHashesFor))]
      if (!lineHashes.length) continue
      await deps.ledger.record(file.workspaceId, {
        path: file.rel,
        lineHashes,
        unitId: threadId,
        harnessId: meta.harnessId,
        ...(meta.dispatchId ? { dispatchId: meta.dispatchId } : {}),
        at
      }).catch(() => undefined)
    }
  }

  return {
    record: (event) => {
      if (event.kind !== 'item_created' || !event.item) return
      void handle(event.threadId, event.item).catch(() => undefined)
    }
  }
}
