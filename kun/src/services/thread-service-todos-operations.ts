import { readFile, writeFile } from 'node:fs/promises'
import type { SetThreadTodosRequest, ThreadRecord, ThreadTodoItem, ThreadTodoList, ThreadTodoStatus } from '../contracts/threads.js'
import { withFileMutationQueue } from '../adapters/tool/file-mutation-queue.js'
import { withThreadStoreMutation } from './thread-mutation-coordinator.js'
import { executionTasksAsTodos, taskPlanStructureHash } from '../tasks/execution-task-state.js'
import { ExecutionTaskError } from './execution-task-service.js'
import { isGuiPlanRelativePath } from '../shared/gui-plan.js'
import { extractPlanTodos, normalizePlanRelativePath, patchPlanTodoStatus } from '../shared/todos.js'
import { type ThreadService, type SyncPlanTodosOptions, resolveWorkspaceRelativePath } from './thread-service-core.js'

export const threadServiceTodosOperations = {
async getTodos(this: ThreadService, threadId: string): Promise<ThreadTodoList | null> {
    const current = await this['threadStore'].get(threadId)
    if (!current) throw new Error(`thread not found: ${threadId}`)
    if (current.executionTasks) return executionTasksAsTodos(threadId, current.executionTasks)
    return current.todos ?? null
  },

async setTodos(this: ThreadService, threadId: string, request: SetThreadTodosRequest): Promise<ThreadTodoList> {
    void threadId; void request
    throw new ExecutionTaskError('tool_retired', 'Whole-list todo writes are retired; use atomic execution tasks.')
  },

async setTodosFromTool(this: ThreadService, threadId: string, request: SetThreadTodosRequest): Promise<ThreadTodoList> {
    void threadId; void request
    throw new Error('TOOL_RETIRED: use task_create, task_update, task_get and task_list')
  },

async patchTodoStatus(this: ThreadService,
    threadId: string,
    todoId: string,
    status: ThreadTodoStatus
  ): Promise<ThreadTodoList> {
    await this.executionTasks.list(threadId)
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
    await this.executionTasks.patchStatuses(threadId, todoIds, fromStatus, status)
    return (await this.getTodos(threadId))!
  },

async clearTodos(this: ThreadService, _threadId: string): Promise<boolean> {
    throw new ExecutionTaskError('tool_retired', 'Whole-list todo deletion is retired; cancel individual execution tasks.')
  },

async syncTodosFromPlan(this: ThreadService, threadId: string, options: SyncPlanTodosOptions): Promise<ThreadTodoList> {
    const relativePath = normalizePlanRelativePath(options.relativePath)
    if (!isGuiPlanRelativePath(relativePath)) throw new Error(`invalid GUI plan relative path: ${options.relativePath}`)
    const planItems = extractPlanTodos({ markdown: options.markdown, planId: options.planId,
      relativePath, threadId, now: this['nowIso']() })
    await this.executionTasks.importPlan(threadId, planItems, { planId: options.planId, relativePath })
    return (await this.getTodos(threadId))!
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
      if (item.taskStatus) return true
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
          if (item.taskStatus) {
            const documentItems = extractPlanTodos({ markdown, planId: item.source!.planId,
              relativePath, threadId: current.id, now: this['nowIso']() })
            const sameHash = documentItems.filter((candidate) => candidate.source.contentHash === item.source?.contentHash)
            const exact = sameHash.find((candidate) => candidate.source.ordinal === item.source?.ordinal &&
              (!item.source?.content || candidate.content === item.source.content))
            const structureMatches = item.source?.documentHash
              ? item.source.documentHash === taskPlanStructureHash(documentItems.map((candidate) => candidate.source.contentHash))
              : sameHash.length === 1
            if (!exact || !structureMatches) throw new ExecutionTaskError('projection_conflict',
              'Task state was saved, but the linked plan changed. Reconcile the saved plan before retrying this task request.')
          }
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
