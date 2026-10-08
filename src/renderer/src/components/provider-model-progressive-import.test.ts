import { describe, expect, it, vi } from 'vitest'
import type { ModelProviderProfileV1 } from '@shared/app-settings'
import type { ModelsDevCatalogResult } from '@shared/kun-gui-api'
import { progressiveModelImport, completePendingModelCatalog } from './provider-model-progressive-import'

const target = { id: 'fixture' } as ModelProviderProfileV1
const catalog: ModelsDevCatalogResult = { status: 'ok', providerKey: 'fixture', providerName: 'Fixture', matchMode: 'catalog', stale: false, models: [] }

describe('progressive public model metadata', () => {
  it('opens provider models before the public catalog finishes and exposes the later update', async () => {
    let finish!: (value: ModelsDevCatalogResult) => void
    const pending = new Promise<ModelsDevCatalogResult>((resolve) => { finish = resolve })
    const open = vi.fn()
    const flow = progressiveModelImport(() => pending, open)
    const initial = await flow.fetchCatalog(target)
    flow.openImport({ target, providerModelIds: ['account-model'], catalogResult: initial })
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ providerModelIds: ['account-model'], catalogLoading: true }))
    const input = open.mock.calls[0][0]
    finish(catalog)
    await expect(input.catalogPromise).resolves.toBe(catalog)
  })
  it('never reopens a closed picker or applies a result after provider switch or replacement', () => {
    const current = { providerId: 'fixture', importRequestId: 2, picked: ['keep-selection'] }
    expect(completePendingModelCatalog(null, { providerId: 'fixture', importRequestId: 2, stillCurrent: true }, catalog)).toBeNull()
    expect(completePendingModelCatalog(current, { providerId: 'fixture', importRequestId: 1, stillCurrent: true }, catalog)).toBe(current)
    expect(completePendingModelCatalog(current, { providerId: 'fixture', importRequestId: 2, stillCurrent: false }, catalog)).toBe(current)
    expect(completePendingModelCatalog(current, { providerId: 'fixture', importRequestId: 2, stillCurrent: true }, catalog))
      .toMatchObject({ picked: ['keep-selection'], catalogResult: catalog, catalogLoading: false })
  })
})

it('retains checked models when late metadata reclassifies their endpoint kind', async () => {
  const { createElement } = await import('react')
  const { act, create } = await import('react-test-renderer')
  const { ProviderModelImportDialog } = await import('./provider-model-import-dialog')
  const profile: ModelProviderProfileV1 = { id: 'fixture', name: 'Fixture', baseUrl: '', apiKey: '', endpointFormat: 'chat_completions', useProxy: false, models: [], modelProfiles: {} }
  const confirm = vi.fn(async () => {})
  const props = { provider: profile, providerModelIds: ['model-a', 'model-b'], catalogResult: catalog,
    catalogLoading: true, t: (key: string) => key, onCancel: () => {}, onConfirm: confirm }
  let renderer!: ReturnType<typeof create>
  await act(async () => { renderer = create(createElement(ProviderModelImportDialog, props)) })
  const rows = renderer.root.findAllByType('li')
  await act(async () => rows[1].findByType('input').props.onChange())
  const enriched: ModelsDevCatalogResult = { ...catalog, status: 'ok', models: [
    { id: 'model-a', inputModalities: ['text'], outputModalities: ['image'], matchSpecificity: 'exact' },
    { id: 'model-b', inputModalities: ['text'], outputModalities: ['text'], matchSpecificity: 'exact' }
  ] }
  await act(async () => { renderer.update(createElement(ProviderModelImportDialog, { ...props, catalogResult: enriched, catalogLoading: false })) })
  const submit = renderer.root.findAllByType('button').find((button) => button.children.includes('providerModelImportConfirm'))!
  await act(async () => { await submit.props.onClick() })
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ image: ['model-a'], chat: [] }))
  await act(async () => renderer.unmount())
})

it('quick-add finishes from the live list while public metadata is unresolved', async () => {
  const { discoverProviderModels } = await import('./provider-model-discovery')
  vi.stubGlobal('window', { kunGui: { probeModelProvider: vi.fn(async () => ({ ok: true, modelIds: ['live-model'], latencyMs: 1 })) } })
  try {
    const fetchCatalog = vi.fn(() => new Promise<ModelsDevCatalogResult>(() => {}))
    const result = await discoverProviderModels({ id: 'custom', name: 'Custom', apiKey: 'fixture', baseUrl: 'https://example.test',
      endpointFormat: 'chat_completions', useProxy: false, models: [], modelProfiles: {} }, {
      t: (key) => key, sharedConnectionFor: () => undefined, fetchModelsDevCatalogFor: fetchCatalog,
      importPickedModels: vi.fn(async () => 1), setProbeStates: vi.fn()
    })
    expect(result.firstChatModel).toBe('live-model')
    expect(result.added).toBe(1)
    expect(fetchCatalog).toHaveBeenCalledOnce()
  } finally { vi.unstubAllGlobals() }
})
