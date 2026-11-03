import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS_CHANGED_EVENT } from '../lib/keyboard-shortcut-settings'

const request = vi.hoisted(() => vi.fn())
vi.mock('./runtime-client', () => ({ rendererRuntimeClient: { runtimeRequest: request } }))

const connections = (model: string) => ({
  ok: true,
  status: 200,
  body: JSON.stringify({
    defaultProviderId: 'deepseek',
    defaultModel: model,
    providers: [{ id: 'deepseek', configured: true, models: [model] }]
  })
})

describe('new-thread shared default prefetch', () => {
  beforeEach(() => {
    vi.resetModules()
    request.mockReset()
    vi.stubGlobal('window', new EventTarget())
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('reuses one warm read for the next create, then reads fresh again', async () => {
    const { prefetchSharedDefaultModelSelection, sharedDefaultModelSelection } = await import('./kun-runtime-shared-default')
    request.mockResolvedValue(connections('deepseek-v4-pro'))
    prefetchSharedDefaultModelSelection()
    prefetchSharedDefaultModelSelection()
    expect(request).toHaveBeenCalledTimes(1)
    await expect(sharedDefaultModelSelection()).resolves.toMatchObject({ registryAvailable: true, model: 'deepseek-v4-pro' })
    expect(request).toHaveBeenCalledTimes(1)
    await sharedDefaultModelSelection()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('drops the warm read when settings change and ignores a failed one', async () => {
    const { prefetchSharedDefaultModelSelection, sharedDefaultModelSelection } = await import('./kun-runtime-shared-default')
    request.mockResolvedValueOnce(connections('old-model')).mockResolvedValue(connections('new-model'))
    prefetchSharedDefaultModelSelection()
    window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT, { detail: {} }))
    await expect(sharedDefaultModelSelection()).resolves.toMatchObject({ model: 'new-model' })

    request.mockReset()
    request.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(connections('after-retry'))
    prefetchSharedDefaultModelSelection()
    await expect(sharedDefaultModelSelection()).resolves.toMatchObject({ model: 'after-retry' })
    expect(request).toHaveBeenCalledTimes(2)
  })
})
