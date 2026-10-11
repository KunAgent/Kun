// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { emitRendererSettingsChanged } from './keyboard-shortcut-settings'
import { QuotaCache } from './quota-cache'

describe('quota caches and saved settings', () => {
  it('keeps what is held on screen but no longer trusts it as fresh after a settings change', async () => {
    const cache = new QuotaCache<string>()
    await cache.load('k', async () => 'held')
    expect(cache.isFresh(cache.peek('k')!)).toBe(true)
    emitRendererSettingsChanged({} as never)
    expect(cache.peek('k')?.value).toBe('held')
    expect(cache.isFresh(cache.peek('k')!)).toBe(false)
    expect(await cache.load('k', async () => 'read again')).toBe('read again')
    expect(cache.isFresh(cache.peek('k')!)).toBe(true)
  })
})
