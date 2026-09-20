import type { NormalizedThread } from '../agent/types'
import type { CompletionAttentionRegistry } from '../store/chat-store-types'
import { threadLooksRunning } from '../store/chat-store-runtime-helpers'
import { completionAttentionForThread } from '../store/unread-completions'
import type { SidebarActivity } from '../components/sidebar/SidebarActivityIndicator'
import {
  readWriteThreadRegistry,
  type WriteThreadRegistry,
  writeFileKey,
  writeThreadIdsForFile,
  writeWorkspaceKey
} from './write-thread-registry'

export type WriteResourceActivityContext = {
  threads: readonly NormalizedThread[]
  activeThreadId: string | null
  busy: boolean
  watchTurnCompletion: Record<string, boolean>
  awaitingUserInputThreadIds: Record<string, true>
  unreadThreadIds: CompletionAttentionRegistry
}

export type WriteResourceActivitySummary = {
  activity: SidebarActivity
  count: number
}

const PRIORITY: Record<SidebarActivity, number> = {
  idle: 0,
  unread: 1,
  failed: 2,
  running: 3,
  'awaiting-input': 4
}

export function combineWriteResourceActivities(
  summaries: readonly WriteResourceActivitySummary[]
): WriteResourceActivitySummary {
  let activity: SidebarActivity = 'idle'
  let count = 0
  for (const summary of summaries) {
    if (summary.activity === 'idle') continue
    count += summary.count
    if (PRIORITY[summary.activity] > PRIORITY[activity]) activity = summary.activity
  }
  return { activity, count }
}

export function writeThreadActivity(
  threadId: string,
  context: WriteResourceActivityContext
): SidebarActivity {
  const id = threadId.trim()
  if (!id) return 'idle'
  const thread = context.threads.find((candidate) => candidate.id === id)
  if (thread?.archived === true) return 'idle'
  if (context.awaitingUserInputThreadIds[id]) return 'awaiting-input'
  if (
    (thread && threadLooksRunning(thread)) ||
    context.watchTurnCompletion[id] === true ||
    (context.activeThreadId === id && context.busy)
  ) return 'running'
  const attention = completionAttentionForThread(context.unreadThreadIds, id)
  if (attention === 'failed') return 'failed'
  if (attention === 'completed') return 'unread'
  return 'idle'
}

export function writeActivityForThreadIds(
  threadIds: readonly string[],
  context: WriteResourceActivityContext
): WriteResourceActivitySummary {
  return combineWriteResourceActivities(
    [...new Set(threadIds.map((id) => id.trim()).filter(Boolean))].map((threadId) => {
      const activity = writeThreadActivity(threadId, context)
      return { activity, count: activity === 'idle' ? 0 : 1 }
    })
  )
}

export function writeFileActivity(
  workspaceRoot: string,
  filePath: string,
  context: WriteResourceActivityContext,
  registry: WriteThreadRegistry = readWriteThreadRegistry()
): WriteResourceActivitySummary {
  return writeActivityForThreadIds(
    writeThreadIdsForFile(workspaceRoot, filePath, registry),
    context
  )
}

export function writeDirectoryActivity(
  workspaceRoot: string,
  directoryPath: string,
  context: WriteResourceActivityContext,
  registry: WriteThreadRegistry = readWriteThreadRegistry()
): WriteResourceActivitySummary {
  const workspace = registry.workspaces[writeWorkspaceKey(workspaceRoot)]
  const directoryKey = writeFileKey(directoryPath)
  if (!workspace || !directoryKey) return { activity: 'idle', count: 0 }
  const threadIds = Object.entries(workspace.fileThreadHistoryIds).flatMap(([fileKey, ids]) =>
    fileKey.startsWith(`${directoryKey}/`) ? ids : []
  )
  return writeActivityForThreadIds(threadIds, context)
}

export function writeWorkspaceActivity(
  workspaceRoot: string,
  context: WriteResourceActivityContext,
  registry: WriteThreadRegistry = readWriteThreadRegistry()
): WriteResourceActivitySummary {
  return writeActivityForThreadIds(
    registry.workspaces[writeWorkspaceKey(workspaceRoot)]?.threadIds ?? [],
    context
  )
}
