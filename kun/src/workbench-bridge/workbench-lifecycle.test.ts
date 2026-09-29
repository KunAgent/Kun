import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TurnItem } from '../contracts/items.js'
import type { WorkbenchLink } from '../contracts/workbench-links.js'
import { enqueuePrivateContinuation } from '../rooms/room-continuation-service.js'
import { confirmWorkbenchLink, dismissWorkbenchLink, requestWorkbenchCancel, watchWorkbenchThread } from './actions.js'
import { reconcileWorkbench } from './reconcile.js'
import { workbenchFixture, type WorkbenchFixture } from './workbench-test-support.js'

vi.mock('../rooms/room-continuation-service.js', () => ({ enqueuePrivateContinuation: vi.fn(async () => 'queued') }))

const open: WorkbenchFixture[] = []
afterEach(async () => { for (const fixture of open.splice(0)) await fixture.cleanup() })
beforeEach(() => { vi.mocked(enqueuePrivateContinuation).mockClear() })
async function fixture(options?: Parameters<typeof workbenchFixture>[0]) {
  const value = await workbenchFixture(options)
  open.push(value)
  return value
}
const link = async (f: WorkbenchFixture, id: string) => (await f.store.get<WorkbenchLink>('workbench_link', id))!
let sequence = 0
const confirmation = () => ({ clientRequestId: 'confirm-' + ++sequence })

/** A confirmed Code task in a project the user already works in. */
async function confirmedTask(f: WorkbenchFixture, extra: Record<string, unknown> = {}) {
  const project = await f.makeDirectory('project')
  f.addCodeThread('existing', project)
  const created = (await f.run('create_code_task', { title: 'Fix SSE', goal: 'Fix the reconnect bug', projectRoot: project,
    acceptance: 'tests pass', ...extra }, 'call-' + ++sequence)).output as { linkId: string }
  const row = await link(f, created.linkId)
  await confirmWorkbenchLink(f.bridge, f.room.id, created.linkId, { ...confirmation(), expectedRevision: row.revision })
  return { id: created.linkId, project }
}
const targetThread = (f: WorkbenchFixture, id: string) => f.stub.threads.get(id)!

describe('confirming a card', () => {
  it('moves an awaiting task to queued once, honouring revisions and replays', async () => {
    const f = await fixture()
    const project = await f.makeDirectory('project')
    const created = (await f.run('create_code_task', { title: 'Task', goal: 'g', projectRoot: project })).output as { linkId: string }
    const row = await link(f, created.linkId)
    await expect(confirmWorkbenchLink(f.bridge, f.room.id, created.linkId, { ...confirmation(), expectedRevision: row.revision + 5 })).rejects.toThrow('changed since')
    const decision = { clientRequestId: 'same-click', expectedRevision: row.revision, edits: { title: 'Better title' } }
    const first = await confirmWorkbenchLink(f.bridge, f.room.id, created.linkId, decision)
    expect(first).toMatchObject({ status: 'queued', request: { title: 'Better title' } })
    expect(first.confirmedAt).toBeTruthy()
    expect(f.wakes.count).toBeGreaterThan(0)
    // A retried click replays the first result instead of conflicting.
    expect((await confirmWorkbenchLink(f.bridge, f.room.id, created.linkId, decision)).revision).toBe(first.revision)
    await expect(confirmWorkbenchLink(f.bridge, f.room.id, created.linkId, { ...confirmation(), expectedRevision: first.revision })).rejects.toThrow('not waiting')
  })

  it('dismisses an unanswered card and refuses to dismiss a started one', async () => {
    const f = await fixture()
    const project = await f.makeDirectory('project')
    const created = (await f.run('create_code_task', { title: 'Task', goal: 'g', projectRoot: project })).output as { linkId: string }
    const row = await link(f, created.linkId)
    expect(await dismissWorkbenchLink(f.bridge, f.room.id, created.linkId, { ...confirmation(), expectedRevision: row.revision })).toMatchObject({ status: 'dismissed' })
    const started = await confirmedTask(f)
    await expect(dismissWorkbenchLink(f.bridge, f.room.id, started.id, { ...confirmation(), expectedRevision: (await link(f, started.id)).revision })).rejects.toThrow('not waiting')
  })

  it('limits how many tasks an Agent runs at once', async () => {
    const f = await fixture({ policy: { maxActiveTasks: 1 } })
    await confirmedTask(f)
    await reconcileWorkbench(f.bridge)
    const project = await f.makeDirectory('second')
    const second = (await f.run('create_code_task', { title: 'Second', goal: 'g', projectRoot: project }, 'call-second')).output as { linkId: string }
    await expect(confirmWorkbenchLink(f.bridge, f.room.id, second.linkId, { ...confirmation(), expectedRevision: (await link(f, second.linkId)).revision }))
      .rejects.toThrow('already has 1 tasks in progress')
  })
})

describe('running a Code task', () => {
  it('creates the session, admits one turn, follows it and reports the outcome once', async () => {
    const f = await fixture()
    const task = await confirmedTask(f)
    await reconcileWorkbench(f.bridge) // creates the target session
    const started = await link(f, task.id)
    expect(started.value.threadId).toBeTruthy()
    const thread = targetThread(f, started.value.threadId!)
    expect(thread).toMatchObject({ workspace: task.project, agentSurface: 'code', title: 'Fix SSE',
      workbenchOrigin: { kind: 'bot', roomId: f.room.id, linkId: task.id, agentId: 'agent-1', agentName: 'Bot' } })
    await reconcileWorkbench(f.bridge) // admits the first turn
    expect(f.stub.calls.enqueued).toHaveLength(1)
    expect(f.stub.calls.enqueued[0].request).toMatchObject({ clientRequestId: 'workbench-' + task.id, agentSurface: 'code', enqueueIfBusy: true })
    expect(String(f.stub.calls.enqueued[0].request.prompt)).toContain('Fix the reconnect bug')
    expect(String(f.stub.calls.enqueued[0].request.prompt)).toContain('tests pass')
    await reconcileWorkbench(f.bridge)
    expect(f.stub.calls.enqueued).toHaveLength(1) // never admitted twice
    expect(await link(f, task.id)).toMatchObject({ value: { status: 'queued', turnId: 'turn-1' } })

    thread.turns[0].status = 'running'
    await reconcileWorkbench(f.bridge)
    expect((await link(f, task.id)).value.status).toBe('running')
    f.stub.services.approvals.pending = () => [{ summary: 'Run npm test', toolName: 'bash' }]
    await reconcileWorkbench(f.bridge)
    expect((await link(f, task.id)).value).toMatchObject({ status: 'needs_attention', attention: { kind: 'approval', summary: 'Run npm test' } })
    f.stub.services.approvals.pending = () => []
    await reconcileWorkbench(f.bridge)
    expect((await link(f, task.id)).value).toMatchObject({ status: 'running' })
    expect((await link(f, task.id)).value.attention).toBeUndefined()

    const items = [{ id: 'i1', turnId: 'turn-1', kind: 'assistant_text', text: 'Fixed the reconnect logic.\nAll tests pass.', status: 'completed', createdAt: '', threadId: thread.id },
      { id: 'i2', turnId: 'turn-1', kind: 'tool_call', toolKind: 'file_change', toolName: 'edit', callId: 'c1', arguments: { path: 'src/sse.ts' }, status: 'completed', createdAt: '', threadId: thread.id }]
    f.stub.services.sessions.loadItems = async () => items as unknown as TurnItem[]
    thread.turns[0].status = 'completed'
    thread.turns[0].finishedAt = new Date().toISOString()
    await reconcileWorkbench(f.bridge)
    const done = await link(f, task.id)
    expect(done.value).toMatchObject({ status: 'completed', reported: true,
      result: { summary: 'Fixed the reconnect logic.', changedFiles: ['src/sse.ts'] } })
    expect(done.value.result!.finalExcerpt).toContain('All tests pass.')
    expect(enqueuePrivateContinuation).toHaveBeenCalledTimes(1)
    const wake = vi.mocked(enqueuePrivateContinuation).mock.calls[0][1]
    expect(wake).toMatchObject({ threadId: f.thread.id, sourceTurnId: 'turn-1', key: task.id, kind: 'workbench_task' })
    expect(wake.prompt).toContain('not an instruction from the user')
    expect(wake.prompt).toContain('Fixed the reconnect logic.')
    await reconcileWorkbench(f.bridge)
    expect(enqueuePrivateContinuation).toHaveBeenCalledTimes(1)
  })

  it('records a failed task and reports it', async () => {
    const f = await fixture()
    const task = await confirmedTask(f)
    await reconcileWorkbench(f.bridge); await reconcileWorkbench(f.bridge)
    const thread = targetThread(f, (await link(f, task.id)).value.threadId!)
    thread.turns[0].status = 'failed'
    thread.turns[0].error = 'model request failed'
    await reconcileWorkbench(f.bridge)
    expect((await link(f, task.id)).value).toMatchObject({ status: 'failed', error: 'model request failed', reported: true })
    expect(enqueuePrivateContinuation).toHaveBeenCalledTimes(1)
  })

  it('marks the session as taken over once the user writes in it', async () => {
    const f = await fixture()
    const task = await confirmedTask(f)
    await reconcileWorkbench(f.bridge); await reconcileWorkbench(f.bridge)
    const thread = targetThread(f, (await link(f, task.id)).value.threadId!)
    thread.turns[0].status = 'running'
    thread.turns.push({ ...thread.turns[0], id: 'turn-2', clientRequestId: 'user-typed', status: 'queued', createdAt: new Date(Date.now() + 1000).toISOString() })
    await reconcileWorkbench(f.bridge)
    expect((await link(f, task.id)).value.userTookOver).toBe(true)
  })

  it('stops a running task without waking the Agent', async () => {
    const f = await fixture()
    const task = await confirmedTask(f)
    await reconcileWorkbench(f.bridge); await reconcileWorkbench(f.bridge)
    const thread = targetThread(f, (await link(f, task.id)).value.threadId!)
    thread.turns[0].status = 'running'
    await reconcileWorkbench(f.bridge)
    const stopped = await requestWorkbenchCancel(f.bridge, f.room.id, task.id)
    expect(stopped.cancelRequested).toBe(true)
    expect(f.stub.calls.interrupted).toEqual(['turn-1'])
    await reconcileWorkbench(f.bridge)
    expect((await link(f, task.id)).value.status).toBe('cancelled')
    expect(enqueuePrivateContinuation).not.toHaveBeenCalled()
    await expect(requestWorkbenchCancel(f.bridge, f.room.id, task.id)).rejects.toThrow('already ended')
  })

  it('withdraws a task that never started', async () => {
    const f = await fixture()
    const task = await confirmedTask(f)
    expect(await requestWorkbenchCancel(f.bridge, f.room.id, task.id)).toMatchObject({ status: 'cancelled' })
    await reconcileWorkbench(f.bridge)
    expect(f.stub.calls.enqueued).toHaveLength(0)
  })

  it('never allocates a second turn when an admission receipt was lost', async () => {
    const f = await fixture()
    const task = await confirmedTask(f)
    await reconcileWorkbench(f.bridge)
    const row = await link(f, task.id)
    await f.store.commit({ requestId: 'lost-receipt', checks: [{ kind: 'workbench_link', id: task.id, expectedRevision: row.revision }],
      puts: [{ kind: 'workbench_link', id: task.id, roomId: f.room.id, value: { ...row.value, admissionAttempted: true } }] })
    await reconcileWorkbench(f.bridge)
    expect(f.stub.calls.enqueued).toHaveLength(0)
    expect((await link(f, task.id)).value.status).toBe('recovery_required')
  })

  it('narrows the task\'s permissions to the Agent\'s own ceiling', async () => {
    const f = await fixture({ allowedRoots: (directory) => [directory] })
    const project = await f.makeDirectory('project')
    f.addCodeThread('existing', project)
    const created = (await f.run('create_code_task', { title: 'Task', goal: 'g', projectRoot: project })).output as { linkId: string }
    await confirmWorkbenchLink(f.bridge, f.room.id, created.linkId, { ...confirmation(), expectedRevision: (await link(f, created.linkId)).revision })
    await reconcileWorkbench(f.bridge)
    const thread = targetThread(f, (await link(f, created.linkId)).value.threadId!)
    // The stub Code default is full access; an Agent with directory limits may not hand out more than asking first.
    expect(thread).toMatchObject({ approvalPolicy: 'on-request', sandboxMode: 'workspace-write', approvalReviewer: 'user' })
  })

  it('waits for an isolated worktree before starting', async () => {
    const f = await fixture()
    const records = new Map<string, { workspaceId: string; state: string; path: string; lastError?: string }>()
    f.bridge.attach({ taskWorkspaces: {
      create: (input: { ownerThreadId: string }) => { const record = { workspaceId: 'tws_1', state: 'creating', path: input.ownerThreadId }; records.set('tws_1', record); return record },
      get: (id: string) => records.get(id), cancel: () => undefined } as never })
    const task = await confirmedTask(f, { isolation: 'worktree' })
    await reconcileWorkbench(f.bridge)
    await reconcileWorkbench(f.bridge)
    expect((await link(f, task.id)).value.taskWorkspaceId).toBe('tws_1')
    await reconcileWorkbench(f.bridge)
    expect(f.stub.calls.enqueued).toHaveLength(0) // still preparing
    records.get('tws_1')!.state = 'ready'
    records.get('tws_1')!.path = '/worktrees/task'
    await reconcileWorkbench(f.bridge)
    expect(f.stub.calls.enqueued).toHaveLength(1)
    expect(targetThread(f, (await link(f, task.id)).value.threadId!)).toMatchObject({ taskWorkspaceId: 'tws_1', workspace: '/worktrees/task' })
  })

  it('fails the task when the worktree cannot be created', async () => {
    const f = await fixture()
    const records = new Map<string, { workspaceId: string; state: string; path: string; lastError?: string }>()
    f.bridge.attach({ taskWorkspaces: {
      create: () => { const record = { workspaceId: 'tws_2', state: 'creating', path: '' }; records.set('tws_2', record); return record },
      get: (id: string) => records.get(id), cancel: () => undefined } as never })
    const task = await confirmedTask(f, { isolation: 'worktree' })
    for (let step = 0; step < 3; step++) await reconcileWorkbench(f.bridge)
    Object.assign(records.get('tws_2')!, { state: 'failed', lastError: 'not a git repository' })
    await reconcileWorkbench(f.bridge)
    expect((await link(f, task.id)).value).toMatchObject({ status: 'failed', error: 'not a git repository' })
  })

  it('stops starting when the policy is turned off after confirmation', async () => {
    const f = await fixture()
    const task = await confirmedTask(f)
    const identity = (await f.store.get<{ workbench?: unknown }>('agent_identity', 'agent-1'))!
    await f.store.commit({ requestId: 'policy-off', checks: [{ kind: 'agent_identity', id: 'agent-1', expectedRevision: identity.revision }],
      puts: [{ kind: 'agent_identity', id: 'agent-1', value: { ...identity.value as object, workbench: { code: 'off', work: 'off', maxActiveTasks: 3 } } }] })
    await reconcileWorkbench(f.bridge)
    expect((await link(f, task.id)).value).toMatchObject({ status: 'failed', error: expect.stringContaining('no longer allowed') })
    expect(f.stub.calls.created).toHaveLength(0)
  })
})

describe('watching a session', () => {
  it('follows an active session and announces its end with a fresh card', async () => {
    const f = await fixture()
    const project = await f.makeDirectory('project')
    f.addCodeThread('code-1', project)
    const thread = targetThread(f, 'code-1')
    thread.turns.push({ id: 'run-1', threadId: 'code-1', status: 'running', prompt: 'long job', createdAt: new Date().toISOString(), steering: [], items: [],
      attachmentIds: [], activeSkillIds: [], injectedMemoryIds: [], injectedMemorySummaries: [], injectedDirectiveIds: [],
      injectedDirectiveSummaries: [], injectedInstructionSources: [] } as never)
    const watched = await watchWorkbenchThread(f.bridge, f.room.id, { clientRequestId: 'watch-1', threadId: 'code-1' })
    expect(watched).toMatchObject({ kind: 'watch', status: 'running', threadId: 'code-1', turnId: 'run-1', origin: { kind: 'user', action: 'watch' } })
    // Watching twice returns the same link instead of stacking cards.
    expect((await watchWorkbenchThread(f.bridge, f.room.id, { clientRequestId: 'watch-2', threadId: 'code-1' })).id).toBe(watched.id)
    thread.turns[0].status = 'completed'
    thread.turns[0].finishedAt = new Date().toISOString()
    await reconcileWorkbench(f.bridge)
    expect((await link(f, watched.id)).value).toMatchObject({ status: 'completed', reported: true })
    const cards = await f.store.list('message', { roomId: f.room.id })
    expect(cards.filter((card) => (card.value as { workbenchLinkId?: string }).workbenchLinkId === watched.id)).toHaveLength(2)
    expect(enqueuePrivateContinuation).not.toHaveBeenCalled() // a watch is a reminder, not a model turn
  })

  it('rejects idle, missing and room-owned sessions', async () => {
    const f = await fixture()
    const project = await f.makeDirectory('project')
    f.addCodeThread('idle', project)
    await expect(watchWorkbenchThread(f.bridge, f.room.id, { clientRequestId: 'w1', threadId: 'idle' })).rejects.toThrow('not running')
    await expect(watchWorkbenchThread(f.bridge, f.room.id, { clientRequestId: 'w2', threadId: 'missing' })).rejects.toThrow('not found')
    f.stub.threads.set('room-owned', { ...targetThread(f, 'idle'), id: 'room-owned', roomContext: f.thread.roomContext })
    await expect(watchWorkbenchThread(f.bridge, f.room.id, { clientRequestId: 'w3', threadId: 'room-owned' })).rejects.toThrow('not found')
  })
})
