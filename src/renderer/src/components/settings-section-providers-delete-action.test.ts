import { createElement } from 'react'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultKunRuntimeSettings, defaultModelProviderSettings,
  mergeModelProviderSettings, type AppSettingsPatch
} from '@shared/app-settings'
import { baseCtx, clickProviderTab, findButton, renderProviders } from './settings-section-agents.test-support'
import { ProvidersSettingsSection } from './settings-section-providers'
import {
  enqueueSharedModelMutation, resetSharedProviderMutationCoordinatorForTests
} from './shared-provider-mutation-coordinator'

describe('provider delete action', () => {
  let renderer: ReactTestRenderer | undefined
  const confirmDialog = vi.fn()
  const runtimeRequest = vi.fn()
  const update = vi.fn<(patch: AppSettingsPatch) => void>()
  let provider = defaultModelProviderSettings()
  let selectedId = 'deepseek'
  let registry: ReturnType<typeof snapshot>

  function snapshot() {
    return {
      schemaVersion: 1, proxyRoutingVersion: 1, revision: 1,
      providers: provider.providers.map((item) => ({
        id: item.id, accountId: `account:${item.id}`, name: item.name,
        kind: 'http', authType: 'api-key', configured: true,
        endpointFormat: item.endpointFormat, useProxy: false,
        baseUrl: item.baseUrl, models: item.models
      }))
    }
  }

  function context() {
    return {
      ...baseCtx(), provider, saveStatus: 'saving', update,
      kun: { ...defaultKunRuntimeSettings(), providerId: selectedId },
      form: { locale: 'en' }
    }
  }

  async function settle() {
    await act(async () => { await enqueueSharedModelMutation(async () => undefined) })
  }

  function deleteButton() {
    return renderer!.root.findByProps({ 'data-testid': 'provider-delete' })
  }

  beforeEach(() => {
    provider = defaultModelProviderSettings()
    selectedId = 'deepseek'
    registry = snapshot()
    confirmDialog.mockReset().mockResolvedValue(true)
    update.mockReset()
    runtimeRequest.mockReset().mockImplementation(async (path: string, method: string) => {
      if (path.includes('/events?')) return new Promise<never>(() => undefined)
      if (method === 'DELETE') {
        const id = decodeURIComponent(path.split('/').pop()!.split('?')[0])
        registry = { ...registry, revision: registry.revision + 1,
          providers: registry.providers.filter((item) => item.id !== id) }
      }
      return { ok: true, status: 200, body: JSON.stringify(registry) }
    })
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('window', {
      kunGui: { confirmDialog, runtimeRequest }, setTimeout, clearTimeout,
      addEventListener: vi.fn(), removeEventListener: vi.fn()
    })
    vi.stubGlobal('document', { body: { style: { overflow: '' } }, activeElement: null })
  })

  afterEach(async () => {
    if (renderer) await act(async () => renderer?.unmount())
    renderer = undefined
    resetSharedProviderMutationCoordinatorForTests()
    vi.unstubAllGlobals()
  })

  it.each(['deepseek', 'opencode-free'])('deletes %s directly from the connection tab', async (id) => {
    selectedId = id
    renderer = await renderProviders(context())
    await settle()
    update.mockClear()
    await act(async () => deleteButton().props.onClick())
    await settle()
    expect(confirmDialog).toHaveBeenCalledTimes(1)
    expect(runtimeRequest.mock.calls.some(([path, method]) =>
      method === 'DELETE' && path.startsWith(`/v1/model-connections/${id}?`)
    )).toBe(true)
    const patch = update.mock.calls.find(([patch]) => patch.provider?.excludedBuiltinProviderIds?.includes(id))?.[0]
    expect(patch).toBeDefined()
    expect(patch!.provider!.providers!.some((item) => item.id === id)).toBe(false)
    provider = mergeModelProviderSettings(provider, patch!.provider)
    expect(provider.providers.some((item) => item.id === id)).toBe(false)
  })

  it('exposes exactly one delete action in every provider detail tab', async () => {
    renderer = await renderProviders(context())
    for (const tab of ['Connection', 'Models', 'Capabilities', 'Advanced']) {
      await clickProviderTab(renderer, tab)
      expect(renderer.root.findAllByProps({ 'data-testid': 'provider-delete' })).toHaveLength(1)
    }
  })

  it('does not mutate settings or the registry when confirmation is cancelled', async () => {
    confirmDialog.mockResolvedValue(false)
    renderer = await renderProviders(context())
    await settle()
    update.mockClear()
    await act(async () => deleteButton().props.onClick())
    expect(update).not.toHaveBeenCalled()
    expect(runtimeRequest.mock.calls.some(([, method]) => method === 'DELETE')).toBe(false)
    expect(deleteButton().props.disabled).toBe(false)
  })

  it('blocks duplicate clicks and restores the action after a failed deletion', async () => {
    let rejectDeletion!: (error: Error) => void
    const pending = new Promise<never>((_resolve, reject) => { rejectDeletion = reject })
    renderer = await renderProviders(context())
    await settle()
    update.mockClear()
    runtimeRequest.mockImplementation(async (_path: string, method: string) =>
      method === 'DELETE' ? pending : { ok: true, status: 200, body: JSON.stringify(registry) }
    )
    const onClick = deleteButton().props.onClick
    await act(async () => { onClick(); onClick() })
    expect(confirmDialog).toHaveBeenCalledTimes(1)
    expect(deleteButton().props.disabled).toBe(true)
    expect(deleteButton().props['aria-busy']).toBe(true)
    await act(async () => { rejectDeletion(new Error('Registry unavailable')) })
    await settle()
    expect(deleteButton().props.disabled).toBe(false)
    expect(JSON.stringify(renderer.toJSON())).toContain('Registry unavailable')
    expect(update).not.toHaveBeenCalled()
  })

  it('renders an add-provider empty state after deleting the last provider', async () => {
    provider = { ...provider, providers: [provider.providers[0]], excludedBuiltinProviderIds: ['opencode-free'] }
    registry = snapshot()
    renderer = await renderProviders(context())
    await settle()
    update.mockClear()
    await act(async () => deleteButton().props.onClick())
    await settle()
    const patch = update.mock.calls.find(([patch]) => patch.provider?.providers?.length === 0)?.[0]
    expect(patch?.agents?.kun).toMatchObject({ providerId: '', apiKey: '', baseUrl: '' })
    provider = mergeModelProviderSettings(provider, patch?.provider)
    await act(async () => { renderer!.update(createElement(ProvidersSettingsSection, { ctx: context() })) })
    expect(renderer.root.findAllByProps({ 'data-testid': 'provider-delete' })).toHaveLength(0)
    expect(JSON.stringify(renderer.toJSON())).toContain('modelProviderEmpty')
    expect(JSON.stringify(renderer.toJSON())).toContain('Add provider')
    const add = renderer.root.findAllByType('button').find((button) =>
      button.props['aria-haspopup'] === 'dialog'
    )!
    await act(async () => add.props.onClick())
    await act(async () => renderer!.root.findByProps({ 'data-testid': 'provider-add-deepseek' }).props.onClick())
    expect(renderer.root.findAllByProps({ 'data-testid': 'provider-delete' })).toHaveLength(0)
    expect(JSON.stringify(renderer.toJSON())).toContain('Unsaved')
    update.mockClear()
    await act(async () => findButton(renderer!, 'Add').props.onClick())
    const restored = update.mock.calls.find(([patch]) =>
      patch.provider?.providers?.some((item) => item.id === 'deepseek')
    )?.[0]
    expect(restored?.provider?.excludedBuiltinProviderIds).toEqual(['opencode-free'])
    expect(mergeModelProviderSettings(provider, restored?.provider).providers.map((item) => item.id))
      .toEqual(['deepseek'])
  })
})
