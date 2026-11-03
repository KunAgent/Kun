import { describe, expect, it, vi } from 'vitest'
import { createEconomyClient, EconomyError } from './economy-client'

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function setup(responses: Array<Response | Error>, token: (force: boolean) => Promise<string | null> = async (force) => force ? 'rotated' : 'access') {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! })
    const next = responses.shift()
    if (!next) throw new Error('unexpected request')
    if (next instanceof Error) throw next
    return next
  }) as unknown as typeof globalThis.fetch
  const expire = vi.fn(async () => {})
  const client = createEconomyClient({ fetch, token, expire, requestId: () => 'request-1' })
  return { client, calls, expire }
}

describe('Kunserve economy client', () => {
  it('sends the bearer token, JSON bodies and request ids to fixed issuer paths', async () => {
    const { client, calls } = setup([reply({ wardrobe: {} }), reply({ purchase: {} })])
    await client.wardrobe()
    await client.purchase('bottle-10')
    expect(calls.map(({ url, init }) => [init.method, url, init.body])).toEqual([
      ['GET', 'https://api-kun-server.com/api/wardrobe', undefined],
      ['POST', 'https://api-kun-server.com/api/shop/purchases', JSON.stringify({ requestId: 'request-1', offerId: 'bottle-10' })]
    ])
    expect(calls[1]!.init.headers).toEqual({ Authorization: 'Bearer access', 'Content-Type': 'application/json' })
    expect(calls[1]!.init).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' })
  })

  it('rotates a refused token once, then signs the app out', async () => {
    const rotated = setup([reply({ error: 'unauthorized' }, 401), reply({ code: 'K7QM4XPA' })])
    expect(await rotated.client.invites()).toEqual({ code: 'K7QM4XPA' })
    expect(rotated.calls[1]!.init.headers).toEqual({ Authorization: 'Bearer rotated' })
    const ended = setup([reply({}, 401), reply({}, 401)])
    await expect(ended.client.shop()).rejects.toMatchObject({ code: 'expired' })
    expect(ended.expire).toHaveBeenCalledOnce()
    await expect(setup([], async () => null).client.shop()).rejects.toMatchObject({ code: 'anonymous' })
  })

  it('passes rule codes through, hides other details, and retries a write once with the same id', async () => {
    for (const [response, code] of [[reply({ error: 'not_enough_feathers' }, 409), 'not_enough_feathers'],
      [reply({ error: 'bottleIds must be a list of bottle ids' }, 400), 'invalid_request'],
      [reply({ message: 'secret' }, 500), 'service'], [reply([1]), 'service']] as const) {
      await expect(setup([response]).client.open(['b'])).rejects.toEqual(new EconomyError(code))
    }
    const retried = setup([new Error('offline'), reply({ purchase: { id: 'p' } })])
    await retried.client.purchase('bottle-1')
    expect(retried.calls.map(({ init }) => init.body)).toEqual([retried.calls[0]!.init.body, retried.calls[0]!.init.body])
    await expect(setup([new Error('offline')]).client.claimInvite('ABCD2345')).rejects.toMatchObject({ code: 'network' })
  })
})
