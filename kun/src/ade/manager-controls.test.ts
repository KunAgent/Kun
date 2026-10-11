import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdeStores } from './manager-controls-test-support.js'
import {
  busyWorker,
  commandAction,
  fileAction,
  INTERVAL_STAT,
  makeHarness,
  managerCtx,
  pendingApproval,
  seedDispatch,
  seedWorker,
  setupAdeStores,
  teardownAdeStores,
  turnRecord,
  workerThread
} from './manager-controls-test-support.js'

let stores: AdeStores

beforeEach(async () => {
  stores = await setupAdeStores()
})

afterEach(async () => {
  await teardownAdeStores(stores)
})

describe('worker_send', () => {
  it('delivers immediately when the worker is idle', async () => {
    const { controls, delegation } = makeHarness(stores)
    await seedWorker(stores)
    const result = await controls.workerSend(managerCtx(), { workerId: 'wrk_1', task: 'fix the thing' })
    expect(result.ok).toBe(true)
    expect(result.dispatched).toBe(true)
    expect(delegation.runChild).toHaveBeenCalledTimes(1)
    expect((await stores.dispatches.list('thr_mgr'))[0]!.state).toBe('accepted')
  })

  it('queues while busy and the terminal hook delivers it', async () => {
    const { controls, delegation, lifecycle } = makeHarness(stores)
    await seedWorker(stores)
    // First dispatch occupies the worker.
    await controls.workerSend(managerCtx(), { workerId: 'wrk_1', task: 'first' })
    const first = (await stores.dispatches.list('thr_mgr'))[0]!
    expect(first.state).toBe('accepted')
    await stores.threads.upsert({
      ...workerThread(), turns: [turnRecord({ clientRequestId: first.dispatchId })]
    })
    const result = await controls.workerSend(managerCtx(), { workerId: 'wrk_1', task: 'queued work' })
    expect(result.ok).toBe(true)
    expect(result.dispatched).toBe(false)
    expect(result.deliveryPending).toBe('worker-busy')
    expect(delegation.runChild).toHaveBeenCalledTimes(1)
    // The first turn ends → the hook completes dispatch A and delivers B.
    const finished = turnRecord({ clientRequestId: first.dispatchId, status: 'completed' })
    await stores.threads.upsert({ ...workerThread(), turns: [finished] })
    await lifecycle.handleWorkerTurnTerminal('wrk_1', 'turn_w1', 'completed')
    expect(delegation.runChild).toHaveBeenCalledTimes(2)
    const rest = await stores.dispatches.list('thr_mgr')
    expect(rest.find((entry) => entry.dispatchId === first.dispatchId)?.state).toBe('completed')
    expect(rest.find((entry) => entry.dispatchId === result.dispatchId)?.state).toBe('accepted')
  })

  it('interrupts the running turn for mode=interrupt', async () => {
    const { controls, interruptTurn, delegation } = makeHarness(stores)
    await busyWorker(stores)
    const result = await controls.workerSend(managerCtx(), {
      workerId: 'wrk_1', task: 'urgent', mode: 'interrupt'
    })
    expect(result.ok).toBe(true)
    expect(interruptTurn).toHaveBeenCalledWith({ threadId: 'wrk_1', turnId: 'turn_w1' })
    expect(delegation.abortChild).toHaveBeenCalledWith('wrk_1')
    // The turn is still unwinding; the terminal hook delivers it next.
    expect(result.deliveryPending).toBe('worker-busy')
    expect(delegation.runChild).not.toHaveBeenCalled()
  })

  it('refuses while the user controls the worker', async () => {
    const { controls } = makeHarness(stores)
    await seedWorker(stores, { control: 'user' })
    const result = await controls.workerSend(managerCtx(), { workerId: 'wrk_1', task: 'nope' })
    expect(result.ok).toBe(false)
    expect(result.refusal).toBe('under_user_control')
    expect(await stores.dispatches.list('thr_mgr')).toHaveLength(0)
  })
})

describe('worker_stop / worker_release', () => {
  it('worker_stop aborts the run controller and interrupts the turn', async () => {
    const { controls, delegation, interruptTurn } = makeHarness(stores)
    await busyWorker(stores)
    const result = await controls.workerStop(managerCtx(), { workerId: 'wrk_1' })
    expect(result.ok).toBe(true)
    expect(result.stopped).toBe(true)
    expect(delegation.abortChild).toHaveBeenCalledWith('wrk_1')
    expect(interruptTurn).toHaveBeenCalledWith({ threadId: 'wrk_1', turnId: 'turn_w1' })
  })

  it('worker_stop reports no running turn without interrupting', async () => {
    const { controls, interruptTurn } = makeHarness(stores)
    await seedWorker(stores)
    const result = await controls.workerStop(managerCtx(), { workerId: 'wrk_1' })
    expect(result.ok).toBe(true)
    expect(result.stopped).toBe(false)
    expect(interruptTurn).not.toHaveBeenCalled()
  })

  it('release keeps a dirty task workspace and says so', async () => {
    const { controls, taskWorkspaces, activity } = makeHarness(stores, {
      workspaceStat: { changedFiles: 3, insertions: 10, deletions: 2 }
    })
    await seedWorker(stores)
    const result = await controls.workerRelease(managerCtx(), { workerId: 'wrk_1' })
    expect(result.ok).toBe(true)
    expect(result.workspaceKept).toBe(true)
    expect(result.workspacePath).toBe('/repo/.worktrees/fix-login')
    expect(result.userReport).toContain('unmerged changes')
    expect(taskWorkspaces.discard).not.toHaveBeenCalled()
    expect((await stores.teams.get('thr_mgr'))!.workers[0]!.state).toBe('released')
    expect(activity.apply).toHaveBeenCalledWith('wrk_1',
      expect.objectContaining({ residency: 'dormant' }), 'runtime')
    expect((await stores.notices.pending('thr_mgr'))[0]!.kind).toBe('worker_released')
  })

  it('release discards a clean workspace and cancels queued dispatches', async () => {
    const { controls, taskWorkspaces, delegation, activity } = makeHarness(stores)
    await busyWorker(stores)
    await controls.workerSend(managerCtx(), { workerId: 'wrk_1', task: 'queued' })
    const result = await controls.workerRelease(managerCtx(), { workerId: 'wrk_1', archive: true })
    expect(result.ok).toBe(true)
    expect(result.workspaceKept).toBeUndefined()
    expect(taskWorkspaces.discard).toHaveBeenCalledWith('tws_1', true)
    expect((await stores.dispatches.list('thr_mgr'))[0]!.state).toBe('cancelled')
    expect(activity.apply).toHaveBeenCalledWith('wrk_1',
      expect.objectContaining({ visibility: 'archived' }), 'runtime')
    expect(delegation.abortChild).toHaveBeenCalledWith('wrk_1')
  })
})

describe('dispatch queue/update/cancel', () => {
  it('lists only pre-acceptance dispatches', async () => {
    const { controls } = makeHarness(stores)
    await busyWorker(stores)
    await controls.workerSend(managerCtx(), { workerId: 'wrk_1', task: 'queued work' })
    const dispatch = (await stores.dispatches.list('thr_mgr'))[0]!
    expect((await controls.dispatchQueue(managerCtx(), {})).dispatches
      .map((entry) => entry.dispatchId)).toEqual([dispatch.dispatchId])
    await stores.dispatches.update('thr_mgr', dispatch.dispatchId, { state: 'delivering' })
    await stores.dispatches.update('thr_mgr', dispatch.dispatchId, { state: 'accepted' })
    expect((await controls.dispatchQueue(managerCtx(), {})).dispatches).toHaveLength(0)
  })

  it('updates task/context only while pending', async () => {
    const { controls } = makeHarness(stores)
    await busyWorker(stores)
    await controls.workerSend(managerCtx(), { workerId: 'wrk_1', task: 'queued work' })
    const dispatch = (await stores.dispatches.list('thr_mgr'))[0]!
    const updated = await controls.dispatchUpdate(managerCtx(), {
      dispatchId: dispatch.dispatchId,
      task: 'rewritten task',
      context: { files: ['a.ts'] }
    })
    expect(updated.ok).toBe(true)
    expect(updated.dispatch?.task).toBe('rewritten task')
    expect(updated.dispatch?.context?.files).toEqual(['a.ts'])
    await stores.dispatches.update('thr_mgr', dispatch.dispatchId, { state: 'delivering' })
    const refused = await controls.dispatchUpdate(managerCtx(), {
      dispatchId: dispatch.dispatchId, task: 'too late'
    })
    expect(refused.ok).toBe(false)
    expect(refused.refusal).toBe('dispatch_not_pending')
  })

  it('cancels pending only', async () => {
    const { controls } = makeHarness(stores)
    await busyWorker(stores)
    await controls.workerSend(managerCtx(), { workerId: 'wrk_1', task: 'queued work' })
    const dispatch = (await stores.dispatches.list('thr_mgr'))[0]!
    expect((await controls.dispatchCancel(managerCtx(), { dispatchId: dispatch.dispatchId })).ok).toBe(true)
    expect((await stores.dispatches.get('thr_mgr', dispatch.dispatchId))!.state).toBe('cancelled')
    const again = await controls.dispatchCancel(managerCtx(), { dispatchId: dispatch.dispatchId })
    expect(again.ok).toBe(false)
    expect(again.refusal).toBe('dispatch_not_pending')
  })
})

describe('worker_answer and GUI question answer', () => {
  async function openQuestion() {
    await stores.questions.create('thr_mgr', {
      questionId: 'q_1',
      dispatchId: 'dsp_1',
      workerId: 'wrk_1',
      question: 'proceed with the risky refactor?',
      state: 'open',
      deadline: '2026-09-26T00:05:00.000Z',
      createdAt: '2026-09-26T00:00:00.000Z',
      updatedAt: '2026-09-26T00:00:00.000Z'
    })
  }

  it('worker_answer resolves the record as answered by the manager', async () => {
    const { controls, answerQuestion } = makeHarness(stores)
    await seedWorker(stores)
    await openQuestion()
    const result = await controls.workerAnswer(managerCtx(), { questionId: 'q_1', answer: 'yes' })
    expect(result.ok).toBe(true)
    expect(answerQuestion).toHaveBeenCalledWith(expect.objectContaining({
      questionId: 'q_1', answer: 'yes', answeredBy: 'manager'
    }))
    expect((await stores.questions.get('thr_mgr', 'q_1'))!.answeredBy).toBe('manager')
  })

  it('the GUI route answers as the user', async () => {
    const { teamControls } = makeHarness(stores)
    await seedWorker(stores)
    await openQuestion()
    const result = await teamControls.answerQuestionAsUser('q_1', 'no, stop')
    expect(result.ok).toBe(true)
    expect((await stores.questions.get('thr_mgr', 'q_1'))!.answeredBy).toBe('user')
  })

  it('refuses a settled question', async () => {
    const { controls } = makeHarness(stores)
    await seedWorker(stores)
    await openQuestion()
    await stores.questions.update('thr_mgr', 'q_1', { state: 'answered', answer: 'x', answeredBy: 'user' })
    const result = await controls.workerAnswer(managerCtx(), { questionId: 'q_1', answer: 'yes' })
    expect(result.ok).toBe(false)
    expect(result.refusal).toBe('question_not_open')
  })
})
