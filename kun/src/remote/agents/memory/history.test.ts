import { expect, it, vi } from 'vitest'
import { canonicalMemoryHash } from '../../../memory/memory-record-normalizer.js'
import { agentStableId } from '../../../agents/agent-identity-service.js'
import { putRoomDocument } from '../../../rooms/room-service.js'
import { AgentParamSchemas } from '../service.js'
import { receiptKey } from '../../requests/receipts.js'
import { agentHistoryFixture } from './history.test-support.js'

it('executes the installed SDK contract through the real facade and request.get recovery', async () => {
  const f = await agentHistoryFixture()
  try {
    const call = (method: string, params: unknown, id?: string) => f.facade.execute(f.envelope(method, params, id)) as Promise<any>
    const catalog = await call('catalog.get', {})
    expect(catalog.capabilityDescriptors.some((descriptor: any) => descriptor.operation === 'agent.memory.candidates.list' && descriptor.enabled)).toBe(true)
    const list = await call('agent.memory.candidates.list', { agentId: f.agent.id })
    expect(list.candidates[0].candidateId).toBe(f.candidate.id)
    const proposed = await call('agent.memory.candidates.get', { ...f.candidateParams, side: 'proposed', maxChars: 100 })
    expect(proposed.content.text).toBe(f.candidate.candidate.content.slice(0, 100))
    await f.rooms.agentMemory.edit(f.agent.id, f.saved.memory.id, { clientRequestId: 'facade-revision', expectedFingerprint: f.saved.fingerprint, content: 'Revised via native service' })
    const current = await f.rooms.agentMemory.find(f.agent.id, f.saved.memory.id)
    const memory = { ...f.memoryParams, expectedFingerprint: canonicalMemoryHash(current) }
    const history = await call('agent.memory.history.list', memory)
    const prior = await call('agent.memory.history.get', { ...memory, revision: history.revisions[0].revision })
    expect(prior.content.text).toBe(f.saved.memory.content)
    const params = { ...f.candidateParams, decision: 'reject' }
    const result = await call('agent.memory.candidates.decide', params, 'facade-reject')
    expect(result.receipt.result.status).toBe('skipped')
    expect((await call('request.get', { requestId: 'facade-reject' })).receipt).toEqual(result.receipt)
    await expect(call('agent.memory.candidates.get', { ...f.candidateParams, side: 'current' })).rejects.toThrow('INVALID_REQUEST')
  } finally { await f.close() }
})

it('returns explicitly clipped private candidate summaries and complete contiguous content slices', async () => {
  const f = await agentHistoryFixture()
  try {
    await f.seed({ ...f.candidate, id: 'candidate-two' })
    const page = await f.call('agent.memory.candidates.list', { agentId: f.agent.id, limit: 1 })
    expect(page).toMatchObject({ complete: false, hasMore: true })
    expect(page.candidates[0].proposed).toMatchObject({ contentTruncated: true, summary: true, contentLength: f.candidate.candidate.content.length })
    expect(page.candidates[0].target.fingerprint).toBe(f.saved.fingerprint)
    expect(JSON.stringify(page)).not.toContain('locator')
    expect((await f.call('agent.memory.candidates.list', { agentId: f.agent.id, limit: 1, cursor: page.nextCursor }))).toMatchObject({ complete: true, hasMore: false })
    let text = '', offset = 0
    do {
      const result = await f.call('agent.memory.candidates.get', { ...f.candidateParams, side: 'proposed', contentOffset: offset, maxChars: 11 })
      expect(result.content.offset).toBe(offset)
      expect(result.content.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/)
      text += result.content.text; offset = result.content.nextOffset
    } while (offset !== undefined)
    expect(text).toBe(f.candidate.candidate.content)
    const current = await f.call('agent.memory.candidates.get', { ...f.candidateParams, side: 'current', expectedTargetFingerprint: f.saved.fingerprint })
    expect(current.content.text).toBe(f.saved.memory.content)
  } finally { await f.close() }
})
it('requires the exact target fingerprint and candidate revision, without empty/current fallback or scope fields', async () => {
  const f = await agentHistoryFixture()
  try {
    for (const fingerprint of [undefined, null, '', 'old']) {
      expect(() => AgentParamSchemas['agent.memory.candidates.decide'].parse({ ...f.candidateParams, decision: 'accept', expectedTargetFingerprint: fingerprint })).toThrow()
      expect(() => AgentParamSchemas['agent.memory.candidates.get'].parse({ ...f.candidateParams, side: 'current', expectedTargetFingerprint: fingerprint })).toThrow()
    }
    expect(() => AgentParamSchemas['agent.memory.candidates.decide'].parse({ ...f.candidateParams, decision: 'reject', shared: true })).toThrow()
    await expect(f.call('agent.memory.candidates.get', { ...f.candidateParams, expectedRevision: 1, side: 'proposed' })).rejects.toThrow('REVISION_CONFLICT')
    await f.rooms.agentMemory.edit(f.agent.id, f.saved.memory.id, { clientRequestId: 'desktop-edit', expectedFingerprint: f.saved.fingerprint, content: 'A newer user correction' })
    const stale = await f.call('agent.memory.candidates.decide', { ...f.candidateParams, decision: 'accept', expectedTargetFingerprint: f.saved.fingerprint })
    expect(stale.error).toEqual({ code: 'REVISION_CONFLICT', definitive: true })
    expect((await f.rooms.agentMemory.find(f.agent.id, f.saved.memory.id)).content).toBe('A newer user correction')
    const rejected = await f.call('agent.memory.candidates.decide', { ...f.candidateParams, decision: 'reject' })
    expect(rejected.result).toEqual({ candidateId: f.candidate.id, revision: 1, status: 'skipped' })
  } finally { await f.close() }
})
it('commits one native decision before success and recovers a lost outer settlement only from its proof', async () => {
  const f = await agentHistoryFixture()
  try {
    const params = { ...f.candidateParams, decision: 'accept', expectedTargetFingerprint: f.saved.fingerprint }
    const original = f.store.commit.bind(f.store)
    const spy = vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
      if (input.requestId.endsWith('-settle')) throw new Error('outer acknowledgement lost')
      return original(input)
    })
    await expect(f.call('agent.memory.candidates.decide', params, 'one-decision')).rejects.toThrow('lost')
    spy.mockRestore()
    const envelope = f.envelope('agent.memory.candidates.decide', params, 'one-decision')
    const uncertain = await f.receipts.get(envelope, 'one-decision')
    expect(uncertain?.status).toBe('reconciliation_required')
    expect(await f.agents.recover(envelope, uncertain!)).toEqual({ candidateId: f.candidate.id, revision: 1, status: 'completed', memoryId: agentStableId('mem-agent-approved', f.candidate.id) })
    expect(await f.agents.recover({ ...envelope, deviceId: 'other-phone' }, uncertain!)).toBeUndefined()
    const again = await f.call('agent.memory.candidates.decide', params, 'one-decision')
    expect(again.status).toBe('reconciliation_required')
    const records = await f.storage.list({ agent: { agentId: f.agent.id, manage: true } })
    expect(records).toHaveLength(2)
  } finally { await f.close() }
})
it('keeps a canonical write without native decision proof unknown and never retries it', async () => {
  const f = await agentHistoryFixture()
  try {
    const params = { ...f.candidateParams, decision: 'accept', expectedTargetFingerprint: f.saved.fingerprint }
    const original = f.store.commit.bind(f.store)
    const nativeKey = agentStableId('agent-memory-decision', f.candidate.id, receiptKey(f.envelope('', {}), 'uncertain'))
    const spy = vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
      if (input.requestId === nativeKey) throw new Error('decision proof unavailable')
      return original(input)
    })
    const result = await f.call('agent.memory.candidates.decide', params, 'uncertain')
    spy.mockRestore()
    expect(result).toMatchObject({ status: 'reconciliation_required' }); expect(result.error).toBeUndefined()
    expect(await f.agents.recover(f.envelope('', {}), result)).toBeUndefined()
    expect((await f.call('agent.memory.candidates.decide', params, 'uncertain')).status).toBe('reconciliation_required')
    expect(await f.storage.list({ agent: { agentId: f.agent.id, manage: true } })).toHaveLength(2)
    expect((await f.store.get<any>('agent_memory_job', f.candidate.id))?.value.status).toBe('pending')
  } finally { await f.close() }
})
it('checks the actual target revision inside canonical memory mutation after preflight', async () => {
  const f = await agentHistoryFixture()
  try {
    const create = f.storage.createWithId.bind(f.storage), update = f.storage.update.bind(f.storage)
    const spy = vi.spyOn(f.storage, 'createWithId').mockImplementationOnce(async (id, input) => {
      await update(f.saved.memory.id, { content: 'Concurrent canonical correction', expectedRevision: f.saved.memory.revision }, { agent: { agentId: f.agent.id, manage: true } })
      return create(id, input)
    })
    const result = await f.call('agent.memory.candidates.decide', { ...f.candidateParams, decision: 'accept', expectedTargetFingerprint: f.saved.fingerprint })
    spy.mockRestore()
    expect(result.status).toBe('reconciliation_required'); expect(result.error).toBeUndefined()
    expect((await f.rooms.agentMemory.find(f.agent.id, f.saved.memory.id)).content).toBe('Concurrent canonical correction')
    expect(await f.storage.list({ agent: { agentId: f.agent.id, manage: true } })).toHaveLength(1)
  } finally { await f.close() }
})
it('rejects another Agent and does not expose group candidate or group-target memory history', async () => {
  const f = await agentHistoryFixture()
  try {
    const other = (await f.rooms.agents.create({ clientRequestId: 'other', name: 'Other' })).agent
    await expect(f.call('agent.memory.candidates.get', { ...f.candidateParams, agentId: other.id, side: 'proposed' })).rejects.toThrow('NOT_FOUND')
    await expect(f.call('agent.memory.history.list', { ...f.memoryParams, agentId: other.id })).rejects.toThrow('NOT_FOUND')
    const row = (await f.store.get<any>('room', f.room.id))!
    await putRoomDocument(f.store, 'room', row.id, row.id, { ...row.value, conversationKind: 'group' }, row)
    const page = await f.call('agent.memory.candidates.list', { agentId: f.agent.id })
    expect(page.candidates).toEqual([]); expect(page.complete).toBe(true)
    await expect(f.call('agent.memory.candidates.get', { ...f.candidateParams, side: 'proposed' })).rejects.toThrow('INVALID_REQUEST')
    await expect(f.call('agent.memory.history.list', f.memoryParams)).rejects.toThrow('INVALID_REQUEST')
  } finally { await f.close() }
})
it('paginates retained native revisions, binds cursor/current fingerprint and never revives forgotten content', async () => {
  const f = await agentHistoryFixture()
  try {
    let memory = f.saved.memory
    for (let n = 0; n < 23; n++) {
      await f.rooms.agentMemory.edit(f.agent.id, memory.id, {
        clientRequestId: 'edit-' + n, expectedFingerprint: canonicalMemoryHash(memory), content: 'Revision ' + n + ' 😀' })
      memory = await f.rooms.agentMemory.find(f.agent.id, memory.id)
    }
    const params = { ...f.memoryParams, expectedFingerprint: canonicalMemoryHash(memory) }
    const page = await f.call('agent.memory.history.list', { ...params, limit: 2 })
    expect(page).toMatchObject({ coverage: 'retained_local_revisions', hasMore: true, complete: false })
    const content = await f.call('agent.memory.history.get', { ...params, revision: page.revisions[0].revision, maxChars: 9 })
    expect(content.content).toMatchObject({ text: 'Revision ', nextOffset: 9 })
    const next = await f.call('agent.memory.history.list', { ...params, cursor: page.nextCursor, limit: 20 })
    expect(page.revisions.length + next.revisions.length).toBe(20)
    expect(next).toMatchObject({ complete: true, hasMore: false })
    await expect(f.call('agent.memory.history.get', { ...params, revision: 1 })).rejects.toThrow('NOT_FOUND')
    await f.rooms.agentMemory.edit(f.agent.id, memory.id, { clientRequestId: 'later', expectedFingerprint: params.expectedFingerprint, content: 'New current' })
    const changed = await f.rooms.agentMemory.find(f.agent.id, memory.id)
    await expect(f.call('agent.memory.history.list', { ...params, cursor: page.nextCursor })).rejects.toThrow('REVISION_CONFLICT')
    await expect(f.call('agent.memory.history.list', { ...params, expectedFingerprint: canonicalMemoryHash(changed), cursor: page.nextCursor })).rejects.toThrow('INVALID_CURSOR')
    await f.rooms.agentMemory.edit(f.agent.id, memory.id, { clientRequestId: 'forget', expectedFingerprint: canonicalMemoryHash(changed), forget: true })
    await expect(f.call('agent.memory.history.get', { ...params, revision: changed.revision - 1 })).rejects.toThrow('NOT_FOUND')
    expect((await f.call('agent.memory.candidates.list', { agentId: f.agent.id })).candidates).toEqual([])
  } finally { await f.close() }
})
