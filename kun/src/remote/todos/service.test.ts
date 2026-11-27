import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { remoteFixture } from '../testing/runtime.test-support.js'

describe('remote session todos', () => {
  it('projects execution tasks, plan metadata, code.list todoProgress, and code.history todoSnapshot without leaking host paths', async () => {
    const f = await remoteFixture()
    try {
      const thread = await f.code('Implement checklist')
      const planDir = join(f.root, '.kunsdd', 'plan')
      await mkdir(planDir, { recursive: true })
      const relativePath = '.kunsdd/plan/mobile-todo-sync.md'
      await writeFile(
        join(f.root, relativePath),
        ['# Plan', '- [x] Upgrade protocol', '- [ ] Build mobile tray'].join('\n'),
        'utf8'
      )
      await f.h.threads.syncTodosFromPlan(thread.id, {
        planId: 'plan_1',
        relativePath,
        markdown: ['# Plan', '- [x] Upgrade protocol', '- [ ] Build mobile tray'].join('\n'),
        mode: 'plan_write'
      })

      const created = await f.h.threads.executionTasks.create(thread.id, {
        clientRequestId: 'req_extra',
        title: 'Verify blocked error state',
        acceptance: 'Tray shows blocked pill'
      })
      await f.h.threads.executionTasks.update(thread.id, created.task.id, {
        clientRequestId: 'req_block',
        expectedRevision: created.task.revision,
        status: 'blocked',
        reason: 'Waiting for user decision on layout',
        evidence: [{ summary: 'Checked canvas artboard 02', reference: 'cb_2ed4f6474393' }]
      })

      const snapshot = await f.call('todo.thread.get', { threadId: thread.id })
      expect(snapshot.threadId).toBe(thread.id)
      expect(snapshot.outlineOnly).toBe(false)
      expect(snapshot.planPath).toBe(relativePath)
      expect(snapshot.projectId).toMatch(/^[a-f0-9]{64}$/)
      expect(JSON.stringify(snapshot)).not.toContain(f.root)
      expect(snapshot.items).toHaveLength(3)
      expect(snapshot.items[0]).toMatchObject({
        content: 'Upgrade protocol',
        status: 'completed',
        taskStatus: 'succeeded',
        source: { kind: 'plan', planId: 'plan_1', relativePath, ordinal: 0 }
      })
      expect(snapshot.items[2]).toMatchObject({
        content: 'Verify blocked error state',
        status: 'pending',
        taskStatus: 'blocked',
        reason: 'Waiting for user decision on layout',
        evidence: [{ summary: 'Checked canvas artboard 02', reference: 'cb_2ed4f6474393' }]
      })

      const list = await f.call('code.list', {})
      const summary = list.threads.find((row: any) => row.id === thread.id)
      expect(summary?.todoProgress).toEqual({
        completed: 1,
        total: 3,
        blocked: 1
      })

      const history = await f.call('code.history', { threadId: thread.id })
      expect(history.todoSnapshot).toEqual(snapshot)
    } finally {
      await f.close()
    }
  })

  it('marks outlineOnly when an active graph run owns session progress', async () => {
    const f = await remoteFixture()
    try {
      const thread = await f.code('Graph orchestrated session')
      await f.h.threads.executionTasks.create(thread.id, {
        clientRequestId: 'req_1',
        title: 'Compile graph nodes'
      })
      ;(f.runtime as any).graph = {
        store: {
          list: async () => [{ id: 'run_1', status: 'running' }]
        }
      }
      const snapshot = await f.call('todo.thread.get', { threadId: thread.id })
      expect(snapshot.outlineOnly).toBe(true)
    } finally {
      await f.close()
    }
  })
})
