import { describe, expect, it, vi } from 'vitest'
import { QUOTA_FRESH_MS, QUOTA_MAX_STALE_MS, QuotaCache, QuotaCacheGroup } from './quota-cache'

function setup() {
  const clock = { now: 1_000_000 }
  const group = new QuotaCacheGroup()
  const make = <T,>() => new QuotaCache<T>({ group, now: () => clock.now })
  return { clock, group, make }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

describe('QuotaCache', () => {
  it('serves a fresh answer without asking again, and asks once it is no longer fresh', async () => {
    const { clock, make } = setup()
    const cache = make<string>()
    const fetcher = vi.fn(async () => 'a')
    expect(await cache.load('k', fetcher)).toBe('a')
    clock.now += QUOTA_FRESH_MS - 1
    expect(await cache.load('k', fetcher)).toBe('a')
    expect(fetcher).toHaveBeenCalledTimes(1)
    clock.now += 1
    fetcher.mockResolvedValueOnce('b')
    expect(cache.peek('k')?.value).toBe('a')
    expect(await cache.load('k', fetcher)).toBe('b')
    expect(cache.peek('k')?.value).toBe('b')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('stops showing an answer that is too old to trust', async () => {
    const { clock, make } = setup()
    const cache = make<string>()
    await cache.load('k', async () => 'a')
    clock.now += QUOTA_MAX_STALE_MS
    expect(cache.peek('k')?.value).toBe('a')
    clock.now += 1
    expect(cache.peek('k')).toBeUndefined()
  })

  it('shares one request per key, and a forced read does not join a plain one', async () => {
    const { make } = setup()
    const cache = make<string>()
    const plain = deferred<string>(), forced = deferred<string>()
    const fetcher = vi.fn().mockReturnValueOnce(plain.promise).mockReturnValueOnce(forced.promise)
    const first = cache.load('k', fetcher)
    expect(cache.load('k', fetcher)).toBe(first)
    const second = cache.load('k', fetcher, true)
    expect(second).not.toBe(first)
    expect(cache.load('k', fetcher, true)).toBe(second)
    // A plain read after that joins the newest request, not the one it replaced.
    expect(cache.load('k', fetcher)).toBe(second)
    expect(fetcher).toHaveBeenCalledTimes(2)
    forced.resolve('forced')
    expect(await second).toBe('forced')
    // The older plain request finishing late must not overwrite the newer answer.
    plain.resolve('plain')
    expect(await first).toBe('plain')
    expect(cache.peek('k')?.value).toBe('forced')
  })

  it('leaves what is held untouched when a read fails, and lets the caller drop it', async () => {
    const { make } = setup()
    const cache = make<string>()
    const listener = vi.fn()
    await cache.load('k', async () => 'a')
    cache.subscribe(listener)
    await expect(cache.load('k', async () => { throw new Error('offline') }, true)).rejects.toThrow('offline')
    expect(cache.peek('k')?.value).toBe('a')
    expect(listener).not.toHaveBeenCalled()
    cache.drop('k')
    expect(cache.peek('k')).toBeUndefined()
    expect(listener).toHaveBeenCalledTimes(1)
    cache.drop('k')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('turns a throwing fetcher into a rejection and does not keep the failed request', async () => {
    const { make } = setup()
    const cache = make<string>()
    await expect(cache.load('k', () => { throw new Error('sync') })).rejects.toThrow('sync')
    expect(await cache.load('k', async () => 'ok')).toBe('ok')
  })

  it('marks the other caches of its group stale after a forced read, never after a plain one', async () => {
    const { make } = setup()
    const composer = make<string>(), list = make<string>(), outsider = new QuotaCache<string>()
    await composer.load('a', async () => 'composer')
    await list.load('all', async () => 'list')
    await outsider.load('x', async () => 'outsider')
    await composer.load('a', async () => 'composer 2', false)
    expect(list.peek('all')?.stale).toBe(false)
    await composer.load('a', async () => 'composer forced', true)
    expect(list.peek('all')?.stale).toBe(true)
    expect(composer.peek('a')?.stale).toBe(false)
    expect(outsider.peek('x')?.stale).toBe(false)
    // A stale answer is still shown, but read again on the next load.
    expect(list.isFresh(list.peek('all')!)).toBe(false)
    expect(await list.load('all', async () => 'list 2')).toBe('list 2')
    expect(list.peek('all')?.stale).toBe(false)
  })

  it('notifies subscribers on every change to what is held, and stops after unsubscribe', async () => {
    const { make } = setup()
    const cache = make<string>()
    const listener = vi.fn()
    const unsubscribe = cache.subscribe(listener)
    await cache.load('k', async () => 'a')
    cache.markStale()
    cache.clear()
    expect(listener).toHaveBeenCalledTimes(3)
    unsubscribe()
    await cache.load('k', async () => 'b')
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('holds a bounded number of answers, dropping the least recently written', async () => {
    const { make } = setup()
    const cache = make<number>()
    for (let index = 0; index < 40; index += 1) await cache.load(`k${index}`, async () => index)
    expect(cache.peek('k0')).toBeUndefined()
    expect(cache.peek('k39')?.value).toBe(39)
  })
})
