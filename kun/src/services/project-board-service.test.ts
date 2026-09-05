import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileProjectBoardStore } from '../adapters/file/file-project-board-store.js'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../domain/thread.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { ProjectBoardService } from './project-board-service.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { ThreadService } from './thread-service.js'
import { ProjectBoardPlanMetadataCache } from './project-board-plan-metadata-cache.js'

const temporary: string[] = []
afterEach(async () => Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

async function harness(options: { planMetadataCache?: ProjectBoardPlanMetadataCache } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'kun-project-board-service-'))
  temporary.push(root)
  const workspace = join(root, 'project')
  await mkdir(join(workspace, '.kunsdd', 'plan'), { recursive: true })
  await writeFile(join(workspace, '.kunsdd', 'plan', 'demo.md'), [
    '## Runtime',
    '- [ ] Build board API',
    '  Persist project tasks safely.'
  ].join('\n'))
  const threads = new InMemoryThreadStore()
  let tick = 0
  const nowIso = () => new Date(Date.UTC(2026, 7, 31, 0, 0, tick++)).toISOString()
  const sessionStore = new InMemorySessionStore()
  const eventBus = new InMemoryEventBus()
  const events = new RuntimeEventRecorder({
    eventBus,
    sessionStore,
    allocateSeq: (id) => eventBus.allocateSeq(id),
    nowIso
  })
  const threadService = new ThreadService({
    threadStore: threads,
    sessionStore,
    events,
    ids: new SequentialIdGenerator(),
    nowIso
  })
  const store = new FileProjectBoardStore({ dataDir: join(root, 'data'), nowIso })
  const service = new ProjectBoardService({
    store,
    threadStore: threads,
    threadService,
    planMetadataCache: options.planMetadataCache,
    ids: new SequentialIdGenerator(),
    nowIso
  })
  return { workspace, threads, threadService, store, service, nowIso }
}

describe('ProjectBoardService', () => {
  it('federates only Plan todos and keeps manual cards workspace-scoped', async () => {
    const { workspace, threads, service } = await harness()
    const thread = createThreadRecord({ id: 'thr_plan', title: 'Plan thread', workspace, model: 'test' })
    thread.todos = {
      threadId: thread.id,
      updatedAt: '2026-08-31T00:00:00.000Z',
      items: [
        {
          id: 'todo_plan', content: 'Build board API', status: 'pending',
          source: { kind: 'plan', planId: 'plan_1', relativePath: '.kunsdd/plan/demo.md', ordinal: 0, contentHash: 'hash' },
          createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z'
        },
        {
          id: 'todo_temp', content: 'Temporary agent step', status: 'pending',
          createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z'
        }
      ]
    }
    await threads.upsert(thread)

    const initial = await service.snapshot({ workspace })
    expect(initial.cards).toHaveLength(1)
    expect(initial.cards[0]).toMatchObject({
      id: 'todo:thr_plan:todo_plan',
      description: 'Persist project tasks safely.',
      source: { sectionTitle: 'Runtime' }
    })

    const next = await service.createManualCard({
      workspace, expectedRevision: initial.revision, title: 'Manual card', description: '',
      status: 'in_progress', category: 'bug', priority: 'P0'
    })
    expect(next.revision).toBe(1)
    expect(next.counts).toMatchObject({ total: 2, inProgress: 1 })
    expect(next.cards[0]).toMatchObject({ kind: 'manual', priority: 'P0' })
  })

  it('stores overlays by thread and todo identity without changing Plan titles', async () => {
    const { workspace, threads, service } = await harness()
    const thread = createThreadRecord({ id: 'thr_plan', title: 'Plan thread', workspace, model: 'test' })
    thread.todos = {
      threadId: thread.id, updatedAt: '2026-08-31T00:00:00.000Z',
      items: [{
        id: 'same_id', content: 'Authoritative title', status: 'pending',
        source: { kind: 'plan', planId: 'plan_1', relativePath: '.kunsdd/plan/demo.md', ordinal: 0, contentHash: 'hash' },
        createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z'
      }]
    }
    await threads.upsert(thread)
    const initial = await service.snapshot({ workspace })
    const next = await service.patchTodoOverlay('thr_plan', 'same_id', {
      workspace, expectedRevision: initial.revision, category: 'api', priority: 'P1',
      description: 'Board-only detail'
    })
    expect(next.cards[0]).toMatchObject({
      title: 'Authoritative title', category: 'api', priority: 'P1', description: 'Board-only detail'
    })
  })

  it('folds a custom Git worktree thread into its main project board', async () => {
    const { workspace, threads, service } = await harness()
    const worktree = `${workspace}.worktrees/feature-board`
    await mkdir(worktree, { recursive: true })
    await writeFile(join(worktree, '.git'), `gitdir: ${workspace}/.git/worktrees/feature-board\n`)
    const thread = createThreadRecord({ id: 'thr_worktree', title: 'Worktree', workspace: worktree, model: 'test' })
    thread.todos = {
      threadId: thread.id, updatedAt: '2026-08-31T00:00:00.000Z',
      items: [{
        id: 'todo_worktree', content: 'Build in worktree', status: 'pending',
        source: { kind: 'plan', planId: 'plan_1', relativePath: '.kunsdd/plan/demo.md', ordinal: 0, contentHash: 'hash' },
        createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z'
      }]
    }
    await threads.upsert(thread)
    const snapshot = await service.snapshot({ workspace })
    expect(snapshot.cards.map((card) => card.id)).toContain('todo:thr_worktree:todo_worktree')
  })

  it('builds batch summaries from one thread inventory read', async () => {
    const { workspace, threads, service } = await harness()
    const other = `${workspace}-other`
    await mkdir(other)
    const list = vi.spyOn(threads, 'list')

    const summaries = await service.summaries([workspace, other])

    expect(summaries).toHaveLength(2)
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('builds summaries without loading Plan Markdown metadata', async () => {
    const planMetadataCache = new ProjectBoardPlanMetadataCache()
    const load = vi.spyOn(planMetadataCache, 'load')
    const { workspace, threads, service } = await harness({ planMetadataCache })
    const thread = createThreadRecord({ id: 'thr_summary', title: 'Summary', workspace, model: 'test' })
    thread.todos = {
      threadId: thread.id,
      updatedAt: '2026-08-31T00:00:00.000Z',
      items: [{
        id: 'todo',
        content: 'Task',
        status: 'completed',
        source: {
          kind: 'plan', planId: 'plan', relativePath: '.kunsdd/plan/demo.md',
          ordinal: 0, contentHash: 'hash'
        },
        createdAt: '2026-08-31T00:00:00.000Z',
        updatedAt: '2026-08-31T00:00:00.000Z'
      }]
    }
    await threads.upsert(thread)
    const [summary] = await service.summaries([workspace])
    expect(summary).toMatchObject({ total: 1, completed: 1 })
    expect(load).not.toHaveBeenCalled()
  })

  it('coalesces concurrent snapshot and summary membership scans', async () => {
    const { workspace, threads, service } = await harness()
    const originalList = threads.list.bind(threads)
    let releaseList: (() => void) | undefined
    const listGate = new Promise<void>((resolve) => {
      releaseList = resolve
    })
    const list = vi.spyOn(threads, 'list').mockImplementation(async (options) => {
      await listGate
      return originalList(options)
    })
    const membershipScans = vi.spyOn(
      service as unknown as { boardThreadMemberships: () => Promise<unknown> },
      'boardThreadMemberships'
    )
    const snapshot = service.snapshot({ workspace })
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    const summaries = service.summaries([workspace])
    await vi.waitFor(() => expect(membershipScans).toHaveBeenCalledTimes(2))
    releaseList?.()
    await Promise.all([snapshot, summaries])
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('moves mixed manual and Plan cards with one Board revision and grouped Todo write', async () => {
    const { workspace, threads, service } = await harness()
    await writeFile(join(workspace, '.kunsdd', 'plan', 'demo.md'), '- [ ] First\n- [ ] Second\n')
    const thread = createThreadRecord({ id: 'thr_bulk', title: 'Bulk', workspace, model: 'test' })
    thread.todos = {
      threadId: thread.id,
      updatedAt: '2026-08-31T00:00:00.000Z',
      items: ['First', 'Second'].map((content, ordinal) => ({
        id: `todo_${ordinal}`,
        content,
        status: 'pending' as const,
        source: {
          kind: 'plan' as const,
          planId: 'plan_bulk',
          relativePath: '.kunsdd/plan/demo.md',
          ordinal,
          contentHash: String(ordinal)
        },
        createdAt: '2026-08-31T00:00:00.000Z',
        updatedAt: '2026-08-31T00:00:00.000Z'
      }))
    }
    await threads.upsert(thread)
    const initial = await service.snapshot({ workspace })
    const withManual = await service.createManualCard({
      workspace,
      expectedRevision: initial.revision,
      title: 'Manual',
      description: '',
      status: 'pending',
      category: 'other',
      priority: null
    })
    const manualId = withManual.cards.find((card) => card.kind === 'manual')?.id
    expect(manualId).toBeTruthy()

    const result = await service.patchCardStatuses({
      workspace,
      expectedRevision: withManual.revision,
      cardIds: [manualId!, 'todo:thr_bulk:todo_0', 'todo:thr_bulk:todo_1'],
      fromStatus: 'pending',
      status: 'completed'
    })

    expect(result.failures).toEqual([])
    expect(result.revision).toBe(withManual.revision + 1)
    expect(result.updatedCards).toHaveLength(3)
    expect(result.counts).toMatchObject({ total: 3, completed: 3 })
    expect((await threads.get('thr_bulk'))?.todos?.items.every((item) =>
      item.status === 'completed')).toBe(true)
  })

  it('rejects multiple selected Plan todos from one thread entering in-progress', async () => {
    const { workspace, threads, service } = await harness()
    const thread = createThreadRecord({ id: 'thr_conflict', title: 'Conflict', workspace, model: 'test' })
    thread.todos = {
      threadId: thread.id,
      updatedAt: '2026-08-31T00:00:00.000Z',
      items: ['one', 'two'].map((id, ordinal) => ({
        id,
        content: id,
        status: 'pending' as const,
        source: {
          kind: 'plan' as const,
          planId: 'plan',
          relativePath: '.kunsdd/plan/demo.md',
          ordinal,
          contentHash: id
        },
        createdAt: '2026-08-31T00:00:00.000Z',
        updatedAt: '2026-08-31T00:00:00.000Z'
      }))
    }
    await threads.upsert(thread)

    await expect(service.patchCardStatuses({
      workspace,
      expectedRevision: 0,
      cardIds: ['todo:thr_conflict:one', 'todo:thr_conflict:two'],
      fromStatus: 'pending',
      status: 'in_progress'
    })).rejects.toMatchObject({ code: 'in_progress_conflict' })
    expect((await threads.get(thread.id))?.todos?.items.map((item) => item.status))
      .toEqual(['pending', 'pending'])
  })

  it('updates 500 manual cards in one Board Store mutation', async () => {
    const { workspace, store, service, nowIso } = await harness()
    await store.mutate(await realpath(workspace), 0, (document) => {
      for (let index = 0; index < 500; index += 1) {
        const id = `manual_${index}`
        const now = nowIso()
        document.manualCards[id] = {
          id,
          title: id,
          description: '',
          status: 'pending',
          category: 'other',
          priority: null,
          archived: false,
          createdAt: now,
          updatedAt: now
        }
      }
      return document
    })
    const result = await service.patchCardStatuses({
      workspace,
      expectedRevision: 1,
      cardIds: Array.from({ length: 500 }, (_, index) => `manual:manual_${index}`),
      fromStatus: 'pending',
      status: 'completed'
    })
    expect(result.revision).toBe(2)
    expect(result.updatedCards).toHaveLength(500)
    expect(result.counts.completed).toBe(500)
  })

  it('returns partial failures while preserving successful thread groups', async () => {
    const { workspace, store, threads, threadService, nowIso } = await harness()
    for (const id of ['ok', 'fail']) {
      const thread = createThreadRecord({ id: `thr_${id}`, title: id, workspace, model: 'test' })
      thread.todos = {
        threadId: thread.id,
        updatedAt: '2026-08-31T00:00:00.000Z',
        items: [{
          id: `todo_${id}`,
          content: id === 'ok' ? 'Build board API' : 'Failure',
          status: 'pending',
          source: {
            kind: 'plan', planId: `plan_${id}`, relativePath: '.kunsdd/plan/demo.md',
            ordinal: 0, contentHash: id
          },
          createdAt: '2026-08-31T00:00:00.000Z',
          updatedAt: '2026-08-31T00:00:00.000Z'
        }]
      }
      await threads.upsert(thread)
    }
    const service = new ProjectBoardService({
      store,
      threadStore: threads,
      threadService: {
        patchTodoStatuses: async (threadId, todoIds, fromStatus, status) => {
          if (threadId === 'thr_fail') throw new Error('injected write failure')
          return threadService.patchTodoStatuses(threadId, todoIds, fromStatus, status)
        }
      },
      ids: new SequentialIdGenerator(),
      nowIso
    })
    const result = await service.patchCardStatuses({
      workspace,
      expectedRevision: 0,
      cardIds: ['todo:thr_ok:todo_ok', 'todo:thr_fail:todo_fail'],
      fromStatus: 'pending',
      status: 'completed'
    })
    expect(result.updatedCards.map((card) => card.id)).toEqual(['todo:thr_ok:todo_ok'])
    expect(result.failures).toMatchObject([{ cardId: 'todo:thr_fail:todo_fail' }])
    expect(result.counts).toMatchObject({ pending: 1, completed: 1 })
  })
})
