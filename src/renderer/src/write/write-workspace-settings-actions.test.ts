import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultWriteSettings } from '@shared/app-settings'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { useWriteWorkspaceStore } from './write-workspace-store'

const initialInlineCompletion = defaultWriteSettings().inlineCompletion

afterEach(() => {
  vi.restoreAllMocks()
  useWriteWorkspaceStore.setState({
    inlineCompletion: initialInlineCompletion,
    settingsError: null
  })
})

describe('setInlineCompletionEnabled', () => {
  it('updates immediately and persists the focused Write setting', async () => {
    const setSettings = vi.spyOn(rendererRuntimeClient, 'setSettings').mockResolvedValue(undefined as never)

    await useWriteWorkspaceStore.getState().setInlineCompletionEnabled(false)

    expect(useWriteWorkspaceStore.getState().inlineCompletion.enabled).toBe(false)
    expect(setSettings).toHaveBeenCalledWith({
      write: { inlineCompletion: { enabled: false } }
    })
  })

  it('rolls back the optimistic toggle when persistence fails', async () => {
    vi.spyOn(rendererRuntimeClient, 'setSettings').mockRejectedValue(new Error('settings unavailable'))

    await useWriteWorkspaceStore.getState().setInlineCompletionEnabled(false)

    expect(useWriteWorkspaceStore.getState().inlineCompletion.enabled).toBe(true)
    expect(useWriteWorkspaceStore.getState().settingsError).toBe('settings unavailable')
  })

  it('serializes rapid toggles and does not roll back a newer choice', async () => {
    const deferred: { reject?: (reason: Error) => void } = {}
    const firstWrite = new Promise<never>((_resolve, reject) => {
      deferred.reject = reject
    })
    const setSettings = vi.spyOn(rendererRuntimeClient, 'setSettings')
      .mockImplementationOnce(() => firstWrite)
      .mockResolvedValueOnce(undefined as never)

    const disable = useWriteWorkspaceStore.getState().setInlineCompletionEnabled(false)
    const enable = useWriteWorkspaceStore.getState().setInlineCompletionEnabled(true)
    deferred.reject?.(new Error('stale failure'))
    await Promise.all([disable, enable])

    expect(setSettings.mock.calls).toEqual([
      [{ write: { inlineCompletion: { enabled: false } } }],
      [{ write: { inlineCompletion: { enabled: true } } }]
    ])
    expect(useWriteWorkspaceStore.getState().inlineCompletion.enabled).toBe(true)
    expect(useWriteWorkspaceStore.getState().settingsError).toBeNull()
  })
})
