import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ModelProviderProfileV1 } from '@shared/app-settings'
import type { ModelsDevCatalogResult } from '@shared/kun-gui-api'
import { ProviderModelImportDialog } from './provider-model-import-dialog'

const labels: Record<string, string> = {
  providerModelKindChat: 'Text chat',
  providerModelKindImage: 'Image generation',
  providerModelKindSpeech: 'Speech to text',
  providerModelKindTts: 'Text to speech',
  providerModelKindMusic: 'Music generation',
  providerModelKindVideo: 'Video generation',
  providerModelImportTitle: 'Pick models to import',
  providerModelImportSubtitle: 'Found {{total}} for {{provider}}; {{existing}} already added.',
  providerModelImportSearchPlaceholder: 'Search by model name',
  providerModelImportFilterAll: 'All types ({{count}})',
  providerModelImportSourceAll: 'All sources ({{count}})',
  providerModelImportSourceApi: 'Provider API ({{count}})',
  providerModelImportSourceCatalog: 'models.dev ({{count}})',
  providerModelImportSourceApiBadge: 'Provider API',
  providerModelImportSourceCatalogBadge: 'models.dev only',
  providerModelImportSourceBothBadge: 'API + models.dev',
  providerModelImportHideExisting: 'Hide already added ({{count}})',
  providerModelImportAlreadyAdded: 'Already added',
  providerModelImportNoneFetched: 'No models available',
  providerModelImportNoneMatch: 'No matches',
  providerModelImportSelectAllVisible: 'Select all ({{count}})',
  providerModelImportClearVisible: 'Clear all',
  providerModelImportSelectedCount: '{{count}} selected',
  providerModelImportCancel: 'Cancel',
  providerModelImportConfirm: 'Import {{count}}',
  providerModelImportApplyMetadata: 'Apply model metadata',
  providerModelImportMetadataUpdates: '{{count}} existing models can be updated',
  providerModelImportMetadataIgnored: 'Ignored {{count}} out-of-range catalog fields; models remain importable.',
  providerModelImportMetadataIssueBadge: 'Metadata ignored',
  providerModelImportMetadataIssueDetail: '{{field}} {{value}} exceeds supported maximum {{max}}; field ignored.',
  providerModelFieldContextWindow: 'Context window',
  providerModelFieldMaxOutput: 'Max output',
  providerModelImportProviderWarning: 'Provider verification failed: {{message}}',
  providerModelImportCatalogError: 'Catalog unavailable: {{message}}',
  providerModelImportCatalogUnmapped: 'No exact catalog mapping.',
  providerModelImportCatalogStale: 'Using cached catalog data.',
  providerModelImportContextBadge: 'Context {{value}}',
  providerModelImportOutputBadge: 'Output {{value}}',
  providerModelImportVisionBadge: 'Vision',
  providerModelImportAudioInputBadge: 'Audio input',
  providerModelImportToolsBadge: 'Tools',
  providerModelImportNoToolsBadge: 'No tools',
  providerModelImportReasoningBadge: 'Reasoning'
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
    useProxy: false,
    models: [],
    modelProfiles: {},
    ...overrides
  }
}

function catalog(
  models: Extract<ModelsDevCatalogResult, { status: 'ok' }>['models'],
  overrides: Partial<Extract<ModelsDevCatalogResult, { status: 'ok' }>> = {}
): ModelsDevCatalogResult {
  return {
    status: 'ok',
    providerKey: 'acme',
    providerName: 'Acme Catalog',
    matchMode: 'catalog',
    stale: false,
    models,
    ...overrides
  }
}

function render(input: {
  target?: ModelProviderProfileV1
  providerModelIds?: string[]
  catalogResult?: ModelsDevCatalogResult
  providerError?: string
} = {}): string {
  return renderToStaticMarkup(createElement(ProviderModelImportDialog, {
    provider: input.target ?? provider(),
    providerModelIds: input.providerModelIds ?? [],
    catalogResult: input.catalogResult ?? { status: 'unmapped', models: [] },
    providerError: input.providerError,
    t,
    onCancel: () => undefined,
    onConfirm: async () => undefined
  }))
}

describe('ProviderModelImportDialog', () => {
  it('shows merged source counts, metadata, and selects only provider-confirmed models', () => {
    const html = render({
      providerModelIds: ['GPT-4o'],
      catalogResult: catalog([
        {
          id: 'gpt-4o',
          name: 'GPT 4o',
          description: 'Multimodal flagship',
          inputModalities: ['text', 'image', 'audio'],
          outputModalities: ['text'],
          contextWindowTokens: 128_000,
          maxOutputTokens: 16_000,
          toolCalling: true,
          reasoning: true
        },
        {
          id: 'catalog-candidate',
          inputModalities: ['text'],
          outputModalities: ['text'],
          toolCalling: false
        }
      ])
    })

    expect(html).toContain('Found 2 for Acme')
    expect(html).toContain('Provider API (1)')
    expect(html).toContain('models.dev (2)')
    expect(html).toContain('API + models.dev')
    expect(html).toContain('models.dev only')
    expect(html).toContain('Multimodal flagship')
    expect(html).toContain('Context 128K')
    expect(html).toContain('Output 16K')
    expect(html).toContain('Vision')
    expect(html).toContain('Audio input')
    expect(html).toContain('Text chat · 2')
    expect(html).not.toContain('Speech to text ·')
    expect(html).toContain('Tools')
    expect(html).toContain('Reasoning')
    expect(html).toContain('No tools')
    expect(html).toContain('Import 1')
  })

  it('keeps a dedicated audio-to-text model classified as speech recognition', () => {
    const html = render({
      providerModelIds: ['sound-reader'],
      catalogResult: catalog([{
        id: 'sound-reader',
        inputModalities: ['audio'],
        outputModalities: ['text']
      }])
    })

    expect(html).toContain('Speech to text · 1')
    expect(html).toContain('Audio input')
    expect(html).not.toContain('Text chat ·')
  })

  it('shows ignored catalog metadata without removing the affected model', () => {
    const html = render({
      providerModelIds: ['qwen/qwen3.5-flash'],
      catalogResult: catalog([{
        id: 'qwen/qwen3.5-flash',
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
        contextWindowTokens: 1_020_000,
        toolCalling: true,
        metadataIssues: [{
          field: 'maxOutputTokens',
          code: 'out_of_range',
          rawValue: 1_020_000,
          maxAllowed: 1_000_000
        }]
      }])
    })

    expect(html).toContain('qwen/qwen3.5-flash')
    expect(html).toContain('Ignored 1 out-of-range catalog fields')
    expect(html).toContain('Metadata ignored')
    expect(html).toContain('Max output 1,020,000 exceeds supported maximum 1,000,000')
  })

  it('hides existing rows by default and does not preselect them', () => {
    const html = render({
      target: provider({ models: ['gpt-4o'] }),
      providerModelIds: ['gpt-4o', 'gpt-4o-mini']
    })
    expect(html).toContain('Found 2 for Acme; 1 already added.')
    expect(html).toContain('gpt-4o-mini')
    expect(html).not.toContain('Already added')
    expect(html).toContain('Hide already added (1)')
    expect(html).toContain('Import 1')
  })

  it('allows catalog metadata to be applied when every matching model already exists', () => {
    const html = render({
      target: provider({ models: ['gpt-4o'] }),
      providerModelIds: ['gpt-4o'],
      catalogResult: catalog([{
        id: 'gpt-4o',
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
        contextWindowTokens: 128_000,
        reasoning: true
      }])
    })
    expect(html).toContain('1 existing models can be updated')
    expect(html).toContain('Apply model metadata')
    const applyButton = html.match(/<button[^>]*>Apply model metadata<\/button>/)?.[0]
    expect(applyButton).toBeDefined()
    expect(applyButton).not.toContain('disabled=""')
  })

  it('does not claim that a fully configured existing model needs an update', () => {
    const html = render({
      target: provider({
        models: ['gpt-4o'],
        modelProfiles: {
          'gpt-4o': {
            contextWindowTokens: 128_000,
            maxOutputTokens: 16_000,
            inputModalities: ['text', 'image'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text', 'image_url']
          }
        }
      }),
      providerModelIds: ['gpt-4o'],
      catalogResult: catalog([{
        id: 'gpt-4o',
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
        contextWindowTokens: 128_000,
        maxOutputTokens: 16_000,
        reasoning: true
      }])
    })
    expect(html).not.toContain('existing models can be updated')
    expect(html).toContain('Import 0')
    expect(html).toContain('disabled=""')
  })

  it('shows independent provider and stale-catalog warnings', () => {
    const html = render({
      providerError: '401 unauthorized',
      catalogResult: catalog([{ id: 'candidate', inputModalities: ['text'], outputModalities: ['text'] }], {
        stale: true
      })
    })
    expect(html).toContain('Provider verification failed: 401 unauthorized')
    expect(html).toContain('Using cached catalog data.')
    expect(html).toContain('Import 0')
  })

  it('does not offer catalog-only rows in enrichment-only mode', () => {
    const html = render({
      providerModelIds: ['gpt-5.5'],
      catalogResult: catalog([
        { id: 'gpt-5.5', inputModalities: ['text', 'image'], outputModalities: ['text'] },
        { id: 'unavailable-subscription-model', inputModalities: ['text'], outputModalities: ['text'] }
      ], { matchMode: 'enrichment-only' })
    })
    expect(html).toContain('gpt-5.5')
    expect(html).not.toContain('unavailable-subscription-model')
    expect(html).toContain('Import 1')
  })

  it('renders an empty state when neither source returned models', () => {
    const html = render()
    expect(html).toContain('No models available')
    expect(html).toContain('Import 0')
    expect(html).toContain('disabled=""')
  })
})
