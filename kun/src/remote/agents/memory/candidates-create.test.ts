import { expect, it } from 'vitest'
import { validateOperationParams } from '@kun/remote-protocol'
import { agentHistoryFixture } from './history.test-support.js'

it('accepts a scoped targetless create through the facade exactly once without touching existing memory', async () => {
  const f = await agentHistoryFixture()
  try {
    const held = { ...f.candidate, id: 'held-create', action: 'create' as const, targetId: undefined, targetFingerprint: undefined,
      captureScope: { conversationId: f.room.id, taskId: 'task-private' }, reason: 'invalid-relation related: review required' }
    await f.seed(held)
    const page = await f.facade.execute(f.envelope('agent.memory.candidates.list', { agentId: f.agent.id })) as any
    expect(page.candidates.find((entry: any) => entry.candidateId === held.id)).toMatchObject({
      action: 'create', targetAvailable: false, canAccept: true, reason: 'comparison_review_required'
    })
    const proposed = await f.facade.execute(f.envelope('agent.memory.candidates.get', {
      agentId: f.agent.id, candidateId: held.id, expectedRevision: 0, side: 'proposed'
    })) as any
    expect(proposed.content.text).toBe(held.candidate.content)
    const params = { agentId: f.agent.id, candidateId: held.id, expectedRevision: 0, decision: 'accept' }
    const envelope = f.envelope('agent.memory.candidates.decide', params, 'create-decision')
    const result = await f.facade.execute(envelope) as any
    expect(result.receipt.result).toMatchObject({ candidateId: held.id, status: 'completed' })
    expect(await f.facade.execute(envelope)).toEqual(result)
    const records = await f.storage.list({ agent: { agentId: f.agent.id, manage: true } })
    expect(records).toHaveLength(2)
    const created = records.find((record) => record.id === result.receipt.result.memoryId)!
    expect(created.agentContext).toMatchObject({ sourceConversationId: f.room.id, sourceTaskId: 'task-private', locked: true })
    expect(created.supersedes).toBeUndefined()
    expect(records.find((record) => record.id === f.saved.memory.id)?.supersededAt).toBeUndefined()
  } finally { await f.close() }
})

it('fails closed for missing update targets, unknown legacy scope and unexpected target fingerprints', async () => {
  const f = await agentHistoryFixture()
  try {
    const base = { ...f.candidate, targetId: undefined, targetFingerprint: undefined,
      captureScope: { conversationId: f.room.id } }
    for (const [id, candidate, fingerprint] of [
      ['missing-update', { ...base, action: 'update' as const }, undefined],
      ['legacy-create', { ...base, action: 'create' as const, captureScope: undefined }, undefined],
      ['wrong-fingerprint', { ...base, action: 'create' as const }, f.saved.fingerprint]
    ] as const) {
      await f.seed({ ...candidate, id })
      const result = await f.call('agent.memory.candidates.decide', {
        agentId: f.agent.id, candidateId: id, expectedRevision: 0, decision: 'accept', ...(fingerprint ? { expectedTargetFingerprint: fingerprint } : {})
      }, id)
      expect(result.error).toEqual({ code: 'INVALID_REQUEST', definitive: true })
      if (id !== 'wrong-fingerprint') {
        const page = await f.call('agent.memory.candidates.list', { agentId: f.agent.id })
        expect(page.candidates.find((entry: any) => entry.candidateId === id).canAccept).toBe(false)
      }
    }
    expect(await f.storage.list({ agent: { agentId: f.agent.id, manage: true } })).toHaveLength(1)
  } finally { await f.close() }
})

it('does not expose or approve a targetless candidate whose retained capture scope is outside the private Agent surface', async () => {
  const f = await agentHistoryFixture()
  try {
    await f.seed({ ...f.candidate, id: 'foreign-scope', action: 'create', targetId: undefined, targetFingerprint: undefined,
      captureScope: { conversationId: 'unavailable-room' } })
    const params = { agentId: f.agent.id, candidateId: 'foreign-scope', expectedRevision: 0 }
    await expect(f.call('agent.memory.candidates.get', { ...params, side: 'proposed' })).rejects.toThrow('INVALID_REQUEST')
    const result = await f.call('agent.memory.candidates.decide', { ...params, decision: 'accept' }, 'foreign-scope-decision')
    expect(result.error).toEqual({ code: 'INVALID_REQUEST', definitive: true })
    expect((await f.call('agent.memory.candidates.list', { agentId: f.agent.id })).candidates.map((entry: any) => entry.candidateId))
      .not.toContain('foreign-scope')
    expect(await f.storage.list({ agent: { agentId: f.agent.id, manage: true } })).toHaveLength(1)
  } finally { await f.close() }
})

it('keeps protocol validation strict for supplied fingerprints and rejects client-controlled scope', () => {
  const params = { agentId: 'agent', candidateId: 'candidate', expectedRevision: 0, decision: 'accept' as const }
  expect(() => validateOperationParams('agent.memory.candidates.decide', params)).not.toThrow()
  for (const expectedTargetFingerprint of [null, '', 'old']) {
    expect(() => validateOperationParams('agent.memory.candidates.decide', { ...params, expectedTargetFingerprint })).toThrow()
  }
  expect(() => validateOperationParams('agent.memory.candidates.decide', { ...params, captureScope: { conversationId: 'other' } })).toThrow()
  expect(() => validateOperationParams('agent.memory.candidates.get', {
    agentId: params.agentId, candidateId: params.candidateId, expectedRevision: 0, side: 'current'
  })).toThrow()
})
