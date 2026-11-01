import { expect, it, vi } from 'vitest'
import { setup } from './manager-worker-dispatch-fixtures.js'
import { DispatchDeliverer } from './dispatch-deliverer.js'
import { childRunRecord } from './manager-runtime-fixtures.js'

function barrier() {
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  return { wait, release }
}

async function notice(f: Awaited<ReturnType<typeof setup>>) {
  await f.notices.enqueue({ noticeId: 'notice', teamId: 'parent', workerId: 'old',
    kind: 'dispatch_failed', title: 'failure', attempts: 0, createdAt: new Date(f.clock.now).toISOString() })
  await f.notices.ack('parent', ['notice'])
  expect(await f.notices.pending('parent')).toHaveLength(0)
}

it.each(['stop', 'takeover', 'release', 'cancel'] as const)(
  'allows ACK and %s during admission, then stops the late child', async action => {
    const f = await setup('ask-for-approval', 'kun', 8, undefined, undefined, true)
    const hold = barrier()
    const admitted = barrier()
    let live = false
    f.delivererDeps.delegation.abortChild.mockImplementation(() => { live = false; return true })
    f.runChild.mockImplementationOnce(async input => {
      admitted.release()
      await hold.wait
      live = true
      const record = childRunRecord({ id: input.childId! })
      await f.childRuns.upsert(record)
      await f.threads.upsert({ ...f.source, id: input.childId!, turns: [],
        executionUnit: { kind: 'worker', teamId: 'parent', managerThreadId: 'parent',
          label: 'late child', lifecycle: 'persistent', control: 'manager' } })
      return record
    })
    const creation = f.runtime.createWorkerNow(f.ctx,
      { ...f.assignment, workspace: { isolation: 'local' } }, f.context)
    await admitted.wait
    const row = (await f.dispatches.list('parent'))[0]
    let controlled = false
    const control = (async () => {
      await notice(f)
      if (action === 'stop') await f.runtime.teamControls.stopWorker(row.workerId)
      if (action === 'takeover') await f.runtime.teamControls.takeOverWorker(row.workerId)
      if (action === 'release') await f.runtime.controls.workerRelease(f.ctx, { workerId: row.workerId })
      if (action === 'cancel') await f.dispatches.update('parent', row.dispatchId, { state: 'cancelled' })
      controlled = true
    })()
    try { await vi.waitFor(() => expect(controlled).toBe(true), { timeout: 500 }) }
    finally { hold.release(); await creation; await control }
    expect(live).toBe(false)
    expect((await f.dispatches.get('parent', row.dispatchId))?.state).toBe('cancelled')
    expect(f.delivererDeps.delegation.abortChild).toHaveBeenCalled()
    if (action === 'takeover') expect((await f.threads.get(row.workerId))?.executionUnit?.control).toBe('user')
    if (action === 'release') expect((await f.threads.get(row.workerId))?.executionUnit).toBeUndefined()
    if (action === 'takeover') expect((await f.teams.worker('parent', row.workerId))?.control).toBe('user')
    if (action === 'release') expect((await f.teams.worker('parent', row.workerId))?.state).toBe('released')
  })

it('serializes duplicate delivery across deliverer instances while admission is suspended', async () => {
  const f = await setup('ask-for-approval', 'kun', 8, undefined, undefined, true)
  const hold = barrier()
  const admitted = barrier()
  f.runChild.mockImplementationOnce(async input => {
    admitted.release()
    await hold.wait
    return childRunRecord({ id: input.childId! })
  })
  const creation = f.runtime.createWorkerNow(f.ctx,
    { ...f.assignment, workspace: { isolation: 'local' } }, f.context)
  await admitted.wait
  const row = (await f.dispatches.list('parent'))[0]
  const duplicate = new DispatchDeliverer(f.delivererDeps).tryDeliver('parent', row.dispatchId)
  const recovery = new DispatchDeliverer(f.delivererDeps).reconcileTeam('parent')
  await notice(f)
  hold.release()
  await Promise.all([creation, duplicate, recovery])
  expect(f.runChild).toHaveBeenCalledTimes(1)
  expect((await f.dispatches.get('parent', row.dispatchId))?.state).toBe('accepted')
})

it.each(['create', 'settle'] as const)('keeps ACK and release responsive during workspace %s', async phase => {
  const f = await setup('ask-for-approval')
  f.workspace.path = f.root
  const old = await f.runtime.createWorkerNow(f.ctx, f.assignment, f.context)
  expect(old.ok).toBe(true)
  // Keep the old worker's workspace out of release cleanup in this lock-only test.
  await f.teams.updateWorker('parent', old.workerId!, { taskWorkspaceId: undefined })
  const hold = barrier()
  let listener: (() => void) | undefined
  if (phase === 'create') f.taskWorkspaces.create.mockImplementationOnce(async () => { await hold.wait; return f.workspace })
  else {
    f.workspace.state = 'creating'
    vi.spyOn(f.taskWorkspaces as import('../workspace-tasks/task-workspace-settlement.js').TaskWorkspaceSettlementSource, 'onChange').mockImplementation(callback => {
      listener = () => callback(f.workspace)
      return () => undefined
    })
  }
  const creation = f.runtime.createWorkerNow(f.ctx, f.assignment, f.context,
    { workerId: 'new-worker', dispatchId: 'new-dispatch', intentId: 'new-intent' })
  await vi.waitFor(() => expect(f.taskWorkspaces.create).toHaveBeenCalledTimes(2))
  if (phase === 'settle') await vi.waitFor(() => expect(listener).toBeDefined())
  let completed = false
  const control = (async () => {
    await notice(f)
    await f.runtime.controls.workerRelease(f.ctx, { workerId: old.workerId })
    completed = true
  })()
  try { await vi.waitFor(() => expect(completed).toBe(true), { timeout: 500 }) }
  finally { f.workspace.state = 'ready'; listener?.(); hold.release(); await creation; await control }
})

it('makes a reviewer wait outside the team lock and lose the final slot without launching', async () => {
  const f = await setup('ask-for-approval', 'kun', 2)
  f.workspace.path = f.root
  const first = await f.runtime.createWorkerNow(f.ctx, f.assignment, f.context,
    { workerId: 'original', dispatchId: 'original-dispatch', intentId: 'original-intent' })
  expect(first.ok).toBe(true)
  await f.dispatches.update('parent', first.dispatchId!, { state: 'completed' })
  await f.teams.updateWorker('parent', first.workerId!, { taskWorkspaceId: undefined })
  const hold = barrier()
  f.taskWorkspaces.create.mockImplementationOnce(async () => { await hold.wait; return f.workspace })
  const creation = f.runtime.createWorkerNow(f.ctx, f.assignment, f.context,
    { workerId: 'winner', dispatchId: 'winner-dispatch', intentId: 'winner-intent' })
  await vi.waitFor(() => expect(f.taskWorkspaces.create).toHaveBeenCalledTimes(2))
  const review = f.runtime.reviews.request(f.ctx, {
    workerId: first.workerId, reviewer: { harnessId: 'claude-code', model: 'main-model' }
  }, f.context)
  await notice(f)
  hold.release()
  expect((await creation).ok).toBe(true)
  expect(await review).toMatchObject({ ok: false, refusal: 'worker_limit' })
  expect(f.taskWorkspaces.create).toHaveBeenCalledTimes(2)
  expect(f.runChild).toHaveBeenCalledTimes(2)
})
