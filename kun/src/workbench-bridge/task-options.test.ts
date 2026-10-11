import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { WorkbenchLink } from '../contracts/workbench-links.js'
import { buildWorkbenchPlan, confirmWorkbenchLink, runNowWorkbenchLink, setSeriesPaused, updateScheduledWorkbenchLink } from './actions.js'
import { reconcileWorkbench } from './reconcile.js'
import { updateWorkbenchLink } from './link-store.js'
import { reconcileSchedules } from './schedule.js'
import { workbenchFixture, type WorkbenchFixture } from './workbench-test-support.js'

const open: WorkbenchFixture[] = []
afterEach(async () => { for (const fixture of open.splice(0)) await fixture.cleanup() })
async function fixture(options?: Parameters<typeof workbenchFixture>[0]) {
  const value = await workbenchFixture(options); open.push(value); return value
}
const row = (f: WorkbenchFixture, id: string) => f.store.get<WorkbenchLink>('workbench_link', id)
let serial = 0
const decision = (revision: number) => ({ clientRequestId: `options-${++serial}`, expectedRevision: revision })

describe('bot workbench task options', () => {
  it('freezes the chosen model and advances an automatic plan into a build turn once', async () => {
    const f = await fixture()
    const project = await f.makeDirectory('project')
    const created = (await f.run('create_code_task', { title: 'Fix SSE', goal: 'Fix reconnection', projectRoot: project,
      executionMode: 'auto' })).output as { linkId: string }
    const initial = (await row(f, created.linkId))!
    await confirmWorkbenchLink(f.bridge, f.room.id, created.linkId, { ...decision(initial.revision), edits: {
      execution: { mode: 'auto', model: { providerId: 'p1', model: 'chosen-model', reasoningEffort: 'high' },
        persona: { id: 'reviewer', name: 'Reviewer', text: 'Be precise.' }, permission: 'ask-for-approval' }
    } })
    await reconcileWorkbench(f.bridge)
    await reconcileWorkbench(f.bridge)
    const planning = (await row(f, created.linkId))!.value
    expect(f.stub.calls.enqueued[0].request).toMatchObject({ model: 'chosen-model', reasoningEffort: 'high',
      persona: 'Be precise.', mode: 'plan', guiPlan: { relativePath: planning.planPath } })
    const thread = f.stub.threads.get(planning.threadId!)!
    thread.turns[0].status = 'completed'
    await mkdir(dirname(join(thread.workspace, planning.planPath!)), { recursive: true })
    await writeFile(join(thread.workspace, planning.planPath!), '# Fix SSE\n- [ ] Implement\n')
    await reconcileWorkbench(f.bridge)
    expect((await row(f, created.linkId))!.value).toMatchObject({ phase: 'build', status: 'queued' })
    await reconcileWorkbench(f.bridge)
    await reconcileWorkbench(f.bridge)
    expect(f.stub.calls.enqueued).toHaveLength(2)
    expect(f.stub.calls.enqueued[1].request).toMatchObject({ model: 'chosen-model', mode: 'agent', reasoningEffort: 'high' })
    expect(String(f.stub.calls.enqueued[1].request.prompt)).toContain('Implement')
  })

  it('waits for the user to build a plan and rejects stale scheduled edits', async () => {
    const f = await fixture()
    const project = await f.makeDirectory('project')
    const created = (await f.run('create_code_task', { title: 'Planned', goal: 'Implement', projectRoot: project,
      executionMode: 'plan' }, 'plan-manual')).output as { linkId: string }
    const before = (await row(f, created.linkId))!
    await confirmWorkbenchLink(f.bridge, f.room.id, created.linkId, decision(before.revision))
    await reconcileWorkbench(f.bridge)
    await reconcileWorkbench(f.bridge)
    const planning = (await row(f, created.linkId))!.value
    const thread = f.stub.threads.get(planning.threadId!)!
    thread.turns[0].status = 'completed'
    await mkdir(dirname(join(thread.workspace, planning.planPath!)), { recursive: true })
    await writeFile(join(thread.workspace, planning.planPath!), '# Plan\n')
    await reconcileWorkbench(f.bridge)
    const ready = (await row(f, created.linkId))!
    expect(ready.value.status).toBe('plan_ready')
    await expect(buildWorkbenchPlan(f.bridge, f.room.id, created.linkId, decision(ready.revision + 1)))
      .rejects.toThrow('changed since')
    await buildWorkbenchPlan(f.bridge, f.room.id, created.linkId, decision(ready.revision))
    await reconcileWorkbench(f.bridge)
    expect(f.stub.calls.enqueued).toHaveLength(2)

    const scheduled = (await f.run('create_code_task', { title: 'Timed', goal: 'Implement', projectRoot: project,
      schedule: { kind: 'once', runAt: new Date(Date.now() + 120_000).toISOString(), timeZone: 'UTC' } },
    'plan-schedule')).output as { linkId: string }
    const proposal = (await row(f, scheduled.linkId))!
    await confirmWorkbenchLink(f.bridge, f.room.id, scheduled.linkId, decision(proposal.revision))
    const current = (await row(f, scheduled.linkId))!
    await expect(updateScheduledWorkbenchLink(f.bridge, f.room.id, scheduled.linkId, { ...decision(current.revision + 1),
      edits: { title: 'Changed' } })).rejects.toThrow('changed since')
    const changed = await updateScheduledWorkbenchLink(f.bridge, f.room.id, scheduled.linkId, { ...decision(current.revision),
      edits: { title: 'Changed' } })
    expect(changed.request.title).toBe('Changed')
  })

  it('runs an accepted single schedule after restart and marks a very late run missed', async () => {
    const f = await fixture()
    const project = await f.makeDirectory('project')
    const runAt = new Date(Date.now() + 120_000).toISOString()
    const create = async (callId: string) => {
      const created = (await f.run('create_code_task', { title: 'Scheduled', goal: 'Check', projectRoot: project,
        schedule: { kind: 'once', runAt, timeZone: 'UTC' } }, callId)).output as { linkId: string }
      const before = (await row(f, created.linkId))!
      expect(before.value.status).toBe('awaiting_confirmation')
      await confirmWorkbenchLink(f.bridge, f.room.id, created.linkId, decision(before.revision))
      return created.linkId
    }
    const due = await create('schedule-1')
    expect((await row(f, due))!.value.status).toBe('scheduled')
    await reconcileSchedules(f.bridge, Date.parse(runAt) + 1)
    expect((await row(f, due))!.value.status).toBe('queued')
    const late = await create('schedule-2')
    await reconcileSchedules(f.bridge, Date.parse(runAt) + 3 * 60 * 60_000)
    expect((await row(f, late))!.value.status).toBe('missed')
  })

  it('keeps a due task queued while the Agent is at its concurrency limit', async () => {
    const f = await fixture({ policy: { maxActiveTasks: 1 } })
    const project = await f.makeDirectory('project')
    const runAt = new Date(Date.now() + 120_000).toISOString()
    const ids: string[] = []
    for (let index = 0; index < 2; index++) {
      const created = (await f.run('create_code_task', { title: `Task ${index}`, goal: 'Check', projectRoot: project,
        schedule: { kind: 'once', runAt, timeZone: 'UTC' } }, `capacity-${index}`)).output as { linkId: string }
      const before = (await row(f, created.linkId))!
      await confirmWorkbenchLink(f.bridge, f.room.id, created.linkId, decision(before.revision))
      ids.push(created.linkId)
    }
    await reconcileSchedules(f.bridge, Date.parse(runAt) + 1)
    await reconcileWorkbench(f.bridge)
    const current = await Promise.all(ids.map((id) => row(f, id)))
    expect(current.filter((item) => item?.value.threadId)).toHaveLength(1)
    expect(current.find((item) => !item?.value.threadId)?.value.status).toBe('queued')
  })

  it('starts a goal with its budget and follows the goal status', async () => {
    const f = await fixture()
    const project = await f.makeDirectory('project')
    const created = (await f.run('create_code_task', { title: 'Keep improving', goal: 'Fix all failures', projectRoot: project,
      executionMode: 'goal', goalTokenBudget: 1000 }, 'goal-1')).output as { linkId: string }
    const before = (await row(f, created.linkId))!
    await confirmWorkbenchLink(f.bridge, f.room.id, created.linkId, { ...decision(before.revision), edits: { report: 'silent' } })
    await reconcileWorkbench(f.bridge)
    await reconcileWorkbench(f.bridge)
    const started = (await row(f, created.linkId))!.value
    const thread = f.stub.threads.get(started.threadId!)!
    expect(thread.goal).toMatchObject({ objective: 'Fix all failures', tokenBudget: 1000, status: 'active' })
    thread.turns[0].status = 'completed'
    thread.goal = { ...thread.goal!, status: 'budgetLimited', tokensUsed: 1000 }
    await reconcileWorkbench(f.bridge)
    expect((await row(f, created.linkId))!.value).toMatchObject({ status: 'needs_attention', goal: { status: 'budgetLimited', tokensUsed: 1000 } })
    thread.goal = { ...thread.goal, status: 'complete' }
    await reconcileWorkbench(f.bridge)
    expect((await row(f, created.linkId))!.value.status).toBe('completed')
  })

  it('creates one child per recurring occurrence and supports pause and manual run', async () => {
    const f = await fixture()
    const project = await f.makeDirectory('project')
    const date = new Date(Date.now() + 3 * 60_000)
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
    const created = (await f.run('create_code_task', { title: 'Daily check', goal: 'Check', projectRoot: project,
      schedule: { kind: 'recurring', every: 'day', time, timeZone: 'UTC', maxRuns: 3 } }, 'series-1')).output as { linkId: string }
    const before = (await row(f, created.linkId))!
    await confirmWorkbenchLink(f.bridge, f.room.id, created.linkId, decision(before.revision))
    const series = (await row(f, created.linkId))!.value
    expect(series).toMatchObject({ kind: 'schedule_series', status: 'active', runCount: 0, request: { report: 'silent' } })
    await reconcileSchedules(f.bridge, Date.parse(series.scheduledFor!) + 1)
    await reconcileSchedules(f.bridge, Date.parse(series.scheduledFor!) + 1)
    const after = (await row(f, created.linkId))!
    expect(after.value.runCount).toBe(1)
    expect(after.value.recentRunIds).toHaveLength(1)
    const child = (await row(f, after.value.recentRunIds![0]))!.value
    expect(child).toMatchObject({ status: 'queued', origin: { kind: 'series', seriesId: created.linkId, occurrence: 1 } })
    await reconcileSchedules(f.bridge, Date.parse(after.value.scheduledFor!) + 1)
    expect((await row(f, created.linkId))!.value.runCount).toBe(1)
    await reconcileWorkbench(f.bridge)
    const firstThreadId = (await row(f, child.id))!.value.threadId
    expect(firstThreadId).toBeTruthy()
    const beforePause = (await row(f, created.linkId))!
    const paused = await setSeriesPaused(f.bridge, f.room.id, created.linkId, decision(beforePause.revision), true)
    expect(paused.status).toBe('paused')
    await expect(runNowWorkbenchLink(f.bridge, f.room.id, created.linkId, decision(paused.revision)))
      .rejects.toThrow('already has a running task')
    await updateWorkbenchLink(f.bridge.store, f.room.id, child.id, () => ({ status: 'completed' }))
    await runNowWorkbenchLink(f.bridge, f.room.id, created.linkId, decision(paused.revision))
    expect((await row(f, created.linkId))!.value.runCount).toBe(2)
    await reconcileWorkbench(f.bridge)
    const secondId = (await row(f, created.linkId))!.value.recentRunIds![0]
    const secondThreadId = (await row(f, secondId))!.value.threadId
    expect(secondThreadId).toBeTruthy()
    expect(secondThreadId).not.toBe(firstThreadId)
    await updateWorkbenchLink(f.bridge.store, f.room.id, secondId, () => ({ status: 'completed' }))
    const beforeResume = (await row(f, created.linkId))!
    await setSeriesPaused(f.bridge, f.room.id, created.linkId, decision(beforeResume.revision), false)
    await reconcileSchedules(f.bridge, Date.parse(beforeResume.value.scheduledFor!) + 1)
    expect((await row(f, created.linkId))!.value).toMatchObject({ status: 'ended', runCount: 3 })
  })

  it('keeps the failure-only report policy on recurring children', async () => {
    const f = await fixture()
    const project = await f.makeDirectory('project')
    const date = new Date(Date.now() + 3 * 60_000)
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
    const created = (await f.run('create_code_task', { title: 'Failure report', goal: 'Check', projectRoot: project,
      schedule: { kind: 'recurring', every: 'day', time, timeZone: 'UTC' } }, 'failure-policy')).output as { linkId: string }
    const before = (await row(f, created.linkId))!
    await confirmWorkbenchLink(f.bridge, f.room.id, created.linkId, { ...decision(before.revision), edits: { report: 'failure' } })
    const series = (await row(f, created.linkId))!.value
    await reconcileSchedules(f.bridge, Date.parse(series.scheduledFor!) + 1)
    const childId = (await row(f, created.linkId))!.value.recentRunIds![0]
    expect((await row(f, childId))!.value.request.report).toBe('failure')
  })
})
