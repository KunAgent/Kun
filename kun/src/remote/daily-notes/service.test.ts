import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RemoteDailyNotes } from './service.js'
import type { Envelope } from '../contracts.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function makeEnvelope(method: Envelope['call']['method'], requestId: string, params: Record<string, unknown>): Envelope {
  return {
    accountId: 'acct_test',
    deviceId: 'dev_mobile',
    authorizationId: 'auth_test',
    scopes: ['personal'],
    call: {
      method,
      requestId,
      expiresAt: Date.now() + 60_000,
      params
    }
  }
}

describe('RemoteDailyNotes', () => {
  it('supports create, idempotent replay, quadrant/done/notes updates, moveToDay, rollover, delete, and live thread link hydration', async () => {
    const dailyNotesDir = await mkdtemp(join(tmpdir(), 'kun-remote-daily-notes-'))
    tempDirs.push(dailyNotesDir)

    const mockThreads = new Map<string, any>([
      [
        'thread_fast',
        {
          id: 'thread_fast',
          title: '排障助手开放 tool',
          status: 'running',
          turns: [{ id: 'turn_1', status: 'running', items: [] }],
          todos: {
            revision: 2,
            updatedAt: '2026-11-27T10:00:00Z',
            items: [
              { id: '1', content: 'step 1', status: 'completed', createdAt: '2026-11-27T09:00:00Z', updatedAt: '2026-11-27T09:10:00Z' },
              { id: '2', content: 'step 2', status: 'completed', createdAt: '2026-11-27T09:00:00Z', updatedAt: '2026-11-27T09:20:00Z' },
              { id: '3', content: 'step 3', status: 'in_progress', createdAt: '2026-11-27T09:00:00Z', updatedAt: '2026-11-27T09:30:00Z' }
            ]
          }
        }
      ]
    ])

    const service = new RemoteDailyNotes({
      dailyNotesDir,
      threadService: {
        getMetadata: async (id: string) => mockThreads.get(id) ?? null
      }
    } as any)

    // 1. Create a Q1 task with notes and Kun thread link on 2026-11-26
    const createParams = {
      day: '2026-11-26',
      title: 'p0 codemaker hub 排障助手要开放 tool',
      notes: ['[图片]', 'https://api-kun-server.com/health'],
      quadrant: 1 as const,
      link: { label: '会话', url: 'kun://thread/thread_fast' }
    }
    const createdPage = await service.dispatch(
      makeEnvelope('daily.notes.create', 'req_create_1', createParams),
      createParams
    ) as any
    expect(createdPage.tasks).toHaveLength(1)
    expect(createdPage.tasks[0]).toMatchObject({
      day: '2026-11-26',
      line: 0,
      title: 'p0 codemaker hub 排障助手要开放 tool',
      quadrant: 1,
      done: false,
      notes: ['[图片]', 'https://api-kun-server.com/health'],
      link: {
        kind: 'thread',
        threadId: 'thread_fast',
        statusTone: 'running',
        statusText: '执行中 2/3',
        progress: { completed: 2, total: 3 }
      }
    })

    // 2. Idempotent create replay with identical requestId does not duplicate task
    const replayPage = await service.dispatch(
      makeEnvelope('daily.notes.create', 'req_create_1', createParams),
      createParams
    ) as any
    expect(replayPage.tasks).toHaveLength(1)

    // 3. Recover receipt confirms created page
    const recovered = await service.recover(
      { accountId: 'acct_test', deviceId: 'dev_mobile', authorizationId: 'auth_test' },
      { requestId: 'req_create_1', method: 'daily.notes.create', status: 'reconciliation_required', params: createParams } as any
    )
    expect(recovered?.tasks).toHaveLength(1)

    // 4. Add a second unsorted task on 2026-11-26 and mark it done
    const page2 = await service.dispatch(
      makeEnvelope('daily.notes.create', 'req_create_2', { day: '2026-11-26', title: 'devin', quadrant: null }),
      { day: '2026-11-26', title: 'devin', quadrant: null }
    ) as any
    expect(page2.tasks).toHaveLength(2)

    const doneUpdate = await service.dispatch(
      makeEnvelope('daily.notes.update', 'req_upd_1', {}),
      {
        day: '2026-11-26',
        line: page2.tasks[1].line,
        expectedRevision: page2.revision,
        done: true,
        quadrant: 4
      }
    ) as any
    expect(doneUpdate.page.completed).toBe(1)
    expect(doneUpdate.page.tasks[1].quadrant).toBe(4)

    // 5. Rollover incomplete tasks from 2026-11-26 -> 2026-11-27
    const rolled = await service.dispatch(
      makeEnvelope('daily.notes.rollover', 'req_roll_1', {}),
      { fromDay: '2026-11-26', toDay: '2026-11-27', expectedFromRevision: doneUpdate.page.revision }
    ) as any
    expect(rolled.movedCount).toBe(1)
    expect(rolled.fromPage.tasks).toHaveLength(1)
    expect(rolled.fromPage.tasks[0].done).toBe(true)
    expect(rolled.toPage.tasks).toHaveLength(1)
    expect(rolled.toPage.tasks[0].title).toBe('p0 codemaker hub 排障助手要开放 tool')
    expect(rolled.toPage.tasks[0].notes).toEqual(['[图片]', 'https://api-kun-server.com/health'])

    // 6. Reschedule (moveToDay) from 2026-11-27 -> 2026-12-11 while changing quadrant
    const moved = await service.dispatch(
      makeEnvelope('daily.notes.update', 'req_move_1', {}),
      {
        day: '2026-11-27',
        line: 0,
        expectedRevision: rolled.toPage.revision,
        quadrant: 2,
        moveToDay: '2026-12-11'
      }
    ) as any
    expect(moved.page.tasks).toHaveLength(0)
    expect(moved.movedToPage.tasks).toHaveLength(1)
    expect(moved.movedToPage.tasks[0].quadrant).toBe(2)

    // 7. Stale revision conflict rejected cleanly
    await expect(
      service.preflight('daily.notes.delete', {
        day: '2026-12-11',
        line: 0,
        expectedRevision: rolled.toPage.revision
      })
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })

    // 8. Delete task on 2026-12-11
    const afterDelete = await service.dispatch(
      makeEnvelope('daily.notes.delete', 'req_del_1', {}),
      {
        day: '2026-12-11',
        line: 0,
        expectedRevision: moved.movedToPage.revision
      }
    ) as any
    expect(afterDelete.tasks).toHaveLength(0)
  })
})
