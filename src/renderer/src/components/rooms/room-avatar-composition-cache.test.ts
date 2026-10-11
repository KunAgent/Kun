import { describe, expect, it, vi } from 'vitest'
import { AvatarCompositionCache, type AvatarCompositionResource } from './room-avatar-composition-cache'

function resource(url: string, bytes = 1): AvatarCompositionResource {
  return { url, bytes, dispose: vi.fn() }
}

describe('avatar composition cache', () => {
  it('deduplicates pending work and keeps shared images alive until the last consumer releases', async () => {
    const cache = new AvatarCompositionCache(0)
    const image = resource('blob:shared')
    const create = vi.fn(async () => image)
    const first = cache.acquire('same', create)
    const second = cache.acquire('same', create)
    expect(first.promise).toBe(second.promise)
    await expect(first.promise).resolves.toBe('blob:shared')
    expect(create).toHaveBeenCalledOnce()
    first.release()
    first.release()
    expect(image.dispose).not.toHaveBeenCalled()
    second.release()
    expect(image.dispose).toHaveBeenCalledOnce()
  })

  it('evicts the least recently used idle result, without revoking displayed images', async () => {
    const cache = new AvatarCompositionCache(1)
    const a = resource('blob:a')
    const b = resource('blob:b')
    const c = resource('blob:c')
    const first = cache.acquire('a', async () => a)
    const held = cache.acquire('b', async () => b)
    await Promise.all([first.promise, held.promise])
    first.release()
    const third = cache.acquire('c', async () => c)
    await third.promise
    third.release()
    expect(a.dispose).toHaveBeenCalledOnce()
    expect(b.dispose).not.toHaveBeenCalled()
    expect(c.dispose).not.toHaveBeenCalled()
    held.release()
    expect(b.dispose).toHaveBeenCalledOnce()
    const reused = cache.acquire('c', () => { throw new Error('Should remain cached') })
    await expect(reused.promise).resolves.toBe('blob:c')
    reused.release()
    cache.clear()
    expect(c.dispose).toHaveBeenCalledOnce()
  })

  it('bounds retained bytes and retires old in-flight work across invalidation', async () => {
    const cache = new AvatarCompositionCache(10, 2)
    const oversized = resource('blob:large', 3)
    const large = cache.acquire('large', async () => oversized)
    await large.promise
    large.release()
    expect(oversized.dispose).toHaveBeenCalledOnce()
    let resolveOld!: (resource: AvatarCompositionResource) => void
    const old = cache.acquire('same', () => new Promise((resolve) => { resolveOld = resolve }))
    await Promise.resolve()
    cache.clear()
    old.release()
    const freshImage = resource('blob:fresh')
    const fresh = cache.acquire('same', async () => freshImage)
    const oldImage = resource('blob:old')
    resolveOld(oldImage)
    await Promise.all([old.promise, fresh.promise])
    expect(oldImage.dispose).toHaveBeenCalledOnce()
    expect(freshImage.dispose).not.toHaveBeenCalled()
    fresh.release()
    cache.clear()
    expect(freshImage.dispose).toHaveBeenCalledOnce()
  })

  it('retries failed compositions rather than caching their rejection', async () => {
    const cache = new AvatarCompositionCache()
    const failed = cache.acquire('same', async () => { throw new Error('Missing layer') })
    await expect(failed.promise).rejects.toThrow('Missing layer')
    failed.release()
    const retry = cache.acquire('same', async () => resource('blob:retry'))
    await expect(retry.promise).resolves.toBe('blob:retry')
    retry.release()
    cache.clear()
  })
})
