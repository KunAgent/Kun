import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ModelProviderProfileV1 } from '@shared/app-settings'
import { ProviderModelImportDialog } from './provider-model-import-dialog'

const labels: Record<string, string> = {
  providerModelKindChat: 'Text chat',
  providerModelKindImage: 'Image generation',
  providerModelKindSpeech: 'Speech to text',
  providerModelKindTts: 'Text to speech',
  providerModelKindMusic: 'Music generation',
  providerModelKindVideo: 'Video generation',
  providerModelImportTitle: 'Pick models to import',
  providerModelImportSubtitle: 'Fetched {{total}} from {{provider}}; {{existing}} already added.',
  providerModelImportSearchPlaceholder: 'Search by model name',
  providerModelImportFilterAll: 'All ({{count}})',
  providerModelImportHideExisting: 'Hide already added ({{count}})',
  providerModelImportAlreadyAdded: 'Already added',
  providerModelImportNoneFetched: 'Provider returned 0 models',
  providerModelImportNoneMatch: 'No matches',
  providerModelImportSelectAllVisible: 'Select all ({{count}})',
  providerModelImportClearVisible: 'Clear all',
  providerModelImportSelectedCount: '{{count}} selected',
  providerModelImportCancel: 'Cancel',
  providerModelImportConfirm: 'Import {{count}}'
}

function t(key: string, params?: Record<string, unknown>): string {
  const template = labels[key] ?? key
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name] ?? ''))
}

function provider(overrides: Partial<ModelProviderProfileV1> = {}): ModelProviderProfileV1 {
  return {
    id: 'p1',
    name: 'Acme',
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com/v1',
    endpointFormat: 'chat_completions',
    models: [],
    modelProfiles: {},
    ...overrides
  }
}

function render(target: ModelProviderProfileV1, fetched: string[]): string {
  return renderToStaticMarkup(createElement(ProviderModelImportDialog, {
    provider: target,
    fetchedModelIds: fetched,
    t,
    onCancel: () => undefined,
    onConfirm: () => undefined
  }))
}

describe('ProviderModelImportDialog', () => {
  it('shows the fetched count, a search input, and per-kind filter chips', () => {
    const html = render(provider(), ['gpt-4o', 'gpt-4o-mini', 'whisper-1', 'dall-e-3'])
    expect(html).toContain('Pick models to import')
    expect(html).toContain('Fetched 4 from Acme')
    expect(html).toContain('Search by model name')
    expect(html).toContain('All (4)')
    expect(html).toContain('Text chat · 2')
  })

  it('pre-selects only fresh models, hides already-added rows by default, and offers a toggle to show them', () => {
    const html = render(
      provider({ models: ['gpt-4o'] }),
      ['gpt-4o', 'gpt-4o-mini']
    )
    // Subtitle calls out the duplicate count even though the row itself is hidden
    expect(html).toContain('Fetched 2 from Acme; 1 already added.')
    // Default hideExisting=true → existing row gone, fresh row visible and pre-selected → Import shows 1
    expect(html).toContain('gpt-4o-mini')
    expect(html).not.toContain('Already added') // badge hidden because filtered out
    expect(html).toContain('Hide already added (1)')
    expect(html).toContain('Import 1')
  })

  it('renders an empty state when the provider returned no models', () => {
    const html = render(provider(), [])
    expect(html).toContain('Provider returned 0 models')
    // Import button shows 0 selected and is disabled
    expect(html).toContain('Import 0')
    expect(html).toContain('disabled=""')
  })
})
