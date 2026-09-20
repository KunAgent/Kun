import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { productServiceFixture } from '../../tests/room-product-service-test-fixture.js'
import { prepareRoomAgreements, roomBundleRules, RoomContextPending, type RuleCompression } from './room-rule-compression.js'
import { roomRuleOriginalPage } from './room-rule-read-tool.js'
import type { RoomRequestState } from './room-runtime-types.js'
import type { RoomRule } from '../contracts/rooms-product.js'
const mocked = vi.hoisted(() => ({ ensure: vi.fn(), enqueue: vi.fn(), observe: vi.fn() }))
vi.mock('./room-execution.js', () => ({ ensureRoomThread: mocked.ensure, enqueueRoomTurn: mocked.enqueue, observeRoomTurn: mocked.observe }))
const fixtures: Awaited<ReturnType<typeof productServiceFixture>>[] = []
beforeEach(() => {
  mocked.ensure.mockReset().mockResolvedValue(undefined)
  mocked.enqueue.mockReset().mockResolvedValue('compression-turn')
  mocked.observe.mockReset().mockImplementation(async () => {
    const prompt = mocked.enqueue.mock.calls.at(-1)![3] as string
    const input = JSON.parse(prompt.split('\n').at(-1)!)
    return { status: 'completed', text: JSON.stringify({ sources: input.sources,
      summary: 'MUST keep /src/public-api.ts and numeric limit 12. MUST NOT upload credentials. Exception: local fixtures only. Conflicting rules remain unresolved.' }) }
  })
})
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close() })
async function fixture() {
  const f = await productServiceFixture()
  fixtures.push(f)
  const sent = await f.service.send(f.room.id, { clientRequestId: 'input', body: 'Implement with every project agreement' })
  const request = async () => (await f.store.get<RoomRequestState>('request', sent.requestId))!.value
  const rules: RoomRule[] = [{ id: 'rule-long', messageId: 'source', active: true, version: 1,
    body: ('必须保留 /src/public-api.ts，限额 12。禁止上传凭证，例外仅本地测试。'.repeat(300)) }]
  return { ...f, request, rules }
}
async function complete(f: Awaited<ReturnType<typeof fixture>>) {
  for (let i = 0; i < 80; i++) {
    try { return await prepareRoomAgreements(f.deps, await f.request(), f.rules, 16000) }
    catch (error) { if (!(error instanceof RoomContextPending)) throw error }
  }
  throw new Error('compression did not finish')
}
describe('automatic frozen agreement compression', () => {
  it('compresses oversized CJK sources with complete attribution and keeps paged originals authoritative', async () => {
    const f = await fixture()
    const result = await complete(f)
    expect(result.rules).toEqual([])
    expect(result.agreements).toMatchObject({ compressed: true, count: 1, policyVersion: 1 })
    expect(result.agreements.summary).toContain('MUST NOT')
    expect(result.agreements.summary).toContain('/src/public-api.ts')
    expect(result.agreements.summary).toContain('12')
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(10000)
    expect(await roomBundleRules(f.store, f.room.id, result.agreements.bundleId)).toEqual(f.rules)
    const page = await roomRuleOriginalPage(f.store, f.room.id, { bundleId: result.agreements.bundleId, ruleId: 'rule-long', version: 1 })
    expect(page.nextOffset).toBeGreaterThan(0)
    await expect(roomRuleOriginalPage(f.store, 'other-room', { bundleId: result.agreements.bundleId })).rejects.toThrow('not found')
    const calls = mocked.enqueue.mock.calls.length
    expect((await complete(f)).agreements).toEqual(result.agreements)
    expect(mocked.enqueue).toHaveBeenCalledTimes(calls)
  })
  it('rejects omitted source keys after two repairs and preserves the complete frozen source', async () => {
    const f = await fixture()
    mocked.observe.mockResolvedValue({ status: 'completed', text: JSON.stringify({ sources: ['fabricated-source'], summary: 'Looks short' }) })
    await expect(complete(f)).rejects.toThrow('source coverage')
    expect(mocked.enqueue).toHaveBeenCalledTimes(3)
    const job = (await f.store.list<RuleCompression>('rule_compression', { roomId: f.room.id }))[0].value
    expect(job.status).toBe('failed')
    expect(await roomBundleRules(f.store, f.room.id, job.bundleId)).toEqual(f.rules)
  })
  it('uses originals directly when they fit and creates a different bundle for a changed version', async () => {
    const f = await fixture()
    f.rules[0].body = 'Do not remove compatibility. Numeric limit 12.'
    const first = await complete(f)
    expect(first.rules).toEqual(f.rules)
    expect(first.agreements.compressed).toBe(false)
    f.rules[0] = { ...f.rules[0], version: 2, body: 'Numeric limit 16; do not remove compatibility.' }
    const next = await complete(f)
    expect(next.agreements.bundleId).not.toBe(first.agreements.bundleId)
    expect((await roomBundleRules(f.store, f.room.id, first.agreements.bundleId))[0].body).toContain('12')
    expect(mocked.enqueue).not.toHaveBeenCalled()
  })
})
