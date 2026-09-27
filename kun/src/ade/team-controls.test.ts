import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeEvent } from '../contracts/events.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import type { ManagerRuntime } from './manager-runtime.js'
import { createManagerToolProvider } from '../adapters/tool/manager-tool-provider.js'
import type { AdeStores } from './manager-controls-test-support.js'
import {
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

const teamWorker = async () => (await stores.teams.get('thr_mgr'))!.workers[0]!
const threadUnit = async () => (await stores.threads.get('wrk_1'))!.executionUnit

describe('takeOverWorker', () => {
  it('flips control to the user, snapshots the baseline, and notifies the manager', async () => {
    const { teamControls, taskWorkspaces } = makeHarness(stores)
    await seedWorker(stores)
    await seedDispatch(stores)
    const result = await teamControls.takeOverWorker('wrk_1')
    expect(result.ok).toBe(true)
    const worker = await teamWorker()
    expect(worker.control).toBe('user')
    expect(worker.takeoverBaseline).toBe('tree_base1')
    expect(taskWorkspaces.snapshotBaseline).toHaveBeenCalledWith('tws_1')
    expect((await threadUnit())?.control).toBe('user')
    const notices = await stores.notices.pending('thr_mgr')
    expect(notices.map((entry) => entry.kind)).toEqual(['worker_taken_over'])
    // The queued dispatch survives the takeover (09 §9).
    expect((await stores.dispatches.get('thr_mgr', 'dsp_held'))!.state).toBe('pending')
  })

  it('refuses a released worker and is a no-op while already taken over', async () => {
    const { teamControls } = makeHarness(stores)
    await seedWorker(stores, { state: 'released' })
    expect((await teamControls.takeOverWorker('wrk_1')).refusal).toBe('worker_not_active')
    await seedWorker(stores, { state: 'active', control: 'user' })
    expect((await teamControls.takeOverWorker('wrk_1')).ok).toBe(true)
  })

  it('implicitly takes over when the user types a turn in the worker thread', async () => {
    const { lifecycle } = makeHarness(stores)
    await seedWorker(stores)
    await stores.threads.upsert({
      ...workerThread(), turns: [turnRecord({ id: 'turn_user', status: 'running' })]
    })
    lifecycle.handleRuntimeEvent({
      kind: 'turn_started', threadId: 'wrk_1', turnId: 'turn_user'
    } as RuntimeEvent)
    await vi.waitFor(async () => {
      expect((await teamWorker()).control).toBe('user')
    })
    expect((await threadUnit())?.control).toBe('user')
    expect((await stores.notices.pending('thr_mgr'))[0]!.kind).toBe('worker_taken_over')
  })

  it('backfills the turnId when a dispatch turn starts instead', async () => {
    const { lifecycle } = makeHarness(stores)
    await seedWorker(stores)
    await seedDispatch(stores, { state: 'accepted', turnId: undefined })
    await stores.threads.upsert({
      ...workerThread(),
      turns: [turnRecord({ clientRequestId: 'dsp_held' })]
    })
    lifecycle.handleRuntimeEvent({
      kind: 'turn_started', threadId: 'wrk_1', turnId: 'turn_w1'
    } as RuntimeEvent)
    await vi.waitFor(async () => {
      expect((await stores.dispatches.get('thr_mgr', 'dsp_held'))!.turnId).toBe('turn_w1')
    })
    expect((await teamWorker()).control).toBe('manager')
    expect(await stores.notices.pending('thr_mgr')).toHaveLength(0)
  })
})

describe('handBackWorker', () => {
  it('returns control, reports the takeover-interval diff, and resumes held dispatches', async () => {
    const { teamControls, taskWorkspaces, delegation } = makeHarness(stores)
    await seedWorker(stores)
    await seedDispatch(stores)
    await teamControls.takeOverWorker('wrk_1')
    const result = await teamControls.handBackWorker('wrk_1')
    expect(result.ok).toBe(true)
    expect(result.capture).toEqual(INTERVAL_STAT)
    expect(taskWorkspaces.diffSinceBaseline).toHaveBeenCalledWith('tws_1', 'tree_base1')
    const worker = await teamWorker()
    expect(worker.control).toBe('manager')
    expect(worker.takeoverBaseline).toBeUndefined()
    expect((await threadUnit())?.control).toBe('manager')
    const notice = (await stores.notices.pending('thr_mgr')).at(-1)!
    expect(notice.kind).toBe('worker_handed_back')
    expect(notice.capture).toEqual(INTERVAL_STAT)
    // The dispatch held during takeover is delivered now.
    expect(delegation.runChild).toHaveBeenCalledTimes(1)
    expect((await stores.dispatches.get('thr_mgr', 'dsp_held'))!.state).toBe('accepted')
  })

  it('falls back to cumulative stats when no baseline exists', async () => {
    const { teamControls, taskWorkspaces } = makeHarness(stores, {
      workspaceStat: { changedFiles: 5, insertions: 20, deletions: 7 }
    })
    await seedWorker(stores, { control: 'user' })
    const result = await teamControls.handBackWorker('wrk_1')
    expect(result.ok).toBe(true)
    expect(taskWorkspaces.diffSinceBaseline).not.toHaveBeenCalled()
    expect(result.capture).toEqual({ changedFiles: 5, insertions: 20, deletions: 7 })
  })

  it('refuses a released worker and is a no-op while manager-controlled', async () => {
    const { teamControls } = makeHarness(stores)
    await seedWorker(stores, { state: 'released' })
    expect((await teamControls.handBackWorker('wrk_1')).refusal).toBe('worker_not_active')
    await seedWorker(stores, { state: 'active' })
    expect((await teamControls.handBackWorker('wrk_1')).ok).toBe(true)
  })
})

describe('detachWorker', () => {
  it('detaches the worker, clears executionUnit, and cancels its dispatches', async () => {
    const { teamControls } = makeHarness(stores)
    await seedWorker(stores)
    await seedDispatch(stores)
    await seedDispatch(stores, { dispatchId: 'dsp_live', state: 'accepted' })
    await seedDispatch(stores, { dispatchId: 'dsp_done', state: 'completed' })
    const result = await teamControls.detachWorker('wrk_1')
    expect(result.ok).toBe(true)
    expect((await teamWorker()).state).toBe('detached')
    expect(await threadUnit()).toBeUndefined()
    const dispatches = await stores.dispatches.list('thr_mgr')
    expect(dispatches.find((entry) => entry.dispatchId === 'dsp_held')!.state).toBe('cancelled')
    expect(dispatches.find((entry) => entry.dispatchId === 'dsp_live')!.state).toBe('cancelled')
    expect(dispatches.find((entry) => entry.dispatchId === 'dsp_done')!.state).toBe('completed')
    expect((await stores.notices.pending('thr_mgr'))[0]!.kind).toBe('worker_detached')
    // The thread record itself is kept — it becomes a normal conversation.
    expect(await stores.threads.get('wrk_1')).toBeTruthy()
  })

  it('is a no-op for an already-detached worker', async () => {
    const { teamControls } = makeHarness(stores)
    await seedWorker(stores, { state: 'detached' })
    expect((await teamControls.detachWorker('wrk_1')).ok).toBe(true)
  })
})

describe('guiDispatch', () => {
  it('delivers a durable dispatch to an idle worker', async () => {
    const { teamControls, delegation } = makeHarness(stores)
    await seedWorker(stores)
    const result = await teamControls.guiDispatch('wrk_1', { task: 'review the diff' })
    expect(result.ok).toBe(true)
    expect(result.dispatched).toBe(true)
    expect(delegation.runChild).toHaveBeenCalledTimes(1)
    const dispatch = (await stores.dispatches.list('thr_mgr'))[0]!
    expect(dispatch.workerId).toBe('wrk_1')
    expect(dispatch.task).toBe('review the diff')
  })

  it('refuses while the user holds control', async () => {
    const { teamControls } = makeHarness(stores)
    await seedWorker(stores, { control: 'user' })
    const result = await teamControls.guiDispatch('wrk_1', { task: 'nope' })
    expect(result.ok).toBe(false)
    expect(result.refusal).toBe('under_user_control')
    expect(await stores.dispatches.list('thr_mgr')).toHaveLength(0)
  })
})

describe('worker_approve', () => {
  it('refuses when managerMayApprove is off', async () => {
    const { controls, gate } = makeHarness(stores)
    await seedWorker(stores)
    pendingApproval(gate, 'appr_1', fileAction('/repo/.worktrees/fix-login/a.ts'))
    const result = await controls.workerApprove(managerCtx(), {
      approvalId: 'appr_1', decision: 'allow'
    })
    expect(result.ok).toBe(false)
    expect(result.refusal).toBe('disabled')
    expect(gate.get('appr_1')!.status).toBe('pending')
  })

  it('approves an in-workspace file write and audits approvalReviewer=agent', async () => {
    const { controls, gate, recorded } = makeHarness(stores, { mayApprove: true })
    await seedWorker(stores)
    pendingApproval(gate, 'appr_1', fileAction('/repo/.worktrees/fix-login/src/fix.ts'))
    const result = await controls.workerApprove(managerCtx(), {
      approvalId: 'appr_1', decision: 'allow'
    })
    expect(result.ok).toBe(true)
    expect(result.decided).toBe('allow')
    expect(gate.get('appr_1')!.status).toBe('allowed')
    expect(recorded).toEqual([
      expect.objectContaining({
        kind: 'approval_resolved',
        approvalId: 'appr_1',
        status: 'allowed',
        approvalReviewer: 'agent'
      })
    ])
  })

  it('records denied decisions through the same audit path', async () => {
    const { controls, gate, recorded } = makeHarness(stores, { mayApprove: true })
    await seedWorker(stores)
    pendingApproval(gate, 'appr_1', commandAction())
    const result = await controls.workerApprove(managerCtx(), {
      approvalId: 'appr_1', decision: 'deny'
    })
    expect(result.ok).toBe(true)
    expect(result.decided).toBe('deny')
    expect(gate.get('appr_1')!.status).toBe('denied')
    expect(recorded[0]).toEqual(expect.objectContaining({ status: 'denied', approvalReviewer: 'agent' }))
  })

  it('never approves requiresUserDecision actions', async () => {
    const { controls, gate } = makeHarness(stores, { mayApprove: true })
    await seedWorker(stores)
    pendingApproval(gate, 'appr_1', fileAction('/repo/.worktrees/fix-login/a.ts', {
      requiresUserDecision: true
    }))
    const result = await controls.workerApprove(managerCtx(), {
      approvalId: 'appr_1', decision: 'allow'
    })
    expect(result.ok).toBe(false)
    expect(result.refusal).toBe('outside_authority')
    expect(gate.get('appr_1')!.status).toBe('pending')
  })

  it('keeps file targets inside the worker write roots even at full-access', async () => {
    const { controls, gate } = makeHarness(stores, { mayApprove: true })
    await seedWorker(stores)
    pendingApproval(gate, 'appr_1', fileAction('/etc/passwd'))
    const result = await controls.workerApprove(managerCtx(), {
      approvalId: 'appr_1', decision: 'allow'
    })
    expect(result.ok).toBe(false)
    expect(result.refusal).toBe('outside_authority')
    expect(gate.get('appr_1')!.status).toBe('pending')
  })

  it('rejects command approvals for an approve-for-me manager', async () => {
    const { controls, gate } = makeHarness(stores, { mayApprove: true })
    await seedWorker(stores)
    pendingApproval(gate, 'appr_1', commandAction())
    const result = await controls.workerApprove(managerCtx({
      authority: { kunPermissionMode: 'approve-for-me', interactive: false }
    }), { approvalId: 'appr_1', decision: 'allow' })
    expect(result.ok).toBe(false)
    expect(result.refusal).toBe('outside_authority')
  })

  it('approves commands when the manager runs at full-access', async () => {
    const { controls, gate } = makeHarness(stores, { mayApprove: true })
    await seedWorker(stores)
    pendingApproval(gate, 'appr_1', commandAction())
    const result = await controls.workerApprove(managerCtx(), {
      approvalId: 'appr_1', decision: 'allow'
    })
    expect(result.ok).toBe(true)
    expect(gate.get('appr_1')!.status).toBe('allowed')
  })

  it('rejects approvals for workers outside this team', async () => {
    const { controls, gate } = makeHarness(stores, { mayApprove: true })
    await seedWorker(stores)
    pendingApproval(gate, 'appr_x', fileAction('/repo/.worktrees/fix-login/a.ts'), 'wrk_other')
    const result = await controls.workerApprove(managerCtx(), {
      approvalId: 'appr_x', decision: 'allow'
    })
    expect(result.ok).toBe(false)
    expect(result.refusal).toBe('approval_not_found')
  })

  it('rejects an already-resolved approval', async () => {
    const { controls, gate } = makeHarness(stores, { mayApprove: true })
    await seedWorker(stores)
    pendingApproval(gate, 'appr_1', fileAction('/repo/.worktrees/fix-login/a.ts'))
    gate.resolve('appr_1', 'allow')
    const result = await controls.workerApprove(managerCtx(), {
      approvalId: 'appr_1', decision: 'deny'
    })
    expect(result.ok).toBe(false)
    expect(result.refusal).toBe('already_decided')
    expect(gate.get('appr_1')!.status).toBe('allowed')
  })
})

describe('worker approval notices', () => {
  const approvalEvent = {
    kind: 'approval_requested',
    threadId: 'wrk_1',
    turnId: 'turn_w1',
    approvalId: 'appr_1',
    toolName: 'write_file',
    status: 'pending',
    summary: 'write a.ts'
  } as RuntimeEvent

  it('enqueues a worker_approval notice when managerMayApprove is on', async () => {
    const { lifecycle } = makeHarness(stores, { mayApprove: true })
    await seedWorker(stores)
    lifecycle.handleRuntimeEvent(approvalEvent)
    await vi.waitFor(async () => {
      expect(await stores.notices.pending('thr_mgr')).toHaveLength(1)
    })
    const notice = (await stores.notices.pending('thr_mgr'))[0]!
    expect(notice.kind).toBe('worker_approval')
    expect(notice.approvalId).toBe('appr_1')
  })

  it('enqueues nothing while managerMayApprove is off', async () => {
    const { lifecycle } = makeHarness(stores)
    await seedWorker(stores)
    lifecycle.handleRuntimeEvent(approvalEvent)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await stores.notices.pending('thr_mgr')).toHaveLength(0)
  })
})

describe('tool provider gates', () => {
  const toolContext: ToolHostContext = {
    threadId: 'thr_mgr',
    turnId: 'turn_mgr_1',
    workspace: '/repo',
    workspaceMode: 'ade',
    approvalPolicy: 'on-request',
    abortSignal: new AbortController().signal,
    awaitApproval: vi.fn(async () => 'deny' as const)
  }
  const provider = (mayApprove: boolean) => createManagerToolProvider({
    manager: { toolContext: vi.fn(async () => managerCtx()) } as unknown as ManagerRuntime,
    harnessList: {} as never,
    managerMayApprove: () => mayApprove
  })
  const tool = (mayApprove: boolean, name: string) =>
    provider(mayApprove).tools.find((entry) => entry.name === name)!

  it('advertises the control-plane tools only on kun ade manager threads', () => {
    const send = tool(false, 'worker_send')
    expect(send.shouldAdvertise?.(toolContext)).toBe(true)
    expect(send.shouldAdvertise?.({ ...toolContext, executionUnitKind: 'worker' })).toBe(false)
    expect(send.shouldAdvertise?.({ ...toolContext, harnessId: 'acp' })).toBe(false)
    expect(send.shouldAdvertise?.({ ...toolContext, workspaceMode: 'code' })).toBe(false)
  })

  it('gates worker_approve on managerMayApprove', () => {
    expect(tool(true, 'worker_approve').shouldAdvertise?.(toolContext)).toBe(true)
    expect(tool(false, 'worker_approve').shouldAdvertise?.(toolContext)).toBe(false)
    // Other tools are unaffected by the gate.
    expect(tool(false, 'dispatch_queue').shouldAdvertise?.(toolContext)).toBe(true)
  })
})
