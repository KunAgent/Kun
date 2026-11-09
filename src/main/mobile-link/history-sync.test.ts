import { expect, it, vi } from 'vitest'
import { MobileSubscriptions } from './subscriptions'

const authority = { accountId: 'owner', deviceId: 'phone', authorizationId: 'transport_authority', syncKey: 'stable_grant', scopes: ['personal'] }
const input = (subscriptionId: string) => ({ kind: 'code', id: 'thread', sync: { version: 2, subscriptionId, view: 'conversation' } })
it('forwards authorized sync frames and keeps the replacement subscription when an old cancellation arrives', async () => {
  const send = vi.fn(), controls: ReadableStreamDefaultController<Uint8Array>[] = []
  let opened!: () => void
  let nextOpen = new Promise<void>(resolve => { opened = resolve })
  const fetcher = vi.fn(async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controls.push(controller) } })
    opened()
    return new Response(stream)
  })
  const subscriptions = new MobileSubscriptions({ send, fetch: fetcher,
    lease: async () => ({ baseUrl: 'http://runtime', runtimeToken: 'private_token', request: vi.fn() }) })
  const first = subscriptions.subscribe('phone', input('first'), authority)
  await nextOpen
  nextOpen = new Promise(resolve => { opened = resolve })
  const second = subscriptions.subscribe('phone', input('second'), authority)
  await nextOpen
  await subscriptions.subscribe('phone', { ...input('first'), active: false }, authority)
  controls[1]!.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ kind: 'ready', subscriptionId: 'second', epoch: 'epoch', seq: 0 }) + '\n\n'))
  controls[1]!.close()
  await Promise.all([first, second])
  expect(fetcher).toHaveBeenLastCalledWith('http://runtime/v1/remote/code-sync/thread', expect.objectContaining({
    method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer private_token',
      'X-Kun-Remote-Device': 'phone', 'X-Kun-Remote-Sync-Key': 'stable_grant' }) }))
  expect(send.mock.calls.some(([frame]) => frame.payload?.sync?.subscriptionId === 'second' && frame.payload.sync.kind === 'ready')).toBe(true)
  expect(send.mock.calls.some(([frame]) => frame.payload?.sync?.subscriptionId === 'first')).toBe(false)
  subscriptions.clear()
})
