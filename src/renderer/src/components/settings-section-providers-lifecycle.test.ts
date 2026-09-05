import {
  DEFAULT_MODEL_PROVIDER_ID,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  type ModelProviderModelProfileV1,
  type ModelProviderProfileV1
} from '@shared/app-settings'
import { createElement, useState } from 'react'
import {
  act,
  create as createRenderer,
  type ReactTestInstance,
  type ReactTestRenderer
} from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderModelsManager } from './settings-section-provider-models'
import {
  clearPendingSharedProviderDeletionForExplicitAdd,
  ProvidersSettingsSection
} from './settings-section-providers'
import {
  enqueueSharedModelMutation,
  resetSharedProviderMutationCoordinatorForTests,
  sharedProviderMutationCoordinator
} from './shared-provider-mutation-coordinator'

const textModelProfile: ModelProviderModelProfileV1 = {
  inputModalities: ['text'],
  outputModalities: ['text'],
  supportsToolCalling: true,
  messageParts: ['text']
}

describe('provider mutation lifecycle across settings remounts', () => {
  type RuntimeResult = { ok: boolean; status: number; body: string }

  const deferred = <T,>(): {
    promise: Promise<T>
    resolve: (value: T) => void
    reject: (error: unknown) => void
  } => {
    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    return { promise, resolve, reject }
  }

  const translate = (key: string, params?: Record<string, unknown>): string => {
    let value = key
    for (const [name, replacement] of Object.entries(params ?? {})) {
      value = value.replaceAll(`{{${name}}}`, String(replacement))
    }
    return value
  }

  const providerFixture = (id = 'custom-provider-2'): {
    settings: ReturnType<typeof defaultModelProviderSettings>
    provider: ModelProviderProfileV1
  } => {
    const settings = defaultModelProviderSettings()
    const provider = {
      ...settings.providers.find((item) => item.id === 'deepseek')!,
      id,
      name: 'Remount Provider',
      apiKey: '',
      baseUrl: 'https://api.example.com/v1',
      models: ['old-model'],
      modelProfiles: { 'old-model': textModelProfile }
    }
    return { settings, provider }
  }

  const connectionFor = (provider: ModelProviderProfileV1, models = provider.models) => ({
    id: provider.id,
    accountId: `account:${provider.id}`,
    name: provider.name,
    kind: 'http' as const,
    authType: 'api-key' as const,
    baseUrl: provider.baseUrl,
    endpointFormat: provider.endpointFormat,
    configured: true,
    models,
    modelCapabilities: Object.fromEntries(models.map((model) => [model, {
      id: model,
      ...(provider.modelProfiles[model] ?? textModelProfile)
    }])),
    selectedModel: models[0]
  })

  const snapshotFor = (
    provider: ModelProviderProfileV1,
    revision: number,
    models = provider.models,
    includeProvider = true
  ) => ({
    schemaVersion: 1 as const,
    revision,
    providers: includeProvider ? [connectionFor(provider, models)] : [],
    ...(includeProvider
      ? {
          defaultProviderId: provider.id,
          defaultAccountId: `account:${provider.id}`,
          defaultModel: models[0]
        }
      : {}),
    proxy: { enabled: false, url: '' },
    routePools: [],
    localModelGateway: { enabled: false }
  })

  const contextFor = (
    settings: ReturnType<typeof defaultModelProviderSettings>,
    provider: ModelProviderProfileV1,
    update = vi.fn()
  ): Record<string, unknown> => ({
    t: translate,
    form: {
      locale: 'en',
      write: { inlineCompletion: { inheritProvider: true, providerId: '' } }
    },
    provider: {
      ...settings,
      providers: [...settings.providers.filter((item) => item.id !== provider.id), provider]
    },
    kun: {
      ...defaultKunRuntimeSettings(),
      providerId: provider.id,
      model: provider.models[0]
    },
    update,
    showApiKey: false,
    setShowApiKey: vi.fn(),
    selectControlClass: 'select',
    saveStatus: 'saving',
    saveError: '',
    retrySave: vi.fn()
  })

  const instanceText = (instance: ReactTestInstance): string => instance.children
    .map((child) => typeof child === 'string' ? child : instanceText(child))
    .join('')

  const rendererText = (renderer: ReactTestRenderer): string => JSON.stringify(renderer.toJSON())

  const findButton = (renderer: ReactTestRenderer, label: string): ReactTestInstance => {
    const button = renderer.root.findAllByType('button')
      .find((candidate) => instanceText(candidate).trim() === label)
    expect(button, `button "${label}"`).toBeTruthy()
    return button!
  }

  const clickTab = async (renderer: ReactTestRenderer, label: string): Promise<void> => {
    const tab = renderer.root.findAllByProps({ role: 'tab' })
      .find((candidate) => instanceText(candidate) === label)
    expect(tab, `tab "${label}"`).toBeTruthy()
    await act(async () => tab!.props.onClick())
  }

  const flush = async (): Promise<void> => {
    await act(async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
      await Promise.resolve()
    })
  }

  let mountedRenderers: ReactTestRenderer[] = []

  const mount = async (ctx: Record<string, unknown>): Promise<ReactTestRenderer> => {
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(ProvidersSettingsSection, { ctx }))
    })
    mountedRenderers.push(renderer)
    return renderer
  }

  const unmount = async (renderer: ReactTestRenderer): Promise<void> => {
    await act(async () => renderer.unmount())
    mountedRenderers = mountedRenderers.filter((item) => item !== renderer)
  }

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    mountedRenderers = []
    vi.stubGlobal('window', {
      kunGui: {
        runtimeRequest: vi.fn(),
        openSettingsConfigFile: vi.fn(async () => ({ ok: true })),
        confirmDialog: vi.fn(async () => true)
      },
      setTimeout: vi.fn((callback: () => void) => {
        callback()
        return 0
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
    vi.stubGlobal('document', {
      body: { style: { overflow: '' } },
      activeElement: null
    })
  })

  afterEach(async () => {
    await act(async () => {
      for (const renderer of mountedRenderers) renderer.unmount()
    })
    resetSharedProviderMutationCoordinatorForTests()
    vi.unstubAllGlobals()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  it('opens the fixed settings file and surfaces a shell failure', async () => {
    const { settings, provider } = providerFixture()
    const openSettingsConfigFile = vi.fn(async () => ({ ok: false, message: 'editor unavailable' }))
    Object.assign(window.kunGui, { openSettingsConfigFile })

    const renderer = await mount(contextFor(settings, provider))
    await flush()
    expect(rendererText(renderer)).toContain('modelProviderConfigFileHint')
    await act(async () => findButton(renderer, 'modelProviderOpenConfigFile').props.onClick())

    expect(openSettingsConfigFile).toHaveBeenCalledOnce()
    expect(rendererText(renderer)).toContain('editor unavailable')
  })

  it('keeps provider metadata and wrapping actions in separate header regions', async () => {
    const { settings, provider } = providerFixture()
    const renderer = await mount(contextFor(settings, provider))
    await flush()

    const metadata = renderer.root.findByProps({ 'data-testid': 'provider-workspace-meta' })
    const actions = renderer.root.findByProps({ 'data-testid': 'provider-workspace-actions' })
    expect(metadata.props.className).toContain('grid')
    expect(actions.props.className).toContain('flex-wrap')
    expect(actions.findAllByType('button')).toHaveLength(2)
    for (const button of actions.findAllByType('button')) {
      expect(button.props.className).toContain('whitespace-nowrap')
    }
    const tabs = renderer.root.findAllByProps({ role: 'tablist' })
      .find((tablist) => tablist.props['aria-label'] === 'providers')
    expect(tabs).toBeTruthy()
  })

  it('shows a wired API key input when adding a custom provider', async () => {
    const { settings, provider } = providerFixture('deepseek')
    const renderer = await mount(contextFor(settings, provider))
    await flush()

    await act(async () => findButton(renderer, 'modelProviderAdd').props.onClick())
    const customProviderButton = renderer.root.findAllByType('button')
      .find((button) => instanceText(button).includes('modelProviderAddMenuCustom'))
    expect(customProviderButton).toBeTruthy()
    await act(async () => customProviderButton!.props.onClick())

    const credentialInput = renderer.root.findAllByType('input')
      .find((input) => input.props.type === 'password')
    expect(credentialInput).toBeTruthy()
    expect(rendererText(renderer)).toContain('modelProviderApiKey')

    await act(async () => credentialInput!.props.onChange({ target: { value: 'sk-custom' } }))
    expect(renderer.root.findAllByType('input')
      .find((input) => input.props.type === 'password')?.props.value)
      .toBe('sk-custom')
  })

  it('uses the shared provider mark in configured, detail, and add-provider surfaces', async () => {
    const fixture = providerFixture('codex-2')
    const provider: ModelProviderProfileV1 = {
      ...fixture.provider,
      name: 'ChatGPT subscription 2',
      presetSource: { presetId: 'codex', mode: 'api' }
    }
    const renderer = await mount(contextFor(fixture.settings, provider))
    await flush()

    expect(renderer.root.findAllByProps({ 'data-provider-icon': 'codex' }).length)
      .toBeGreaterThanOrEqual(2)

    await act(async () => findButton(renderer, 'modelProviderAdd').props.onClick())

    expect(renderer.root.findAllByProps({ 'data-provider-icon': 'codex' }).length)
      .toBeGreaterThanOrEqual(3)
    expect(renderer.root.findAllByProps({ 'data-provider-icon': 'kun' }).length)
      .toBeGreaterThanOrEqual(1)
  })

  it('hides the delete action for the default API provider', async () => {
    const { settings, provider } = providerFixture('deepseek')
    const runtimeRequest = vi.fn(async (path: string) => {
      if (path.includes('/events?')) return new Promise<never>(() => undefined)
      return { ok: true, status: 200, body: JSON.stringify(snapshotFor(provider, 1)) }
    })
    Object.assign(window.kunGui, { runtimeRequest })

    const renderer = await mount(contextFor(settings, provider))
    await flush()
    await clickTab(renderer, 'modelProviderTabAdvanced')

    expect(rendererText(renderer)).not.toContain('modelProviderRemove')
    expect(rendererText(renderer)).not.toContain('modelProviderSectionDanger')
  })

  it('shows safe replacement guidance for an unreadable protected credential', async () => {
    const { settings, provider } = providerFixture()
    const snapshot = {
      ...snapshotFor(provider, 3),
      providers: [{
        ...connectionFor(provider),
        credentialStatus: 'unreadable' as const,
        credentialErrorCode: 'credential_unreadable' as const
      }]
    }
    const runtimeRequest = vi.fn(async (path: string) => {
      if (path.includes('/events?')) return new Promise<never>(() => undefined)
      return { ok: true, status: 200, body: JSON.stringify(snapshot) }
    })
    Object.assign(window.kunGui, { runtimeRequest })

    const renderer = await mount(contextFor(settings, provider))
    await flush()

    expect(rendererText(renderer)).toContain(
      'The existing credential cannot be read. Enter a new value to replace it safely.'
    )
    expect(rendererText(renderer)).not.toContain('settings:provider:')
    expect(rendererText(renderer)).not.toContain('credential_unreadable')
  })

  it('reveals a protected credential on demand and clears it when hidden again', async () => {
    const { settings, provider } = providerFixture('deepseek')
    const runtimeRequest = vi.fn(async (path: string) => {
      if (path.includes('/events?')) return new Promise<never>(() => undefined)
      return { ok: true, status: 200, body: JSON.stringify(snapshotFor(provider, 1)) }
    })
    const revealModelProviderCredential = vi.fn(async (providerId: string) => ({
      providerId,
      credential: 'sk-protected-secret'
    }))
    Object.assign(window.kunGui, { runtimeRequest, revealModelProviderCredential })
    const ctx = contextFor(settings, provider)
    const Harness = () => {
      const [showApiKey, setShowApiKey] = useState(false)
      return createElement(ProvidersSettingsSection, {
        ctx: { ...ctx, showApiKey, setShowApiKey }
      })
    }
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(Harness))
    })
    mountedRenderers.push(renderer)
    await flush()

    const hiddenInput = renderer.root.findAllByType('input')
      .find((input) => input.props.type === 'password')
    expect(hiddenInput?.props.value).toBe('')
    expect(hiddenInput?.props.placeholder).toBe('••••••••••••')
    const showButton = renderer.root.findAllByType('button')
      .find((button) => button.props['aria-label'] === 'showSecret')
    expect(showButton).toBeTruthy()
    await act(async () => showButton!.props.onClick())
    await flush()

    const revealedInput = renderer.root.findAllByType('input')
      .find((input) => input.props.type === 'text' && input.props.value === 'sk-protected-secret')
    expect(revealedInput).toBeTruthy()
    expect(revealModelProviderCredential).toHaveBeenCalledWith('deepseek')

    const hideButton = renderer.root.findAllByType('button')
      .find((button) => button.props['aria-label'] === 'hideSecret')
    expect(hideButton).toBeTruthy()
    await act(async () => hideButton!.props.onClick())
    await flush()

    const rehiddenInput = renderer.root.findAllByType('input')
      .find((input) => input.props.type === 'password')
    expect(rehiddenInput?.props.value).toBe('')
    expect(rehiddenInput?.props.placeholder).toBe('••••••••••••')
  })

  it('keeps a credential generation through unmount and clears it after the adopted commit', async () => {
    const { settings, provider } = providerFixture()
    let registryRevision = 1
    const credentialPut = deferred<RuntimeResult>()
    const credentialStarted = deferred<void>()
    const fenceBodies: Array<{ operationToken: string }> = []
    const credentialBodies: Array<{
      expectedRevision: number
      credential: string
      operationToken: string
    }> = []
    const commitBodies: Array<{ expectedRevision: number; operationToken: string }> = []
    const runtimeRequest = vi.fn(async (path: string, method: string, body?: string) => {
      if (path.includes('/events?')) return new Promise<never>(() => undefined)
      if (path === '/v1/model-connections' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify(snapshotFor(provider, registryRevision))
        }
      }
      if (path === `/v1/model-connections/${provider.id}/credential/fence` && method === 'POST') {
        fenceBodies.push(JSON.parse(body ?? '{}'))
        return {
          ok: true,
          status: 200,
          body: JSON.stringify(snapshotFor(provider, registryRevision))
        }
      }
      if (path === `/v1/model-connections/${provider.id}/credential` && method === 'PUT') {
        credentialBodies.push(JSON.parse(body ?? '{}'))
        credentialStarted.resolve()
        return credentialPut.promise
      }
      if (path === `/v1/model-connections/${provider.id}/credential/commit` && method === 'POST') {
        commitBodies.push(JSON.parse(body ?? '{}'))
        registryRevision = 2
        return {
          ok: true,
          status: 200,
          body: JSON.stringify(snapshotFor(provider, registryRevision))
        }
      }
      throw new Error(`Unexpected runtime request: ${method} ${path}`)
    })
    Object.assign(window.kunGui, { runtimeRequest })
    const ctx = contextFor(settings, provider)
    const first = await mount(ctx)
    await flush()

    const credentialInput = first.root.findAllByType('input')
      .find((input) => input.props.type === 'password')
    expect(credentialInput).toBeTruthy()
    expect(credentialInput?.props.placeholder).toBe('••••••••••••')
    await act(async () => credentialInput!.props.onChange({ target: { value: 'latest-secret' } }))
    expect(sharedProviderMutationCoordinator.pendingCredentials.get(provider.id)).toMatchObject({
      credential: 'latest-secret'
    })

    await unmount(first)
    await credentialStarted.promise
    const second = await mount(ctx)
    await flush()
    const remountedInput = second.root.findAllByType('input')
      .find((input) => input.props.type === 'password')
    expect(remountedInput?.props.value).toBe('latest-secret')

    credentialPut.resolve({
      ok: true,
      status: 200,
      body: JSON.stringify(snapshotFor(provider, 1))
    })
    await flush()
    await enqueueSharedModelMutation(async () => undefined)
    await flush()

    expect(fenceBodies).toHaveLength(1)
    expect(credentialBodies).toEqual([{
      expectedRevision: 1,
      credential: 'latest-secret',
      operationToken: fenceBodies[0]!.operationToken
    }])
    expect(commitBodies).toEqual([{
      expectedRevision: 1,
      operationToken: fenceBodies[0]!.operationToken
    }])
    expect(sharedProviderMutationCoordinator.pendingCredentials.has(provider.id)).toBe(false)
    expect(second.root.findAllByType('input')
      .find((input) => input.props.type === 'password')?.props.value)
      .toBe('')
  })

  it('keeps a catalog overlay through unmount without submitting its generation twice', async () => {
    const { settings, provider } = providerFixture()
    let registryRevision = 1
    let registryModels = [...provider.models]
    const firstPatch = deferred<RuntimeResult>()
    const patchStarted = deferred<void>()
    const patchBodies: Array<{ expectedRevision: number; models: string[] }> = []
    const runtimeRequest = vi.fn(async (path: string, method: string, body?: string) => {
      if (path.includes('/events?')) return new Promise<never>(() => undefined)
      if (path === '/v1/model-connections' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify(snapshotFor(provider, registryRevision, registryModels))
        }
      }
      if (path === `/v1/model-connections/${provider.id}` && method === 'PATCH') {
        const request = JSON.parse(body ?? '{}') as { expectedRevision: number; models: string[] }
        patchBodies.push(request)
        if (patchBodies.length === 1) {
          patchStarted.resolve()
          return firstPatch.promise
        }
        registryRevision += 1
        registryModels = [...request.models]
        return {
          ok: true,
          status: 200,
          body: JSON.stringify(snapshotFor(provider, registryRevision, registryModels))
        }
      }
      throw new Error(`Unexpected runtime request: ${method} ${path}`)
    })
    Object.assign(window.kunGui, { runtimeRequest })
    const ctx = contextFor(settings, provider)
    const first = await mount(ctx)
    await flush()
    const nextProvider = {
      ...provider,
      models: ['old-model', 'new-model'],
      modelProfiles: {
        ...provider.modelProfiles,
        'new-model': textModelProfile
      }
    }
    await act(async () => first.root.findByType(ProviderModelsManager).props.onChange(nextProvider))

    await unmount(first)
    await patchStarted.promise
    const second = await mount(ctx)
    await flush()
    expect(second.root.findByType(ProviderModelsManager).props.provider.models)
      .toEqual(['old-model', 'new-model'])

    registryRevision = 2
    registryModels = [...nextProvider.models]
    firstPatch.resolve({
      ok: true,
      status: 200,
      body: JSON.stringify(snapshotFor(provider, registryRevision, registryModels))
    })
    await flush()
    await enqueueSharedModelMutation(async () => undefined)
    await flush()

    expect(patchBodies).toHaveLength(1)
    expect(patchBodies[0]).toMatchObject({
      expectedRevision: 1,
      models: ['old-model', 'new-model']
    })
  })

  it('keeps the provider visible while DELETE is in flight and after DELETE fails', async () => {
    const { settings, provider } = providerFixture()
    const deleteRequest = deferred<RuntimeResult>()
    const deleteStarted = deferred<void>()
    const runtimeRequest = vi.fn(async (path: string, method: string) => {
      if (path.includes('/events?')) return new Promise<never>(() => undefined)
      if (path === '/v1/model-connections' && method === 'GET') {
        return { ok: true, status: 200, body: JSON.stringify(snapshotFor(provider, 1)) }
      }
      if (path.startsWith(`/v1/model-connections/${provider.id}?`) && method === 'DELETE') {
        deleteStarted.resolve()
        return deleteRequest.promise
      }
      throw new Error(`Unexpected runtime request: ${method} ${path}`)
    })
    Object.assign(window.kunGui, { runtimeRequest })
    const update = vi.fn()
    const renderer = await mount(contextFor(settings, provider, update))
    await flush()
    update.mockClear()
    await clickTab(renderer, 'modelProviderTabAdvanced')
    await act(async () => findButton(renderer, 'modelProviderRemove').props.onClick())
    await deleteStarted.promise

    expect(rendererText(renderer)).toContain(provider.name)
    expect(update).not.toHaveBeenCalled()
    expect(sharedProviderMutationCoordinator.pendingDeletions.get(provider.id)).toMatchObject({
      committedRevision: null
    })

    deleteRequest.resolve({
      ok: false,
      status: 503,
      body: JSON.stringify({ message: 'delete failed safely' })
    })
    await enqueueSharedModelMutation(async () => undefined)
    await flush()

    expect(sharedProviderMutationCoordinator.pendingDeletions.has(provider.id)).toBe(false)
    expect(rendererText(renderer)).toContain(provider.name)
    expect(rendererText(renderer)).toContain('delete failed safely')
    expect(update).not.toHaveBeenCalled()
  })

  it('removes a deleted provider with the latest settings updater after the registry commit', async () => {
    const { settings, provider } = providerFixture()
    const deleteRequest = deferred<RuntimeResult>()
    const deleteStarted = deferred<void>()
    const runtimeRequest = vi.fn(async (path: string, method: string) => {
      if (path.includes('/events?')) return new Promise<never>(() => undefined)
      if (path === '/v1/model-connections' && method === 'GET') {
        return { ok: true, status: 200, body: JSON.stringify(snapshotFor(provider, 1)) }
      }
      if (path.startsWith(`/v1/model-connections/${provider.id}?`) && method === 'DELETE') {
        deleteStarted.resolve()
        return deleteRequest.promise
      }
      throw new Error(`Unexpected runtime request: ${method} ${path}`)
    })
    Object.assign(window.kunGui, { runtimeRequest })
    const staleUpdate = vi.fn()
    const latestUpdate = vi.fn()
    const renderer = await mount(contextFor(settings, provider, staleUpdate))
    await flush()
    staleUpdate.mockClear()
    await clickTab(renderer, 'modelProviderTabAdvanced')
    await act(async () => findButton(renderer, 'modelProviderRemove').props.onClick())
    await deleteStarted.promise
    await act(async () => renderer.update(createElement(ProvidersSettingsSection, {
      ctx: contextFor(settings, provider, latestUpdate)
    })))

    deleteRequest.resolve({
      ok: true,
      status: 200,
      body: JSON.stringify(snapshotFor(provider, 2, provider.models, false))
    })
    await enqueueSharedModelMutation(async () => undefined)
    await flush()

    expect(staleUpdate).not.toHaveBeenCalled()
    const patch = latestUpdate.mock.calls.at(-1)?.[0] as {
      provider?: { providers?: ModelProviderProfileV1[] }
      agents?: { kun?: { providerId?: string; model?: string } }
    }
    expect(patch.provider?.providers?.some((item) => item.id === provider.id)).toBe(false)
    expect(patch.agents?.kun).toMatchObject({ providerId: DEFAULT_MODEL_PROVIDER_ID })
    expect(sharedProviderMutationCoordinator.pendingDeletions.get(provider.id))
      .toMatchObject({ committedRevision: 2 })
  })

  it('does not let an old DELETE generation hide an explicitly re-added provider after remount', async () => {
    const { settings, provider } = providerFixture()
    let registryIncludesProvider = true
    let registryRevision = 1
    const deleteRequest = deferred<RuntimeResult>()
    const deleteStarted = deferred<void>()
    const runtimeRequest = vi.fn(async (path: string, method: string) => {
      if (path.includes('/events?')) return new Promise<never>(() => undefined)
      if (path === '/v1/model-connections' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify(snapshotFor(
            provider,
            registryRevision,
            provider.models,
            registryIncludesProvider
          ))
        }
      }
      if (path.startsWith(`/v1/model-connections/${provider.id}?`) && method === 'DELETE') {
        deleteStarted.resolve()
        return deleteRequest.promise
      }
      throw new Error(`Unexpected runtime request: ${method} ${path}`)
    })
    Object.assign(window.kunGui, { runtimeRequest })
    const update = vi.fn()
    const ctx = contextFor(settings, provider, update)
    const first = await mount(ctx)
    await flush()
    update.mockClear()
    await clickTab(first, 'modelProviderTabAdvanced')
    await act(async () => findButton(first, 'modelProviderRemove').props.onClick())
    await deleteStarted.promise

    clearPendingSharedProviderDeletionForExplicitAdd(
      sharedProviderMutationCoordinator.pendingDeletions,
      provider.id
    )
    await unmount(first)
    const readded = await mount(ctx)
    await flush()
    update.mockClear()

    registryIncludesProvider = false
    registryRevision = 2
    deleteRequest.resolve({
      ok: true,
      status: 200,
      body: JSON.stringify(snapshotFor(provider, registryRevision, provider.models, false))
    })
    await enqueueSharedModelMutation(async () => undefined)
    await flush()

    expect(sharedProviderMutationCoordinator.pendingDeletions.has(provider.id)).toBe(false)
    expect(rendererText(readded)).toContain(provider.name)
    expect(update).not.toHaveBeenCalled()
  })
})
