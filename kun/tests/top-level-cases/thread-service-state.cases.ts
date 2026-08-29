import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemorySessionStore } from '../../src/adapters/in-memory-session-store.js'
import { InMemoryEventBus } from '../../src/adapters/in-memory-event-bus.js'
import { InMemoryThreadStore } from '../../src/adapters/in-memory-thread-store.js'
import { SequentialIdGenerator } from '../../src/ports/id-generator.js'
import { ThreadService } from '../../src/services/thread-service.js'
import { RuntimeEventRecorder } from '../../src/services/runtime-event-recorder.js'
import { createThreadRecord, touchThread } from '../../src/domain/thread.js'
import { createTurnRecord, startTurn } from '../../src/domain/turn.js'
import { makeAssistantTextItem, makeToolCallItem, makeToolResultItem, makeUserItem } from '../../src/domain/item.js'
import type { TurnItem } from '../../src/contracts/items.js'
import { DEFAULT_KUN_MODEL } from '../../src/config/kun-config.js'
import { buildService, seedParentWithTurns, withId } from '../support/thread-service-fixtures.js'

describe('ThreadService goals', () => {
  it('sets, updates, and clears a thread goal', async () => {
    const { service, sessionStore } = buildService()
    await service.create(
      { workspace: '/tmp/p', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_goal', title: 'Goal thread' }
    )

    const goal = await service.setGoal('thr_goal', {
      objective: 'ship goal mode',
      status: 'active',
      tokenBudget: 5000
    })
    expect(goal).toMatchObject({
      threadId: 'thr_goal',
      objective: 'ship goal mode',
      status: 'active',
      tokenBudget: 5000,
      tokensUsed: 0,
      timeUsedSeconds: 0
    })
    expect((await service.getGoal('thr_goal'))?.objective).toBe('ship goal mode')

    const paused = await service.setGoal('thr_goal', { status: 'paused' })
    expect(paused.status).toBe('paused')
    expect(paused.objective).toBe('ship goal mode')

    expect(await service.clearGoal('thr_goal')).toBe(true)
    expect(await service.getGoal('thr_goal')).toBeNull()
    expect(await service.clearGoal('thr_goal')).toBe(false)

    const events = await sessionStore.loadEventsSince('thr_goal', 0)
    expect(events.map((event) => event.kind)).toContain('goal_updated')
    expect(events.map((event) => event.kind)).toContain('goal_cleared')
  })

  it('accumulates goal token usage and marks a reached budget as usage limited', async () => {
    const { service } = buildService()
    await service.create({ workspace: '/tmp/p', model: 'm', mode: 'agent' }, { id: 'thr_goal_usage' })
    await service.setGoal('thr_goal_usage', { objective: 'bounded work', tokenBudget: 100 })

    await expect(service.recordGoalUsage('thr_goal_usage', 60)).resolves.toMatchObject({
      tokensUsed: 60,
      status: 'active'
    })
    await expect(service.recordGoalUsage('thr_goal_usage', 40)).resolves.toMatchObject({
      tokensUsed: 100,
      status: 'usageLimited'
    })
  })

  it('rejects status-only updates when no goal exists', async () => {
    const { service } = buildService()
    await service.create(
      { workspace: '/tmp/p', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_empty', title: 'Goal thread' }
    )

    await expect(service.setGoal('thr_empty', { status: 'paused' })).rejects.toThrow(/no goal exists/)
  })
})

describe('ThreadService todos', () => {
  it('syncs plan checklists, patches linked checkboxes, and preserves removed tasks', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-todos-'))
    try {
      const relativePath = '.kunsdd/plan/demo.md'
      const absolutePath = join(workspace, relativePath)
      await mkdir(join(workspace, '.kunsdd', 'plan'), { recursive: true })
      const originalMarkdown = '# Plan\n\n- [ ] Build UI\n- [x] Add tests\n'
      await writeFile(absolutePath, originalMarkdown, 'utf-8')

      const { service, sessionStore } = buildService()
      await service.create(
        { workspace, model: 'deepseek-chat', mode: 'agent' },
        { id: 'thr_todos', title: 'Todos' }
      )

      const synced = await service.syncTodosFromPlan('thr_todos', {
        planId: 'plan_1',
        relativePath,
        markdown: originalMarkdown,
        mode: 'document_edit'
      })
      expect(synced.items.map((item) => [item.content, item.status])).toEqual([
        ['Build UI', 'pending'],
        ['Add tests', 'completed']
      ])

      const toggled = await service.setTodos('thr_todos', {
        todos: synced.items.map((item) => ({
          id: item.id,
          content: item.content,
          status: item.content === 'Build UI' ? 'completed' : item.status,
          source: item.source
        }))
      })
      expect(toggled.items.find((item) => item.content === 'Build UI')?.status).toBe('completed')
      expect(await readFile(absolutePath, 'utf-8')).toContain('- [x] Build UI')

      const rewrittenMarkdown = '# Plan\n\n- [ ] Add tests\n'
      const rewritten = await service.syncTodosFromPlan('thr_todos', {
        planId: 'plan_1',
        relativePath,
        markdown: rewrittenMarkdown,
        mode: 'document_edit'
      })
      expect(rewritten.items.find((item) => item.content === 'Build UI')).toBeUndefined()
      expect(rewritten.items.find((item) => item.content === 'Add tests')?.status).toBe('pending')

      const events = await sessionStore.loadEventsSince('thr_todos', 0)
      expect(events.some((event) => event.kind === 'todos_updated')).toBe(true)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('refuses to patch a plan path that escapes through a symlink', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-todos-workspace-'))
    const outside = await mkdtemp(join(tmpdir(), 'kun-todos-outside-'))
    try {
      const relativePath = '.kunsdd/plan/demo.md'
      const planDir = join(workspace, '.kunsdd', 'plan')
      const planPath = join(planDir, 'demo.md')
      const markdown = '# Plan\n\n- [ ] Keep this private\n'
      await mkdir(planDir, { recursive: true })
      await writeFile(planPath, markdown, 'utf-8')

      const { service } = buildService()
      await service.create(
        { workspace, model: 'deepseek-chat', mode: 'agent' },
        { id: 'thr_todos_symlink', title: 'Todos' }
      )
      const synced = await service.syncTodosFromPlan('thr_todos_symlink', {
        planId: 'plan_1',
        relativePath,
        markdown,
        mode: 'document_edit'
      })

      const outsidePlan = join(outside, 'demo.md')
      await writeFile(outsidePlan, markdown, 'utf-8')
      await rm(planDir, { recursive: true, force: true })
      await symlink(outside, planDir, 'dir')

      await expect(service.setTodos('thr_todos_symlink', {
        todos: synced.items.map((item) => ({
          id: item.id,
          content: item.content,
          status: 'completed' as const,
          source: item.source
        }))
      })).rejects.toThrow(/plan path escapes workspace/)
      await expect(readFile(outsidePlan, 'utf-8')).resolves.toBe(markdown)
    } finally {
      await rm(workspace, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
})

describe('ThreadService.list with relation filter', () => {
  it('hides side threads by default and includes them with includeSide', async () => {
    const { service } = buildService()
    await service.create(
      { workspace: '/tmp/p', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_main', title: 'Main' }
    )
    const side = await service.fork('thr_main', { relation: 'side' })
    const fork = await service.fork('thr_main', { relation: 'fork' })
    const def = await service.list()
    const ids = def.map((t) => t.id).sort()
    expect(ids).toEqual(['thr_main', fork.id].sort())
    expect(def.find((t) => t.id === side.id)).toBeUndefined()

    const all = await service.list({ includeSide: true })
    const allIds = all.map((t) => t.id).sort()
    expect(allIds).toEqual(['thr_main', fork.id, side.id].sort())
  })
})

describe('ThreadService agent surface ownership', () => {
  it('persists explicit ownership in create/list and carries it through fork and resume', async () => {
    const { service } = buildService()
    const created = await service.create(
      {
        workspace: '/tmp/design',
        model: 'deepseek-chat',
        mode: 'agent',
        agentSurface: 'design'
      },
      { id: 'thr_design_surface', title: 'Design drawing' }
    )

    expect(created.agentSurface).toBe('design')
    expect((await service.list()).find((thread) => thread.id === created.id)?.agentSurface).toBe('design')
    expect((await service.fork(created.id)).agentSurface).toBe('design')
    expect((await service.resumeSession(created.id)).thread.agentSurface).toBe('design')
  })
})

describe('ThreadService.resumeSession', () => {
  it('uses the Kun default model when resuming item-only legacy sessions', async () => {
    const { service, sessionStore } = buildService()
    await sessionStore.appendItem(
      'legacy_session',
      makeUserItem({
        id: 'item_legacy_user',
        turnId: 'turn_legacy',
        threadId: 'legacy_session',
        text: 'legacy prompt'
      })
    )

    const result = await service.resumeSession('legacy_session')

    expect(result.thread.model).toBe(DEFAULT_KUN_MODEL)
  })
})

describe('ThreadService.update relation', () => {
  it('clears parentThreadId when promoting a side thread to primary', async () => {
    const { service, threadStore } = buildService()
    await service.create(
      { workspace: '/tmp/p', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_p', title: 'Parent' }
    )
    const side = await service.fork('thr_p', { relation: 'side' })
    expect(side.parentThreadId).toBe('thr_p')
    const promoted = await service.update(side.id, { relation: 'primary' })
    expect(promoted.relation).toBe('primary')
    expect(promoted.parentThreadId).toBeUndefined()
    const fetched = await threadStore.get(side.id)
    expect(fetched?.relation).toBe('primary')
  })
})

describe('ThreadService + domain factory relation defaults', () => {
  it('createThreadRecord defaults relation to primary when unspecified', () => {
    const thread = createThreadRecord({
      id: 'thr_default',
      title: 'Default',
      workspace: '/tmp',
      model: 'deepseek-chat'
    })
    expect(thread.relation).toBe('primary')
    expect(thread.parentThreadId).toBeUndefined()
  })
})
