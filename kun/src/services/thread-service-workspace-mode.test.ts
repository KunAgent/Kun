import { describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import {
  UpdateThreadRequest,
  type ThreadRecord
} from '../contracts/threads.js'
import { shouldAdvertiseManagerTools } from '../domain/manager-tools.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { ThreadService } from './thread-service.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { _internal as threadsRouteInternal } from '../server/routes/threads.js'

function serviceWith(store = new InMemoryThreadStore()): ThreadService {
  const sessionStore = new InMemorySessionStore()
  const eventBus = new InMemoryEventBus()
  const nowIso = () => '2026-08-14T00:00:00.000Z'
  return new ThreadService({
    threadStore: store,
    sessionStore,
    events: new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    }),
    ids: new SequentialIdGenerator(),
    nowIso
  })
}

async function seedThreads(service: ThreadService): Promise<{ code: ThreadRecord; ade: ThreadRecord }> {
  const code = await service.create({
    title: 'legacy code thread', workspace: '/repo', model: 'm', mode: 'agent'
  })
  const ade = await service.create({
    title: 'ade manager thread',
    workspace: '/repo',
    model: 'm',
    mode: 'agent',
    workspaceMode: 'ade'
  })
  return { code, ade }
}

describe('ThreadService workspace mode', () => {
  it('persists workspaceMode at create and projects it onto the summary', async () => {
    const service = serviceWith()
    const { ade } = await seedThreads(service)
    expect(ade.workspaceMode).toBe('ade')
    expect(service.toSummary(ade).workspaceMode).toBe('ade')
  })

  it('lists legacy threads only under the code mode and ade threads only under ade', async () => {
    const service = serviceWith()
    const { code, ade } = await seedThreads(service)

    const codeList = await service.list({ workspaceMode: 'code' })
    expect(codeList.map((thread) => thread.id)).toEqual([code.id])

    const adeList = await service.list({ workspaceMode: 'ade' })
    expect(adeList.map((thread) => thread.id)).toEqual([ade.id])

    const all = await service.list()
    expect(all.map((thread) => thread.id).sort()).toEqual([ade.id, code.id].sort())
  })

  it('applies the workspace mode filter on the paginated fallback path', async () => {
    const service = serviceWith()
    const { code, ade } = await seedThreads(service)

    const codePage = await service.listPage({ workspaceMode: 'code' })
    expect(codePage.threads.map((thread) => thread.id)).toEqual([code.id])
    const adePage = await service.listPage({ workspaceMode: 'ade' })
    expect(adePage.threads.map((thread) => thread.id)).toEqual([ade.id])
  })

  it('scopes search to the requested workspace mode', async () => {
    const service = serviceWith()
    await seedThreads(service)
    const matches = await service.list({ workspaceMode: 'ade', search: 'manager' })
    expect(matches).toHaveLength(1)
    expect(matches[0]?.workspaceMode).toBe('ade')
    const none = await service.list({ workspaceMode: 'code', search: 'manager' })
    expect(none).toHaveLength(0)
  })

  it('forks inherit the source workspace mode', async () => {
    const service = serviceWith()
    const { code, ade } = await seedThreads(service)
    const codeFork = await service.fork(code.id)
    expect(codeFork.workspaceMode).toBeUndefined()
    const adeFork = await service.fork(ade.id)
    expect(adeFork.workspaceMode).toBe('ade')
  })

  it('rejects workspaceMode changes through the update contract', async () => {
    expect(
      UpdateThreadRequest.safeParse({ workspaceMode: 'ade' }).success
    ).toBe(false)
    expect(
      UpdateThreadRequest.safeParse({ title: 'x', workspaceMode: 'code' }).success
    ).toBe(false)
    expect(UpdateThreadRequest.safeParse({ title: 'x' }).success).toBe(true)
  })

  it('parses the workspace_mode list query and rejects unknown modes', () => {
    const ok = threadsRouteInternal.parseListThreadsOptions(
      new Request('http://kun.local/v1/threads?workspace_mode=ade')
    )
    expect(ok).toEqual({ ok: true, options: expect.objectContaining({ workspaceMode: 'ade' }) })
    const bad = threadsRouteInternal.parseListThreadsOptions(
      new Request('http://kun.local/v1/threads?workspace_mode=bot')
    )
    expect(bad.ok).toBe(false)
  })
})

describe('manager tool advertisement', () => {
  it('advertises only for native-loop ADE primary threads', () => {
    const base = { workspaceMode: 'ade' as const }
    expect(shouldAdvertiseManagerTools(base)).toBe(true)
    expect(shouldAdvertiseManagerTools({ ...base, harnessId: 'kun' })).toBe(true)
    // Missing workspaceMode counts as code: no manager tools.
    expect(shouldAdvertiseManagerTools({})).toBe(false)
    expect(shouldAdvertiseManagerTools({ workspaceMode: 'code' })).toBe(false)
    // External harnesses never manage workers.
    expect(shouldAdvertiseManagerTools({ ...base, harnessId: 'claude-code' })).toBe(false)
    // Workers cannot create nested teams.
    expect(shouldAdvertiseManagerTools({ ...base, executionUnitKind: 'worker' })).toBe(false)
    // Room agents keep the Rooms member protocol.
    expect(shouldAdvertiseManagerTools({ ...base, roomAgent: true })).toBe(false)
  })
})
