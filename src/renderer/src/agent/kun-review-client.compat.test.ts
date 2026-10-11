import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKunReviewClient } from './kun-review-client'
afterEach(() => vi.unstubAllGlobals())
const input = { target: { kind: 'manager' as const }, commentIds: ['one'], clientRequestId: 'stable-id' }
describe('review client legacy compatibility', () => {
  it('removes new fields only after an old schema rejects them before any effects', async () => {
    const runtimeRequest = vi.fn().mockResolvedValueOnce({ ok: false, status: 400, body: JSON.stringify({ code: 'validation_error', message: 'old schema', details: [{ code: 'unrecognized_keys', path: [], keys: ['clientRequestId'] }] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, body: '{"ok":true}' })
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })
    await createKunReviewClient().sendReview('workspace', input)
    expect(runtimeRequest).toHaveBeenCalledTimes(2)
    expect(JSON.parse(runtimeRequest.mock.calls[1][2])).toEqual({ commentIds: ['one'], target: { kind: 'manager' } })
  })
  it('never retries an uncertain timeout or a real validation error without idempotency', async () => {
    const runtimeRequest = vi.fn().mockRejectedValue(new Error('timeout'))
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })
    await expect(createKunReviewClient().sendReview('workspace', input)).rejects.toThrow('timeout')
    expect(runtimeRequest).toHaveBeenCalledTimes(1)
  })
})
