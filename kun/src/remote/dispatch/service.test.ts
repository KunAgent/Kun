import { afterEach, expect, it, vi } from 'vitest'
import { remoteFixture } from '../testing/runtime.test-support.js'
import { FileAgentDispatchIntentStore } from '../../delegation/agent-dispatch-intent-store.js'
import { AgentDispatchService } from '../../delegation/agent-dispatch-service.js'
import { kunToolPermissionModeSettings } from '../../contracts/policy.js'
import { RemoteDispatch } from './service.js'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0)) await close() })
async function setup() {
  const f = await remoteFixture(), parent = await f.code(), other = await f.code('Other')
  const start = vi.fn(async () => ({ threadId: 'child_1' })), validate = vi.fn(async () => {})
  const service = new AgentDispatchService({ store: new FileAgentDispatchIntentStore(f.root), applicationSessionId: 'app',
    onUpdated: async () => {} })
  service.registerHandler('worker', { start, validate, cancel: async () => {} })
  f.runtime.agentDispatchService = service
  await service.start()
  cleanups.push(async () => { await service.stop(); await f.close() })
  const intent = await service.propose({ kind: 'worker',
    source: { threadId: parent.id, turnId: 'turn_1', toolCallId: 'call_1', userIntent: 'private excerpt' },
    policySnapshot: kunToolPermissionModeSettings('full-access'),
    recommendation: { title: 'Review two modules', task: 'private task details', agentId: 'kun', model: 'fake',
      permissionMode: 'full-access', agentSelection: 'auto',
      assignments: [{ label: 'Module A', agentId: 'kun', model: 'fake' }, { label: 'Module B', agentId: 'kun', model: 'fake' }] },
    payload: { secret: 'host-owned payload' } })
  const params = { threadId: parent.id, intentId: intent.intentId, expectedRevision: intent.revision }
  return { ...f, parent, other, intent, service, start, params, validate }
}
it('lists only the authorized parent, sanitizes cards, and advertises exact read/write capabilities', async () => {
  const f = await setup()
  const value = await f.call('dispatch.list', { threadId: f.parent.id })
  expect(value.intents).toHaveLength(1)
  expect(value.intents[0]).toMatchObject({ state: 'countdown', deadline: f.intent.deadline })
  expect(JSON.stringify(value)).not.toMatch(/host-owned payload|private excerpt|private task details|requestLedger/)
  expect((await f.call('dispatch.list', { threadId: f.other.id })).intents).toEqual([])
  const wrong = await f.call('dispatch.act', { ...f.params, threadId: f.other.id, action: 'pause' })
  expect(wrong.receipt.error).toMatchObject({ code: 'NOT_FOUND', definitive: true })
  const catalog = await f.call('catalog.get', {})
  expect(catalog.capabilityDescriptors).toEqual(expect.arrayContaining([
    expect.objectContaining({ operation: 'dispatch.list', allowedActions: ['read'] }),
    expect.objectContaining({ operation: 'dispatch.act', allowedActions: ['write'] })
  ]))
  expect(f.start).not.toHaveBeenCalled()
})
it('pauses before editing and rejects stale revisions and incomplete batch routes', async () => {
  const f = await setup()
  const paused = (await f.call('dispatch.act', { ...f.params, action: 'pause' }, 'pause')).receipt.result.intent
  expect(paused.state).toBe('paused'); expect(paused.deadline).toBeUndefined()
  expect((await f.call('dispatch.act', { ...f.params, action: 'start_now' })).receipt.error.code).toBe('REVISION_CONFLICT')
  const bad = await f.call('dispatch.act', { ...f.params, expectedRevision: paused.revision, action: 'update', assignments: [{ agentId: 'kun' }] })
  expect(bad.receipt.error.code).toBe('INVALID_REQUEST')
  const saved = await f.call('dispatch.act', { ...f.params, expectedRevision: paused.revision, action: 'update',
    assignments: [{ agentId: 'kun', model: 'fake' }, { agentId: 'kun', model: 'fake' }] })
  expect(saved.receipt.result.intent).toMatchObject({ state: 'countdown', revision: paused.revision + 1 })
  expect(f.start).not.toHaveBeenCalled()
})
it('replays a start receipt without starting twice; request identity cannot change parameters', async () => {
  const f = await setup(), p = { ...f.params, action: 'start_now' }
  const first = await f.call('dispatch.act', p, 'start')
  await f.service.reconcile()
  expect((await f.call('dispatch.act', p, 'start')).receipt).toEqual(first.receipt)
  expect(f.start).toHaveBeenCalledTimes(1)
  await expect(f.call('dispatch.act', { ...p, action: 'cancel' }, 'start')).rejects.toThrow('REQUEST_CONFLICT')
})
it('a disabled unchanged assignment rejects before committing and does not strand receipt recovery', async () => {
  const f = await setup()
  const paused = (await f.call('dispatch.act', { ...f.params, action: 'pause' })).receipt.result.intent
  f.validate.mockRejectedValue(Error('Agent for Module B was disabled'))
  const result = await f.call('dispatch.act', { ...f.params, expectedRevision: paused.revision, action: 'update',
    assignments: [{ agentId: 'kun', model: 'fake' }, { agentId: 'kun', model: 'fake' }] }, 'invalid_route')
  expect(result.receipt).toMatchObject({ status: 'reconciliation_required', error: { code: 'INVALID_REQUEST', definitive: true } })
  expect((await f.call('request.get', { requestId: 'invalid_route' })).receipt.error.definitive).toBe(true)
  expect(await f.service.get(f.intent.intentId)).toMatchObject({ state: 'paused', revision: paused.revision })
  expect((await f.call('dispatch.act', { ...f.params, expectedRevision: paused.revision, action: 'cancel' })).receipt.result.intent.state).toBe('cancelled')
  expect(f.start).not.toHaveBeenCalled()
})
it('recovers only committed ledger identities after an uncertain response, without replay', async () => {
  const f = await setup(), act = f.service.act.bind(f.service)
  vi.spyOn(f.service, 'act').mockImplementationOnce(async (...args) => {
    await act(...args)
    throw Error('response lost after the action committed')
  })
  const result = await f.call('dispatch.act', { ...f.params, action: 'pause' }, 'lost_reply')
  expect(result.receipt.status).toBe('reconciliation_required')
  const recovered = await f.call('request.get', { requestId: 'lost_reply' })
  expect(recovered.receipt).toMatchObject({ status: 'applied', result: { intent: { state: 'paused', revision: 2 } } })
  expect((await f.service.get(f.intent.intentId))?.revision).toBe(2)
  const adapter = new RemoteDispatch(f.runtime, async () => ['fake'])
  expect(await adapter.recover(f.envelope('request.get', { requestId: 'missing' }) as any,
    { requestId: 'missing', params: f.params } as any)).toBeUndefined()
  expect(f.start).not.toHaveBeenCalled()
})
