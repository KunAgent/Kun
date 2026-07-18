import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { GenerationCatalog } from '../src/engine/generation.js'
import {
  GenerationPanel,
  type GenerationPanelProps,
  type GenerationPanelRecord
} from '../src/webview/generation-panel.js'

describe('generation sidebar panel', () => {
  it('shows an honest localized unavailable state without hiding manual editing', () => {
    const props = panelProps({ catalog: emptyCatalog(), catalogOutcome: 'unavailable' })
    const english = renderToStaticMarkup(<GenerationPanel {...props} />)
    const chinese = renderToStaticMarkup(
      <GenerationPanel
        {...props}
        locale={{ language: 'zh-CN', direction: 'ltr', messages: {} }}
      />
    )

    expect(english).toContain('Generation unavailable')
    expect(english).toContain('Manual editing, transcript workflows, proof, and export remain available')
    expect(english).not.toContain('type="password"')
    expect(chinese).toContain('生成能力不可用')
    expect(chinese).toContain('手动剪辑、逐字稿、校验和导出仍可正常使用')
    expect(chinese).not.toContain('Generation unavailable')
  })

  it('requires provider, exact-reference upload, and bounded-cost intent before requesting', async () => {
    const onRequest = vi.fn(async (_request: Parameters<GenerationPanelProps['onRequest']>[0]) => undefined)
    const props = panelProps({ onRequest, createIdempotencyKey: () => 'generation-ui-request-0001' })
    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(<GenerationPanel {...props} />)
      })
      const prompt = renderer!.root.findByType('textarea')
      await act(async () => prompt.props.onChange({ target: { value: 'Create a concise interview opener' } }))
      const variants = renderer!.root.findByProps({ type: 'number' })
      await act(async () => variants.props.onChange({ target: { value: '2' } }))
      const reference = labelCheckbox(renderer!, 'Interview.mp4')
      await act(async () => reference.props.onChange({ target: { checked: true } }))

      expect(button(renderer!, 'Authorize and create placeholder').props.disabled).toBe(true)
      expect(textOf(renderer!.root)).toContain('Kun Host must still issue a short-lived authorization')
      expect(textOf(renderer!.root)).toContain('$0.50')

      for (const label of [
        'Allow this provider operation',
        'Allow upload of 1 selected reference',
        'Approve a maximum estimated charge'
      ]) {
        const checkbox = labelCheckbox(renderer!, label)
        await act(async () => checkbox.props.onChange({ target: { checked: true } }))
      }
      expect(button(renderer!, 'Authorize and create placeholder').props.disabled).toBe(false)
      const form = renderer!.root.findByType('form')
      await act(async () => {
        form.props.onSubmit({ preventDefault: vi.fn() })
        await Promise.resolve()
      })

      expect(onRequest).toHaveBeenCalledTimes(1)
      expect(onRequest).toHaveBeenCalledWith(expect.objectContaining({
        projectId: 'demo-project',
        projectRevision: 4,
        providerId: 'remote-provider',
        modelId: 'remote-video',
        referenceAssetIds: ['asset-one'],
        variants: 2,
        idempotencyKey: 'generation-ui-request-0001',
        consent: expect.objectContaining({
          providerPermissionApproved: true,
          mediaUploadApproved: true,
          costApproved: true,
          approvedMaximumMinor: 50,
          currency: 'USD'
        })
      }))
      const serialized = JSON.stringify(onRequest.mock.calls[0]![0])
      expect(serialized).not.toMatch(/media_reference|\/Users\/|https?:\/\/|api.?key|token/iu)
    } finally {
      await act(async () => renderer?.unmount())
    }
  })

  it('does not invent remote confirmations for a free local no-upload adapter', async () => {
    const onRequest = vi.fn(async () => undefined)
    const props = panelProps({
      catalog: localCatalog(),
      assets: [],
      onRequest,
      createIdempotencyKey: () => 'generation-local-request-0001'
    })
    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(<GenerationPanel {...props} />)
      })
      await act(async () => renderer!.root.findByType('textarea').props.onChange({ target: { value: 'Local ambience' } }))
      expect(renderer!.root.findAllByProps({ type: 'checkbox' })).toHaveLength(0)
      expect(textOf(renderer!.root)).toContain('Processing stays on this device')
      expect(button(renderer!, 'Authorize and create placeholder').props.disabled).toBe(false)
    } finally {
      await act(async () => renderer?.unmount())
    }
  })

  it('keeps the task picker reachable when the default video task has no model', () => {
    const catalog = remoteCatalog()
    const model = catalog.providers[0]!.models[0]!
    model.tasks = ['image']
    model.outputKinds = ['image']
    model.referenceKinds = []
    model.limits = { ...model.limits, minReferences: 0, maxReferences: 0 }
    const markup = renderToStaticMarkup(<GenerationPanel {...panelProps({ catalog, assets: [] })} />)

    expect(markup).not.toContain('Generation unavailable')
    expect(markup).toContain('No permitted model supports this task')
    expect(markup).toContain('aria-pressed="false">Image</button>')
  })

  it('requires provider intent for remote adapters even when their permission list is empty', () => {
    const catalog = remoteCatalog()
    catalog.providers[0]!.models[0]!.permissions.permissionIds = []
    const markup = renderToStaticMarkup(<GenerationPanel {...panelProps({ catalog })} />)
    expect(markup).toContain('Allow this provider operation for the exact request')
  })

  it('surfaces placeholder/progress/variant states with separate cancel, retry, and insert actions', async () => {
    const onCancel = vi.fn(async () => undefined)
    const onRetry = vi.fn(async () => undefined)
    const onInsert = vi.fn(async () => undefined)
    const records: GenerationPanelRecord[] = [
      generationRecord({
        id: 'generation-running',
        state: 'running',
        placeholder: { assetId: 'placeholder-one', displayName: 'Generated video', kind: 'video', state: 'pending' },
        progress: { completed: 1, total: 2, unit: 'variant', message: 'First variant complete' }
      }),
      generationRecord({
        id: 'generation-ready',
        state: 'ready',
        placeholder: { assetId: 'placeholder-two', displayName: 'Resolved video', kind: 'video', state: 'resolved' },
        outputs: [{
          id: 'variant-primary',
          assetId: 'asset-generated',
          displayName: 'primary.mp4',
          kind: 'video',
          mimeType: 'video/mp4',
          primary: true,
          createdAt: '2026-07-14T00:00:00.000Z'
        }]
      }),
      generationRecord({
        id: 'generation-failed',
        state: 'failed',
        placeholder: { assetId: 'placeholder-three', displayName: 'Failed video', kind: 'video', state: 'failed' },
        error: { code: 'provider-failed', message: 'Provider job failed safely.', retryable: true }
      })
    ]
    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(<GenerationPanel {...panelProps({ records, onCancel, onRetry, onInsert })} />)
      })
      expect(textOf(renderer!.root)).toContain('First variant complete')
      expect(textOf(renderer!.root)).toContain('Primary')
      expect(textOf(renderer!.root)).toContain('Prompt fingerprint')
      expect(textOf(renderer!.root)).not.toContain('Running prompt')
      await act(async () => button(renderer!, 'Cancel job').props.onClick())
      for (const label of [
        'Re-authorize this provider operation',
        'Re-authorize upload of 1 reference asset',
        'Re-approve the maximum estimated charge'
      ]) {
        const checkbox = labelCheckbox(renderer!, label)
        await act(async () => checkbox.props.onChange({ target: { checked: true } }))
      }
      await act(async () => button(renderer!, 'Authorize retry').props.onClick())
      await act(async () => button(renderer!, 'Insert into timeline').props.onClick())
      expect(onCancel).toHaveBeenCalledWith('generation-running')
      expect(onRetry).toHaveBeenCalledWith('generation-failed', expect.objectContaining({
        providerPermissionApproved: true,
        mediaUploadApproved: true,
        costApproved: true,
        approvedMaximumMinor: 25,
        currency: 'USD'
      }))
      expect(onInsert).toHaveBeenCalledWith('generation-ready', 'variant-primary')
    } finally {
      await act(async () => renderer?.unmount())
    }
  })

  it('keeps controls bounded at the narrowest sidebar contract', () => {
    const css = readFileSync(new URL('../src/webview/generation-panel.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.generation-panel\s*\{[^}]*min-width:\s*0;/su)
    expect(css).toMatch(/\.generation-records\s*\{[^}]*max-height:\s*420px;[^}]*overflow:\s*auto;/su)
    expect(css).toMatch(/@media \(max-width: 360px\)[\s\S]*\.generation-field-grid\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/u)
  })
})

function generationRecord(overrides: Partial<GenerationPanelRecord>): GenerationPanelRecord {
  return {
    schemaVersion: 1,
    id: 'generation-default',
    generation: 1,
    projectId: 'demo-project',
    projectRevision: 4,
    providerId: 'remote-provider',
    modelId: 'remote-video',
    task: 'video',
    promptDigest: 'a'.repeat(64),
    referenceAssetIds: ['asset-one'],
    variantsRequested: 1,
    quote: {
      quoteId: 'quote-default',
      currency: 'USD',
      minimumMinor: 10,
      maximumMinor: 25,
      estimateOnly: true
    },
    state: 'placeholder',
    placeholder: { assetId: 'placeholder-default', displayName: 'Generated video', kind: 'video', state: 'pending' },
    outputs: [],
    attempt: 1,
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    ...overrides
  }
}

function panelProps(overrides: Partial<GenerationPanelProps> = {}): GenerationPanelProps {
  return {
    projectId: 'demo-project',
    projectRevision: 4,
    catalog: remoteCatalog(),
    catalogOutcome: 'available',
    assets: [{ id: 'asset-one', name: 'Interview.mp4', kind: 'video', available: true }],
    records: [],
    onRequest: async () => undefined,
    onRefresh: async () => undefined,
    onCancel: async () => undefined,
    onRetry: async () => undefined,
    onInsert: async () => undefined,
    ...overrides
  }
}

function remoteCatalog(): GenerationCatalog {
  return {
    schemaVersion: 1,
    revision: 'catalog-revision-1',
    generatedAt: '2026-07-14T00:00:00.000Z',
    providers: [{
      id: 'remote-provider',
      displayName: 'Remote provider',
      version: '1.0.0',
      kind: 'remote',
      status: 'available',
      models: [{
        id: 'remote-video',
        displayName: 'Remote video',
        version: '1.0.0',
        tasks: ['video', 'upscale'],
        outputKinds: ['video'],
        referenceKinds: ['video'],
        limits: {
          maxPromptCharacters: 2_000,
          minReferences: 1,
          maxReferences: 2,
          maxVariants: 4,
          maxWidth: 3_840,
          maxHeight: 2_160,
          maxDurationUs: 30_000_000
        },
        permissions: {
          permissionIds: ['network:api.example.test'],
          credential: 'host-account',
          mediaUpload: 'explicit'
        },
        privacy: {
          processing: 'provider',
          promptRetention: 'provider-policy',
          mediaRetention: 'provider-policy'
        },
        cost: { currency: 'USD', minimumMinor: 10, maximumMinor: 25, estimateOnly: true }
      }]
    }]
  }
}

function localCatalog(): GenerationCatalog {
  const catalog = remoteCatalog()
  catalog.providers = [{
    id: 'local-provider',
    displayName: 'Local provider',
    version: '1.0.0',
    kind: 'local',
    status: 'available',
    models: [{
      ...catalog.providers[0]!.models[0]!,
      id: 'local-video',
      displayName: 'Local video',
      limits: { ...catalog.providers[0]!.models[0]!.limits, minReferences: 0, maxReferences: 0 },
      referenceKinds: [],
      permissions: { permissionIds: [], credential: 'none', mediaUpload: 'never' },
      privacy: { processing: 'device', promptRetention: 'none', mediaRetention: 'none' },
      cost: { currency: 'USD', minimumMinor: 0, maximumMinor: 0, estimateOnly: false }
    }]
  }]
  return catalog
}

function emptyCatalog(): GenerationCatalog {
  return {
    schemaVersion: 1,
    revision: 'generation-unavailable',
    generatedAt: '2026-07-14T00:00:00.000Z',
    providers: []
  }
}

function labelCheckbox(renderer: ReactTestRenderer, text: string): ReactTestInstance {
  const label = renderer.root.findAllByType('label').find((candidate) => textOf(candidate).includes(text))
  if (!label) throw new Error(`Missing label containing ${text}`)
  return label.findByProps({ type: 'checkbox' })
}

function button(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const result = renderer.root.findAllByType('button').find((candidate) => textOf(candidate) === label)
  if (!result) throw new Error(`Missing button ${label}`)
  return result
}

function textOf(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : textOf(child)).join('')
}
