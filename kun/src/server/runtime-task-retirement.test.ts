import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKunServeRuntime } from './runtime-factory.js'
import { buildRouter } from './routes/index.js'
import { createTurnRecord } from '../domain/turn.js'
import type { ToolHostContext } from '../ports/tool-host.js'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

describe('runtime execution-task retirement integration', () => {
  it('keeps retirement through real composition, API transport, model discovery and hot reconfiguration', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-retire-runtime-'))
    cleanups.push(() => rm(dataDir, { recursive: true, force: true }))
    const options = { host: '127.0.0.1', port: 0, dataDir,
      runtimeToken: 'retirement-token', apiKey: '', baseUrl: 'http://127.0.0.1:9', model: 'model',
      approvalPolicy: 'on-request' as const, sandboxMode: 'workspace-write' as const, tokenEconomyMode: false, insecure: false }
    const runtime = await createKunServeRuntime(options)
    cleanups.push(async () => { await runtime.shutdown?.() })
    const thread = await runtime.threadService.create({ workspace: dataDir, model: 'model', mode: 'agent' }, { id: 'task-thread' })
    await runtime.threadStore!.upsert({ ...thread, turns: [createTurnRecord({ id: 'active-turn', threadId: thread.id, prompt: 'Work', status: 'running' })] })
    const context: ToolHostContext = { threadId: thread.id, turnId: 'active-turn', workspace: dataDir,
      approvalPolicy: 'auto', abortSignal: new AbortController().signal, awaitApproval: async () => 'allow' }
    async function checkCatalog() {
      const names = (await runtime.toolHost!.listTools(context)).map((tool) => tool.name)
      expect(names).toEqual(expect.arrayContaining(['task_create', 'task_update', 'task_get', 'task_list']))
      for (const name of ['todo_write', 'todo_list', 'TodoWrite', 'task_graph']) expect(names).not.toContain(name)
    }
    await checkCatalog()
    const result = await runtime.toolHost!.execute({ callId: 'atomic-create', toolName: 'task_create',
      arguments: { title: 'Real runtime task', clientRequestId: 'stable' } }, context)
    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    const router = buildRouter(runtime)
    const request = async (path: string, method = 'GET', body?: unknown, authorized = true) => {
      const route = router.match(method, path)!
      const response = await route.handler(new Request(`http://localhost${path}`, { method,
        headers: authorized ? { Authorization: 'Bearer retirement-token' } : {},
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { params: route.params })
      return response instanceof Response ? { status: response.status, body: await response.json() }
        : { status: response.status, body: JSON.parse(response.body) }
    }
    expect((await request(`/v1/threads/${thread.id}/tasks`, 'GET', undefined, false)).status).toBe(401)
    const listing = await request(`/v1/threads/${thread.id}/tasks`)
    expect(listing.status).toBe(200)
    expect(listing.body).toMatchObject({ tasks: [{ title: 'Real runtime task', revision: 0 }] })
    expect((await request(`/v1/threads/${thread.id}/todos`, 'POST', { todos: [] })).status).toBe(410)
    expect((await request(`/v1/threads/${thread.id}/todos`, 'DELETE')).status).toBe(410)
    expect((await request(`/v1/threads/${thread.id}`)).body).toMatchObject({ todos: { items: [{ content: 'Real runtime task' }] } })
    expect((await runtime.threadService.list())[0]?.todos?.items[0]?.content).toBe('Real runtime task')
    await runtime.applyConfig!({ serve: { model: 'model-after' } })
    await checkCatalog()
    expect((await runtime.threadService.executionTasks.list(thread.id)).tasks).toHaveLength(1)
    const task = (await runtime.threadService.executionTasks.list(thread.id)).tasks[0]
    await runtime.threadService.executionTasks.update(thread.id, task.id,
      { clientRequestId: 'start', expectedRevision: task.revision, status: 'running' }, { threadId: thread.id, turnId: 'active-turn' })
    const beforeEnd = (await runtime.threadStore!.get(thread.id))!
    await runtime.threadStore!.upsert({ ...beforeEnd, turns: beforeEnd.turns.map((turn) => ({ ...turn, status: 'aborted' as const })) })
    runtime.turnService.notifyTurnSettled(thread.id, 'aborted')
    await vi.waitFor(async () => expect((await runtime.threadStore!.get(thread.id))?.executionTasks?.tasks[0]?.status).toBe('paused'))
    await runtime.shutdown?.()
    cleanups.pop()
    const restarted = await createKunServeRuntime(options)
    cleanups.push(async () => { await restarted.shutdown?.() })
    expect(await restarted.threadService.executionTasks.create(thread.id, { title: 'Real runtime task', clientRequestId: 'stable' }))
      .toMatchObject({ replayed: true, task: { title: 'Real runtime task' } })
    expect((await restarted.threadService.list())[0]?.todos?.revision).toBeGreaterThan(0)
  }, 60_000)
})
