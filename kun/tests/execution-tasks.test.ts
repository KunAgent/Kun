import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../src/adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../src/adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../src/adapters/in-memory-thread-store.js'
import { buildExecutionTaskLocalTools } from '../src/adapters/tool/execution-task-tools.js'
import { LocalToolHost } from '../src/adapters/tool/local-tool-host.js'
import { ThreadTodoListSchema } from '../src/contracts/thread-todos.js'
import { createTurnRecord } from '../src/domain/turn.js'
import { toThreadSummary } from '../src/domain/thread.js'
import { SequentialIdGenerator } from '../src/ports/id-generator.js'
import { RuntimeEventRecorder } from '../src/services/runtime-event-recorder.js'
import { ThreadService } from '../src/services/thread-service.js'
import { ExecutionTaskService } from '../src/services/execution-task-service.js'
import { executionTaskRoute } from '../src/server/routes/execution-tasks.js'
import { patchThreadTodoStatus } from '../src/server/routes/project-boards.js'
import { projectPublicThreadRecord } from '../src/server/routes/thread-projection.js'
import type { ToolHostContext } from '../src/ports/tool-host.js'

const temporary: string[] = []
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
async function fixture(legacyRoot?: string, workspace = '/tmp') {
  const store = new InMemoryThreadStore(), sessions = new InMemorySessionStore(), bus = new InMemoryEventBus()
  let tick = 1700000000000
  const nowIso = () => new Date(tick++).toISOString()
  const events = new RuntimeEventRecorder({ sessionStore: sessions, eventBus: bus,
    allocateSeq: (id) => bus.allocateSeq(id), nowIso })
  const service = new ThreadService({ threadStore: store, sessionStore: sessions, events,
    ids: new SequentialIdGenerator(), nowIso, legacyTaskGraphRoot: legacyRoot })
  async function thread(id: string, parentThreadId?: string) {
    await service.create({ workspace, model: 'test', mode: 'agent' }, { id, parentThreadId })
    const record = (await store.get(id))!
    await store.upsert({ ...record, turns: [createTurnRecord({ id: `${id}-turn`, threadId: id, prompt: 'Work', status: 'running' })] })
  }
  await thread('thread')
  const tasks = service.executionTasks
  const create = (title: string, more = {}) => tasks.create('thread', { title, clientRequestId: title, ...more })
  const actor = { threadId: 'thread', turnId: 'thread-turn' }
  return { service, tasks, create, store, sessions, events, nowIso, actor, thread }
}
async function directory() { const path = await mkdtemp(join(tmpdir(), 'kun-execution-tasks-')); temporary.push(path); return path }
function context(): ToolHostContext { return { threadId: 'thread', turnId: 'thread-turn', workspace: '/tmp',
  approvalPolicy: 'auto', abortSignal: new AbortController().signal, awaitApproval: async () => 'allow' } }

describe('canonical execution tasks', () => {
  it('exposes atomic tools and rejects every retired native call', async () => {
    const f = await fixture(), host = new LocalToolHost({ tools: buildExecutionTaskLocalTools(f.tasks) })
    expect((await host.listTools(context())).map((tool) => tool.name)).toEqual(['task_create', 'task_update', 'task_get', 'task_list'])
    for (const toolName of ['todo_write', 'todo_list', 'TodoWrite', 'task_graph']) {
      await expect(host.execute({ callId: toolName, toolName, arguments: {} }, context())).rejects.toThrow(/unknown tool/)
    }
    const result = await host.execute({ callId: 'create', toolName: 'task_create', arguments: { title: 'Check', clientRequestId: 'check' } }, context())
    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false, output: { task: { title: 'Check' } } })
  })

  it('preserves unrelated tasks and rejects stale revisions', async () => {
    const f = await fixture(), a = (await f.create('A')).task, b = (await f.create('B')).task
    await f.tasks.update('thread', a.id, { clientRequestId: 'a-title', expectedRevision: 0, title: 'A revised' })
    await expect(f.tasks.update('thread', a.id, { clientRequestId: 'stale', expectedRevision: 0, title: 'Lost update' })).rejects.toMatchObject({ code: 'conflict' })
    expect((await f.tasks.list('thread')).tasks.map((task) => task.title)).toEqual(['A revised', 'B'])
    expect((await f.tasks.get('thread', b.id)).revision).toBe(0)
  })

  it('deduplicates identical creates and updates across service restart', async () => {
    const f = await fixture(), a = (await f.create('A')).task
    expect((await f.create('A')).task.id).toBe(a.id)
    await expect(f.create('Changed', { clientRequestId: 'A' })).rejects.toMatchObject({ code: 'conflict' })
    const update = { clientRequestId: 'wait', expectedRevision: 0, status: 'waiting', reason: 'User reply' }
    await f.tasks.update('thread', a.id, update)
    const restarted = new ExecutionTaskService({ threadStore: f.store, events: f.events, nowIso: f.nowIso })
    expect(await restarted.update('thread', a.id, update)).toMatchObject({ replayed: true, task: { revision: 1, status: 'waiting' } })
    await expect(restarted.update('thread', a.id, { ...update, reason: 'Different' })).rejects.toMatchObject({ code: 'conflict' })
    expect((await restarted.list('thread')).tasks).toHaveLength(1)
  })

  it('rejects a generated create identity already owned by a legacy task without changing its snapshot', async () => {
    const f = await fixture(), clientRequestId = 'legacy-collision'
    const id = `task_${createHash('sha256').update(JSON.stringify(['thread', clientRequestId])).digest('hex').slice(0, 32)}`
    const legacyTodos = ThreadTodoListSchema.parse({ threadId: 'thread', updatedAt: f.nowIso(), items: [
      { id, content: 'Original legacy task', status: 'pending', createdAt: f.nowIso(), updatedAt: f.nowIso() }
    ] })
    await f.store.upsert({ ...(await f.store.get('thread'))!, todos: legacyTodos })
    await expect(f.create('New task', { clientRequestId })).rejects.toMatchObject({ code: 'conflict' })
    expect((await f.store.get('thread'))?.todos).toEqual(legacyTodos)
    expect((await f.tasks.list('thread')).tasks).toMatchObject([{ id, title: 'Original legacy task' }])
    const created = await f.create('New task', { clientRequestId: 'different-request' })
    expect(created.task.id).not.toBe(id)
    expect((await f.tasks.list('thread')).tasks).toHaveLength(2)
  })

  it('serializes independent writes and admits only one same-revision winner', async () => {
    const f = await fixture(), a = (await f.create('A')).task, b = (await f.create('B')).task
    await Promise.all([a, b].map((task) => f.tasks.update('thread', task.id, { expectedRevision: 0, clientRequestId: task.id, title: `${task.title}!` })))
    const outcomes = await Promise.allSettled(['one', 'two'].map((title) => f.tasks.update('thread', a.id, { expectedRevision: 1, clientRequestId: title, title })))
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect((await f.tasks.get('thread', b.id)).title).toBe('B!')
  })

  it('retries a thread-store CAS race without losing the concurrent metadata', async () => {
    const f = await fixture(), original = f.store.upsertIfRevision.bind(f.store)
    let first = true
    vi.spyOn(f.store, 'upsertIfRevision').mockImplementation(async (record, revision) => {
      if (first) { first = false; await f.store.upsert({ ...(await f.store.get('thread'))!, title: 'Concurrent title' }) }
      return original(record, revision)
    })
    await f.create('A')
    expect((await f.store.get('thread'))?.title).toBe('Concurrent title')
    expect((await f.tasks.list('thread')).tasks).toHaveLength(1)
  })

  it('validates dependencies and derives readiness without executing anything', async () => {
    const f = await fixture(), a = (await f.create('A')).task, b = (await f.create('B', { dependsOn: [a.id] })).task
    await expect(f.create('Missing', { dependsOn: ['absent'] })).rejects.toMatchObject({ code: 'invalid_dependency' })
    await expect(f.tasks.update('thread', a.id, { expectedRevision: 0, clientRequestId: 'cycle', dependsOn: [b.id] })).rejects.toThrow(/cycle/)
    expect((await f.tasks.list('thread', { runnable: true })).tasks.map((task) => task.id)).toEqual([a.id])
    await expect(f.tasks.update('thread', b.id, { expectedRevision: 0, clientRequestId: 'early', status: 'running' }, f.actor)).rejects.toMatchObject({ code: 'dependency_blocked' })
    await f.tasks.update('thread', a.id, { expectedRevision: 0, clientRequestId: 'done', status: 'succeeded', evidence: [{ summary: 'Verified A' }] })
    expect((await f.tasks.list('thread', { runnable: true })).tasks.map((task) => task.id)).toEqual([b.id])
  })

  it('requires evidence and wait reasons; failure never means success', async () => {
    const f = await fixture(), a = (await f.create('A')).task, b = (await f.create('B', { dependsOn: [a.id] })).task
    await expect(f.tasks.update('thread', a.id, { expectedRevision: 0, clientRequestId: 'done', status: 'succeeded' })).rejects.toMatchObject({ code: 'evidence_required' })
    await expect(f.tasks.update('thread', a.id, { expectedRevision: 0, clientRequestId: 'wait', status: 'waiting' })).rejects.toMatchObject({ code: 'reason_required' })
    await f.tasks.update('thread', a.id, { expectedRevision: 0, clientRequestId: 'failed', status: 'failed', reason: 'Validation failed' })
    expect((await f.tasks.list('thread')).runnable).not.toContain(b.id)
    expect((await f.service.getTodos('thread'))?.items[0]).toMatchObject({ status: 'pending', taskStatus: 'failed' })
    expect((await f.store.get('thread'))?.goal).toBeUndefined()
  })

  it('enforces owner scopes while separate child owners run concurrently', async () => {
    const f = await fixture(); await f.thread('child1', 'thread'); await f.thread('child2', 'thread'); await f.thread('stranger')
    const legacyTodos = ThreadTodoListSchema.parse({ threadId: 'thread', updatedAt: f.nowIso(), items: [
      { id: 'legacy', content: 'Historical step', status: 'in_progress', createdAt: f.nowIso(), updatedAt: f.nowIso() }
    ] })
    await f.store.upsert({ ...(await f.store.get('thread'))!, todos: legacyTodos })
    const a = (await f.create('A', { ownerThreadId: 'child1' })).task, b = (await f.create('B', { ownerThreadId: 'child2' })).task
    await expect(f.create('Invalid owner', { ownerThreadId: 'stranger' })).rejects.toMatchObject({ code: 'forbidden' })
    await Promise.all([a, b].map((task) => f.tasks.update('thread', task.id, { expectedRevision: 0, clientRequestId: task.id, status: 'running' },
      { threadId: task.ownerThreadId, turnId: `${task.ownerThreadId}-turn` })))
    expect((await f.tasks.list('thread')).tasks.filter((task) => task.status === 'running')).toHaveLength(2)
    const todos = (await f.service.getTodos('thread'))!
    expect(todos.items.filter((item) => item.status === 'in_progress')).toHaveLength(2)
    expect(ThreadTodoListSchema.safeParse(todos).success).toBe(true)
    expect(ThreadTodoListSchema.safeParse({ ...todos, revision: undefined }).success).toBe(false)
    expect((await f.store.get('thread'))?.todos).toEqual(legacyTodos)
    await expect(f.service.setTodos('thread', { todos: [] })).rejects.toThrow(/retired/)
    await expect(f.service.clearTodos('thread')).rejects.toThrow(/retired/)
    await expect(f.tasks.get('thread', a.id, { threadId: 'child2', turnId: 'child2-turn' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(f.tasks.update('thread', a.id, { expectedRevision: 1, clientRequestId: 'wrong-owner', status: 'cancelled' }, f.actor)).rejects.toMatchObject({ code: 'execution_active' })
  })

  it('requires a real active turn and pauses interrupted work without restarting it', async () => {
    const f = await fixture(), a = (await f.create('A')).task
    await expect(f.tasks.update('thread', a.id, { expectedRevision: 0, clientRequestId: 'fake', status: 'running' })).rejects.toMatchObject({ code: 'forbidden' })
    await f.tasks.update('thread', a.id, { expectedRevision: 0, clientRequestId: 'run', status: 'running' }, f.actor)
    const thread = (await f.store.get('thread'))!
    await f.store.upsert({ ...thread, turns: thread.turns.map((turn) => ({ ...turn, status: 'aborted' as const })) })
    expect((await f.tasks.list('thread')).tasks[0]).toMatchObject({ status: 'paused', revision: 2 })
    expect((await f.store.get('thread'))?.turns).toHaveLength(1)
    await expect(f.tasks.get('thread', a.id, f.actor)).rejects.toMatchObject({ code: 'stale_execution' })
  })

  it('uses revision-bound pagination and rejects obsolete cursors', async () => {
    const f = await fixture(); await f.create('A'); await f.create('B')
    const page = await f.tasks.list('thread', { limit: 1 })
    expect(page.runnable).toEqual(page.tasks.map((task) => task.id))
    const nextPage = await f.tasks.list('thread', { cursor: page.nextCursor, limit: 1 })
    expect(nextPage.tasks[0].title).toBe('B')
    expect(nextPage.runnable).toEqual(nextPage.tasks.map((task) => task.id))
    expect(nextPage.runnable).not.toContain(page.tasks[0].id)
    await f.create('C')
    await expect(f.tasks.list('thread', { cursor: page.nextCursor })).rejects.toMatchObject({ code: 'conflict' })
  })

  it('migrates todo and graph identities once and preserves original records', async () => {
    const root = await directory(), f = await fixture(root)
    const legacy = [{ id: 'old', content: 'Same title', status: 'in_progress' as const }]
    await f.store.upsert({ ...(await f.store.get('thread'))!, todos: { threadId: 'thread', updatedAt: f.nowIso(),
      items: legacy.map((item) => ({ ...item, createdAt: f.nowIso(), updatedAt: f.nowIso() })) } })
    const filename = join(root, `${createHash('sha256').update('thread').digest('hex')}.json`)
    const graph = JSON.stringify({ concurrency: 1, tasks: { old: { id: 'old', title: 'Same title', state: 'running', dependsOn: [], priority: 0 } } })
    await writeFile(filename, graph)
    const first = await f.tasks.list('thread')
    expect(first.tasks).toHaveLength(2)
    expect(new Set(first.tasks.map((task) => task.id)).size).toBe(2)
    expect(first.tasks.every((task) => task.status === 'paused')).toBe(true)
    expect((await f.tasks.list('thread')).tasks.map((task) => task.id)).toEqual(first.tasks.map((task) => task.id))
    expect(await readFile(filename, 'utf8')).toBe(graph)
    expect((await f.store.get('thread'))?.todos?.items[0].status).toBe('in_progress')
    await expect(f.service.setTodos('thread', { todos: [] })).rejects.toThrow(/retired/)
  })

  it('fails closed on corrupt legacy data without overwriting it', async () => {
    const root = await directory(), f = await fixture(root)
    const filename = join(root, `${createHash('sha256').update('thread').digest('hex')}.json`)
    await writeFile(filename, '{broken')
    await expect(f.tasks.list('thread')).rejects.toThrow()
    expect((await f.store.get('thread'))?.executionTasks).toBeUndefined()
    expect(await readFile(filename, 'utf8')).toBe('{broken')
  })

  it('imports plans without overwriting progress and verifies source identity on projection', async () => {
    const workspace = await directory(), f = await fixture(undefined, workspace)
    const path = '.kunsdd/plan/demo.md', filename = join(workspace, path)
    await mkdir(join(workspace, '.kunsdd/plan'), { recursive: true })
    await writeFile(filename, '# Plan\n- [ ] Build UI\n')
    const options = { planId: 'plan', relativePath: path, markdown: '# Plan\n- [ ] Build UI\n', mode: 'document_edit' as const }
    await f.service.syncTodosFromPlan('thread', options)
    const task = (await f.tasks.list('thread')).tasks[0]
    const update = { clientRequestId: 'done', expectedRevision: 0, status: 'succeeded', evidence: [{ summary: 'UI verified' }] }
    await f.tasks.update('thread', task.id, update)
    expect(await readFile(filename, 'utf8')).toContain('- [x] Build UI')
    await f.service.syncTodosFromPlan('thread', options)
    expect((await f.tasks.list('thread')).tasks).toHaveLength(1)
    expect((await f.tasks.get('thread', task.id)).status).toBe('succeeded')
    await writeFile(filename, '# Plan\n- [ ] Different item\n')
    await expect(f.tasks.update('thread', task.id, update)).rejects.toMatchObject({ code: 'projection_conflict' })
    expect(await readFile(filename, 'utf8')).toContain('- [ ] Different item')
    expect((await f.tasks.get('thread', task.id)).status).toBe('succeeded')
  })

  it('repairs missing event delivery on an idempotent retry', async () => {
    const f = await fixture()
    vi.spyOn(f.events, 'record').mockRejectedValueOnce(new Error('event delivery interrupted'))
    await expect(f.create('A')).rejects.toThrow(/interrupted/)
    const retried = await f.create('A')
    expect(retried.replayed).toBe(true)
    expect((await f.tasks.list('thread')).tasks).toHaveLength(1)
    expect((await f.sessions.loadEventsSince('thread', 0)).some((event) => event.kind === 'todos_updated')).toBe(true)
  })

  it('repairs a committed board transition without incrementing its revision twice', async () => {
    const f = await fixture(), task = (await f.create('A')).task
    vi.spyOn(f.events, 'record').mockRejectedValueOnce(new Error('event interrupted'))
    await expect(f.tasks.patchStatuses('thread', [task.id], 'pending', 'completed')).rejects.toThrow(/interrupted/)
    await f.tasks.patchStatuses('thread', [task.id], 'pending', 'completed')
    expect(await f.tasks.get('thread', task.id)).toMatchObject({ status: 'succeeded', revision: 1 })
    const events = await f.sessions.loadEventsSince('thread', 0)
    expect(events.at(-1)).toMatchObject({ kind: 'todos_updated', todos: { items: [{ taskStatus: 'succeeded' }] } })
  })

  it('retains independent titles and safely handles moved, duplicated and removed plan steps', async () => {
    const workspace = await directory(), f = await fixture(undefined, workspace)
    const relativePath = '.kunsdd/plan/duplicate.md', filename = join(workspace, relativePath)
    await mkdir(join(workspace, '.kunsdd/plan'), { recursive: true })
    const sync = async (markdown: string) => {
      await writeFile(filename, markdown)
      await f.service.syncTodosFromPlan('thread', { planId: 'duplicate', relativePath, markdown, mode: 'document_edit' })
    }
    await sync('- [ ] B\n- [ ] A\n')
    const a = (await f.tasks.list('thread')).tasks.find((task) => task.title === 'A')!
    await f.tasks.update('thread', a.id, { clientRequestId: 'rename', expectedRevision: a.revision, title: 'Independent title' })
    expect(await readFile(filename, 'utf8')).toBe('- [ ] B\n- [ ] A\n')
    await sync('- [ ] A\n')
    await sync('- [ ] A\n- [ ] A\n')
    let tasks = (await f.tasks.list('thread')).tasks
    expect(tasks).toHaveLength(3)
    expect(new Set(tasks.map((task) => task.id)).size).toBe(3)
    expect(tasks.find((task) => task.id === a.id)?.title).toBe('Independent title')
    await sync('# No steps\n')
    expect((await f.tasks.list('thread')).runnable).toEqual([])
    tasks = (await f.tasks.list('thread')).tasks
    expect(tasks.every((task) => task.sourceStale)).toBe(true)
    await expect(f.tasks.patchStatuses('thread', [a.id], 'pending', 'completed')).rejects.toMatchObject({ code: 'plan_changed' })
    await f.tasks.update('thread', a.id, { expectedRevision: tasks.find((task) => task.id === a.id)!.revision,
      clientRequestId: 'cancel-obsolete', status: 'cancelled' })
    expect(await readFile(filename, 'utf8')).toBe('# No steps\n')
  })

  it('requires explicit recovery for a legacy deferred retry and retains its policy as read-only context', async () => {
    const root = await directory(), f = await fixture(root)
    const filename = join(root, `${createHash('sha256').update('thread').digest('hex')}.json`)
    await writeFile(filename, JSON.stringify({ concurrency: 2, tasks: { retry: { id: 'retry', title: 'Retry later',
      state: 'ready', dependsOn: [], priority: 0, attempts: 1, maxAttempts: 3, nextAttemptAt: 9999999999999,
      tokenBudget: 1000, worktree: '/old/worktree' } } }))
    const list = await f.tasks.list('thread')
    expect(list.runnable).toEqual([])
    expect(list.tasks[0]).toMatchObject({ status: 'paused', legacyGraphPolicy: { attempts: 1, maxAttempts: 3,
      graphConcurrency: 2, nextAttemptAt: 9999999999999, tokenBudget: 1000, worktree: '/old/worktree' } })
  })

  it('serves canonical progress on detail/summary and keeps receipts private', async () => {
    const f = await fixture(); await f.create('A')
    const record = (await f.store.get('thread'))!, detail = projectPublicThreadRecord(record)
    expect(detail.executionTasks).toBeUndefined()
    expect(detail.todos?.items[0]).toMatchObject({ content: 'A', taskStatus: 'pending', taskRevision: 0 })
    expect(toThreadSummary(record).todos).toEqual(detail.todos)
  })

  it('exposes validated HTTP CRUD with conflict responses', async () => {
    const f = await fixture(), created = await executionTaskRoute(f.service, 'thread', new Request('http://localhost/v1/threads/thread/tasks',
      { method: 'POST', body: JSON.stringify({ title: 'HTTP task', clientRequestId: 'http' }) }))
    expect(created.status).toBe(201)
    const task = (await f.tasks.list('thread')).tasks[0]
    const response = await executionTaskRoute(f.service, 'thread', new Request('http://localhost/v1/threads/thread/tasks/id',
      { method: 'PATCH', body: JSON.stringify({ expectedRevision: 99, clientRequestId: 'stale', title: 'Wrong' }) }), task.id)
    expect(response.status).toBe(409)
  })

  it('rejects attempts to claim running execution through the legacy status PATCH route', async () => {
    const f = await fixture(), { task } = await f.create('Atomic task')
    const response = await patchThreadTodoStatus(f.service, undefined, 'thread', task.id,
      new Request(`http://localhost/v1/threads/thread/todos/${task.id}`, {
        method: 'PATCH', body: JSON.stringify({ status: 'in_progress' })
      }))
    expect(response.status).toBe(400)
    expect(JSON.parse((response as { body: string }).body)).toMatchObject({ code: 'execution_active' })
    expect(await f.tasks.get('thread', task.id)).toMatchObject({ status: 'pending', revision: 0 })
  })
})
