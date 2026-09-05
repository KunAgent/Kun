import { readFile, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { ThreadStore, ThreadStoreListOptions } from '../ports/thread-store.js'
import type { SessionStore } from '../ports/session-store.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type {
  CreateThreadRequest,
  SetThreadGoalRequest,
  SetThreadTodosRequest,
  ThreadGoal,
  ThreadMode,
  ThreadRecord,
  ThreadRelation,
  ThreadStatus,
  ThreadUpdateStatus,
  ThreadTodoItem,
  ThreadTodoList,
  ThreadTodoSource,
  ThreadTodoStatus,
  ThreadSummary
} from '../contracts/threads.js'
import type { ExtensionThreadMetadata } from '../contracts/threads.js'
import type {
  ApprovalPolicy,
  ApprovalReviewer,
  SandboxMode
} from '../contracts/policy.js'
import type { Turn } from '../contracts/turns.js'
import { isPublicTurnItem, type TurnItem } from '../contracts/items.js'
import {
  createThreadRecord,
  resolveThreadAgentSurface,
  toThreadSummary,
  touchThread
} from '../domain/thread.js'
import type { AgentSession } from '../domain/session.js'
import { repairModelHistoryItems } from '../domain/model-history-repair.js'
import type { RuntimeEventRecorder } from './runtime-event-recorder.js'
import type { ThreadLifecycleFence } from './thread-lifecycle-fence.js'
import { withFileMutationQueue } from '../adapters/tool/file-mutation-queue.js'
import { withThreadStoreMutation } from './thread-mutation-coordinator.js'
import { DEFAULT_KUN_MODEL } from '../config/kun-config.js'
import { isGuiPlanRelativePath } from '../shared/gui-plan.js'
import {
  extractPlanTodos,
  mergePlanTodos,
  normalizePlanRelativePath,
  normalizeTodoContent,
  patchPlanTodoStatus,
  todoContentHash
} from '../shared/todos.js'
import { type ThreadService, type ThreadServiceOptions, type ListThreadsOptions, type ForkThreadOptions, type ResumeSessionOptions, type ResumeSessionResult, type SyncPlanTodosOptions, cloneTurnForThread, normalizeTodoItems, preserveToolTodoSources, normalizeTodoStatus, normalizeTodoSource, findExistingTodoForRaw, sameTodoSource, uniqueTodoId, cloneTodoListForThread, resolveWorkspaceRelativePath, cloneTurnForFork, cloneItemForThread, cloneSessionItemsForThread, matchesThreadSearch, threadStatusFromTurns, rebuildTurnsFromItems, attachmentIdsFromItems, toSessionSnapshot } from './thread-service-core.js'

export const threadServiceTodosOperations = {
async getTodos(this: ThreadService, threadId: string): Promise<ThreadTodoList | null> {
    const current = await this['threadStore'].get(threadId)
    if (!current) throw new Error(`thread not found: ${threadId}`)
    return current.todos ?? null
  },

async setTodos(this: ThreadService, threadId: string, request: SetThreadTodosRequest): Promise<ThreadTodoList> {
    return this['setTodosInternal'](threadId, request, false)
  },

async setTodosFromTool(this: ThreadService, threadId: string, request: SetThreadTodosRequest): Promise<ThreadTodoList> {
    return this['setTodosInternal'](threadId, request, true)
  },

async patchTodoStatus(this: ThreadService,
    threadId: string,
    todoId: string,
    status: ThreadTodoStatus
  ): Promise<ThreadTodoList> {
    const current = await this['getTodos'](threadId)
    const fromStatus = current?.items.find((item) => item.id === todoId)?.status
    if (!fromStatus) throw new Error(`todo not found: ${threadId}/${todoId}`)
    return this['patchTodoStatuses'](threadId, [todoId], fromStatus, status)
  },

async patchTodoStatuses(this: ThreadService,
    threadId: string,
    todoIds: readonly string[],
    fromStatus: ThreadTodoStatus,
    status: ThreadTodoStatus
  ): Promise<ThreadTodoList> {
    const uniqueIds = [...new Set(todoIds)]
    if (uniqueIds.length === 0) throw new Error('at least one todo id is required')
    if (status === 'in_progress' && uniqueIds.length > 1) {
      throw new Error(`in_progress conflict: thread ${threadId} has multiple selected todos`)
    }
    const selectedIds = new Set(uniqueIds)
    const todos = await this['withThreadMutation'](threadId, async () => {
      const current = await this['threadStore'].get(threadId)
      if (!current) throw new Error(`thread not found: ${threadId}`)
      const existing = current.todos?.items ?? []
      const existingById = new Map(existing.map((item) => [item.id, item]))
      for (const todoId of uniqueIds) {
        const item = existingById.get(todoId)
        if (!item) throw new Error(`todo not found: ${threadId}/${todoId}`)
        if (item.status !== fromStatus) {
          throw new Error(
            `stale todo status: ${threadId}/${todoId} expected ${fromStatus}, received ${item.status}`
          )
        }
      }
      const now = this['nowIso']()
      const items = existing.map((item) => {
        const nextStatus = selectedIds.has(item.id)
          ? status
          : status === 'in_progress' && item.status === 'in_progress'
            ? 'pending' as const
            : item.status
        return nextStatus === item.status
          ? item
          : { ...item, status: nextStatus, updatedAt: now }
      })
      await this['patchPlanMarkdownForTodoStatusChanges'](current, items)
      const next: ThreadTodoList = { threadId, items, updatedAt: now }
      await this['threadStore'].upsert(touchThread({ ...current, todos: next }, now))
      return next
    })
    await this['events'].record({ kind: 'todos_updated', threadId, todos })
    return todos
  },

async setTodosInternal(this: ThreadService,
    threadId: string,
    request: SetThreadTodosRequest,
    preserveExistingSources: boolean
  ): Promise<ThreadTodoList> {
    const todos = await this['withThreadMutation'](threadId, async () => {
      const current = await this['threadStore'].get(threadId)
      if (!current) throw new Error(`thread not found: ${threadId}`)
      const now = this['nowIso']()
      const existingItems = current.todos?.items ?? []
      const items = normalizeTodoItems({
        rawItems: preserveExistingSources
          ? preserveToolTodoSources(request.todos, existingItems)
          : request.todos,
        existingItems,
        now,
        ids: this['ids']
      })
      await this['patchPlanMarkdownForTodoStatusChanges'](current, items)
      const next: ThreadTodoList = {
        threadId,
        items,
        updatedAt: now
      }
      await this['threadStore'].upsert(touchThread({ ...current, todos: next }, now))
      return next
    })
    await this['events'].record({
      kind: 'todos_updated',
      threadId,
      todos
    })
    return todos
  },

async clearTodos(this: ThreadService, threadId: string): Promise<boolean> {
    const cleared = await this['withThreadMutation'](threadId, async () => {
      const current = await this['threadStore'].get(threadId)
      if (!current) throw new Error(`thread not found: ${threadId}`)
      if (!current.todos) return false
      const updated = touchThread({ ...current }, this['nowIso']())
      delete (updated as { todos?: ThreadTodoList }).todos
      await this['threadStore'].upsert(updated)
      return true
    })
    if (!cleared) return false
    await this['events'].record({
      kind: 'todos_cleared',
      threadId,
      cleared: true
    })
    return true
  },

async syncTodosFromPlan(this: ThreadService, threadId: string, options: SyncPlanTodosOptions): Promise<ThreadTodoList> {
    const todos = await this['withThreadMutation'](threadId, async () => {
      const current = await this['threadStore'].get(threadId)
      if (!current) throw new Error(`thread not found: ${threadId}`)
      const relativePath = normalizePlanRelativePath(options.relativePath)
      if (!isGuiPlanRelativePath(relativePath)) {
        throw new Error(`invalid GUI plan relative path: ${options.relativePath}`)
      }
      const now = this['nowIso']()
      const planItems = extractPlanTodos({
        markdown: options.markdown,
        planId: options.planId,
        relativePath,
        threadId,
        now
      })
      const next = mergePlanTodos({
        threadId,
        existing: current.todos ?? null,
        planItems,
        planId: options.planId,
        relativePath,
        now,
        mode: options.mode
      })
      await this['threadStore'].upsert(touchThread({ ...current, todos: next }, now))
      return next
    })
    await this['events'].record({
      kind: 'todos_updated',
      threadId,
      todos
    })
    return todos
  },

async withThreadMutation<T>(this: ThreadService, threadId: string, operation: () => Promise<T>): Promise<T> {
    return withThreadStoreMutation(this['threadStore'], threadId, operation)
  },

async patchPlanMarkdownForTodoStatusChanges(this: ThreadService,
    current: ThreadRecord,
    nextItems: readonly ThreadTodoItem[]
  ): Promise<void> {
    const previousById = new Map((current.todos?.items ?? []).map((item) => [item.id, item]))
    const changedPlanItems = nextItems.filter((item) => {
      if (item.source?.kind !== 'plan') return false
      const previous = previousById.get(item.id)
      return !previous || previous.status !== item.status
    })
    if (changedPlanItems.length === 0) return

    const byRelativePath = new Map<string, ThreadTodoItem[]>()
    for (const item of changedPlanItems) {
      const source = item.source
      if (!source || source.kind !== 'plan') continue
      const relativePath = normalizePlanRelativePath(source.relativePath)
      if (!isGuiPlanRelativePath(relativePath)) {
        throw new Error(`invalid GUI plan relative path: ${source.relativePath}`)
      }
      byRelativePath.set(relativePath, [...(byRelativePath.get(relativePath) ?? []), item])
    }

    for (const [relativePath, items] of byRelativePath) {
      const absolutePath = await resolveWorkspaceRelativePath(current.workspace, relativePath)
      await withFileMutationQueue(absolutePath, async () => {
        let markdown = await readFile(absolutePath, 'utf-8')
        let changed = false
        for (const item of items) {
          const patched = patchPlanTodoStatus(markdown, {
            content: item.content,
            status: item.status,
            source: item.source
          })
          markdown = patched.markdown
          changed ||= patched.changed
        }
        if (changed) await writeFile(absolutePath, markdown, 'utf-8')
      })
    }
  },
}
