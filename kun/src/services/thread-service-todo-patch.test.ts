import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../domain/thread.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { ThreadService } from './thread-service.js'

const temporary: string[] = []
afterEach(async () => Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe('ThreadService.patchTodoStatus', () => {
  it('atomically enforces one in-progress todo and updates Plan checkboxes', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-todo-patch-'))
    temporary.push(workspace)
    await mkdir(join(workspace, '.kunsdd', 'plan'), { recursive: true })
    const planPath = join(workspace, '.kunsdd', 'plan', 'demo.md')
    await writeFile(planPath, '- [ ] First\n- [ ] Second\n')
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-08-31T12:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus, sessionStore, allocateSeq: (id) => eventBus.allocateSeq(id), nowIso
    })
    const service = new ThreadService({
      threadStore, sessionStore, events, ids: new SequentialIdGenerator(), nowIso
    })
    const thread = createThreadRecord({ id: 'thr_1', title: 'Thread', workspace, model: 'test' })
    thread.todos = {
      threadId: thread.id, updatedAt: nowIso(), items: [
        {
          id: 'first', content: 'First', status: 'in_progress',
          source: { kind: 'plan', planId: 'plan', relativePath: '.kunsdd/plan/demo.md', ordinal: 0, contentHash: 'a' },
          createdAt: nowIso(), updatedAt: nowIso()
        },
        {
          id: 'second', content: 'Second', status: 'pending',
          source: { kind: 'plan', planId: 'plan', relativePath: '.kunsdd/plan/demo.md', ordinal: 1, contentHash: 'b' },
          createdAt: nowIso(), updatedAt: nowIso()
        }
      ]
    }
    await threadStore.upsert(thread)

    const next = await service.patchTodoStatus('thr_1', 'second', 'in_progress')
    expect(next.items.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: 'first', status: 'pending' },
      { id: 'second', status: 'in_progress' }
    ])
    await service.patchTodoStatus('thr_1', 'second', 'completed')
    expect(await readFile(planPath, 'utf8')).toBe('- [ ] First\n- [x] Second\n')
  })

  it('patches multiple Todo statuses with one thread mutation and one Plan rewrite', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-todo-bulk-patch-'))
    temporary.push(workspace)
    await mkdir(join(workspace, '.kunsdd', 'plan'), { recursive: true })
    const planPath = join(workspace, '.kunsdd', 'plan', 'demo.md')
    await writeFile(planPath, '- [ ] First\n- [ ] Second\n')
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-08-31T12:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus, sessionStore, allocateSeq: (id) => eventBus.allocateSeq(id), nowIso
    })
    const service = new ThreadService({
      threadStore, sessionStore, events, ids: new SequentialIdGenerator(), nowIso
    })
    const thread = createThreadRecord({ id: 'thr_bulk', title: 'Thread', workspace, model: 'test' })
    thread.todos = {
      threadId: thread.id,
      updatedAt: nowIso(),
      items: ['First', 'Second'].map((content, ordinal) => ({
        id: `todo_${ordinal}`,
        content,
        status: 'pending' as const,
        source: {
          kind: 'plan' as const,
          planId: 'plan',
          relativePath: '.kunsdd/plan/demo.md',
          ordinal,
          contentHash: String(ordinal)
        },
        createdAt: nowIso(),
        updatedAt: nowIso()
      }))
    }
    await threadStore.upsert(thread)
    const upsert = vi.spyOn(threadStore, 'upsert')

    const next = await service.patchTodoStatuses(
      thread.id,
      ['todo_0', 'todo_1'],
      'pending',
      'completed'
    )

    expect(next.items.every((item) => item.status === 'completed')).toBe(true)
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(await readFile(planPath, 'utf8')).toBe('- [x] First\n- [x] Second\n')
  })
})
