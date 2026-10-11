import { afterEach, describe, expect, it } from 'vitest'
import type { RoomMessage } from '../contracts/rooms.js'
import type { WorkbenchLink } from '../contracts/workbench-links.js'
import { workbenchToolNamesForPolicy, resolveWorkbenchPolicy } from '../contracts/workbench-policy.js'
import { workbenchFixture, type WorkbenchFixture } from './workbench-test-support.js'

const open: WorkbenchFixture[] = []
afterEach(async () => { for (const fixture of open.splice(0)) await fixture.cleanup() })
async function fixture(options?: Parameters<typeof workbenchFixture>[0]) {
  const value = await workbenchFixture(options)
  open.push(value)
  return value
}
const links = (f: WorkbenchFixture) => f.store.list<WorkbenchLink>('workbench_link', { roomId: f.room.id })

describe('workbench policy', () => {
  it('defaults conservatively and hides tools the policy does not allow', () => {
    expect(resolveWorkbenchPolicy(undefined)).toEqual({ code: 'confirm', work: 'read', maxActiveTasks: 3 })
    expect(resolveWorkbenchPolicy({ code: 'nonsense' })).toEqual({ code: 'confirm', work: 'read', maxActiveTasks: 3 })
    const off = workbenchToolNamesForPolicy(resolveWorkbenchPolicy({ code: 'off', work: 'off' }))
    expect(off).toEqual([])
    const read = workbenchToolNamesForPolicy(resolveWorkbenchPolicy({ code: 'off', work: 'read' }))
    expect(read).toEqual(['list_work_spaces', 'search_work_documents', 'read_work_document'])
    expect(workbenchToolNamesForPolicy(resolveWorkbenchPolicy({ work: 'confirm' }))).toContain('create_work_document')
  })
})

describe('Code read tools', () => {
  it('lists only projects inside the Agent limits and never room-owned threads', async () => {
    const f = await fixture()
    const alpha = await f.makeDirectory('alpha'), beta = await f.makeDirectory('beta')
    f.addCodeThread('t1', alpha)
    f.addCodeThread('t2', beta)
    f.addCodeThread('t3', alpha, { status: 'archived' })
    const all = await f.run('list_code_projects', {})
    expect((all.output as { projects: Array<{ path: string }> }).projects.map((project) => project.path).sort()).toEqual([alpha, beta].sort())
    const limited = await fixture({ allowedRoots: [beta] })
    limited.addCodeThread('t1', beta)
    limited.addCodeThread('t2', await limited.makeDirectory('other'))
    const scoped = await limited.run('list_code_projects', {})
    expect((scoped.output as { projects: Array<{ path: string }> }).projects.map((project) => project.path)).toEqual([beta])
  })

  it('reads a bounded summary of a Code thread and rejects room threads', async () => {
    const f = await fixture()
    const alpha = await f.makeDirectory('alpha')
    f.addCodeThread('t1', alpha)
    const read = await f.run('read_code_thread', { threadId: 't1' })
    expect(read.isError).not.toBe(true)
    expect(read.output).toMatchObject({ authority: 'reference_only', thread: { id: 't1', project: alpha, pendingApprovals: 0 } })
    f.stub.threads.set('room-thread', { ...f.stub.threads.get('t1')!, id: 'room-thread', roomContext: f.thread.roomContext })
    expect((await f.run('read_code_thread', { threadId: 'room-thread' })).isError).toBe(true)
    expect((await f.run('read_code_thread', { threadId: 'missing' })).isError).toBe(true)
  })

  it('refuses every Code tool when the policy is off', async () => {
    const f = await fixture({ policy: { code: 'off' } })
    expect((await f.run('list_code_projects', {})).isError).toBe(true)
    expect((await f.run('create_code_task', { title: 't', goal: 'g', projectRoot: f.directory })).isError).toBe(true)
  })
})

describe('create_code_task', () => {
  it('publishes one confirmation card and replays the same call', async () => {
    const f = await fixture()
    const alpha = await f.makeDirectory('alpha')
    f.addCodeThread('t1', alpha)
    const input = { title: 'Fix SSE', goal: 'Fix the reconnect bug', projectRoot: alpha, acceptance: 'tests pass' }
    const first = await f.run('create_code_task', input)
    expect(first.isError).not.toBe(true)
    const out = first.output as { requested: boolean; linkId: string; messageId: string; status: string }
    expect(out).toMatchObject({ requested: true, status: 'awaiting_confirmation' })
    const card = (await f.store.get<RoomMessage>('message', out.messageId))!.value
    expect(card).toMatchObject({ presentationKind: 'workbench_task', workbenchLinkId: out.linkId, originRunId: f.runId })
    const link = (await f.store.get<WorkbenchLink>('workbench_link', out.linkId))!.value
    expect(link).toMatchObject({ kind: 'code_task', surface: 'code', status: 'awaiting_confirmation',
      request: { title: 'Fix SSE', workspaceRoot: alpha, report: 'final', isolation: 'inherit' } })
    expect(link.threadId).toBeUndefined()
    const again = await f.run('create_code_task', input)
    expect((again.output as { linkId: string }).linkId).toBe(out.linkId)
    expect(await links(f)).toHaveLength(1)
    expect(f.wakes.count).toBe(0)
  })

  it('caps the tasks one run may create and the cards awaiting the user', async () => {
    const f = await fixture()
    const alpha = await f.makeDirectory('alpha')
    for (let index = 1; index <= 2; index++) {
      expect((await f.run('create_code_task', { title: 'Task ' + index, goal: 'g', projectRoot: alpha }, 'call-' + index)).isError).not.toBe(true)
    }
    const third = await f.run('create_code_task', { title: 'Task 3', goal: 'g', projectRoot: alpha }, 'call-3')
    expect(third.isError).toBe(true)
    expect(JSON.stringify(third.output)).toContain('maximum number of tasks')
    expect(await links(f)).toHaveLength(2)
  })

  it('starts immediately only for a fresh user request under the auto policy', async () => {
    const fresh = await fixture({ policy: { code: 'auto' } })
    const alpha = await fresh.makeDirectory('alpha')
    fresh.addCodeThread('t1', alpha)
    const started = await fresh.run('create_code_task', { title: 'Go', goal: 'g', projectRoot: alpha })
    expect(started.output).toMatchObject({ requested: true, status: 'queued' })
    expect(fresh.wakes.count).toBe(1)
    // Reminder wakes, continuations and handoff returns are not fresh: they must ask.
    const stale = await fixture({ policy: { code: 'auto' }, fresh: false })
    const beta = await stale.makeDirectory('beta')
    stale.addCodeThread('t1', beta)
    expect((await stale.run('create_code_task', { title: 'Go', goal: 'g', projectRoot: beta })).output).toMatchObject({ status: 'awaiting_confirmation' })
  })

  it('demands confirmation for a directory the user never used in Code, even under auto', async () => {
    const f = await fixture({ policy: { code: 'auto' } })
    const unknown = await f.makeDirectory('brand-new')
    expect((await f.run('create_code_task', { title: 'Go', goal: 'g', projectRoot: unknown })).output).toMatchObject({ status: 'awaiting_confirmation' })
  })

  it('rejects missing directories and projects outside the Agent limits', async () => {
    const allowed = await fixture()
    const good = await allowed.makeDirectory('good')
    const limited = await fixture({ allowedRoots: [good] })
    const outside = await limited.makeDirectory('outside')
    expect((await limited.run('create_code_task', { title: 't', goal: 'g', projectRoot: outside })).isError).toBe(true)
    expect((await limited.run('create_code_task', { title: 't', goal: 'g', projectRoot: '/definitely/not/here' })).isError).toBe(true)
    expect(await links(limited)).toHaveLength(0)
  })

  it('rejects a forged turn', async () => {
    const f = await fixture()
    const alpha = await f.makeDirectory('alpha')
    const result = await f.tool('create_code_task').execute({ title: 't', goal: 'g', projectRoot: alpha }, { ...f.context(), turnId: 'wrong' })
    expect(result.isError).toBe(true)
    expect(await links(f)).toHaveLength(0)
  })
})

describe('task follow-up tools', () => {
  it('only touches the Agent\'s own running task and stops once the user took over', async () => {
    const f = await fixture()
    const alpha = await f.makeDirectory('alpha')
    const created = (await f.run('create_code_task', { title: 'Task', goal: 'g', projectRoot: alpha })).output as { linkId: string }
    // Not started yet: nothing to message.
    expect((await f.run('message_code_task', { linkId: created.linkId, message: 'also do X' }, 'call-2')).isError).toBe(true)
    const row = (await f.store.get<WorkbenchLink>('workbench_link', created.linkId))!
    f.stub.threads.set('target', { ...f.stub.threads.get('conv-thread') ?? f.thread, id: 'target', roomContext: undefined,
      turns: [{ id: 'tt-1', threadId: 'target', status: 'running', prompt: 'p', clientRequestId: 'c', createdAt: new Date().toISOString(),
        steering: [], items: [], attachmentIds: [], activeSkillIds: [], injectedMemoryIds: [], injectedMemorySummaries: [],
        injectedDirectiveIds: [], injectedDirectiveSummaries: [], injectedInstructionSources: [] }] as never })
    await f.store.commit({ requestId: 'set-running', checks: [{ kind: 'workbench_link', id: created.linkId, expectedRevision: row.revision }],
      puts: [{ kind: 'workbench_link', id: created.linkId, roomId: f.room.id, value: { ...row.value, status: 'running', threadId: 'target', turnId: 'tt-1' } }] })
    const sent = await f.run('message_code_task', { linkId: created.linkId, message: 'also do X' }, 'call-3')
    expect(sent.output).toMatchObject({ delivered: true })
    expect(f.stub.calls.steered).toHaveLength(1)
    expect(String(f.stub.calls.steered[0].operationId)).toMatch(/^workbench-steer-/)
    const current = (await f.store.get<WorkbenchLink>('workbench_link', created.linkId))!
    await f.store.commit({ requestId: 'took-over', checks: [{ kind: 'workbench_link', id: created.linkId, expectedRevision: current.revision }],
      puts: [{ kind: 'workbench_link', id: created.linkId, roomId: f.room.id, value: { ...current.value, userTookOver: true } }] })
    expect((await f.run('message_code_task', { linkId: created.linkId, message: 'and Y' }, 'call-4')).isError).toBe(true)
    expect((await f.run('get_code_task', { linkId: 'unknown-link' })).isError).toBe(true)
  })
})
