// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PetDesktopBridge } from '@shared/pets'
import { useChatStore } from '../store/chat-store'
import { startPetPresencePublisher } from './pet-presence-publisher'

vi.mock('../store/chat-store', async () => {
  const { create } = await import('zustand')
  return { useChatStore: create(() => ({})) }
})
afterEach(() => vi.unstubAllGlobals())

describe('workbench model presence', () => {
  it('seeds quietly, announces real switches, ignores unrelated store churn and unsubscribes', () => {
    const send = vi.fn(), stopCatalog = vi.fn()
    const pets = { updatePetPresence: send, onPetCatalogChanged: () => stopCatalog } as unknown as PetDesktopBridge
    vi.stubGlobal('window', { kunGui: { pets } })
    useChatStore.setState({ composerModel: 'gpt-5', composerProviderId: 'opaque-id', composerModelGroups: [
      { providerId: 'opaque-id', label: 'Provider', presetSource: 'openai', modelIds: ['gpt-5'] }
    ] })
    const stop = startPetPresencePublisher(pets)
    expect(send.mock.lastCall?.[0]).toMatchObject({ type: 'model', model: 'gpt-5', provider: 'openai', announce: false })
    send.mockClear()
    useChatStore.setState({ busy: true })
    expect(send).not.toHaveBeenCalled()
    useChatStore.setState({ composerModel: 'claude-sonnet' })
    expect(send.mock.lastCall?.[0]).toMatchObject({ type: 'model', model: 'claude-sonnet', announce: true })
    stop(); send.mockClear()
    useChatStore.setState({ composerModel: 'gpt-5' })
    expect(send).not.toHaveBeenCalled()
    expect(stopCatalog).toHaveBeenCalledOnce()
  })
})
