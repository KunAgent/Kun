import { afterEach, describe, expect, it, vi } from 'vitest'
import { getKunThreadDetail } from './kun-runtime-thread-detail'
import { rendererRuntimeClient } from './runtime-client'

const snapshot = { kind: 'context_snapshot', seq: 8, threadId: 'thread', model: 'codex', stepIndex: 0,
  timestamp: '2026-10-11T00:00:00Z', contextWindowTokens: 100_000, softThresholdTokens: 95_000,
  hardThresholdTokens: 99_000, estimatedInputTokens: 19_000,
  breakdown: { tools: 0, system: 0, skills: 0, messages: 19_000, other: 0 }, toolCount: 0, activeSkillIds: [],
  occupancySource: 'agent', contextManagement: 'sdk-managed' }
function stub(contextSnapshot: unknown) {
  vi.spyOn(rendererRuntimeClient, 'runtimeRequest').mockResolvedValue({ ok: true, status: 200,
    body: JSON.stringify({ id: 'thread', latestSeq: 10, turns: [], contextSnapshot, timeline: { hasMore: false } }) })
}
afterEach(() => { vi.restoreAllMocks() })
describe('durable context snapshot mapping', () => {
  it('maps measured request occupancy on cold load independently of cumulative usage', async () => {
    stub(snapshot)
    expect((await getKunThreadDetail('thread')).contextSnapshot).toMatchObject({ threadId: 'thread',
      estimatedInputTokens: 19_000, contextWindowTokens: 100_000, occupancySource: 'agent' })
  })
  it('keeps an Agent\'s own category split distinguishable from Kun\'s estimate', async () => {
    stub({ ...snapshot, breakdown: { tools: 4_000, system: 2_000, skills: 0, messages: 13_000, other: 0 }, breakdownSource: 'agent' })
    expect((await getKunThreadDetail('thread')).contextSnapshot).toMatchObject({ breakdownSource: 'agent',
      breakdown: { tools: 4_000, system: 2_000, messages: 13_000 } })
    stub({ ...snapshot, breakdownSource: 'tokenizer' })
    expect((await getKunThreadDetail('thread')).contextSnapshot).not.toHaveProperty('breakdownSource')
  })
  it.each([null, { ...snapshot, threadId: 'other' }, { ...snapshot, child: {} }, { ...snapshot, estimatedInputTokens: 12 }])(
    'does not invent or borrow telemetry for an invalid response', async value => {
      stub(value)
      expect((await getKunThreadDetail('thread')).contextSnapshot).toBeNull()
    })
  it('leaves legacy absence distinguishable from an explicit clear', async () => {
    stub(undefined)
    expect((await getKunThreadDetail('thread')).contextSnapshot).toBeUndefined()
  })
})
