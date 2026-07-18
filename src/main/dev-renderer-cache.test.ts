import { describe, expect, it, vi } from 'vitest'
import {
  clearDevelopmentRendererHttpCache,
  configureDevelopmentRendererHttpCache,
  hasDevelopmentRenderer,
  reloadRenderer
} from './dev-renderer-cache'

describe('development renderer cache policy', () => {
  it('recognizes only non-empty development renderer URLs', () => {
    expect(hasDevelopmentRenderer('http://127.0.0.1:5173')).toBe(true)
    expect(hasDevelopmentRenderer('   ')).toBe(false)
    expect(hasDevelopmentRenderer(undefined)).toBe(false)
  })

  it('disables Chromium HTTP caching only for a development renderer', () => {
    const appendSwitch = vi.fn()

    expect(configureDevelopmentRendererHttpCache({ appendSwitch }, 'http://127.0.0.1:5173')).toBe(true)
    expect(appendSwitch).toHaveBeenCalledWith('disable-http-cache')

    appendSwitch.mockClear()
    expect(configureDevelopmentRendererHttpCache({ appendSwitch }, undefined)).toBe(false)
    expect(appendSwitch).not.toHaveBeenCalled()
  })

  it('clears existing HTTP cache only for a development renderer', async () => {
    const clearCache = vi.fn(async () => undefined)

    await expect(
      clearDevelopmentRendererHttpCache({ clearCache }, 'http://127.0.0.1:5173')
    ).resolves.toBe(true)
    expect(clearCache).toHaveBeenCalledOnce()

    clearCache.mockClear()
    await expect(clearDevelopmentRendererHttpCache({ clearCache }, undefined)).resolves.toBe(false)
    expect(clearCache).not.toHaveBeenCalled()
  })

  it('bypasses cache for development reloads and preserves packaged reloads', () => {
    const reload = vi.fn()
    const reloadIgnoringCache = vi.fn()
    const contents = { reload, reloadIgnoringCache }

    reloadRenderer(contents, 'http://127.0.0.1:5173')
    expect(reloadIgnoringCache).toHaveBeenCalledOnce()
    expect(reload).not.toHaveBeenCalled()

    reloadIgnoringCache.mockClear()
    reloadRenderer(contents, undefined)
    expect(reload).toHaveBeenCalledOnce()
    expect(reloadIgnoringCache).not.toHaveBeenCalled()
  })
})
