import { afterEach, describe, expect, it, vi } from 'vitest'
import { productServiceFixture } from '../../tests/room-product-service-test-fixture.js'
import type { RoomRule, RoomRequestOutcome } from '../contracts/rooms-product.js'
import type { RoomRequestState, RoomTaskExecution } from './room-runtime-types.js'
import type { RoomStoreCommit } from './room-store.js'

const fixtures: Awaited<ReturnType<typeof productServiceFixture>>[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.close() })
async function fixture() { const f = await productServiceFixture(); fixtures.push(f); return f }
async function ruleFixture(f: Awaited<ReturnType<typeof fixture>>) {
  const sent = await f.service.send(f.room.id, { clientRequestId: 'agreement', body: 'Use the existing test suite.' })
  const saved = await f.service.rule(f.room.id, sent.message.id, 'pin')
  return saved.result as RoomRule
}

describe('room product agreements and read state', () => {
  it('retains immutable rule versions and exactly replays an edit after subsequent edits', async () => {
    const f = await fixture()
    const rule = await ruleFixture(f)
    const body = { clientRequestId: 'edit', expectedRevision: 0, body: 'Run the focused test suite.' }
    const edited = await f.product.updateRule(f.room.id, rule.id, body)
    await f.product.updateRule(f.room.id, rule.id, { clientRequestId: 'withdraw', expectedRevision: 1, active: false })
    expect((await f.product.updateRule(f.room.id, rule.id, body)).result).toEqual(edited.result)
    const history = await f.store.list<RoomRule>('rule_version', { roomId: f.room.id, order: 'asc' })
    expect(history.map((row) => [row.value.version, row.value.active])).toEqual([[1, true], [2, true], [3, false]])
    expect(history[0].value.body).toBe('Use the existing test suite.')
    await expect(f.product.updateRule(f.room.id, rule.id, { ...body, active: true })).rejects.toThrow('identity conflict')
  })

  it('adopts a frozen current version through the trusted send argument and replays after rule changes', async () => {
    const f = await fixture()
    const rule = await ruleFixture(f)
    const send = vi.spyOn(f.service, 'send')
    const input = { taskId: f.execution.task.id, expectedTaskRevision: 0, version: 1, clientRequestId: 'adopt' }
    const adopted = await f.product.adoptRule(f.room.id, rule.id, input)
    expect(send).toHaveBeenLastCalledWith(f.room.id, expect.objectContaining({ taskId: f.execution.task.id }), { ruleAdoption: rule })
    const request = (await f.store.get<RoomRequestState>('request', adopted.requestId))!
    expect(request.value.ruleAdoption).toEqual(rule)
    expect(request.value.message).not.toHaveProperty('ruleAdoption')
    await f.product.updateRule(f.room.id, rule.id, { clientRequestId: 'edit-after-adoption', expectedRevision: 0, body: 'New rule body.' })
    expect(await f.product.adoptRule(f.room.id, rule.id, input)).toEqual(adopted)
    expect(send).toHaveBeenCalledTimes(1)
    await expect(f.product.adoptRule(f.room.id, rule.id, { ...input, version: 2 })).rejects.toThrow('identity conflict')
    await expect(f.service.send(f.room.id, { body: 'Forged', clientRequestId: 'forged', ruleAdoption: rule })).rejects.toThrow()
  })

  it('preserves a withdrawn version if sending or its final adoption receipt is interrupted', async () => {
    const f = await fixture()
    const rule = await ruleFixture(f)
    await f.product.updateRule(f.room.id, rule.id, { clientRequestId: 'withdraw', expectedRevision: 0, active: false })
    const input = { taskId: f.execution.task.id, expectedTaskRevision: 0, version: 2, clientRequestId: 'adopt-withdrawal' }
    const commit = f.store.commit.bind(f.store)
    let fail = true
    vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
      const result = await commit(input)
      if (fail && input.requestId.startsWith('room-message:') && input.requestId.includes('adopt-')) {
        fail = false; throw new Error('message acknowledgement lost')
      }
      return result
    })
    await expect(f.product.adoptRule(f.room.id, rule.id, input)).rejects.toThrow('acknowledgement lost')
    await f.product.updateRule(f.room.id, rule.id, { clientRequestId: 'restore', expectedRevision: 1, active: true })
    const adopted = await f.product.adoptRule(f.room.id, rule.id, input)
    const request = (await f.store.get<RoomRequestState>('request', adopted.requestId))!
    expect(request.value.ruleAdoption).toMatchObject({ version: 2, active: false })
    expect(request.value.message.body).toContain('Withdraw this project agreement')
    expect((await f.store.list<RoomRequestState>('request', { roomId: f.room.id })).filter((row) => row.value.ruleAdoption)).toHaveLength(1)
  })

  it('stores no-op read receipts and advances monotonically despite out-of-order concurrent reads', async () => {
    const f = await fixture()
    for (let i = 0; i < 5; i++) await f.service.append(f.room.id, 'message-' + i, 'Message ' + i)
    const messages = await f.store.list('message', { roomId: f.room.id, order: 'asc' })
    const seqs = messages.map((row) => row.seq)
    await Promise.all([f.product.read(f.room.id, seqs[4], 'latest'), f.product.read(f.room.id, seqs[0], 'old'),
      f.product.read(f.room.id, seqs[2], 'middle')])
    expect((await f.store.get<{ seq: number }>('read_state', f.room.id))!.value.seq).toBe(seqs[4])
    const noop = await f.product.read(f.room.id, seqs[0], 'no-op')
    await f.service.append(f.room.id, 'new-message', 'New message')
    const newSeq = (await f.store.list('message', { roomId: f.room.id, limit: 1 }))[0].seq
    await f.product.read(f.room.id, newSeq, 'new-read')
    expect((await f.product.read(f.room.id, seqs[0], 'no-op')).result).toEqual(noop.result)
    await expect(f.product.read(f.room.id, newSeq, 'no-op')).rejects.toThrow('identity conflict')
    expect((await f.store.get<{ seq: number }>('read_state', f.room.id))!.value.seq).toBe(newSeq)
  })
})

describe('original request outcomes', () => {
  it('reconstructs legacy outcomes from current child facts, including mixed completion and failures', async () => {
    const f = await fixture()
    const sent = await f.service.send(f.room.id, { body: 'Implement two repositories.', clientRequestId: 'original' })
    await f.updateTask({ task: { ...f.execution.task, requestId: sent.requestId, status: 'completed' } })
    await f.store.commit({ requestId: 'second-task', checks: [{ kind: 'task', id: 'task_two', expectedRevision: null }],
      puts: [{ kind: 'task', id: 'task_two', roomId: f.room.id, taskId: 'task_two', value: {
        ...f.execution, task: { ...f.execution.task, id: 'task_two', requestId: sent.requestId, repositoryId: 'second_repo', status: 'failed' } } }] })
    const list = await f.product.requests(f.room.id)
    expect(list.find((row) => row.id === sent.requestId)?.outcome).toMatchObject({ status: 'partial', total: 2, completed: 1, failed: 1 })
    await f.product.summarizeRequests([(await f.task()).value])
    expect((await f.store.get<RoomRequestOutcome>('outcome', sent.requestId))?.value.status).toBe('partial')
    const before = await f.store.list('message', { roomId: f.room.id })
    await f.product.summarizeRequests([(await f.task()).value])
    expect(await f.store.list('message', { roomId: f.room.id })).toHaveLength(before.length)
    await f.updateTask({ task: { ...(await f.task()).value.task, status: 'running' } })
    expect((await f.product.requests(f.room.id)).find((row) => row.id === sent.requestId)?.outcome?.status).toBe('running')
  })

  it('saves outcome and terminal summary atomically before acknowledging them', async () => {
    const f = await fixture()
    const commit = f.store.commit.bind(f.store)
    let fail = true
    vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
      if (fail && input.puts?.some((row) => row.kind === 'outcome')) {
        fail = false
        expect(input.puts?.some((row) => row.kind === 'message')).toBe(true)
        throw new Error('transaction interrupted')
      }
      return commit(input)
    })
    await expect(f.product.summarizeRequests([f.execution])).rejects.toThrow('transaction interrupted')
    expect(await f.store.get('outcome', f.execution.task.requestId)).toBeNull()
    await f.product.summarizeRequests([f.execution])
    expect(await f.store.get('outcome', f.execution.task.requestId)).not.toBeNull()
    expect(await f.store.list('message', { roomId: f.room.id })).toHaveLength(1)
  })

  it('counts every task beyond the first database page without mixing other requests', async () => {
    const f = await fixture()
    const sent = await f.service.send(f.room.id, { body: 'Large request.', clientRequestId: 'large' })
    for (let start = 0; start < 1205; start += 500) {
      const puts: NonNullable<RoomStoreCommit['puts']> = []
      for (let i = start; i < Math.min(1205, start + 500); i++) {
        const id = 'child_' + i
        puts.push({ kind: 'task', id, roomId: f.room.id, taskId: id, value: { ...f.execution,
          task: { ...f.execution.task, id, requestId: sent.requestId, status: i === 1204 ? 'failed' : 'completed' } } satisfies RoomTaskExecution })
      }
      await f.store.commit({ requestId: 'batch-' + start, puts, checks: puts.map((put) => ({ kind: put.kind, id: put.id, expectedRevision: null })) })
    }
    expect((await f.product.requests(f.room.id)).find((row) => row.id === sent.requestId)?.outcome)
      .toMatchObject({ status: 'partial', total: 1205, completed: 1204, failed: 1 })
  })
})
