import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create as createRenderer, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import type { ModelProviderProfileV1 } from '@shared/app-settings'
import { ProviderModelsManager } from './settings-section-provider-models'

const labels: Record<string, string> = {
  providerModelListDesc: 'Models list description',
  providerModelEmpty: 'No models yet',
  providerModelAdd: 'Add model',
  providerModelAddTitle: 'Add model',
  providerModelEditTitle: 'Configure {{model}}',
  providerModelEditAction: 'Configure {{model}}',
  providerModelCancel: 'Cancel',
  providerModelSave: 'Save model',
  providerModelIdLabel: 'Model ID',
  providerModelIdPlaceholder: 'e.g. model-1',
  providerModelIdHint: 'Use the exact API model ID.',
  providerModelKindLabel: 'Model kind',
  providerModelKindChatDesc: 'For chat and agent tasks.',
  providerModelKindImageDesc: 'For image generation.',
  providerModelKindSpeechDesc: 'For speech recognition.',
  providerModelKindTtsDesc: 'For speech generation.',
  providerModelKindMusicDesc: 'For music generation.',
  providerModelKindVideoDesc: 'For video generation.',
  providerModelVisionLabel: 'Image input',
  providerModelVisionDesc: 'Allow images.',
  providerModelToolsLabel: 'Tool calling',
  providerModelToolsDesc: 'Allow tools.',
  providerModelReasoningLabel: 'Reasoning',
  providerModelReasoningDesc: 'Allow reasoning controls.',
  providerModelAdvancedTitle: 'Advanced model settings',
  providerModelAdvancedDesc: 'Context, output, reasoning protocol, endpoint, and aliases.',
  providerModelContextLabel: 'Context window',
  providerModelContextPlaceholder: 'e.g. 128k',
  providerModelContextHint: 'Context hint',
  providerModelMaxOutputLabel: 'Max output',
  providerModelMaxOutputPlaceholder: 'e.g. 8k',
  providerModelMaxOutputHint: 'Output hint',
  providerModelEndpointFormatLabel: 'Request format',
  providerModelAliasesLabel: 'Aliases',
  modelProviderVisionBadge: 'Vision',
  providerModelReasoningBadge: 'Reasoning',
  providerModelNoToolsBadge: 'No tool calling',
  providerModelDefaultProfileBadge: 'Default profile',
  providerModelContextBadge: '{{size}} context',
  providerModelMaxOutputBadge: '{{size}} output',
  providerModelKindChat: 'Text chat',
  providerModelKindImage: 'Image generation',
  providerModelKindSpeech: 'Speech to text',
  providerModelKindTts: 'Text to speech',
  providerModelKindMusic: 'Music generation',
  providerModelKindVideo: 'Video generation',
  providerModelSearchPlaceholder: 'Search models',
  providerModelPageNext: 'Next page',
  providerModelPagePrev: 'Previous page',
  providerModelPageIndicator: '{{page}} / {{total}}',
  providerModelPageCount: 'Showing {{shown}} of {{total}}',
  providerModelBatchSelectVisible: 'Select page ({{count}})',
  providerModelBatchClearVisible: 'Clear page selection',
  providerModelBatchSelectedCount: '{{count}} selected',
  providerModelBatchDelete: 'Delete selected ({{count}})',
  providerModelBatchToggleRow: 'Select {{model}}'
}

function t(key: string, params?: Record<string, unknown>): string {
  const template = labels[key] ?? key
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name] ?? ''))
}

function provider(overrides: Partial<ModelProviderProfileV1> = {}): ModelProviderProfileV1 {
  return {
    id: 'custom-provider-1',
    name: 'Custom',
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com/v1',
    endpointFormat: 'chat_completions',
    useProxy: false,
    models: [],
    modelProfiles: {},
    ...overrides
  }
}

function renderManager(target: ModelProviderProfileV1): string {
  return renderToStaticMarkup(createElement(ProviderModelsManager, {
    provider: target,
    t,
    selectControlClass: 'select',
    onChange: () => undefined
  }))
}

function renderInteractiveManager(
  target: ModelProviderProfileV1,
  onChange: (next: ModelProviderProfileV1) => void = () => undefined
): ReactTestRenderer {
  let renderer: ReactTestRenderer
  act(() => {
    renderer = createRenderer(createElement(ProviderModelsManager, {
      provider: target,
      t,
      selectControlClass: 'select',
      onChange
    }))
  })
  return renderer!
}

function buttonWithText(renderer: ReactTestRenderer, text: string): ReactTestInstance {
  return renderer.root.find((node) =>
    node.type === 'button' && node.children.some((child) => child === text)
  )
}

describe('ProviderModelsManager', () => {
  it('renders the empty state with an add button', () => {
    const html = renderManager(provider())
    expect(html).toContain('No models yet')
    expect(html).toContain('Add model')
  })

  it('opens add-model editing in a labeled dialog with collapsed advanced settings', () => {
    const onChange = vi.fn()
    const renderer = renderInteractiveManager(provider(), onChange)
    const opener = { focus: vi.fn(), isConnected: false }

    act(() => buttonWithText(renderer, 'Add model').props.onClick({ currentTarget: opener }))

    const dialog = renderer.root.findByProps({ role: 'dialog' })
    expect(dialog.props['aria-modal']).toBe('true')
    expect(dialog.props.className).toContain('flex-col')
    expect(dialog.props.className).toContain('overflow-hidden')
    const scrollRegion = dialog.find((node) =>
      typeof node.props.className === 'string'
      && node.props.className.includes('overflow-y-auto')
    )
    expect(scrollRegion.props.className).toContain('min-h-0')
    expect(scrollRegion.props.className).toContain('flex-1')
    const title = renderer.root.findByProps({ id: dialog.props['aria-labelledby'] })
    expect(title.children).toContain('Add model')
    const advanced = dialog.findByType('details')
    expect(advanced.props.open).toBeUndefined()
    expect(advanced.findAll((node) => node.children.includes('Advanced model settings'))).not.toHaveLength(0)
    const advancedScrollRegion = advanced.find((node) =>
      typeof node.props.className === 'string'
      && node.props.className.includes('max-h-[min(48dvh,480px)]')
    )
    expect(advancedScrollRegion.props.className).toContain('overflow-y-auto')
    expect(advancedScrollRegion.props.className).toContain('overscroll-contain')
    expect(advanced.findByProps({ placeholder: 'e.g. 128k' })).toBeDefined()
    expect(dialog.findAllByProps({ role: 'switch' }).map((toggle) => toggle.props['aria-label']))
      .toEqual(['Image input', 'Tool calling', 'Reasoning'])

    act(() => buttonWithText(renderer, 'Cancel').props.onClick())
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
    expect(onChange).not.toHaveBeenCalled()
    act(() => renderer.unmount())
  })

  it('saves a new model from the dialog through the existing model form helpers', () => {
    const onChange = vi.fn()
    const renderer = renderInteractiveManager(provider(), onChange)

    act(() => buttonWithText(renderer, 'Add model').props.onClick({
      currentTarget: { focus: vi.fn(), isConnected: false }
    }))
    const modelId = renderer.root.findByProps({ 'data-model-editor-initial-focus': 'true' })
    act(() => modelId.props.onChange({ target: { value: 'new-chat-model' } }))
    const save = buttonWithText(renderer, 'Save model')
    expect(save.props.disabled).toBe(false)
    act(() => save.props.onClick())

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].models).toContain('new-chat-model')
    expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
    act(() => renderer.unmount())
  })

  it('opens existing models in the same dialog without mutating them on cancel', () => {
    const onChange = vi.fn()
    const renderer = renderInteractiveManager(provider({ models: ['existing-model'] }), onChange)
    const edit = renderer.root.findByProps({ 'aria-label': 'Configure existing-model' })

    act(() => edit.props.onClick({ currentTarget: { focus: vi.fn(), isConnected: false } }))
    const dialog = renderer.root.findByProps({ role: 'dialog' })
    const title = renderer.root.findByProps({ id: dialog.props['aria-labelledby'] })
    expect(title.children).toContain('Configure existing-model')
    act(() => buttonWithText(renderer, 'Cancel').props.onClick())

    expect(onChange).not.toHaveBeenCalled()
    act(() => renderer.unmount())
  })

  it('renders capability badges from the model profile', () => {
    const html = renderManager(provider({
      models: ['vision-thinker', 'bare-model'],
      modelProfiles: {
        'vision-thinker': {
          contextWindowTokens: 1_000_000,
          maxOutputTokens: 32_000,
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
          supportsToolCalling: false,
          messageParts: ['text', 'image_url'],
          reasoning: {
            supportedEfforts: ['off', 'high'],
            defaultEffort: 'high',
            requestProtocol: 'deepseek-chat-completions'
          }
        }
      }
    }))
    expect(html).toContain('vision-thinker')
    expect(html).toContain('1M context')
    expect(html).toContain('32K output')
    expect(html).toContain('Vision')
    expect(html).toContain('Reasoning')
    expect(html).toContain('No tool calling')
    expect(html).toContain('Default profile')
  })

  it('keeps model names on a separate row from compact capability badges', () => {
    const html = renderManager(provider({
      models: ['deepseek-v4-pro'],
      modelProfiles: {
        'deepseek-v4-pro': {
          contextWindowTokens: 1_000_000,
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text', 'image_url'],
          reasoning: {
            supportedEfforts: ['off', 'high'],
            defaultEffort: 'high',
            requestProtocol: 'deepseek-chat-completions'
          }
        }
      }
    }))

    expect(html).toContain('grid min-w-0 flex-1 gap-1.5')
    expect(html).toContain('flex min-w-0 flex-wrap items-center gap-1')
    expect(html).toContain('text-[10.5px]')
  })

  it('exposes the complete model name on hover for truncated rows', () => {
    const longModelId = 'MiniMax-Text-01-very-long-model-name-with-extra-tags-and-context'
    const html = renderManager(provider({ models: [longModelId] }))

    expect(html).toContain(`title="${longModelId}"`)
    expect(html).toContain('group-hover/model-name:opacity-100')
  })

  it('renders image and speech capability models in the unified list', () => {
    const html = renderManager(provider({
      models: ['chat-model'],
      image: { protocol: 'openai-images', baseUrl: 'https://api.example.com/v1', models: ['image-01'] },
      speech: { protocol: 'mimo-asr', baseUrl: 'https://api.example.com/v1', models: ['mimo-v2.5-asr'] }
    }))

    expect(html).toContain('chat-model')
    expect(html).toContain('Text chat')
    expect(html).toContain('image-01')
    expect(html).toContain('Image generation')
    expect(html).toContain('mimo-v2.5-asr')
    expect(html).toContain('Speech to text')
  })

  it('renders media generation capability models in the unified list', () => {
    const html = renderManager(provider({
      textToSpeech: { protocol: 'mimo-tts', baseUrl: 'https://api.example.com/v1', models: ['mimo-v2.5-tts'] },
      music: { protocol: 'minimax-music', baseUrl: 'https://api.example.com/v1', models: ['music-2.6'] },
      video: { protocol: 'minimax-video', baseUrl: 'https://api.example.com/v1', models: ['MiniMax-Hailuo-2.3'] }
    }))

    expect(html).toContain('mimo-v2.5-tts')
    expect(html).toContain('Text to speech')
    expect(html).toContain('music-2.6')
    expect(html).toContain('Music generation')
    expect(html).toContain('MiniMax-Hailuo-2.3')
    expect(html).toContain('Video generation')
  })

  it('exposes batch-selection toolbar with a per-row checkbox once the list paginates', () => {
    // 9 entries crosses the MODEL_LIST_PAGE_SIZE = 8 threshold so the toolbar
    // and per-row checkboxes show up. Below the threshold both stay hidden to
    // avoid noise on tiny lists.
    const html = renderManager(provider({
      models: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9']
    }))
    expect(html).toContain('Select page (8)')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('Select m1')
  })

  it('keeps large-catalog pagination and search behavior available beside the dialog flow', () => {
    const renderer = renderInteractiveManager(provider({
      models: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9']
    }))

    act(() => renderer.root.findByProps({ 'aria-label': 'Next page' }).props.onClick())
    expect(JSON.stringify(renderer.toJSON())).toContain('m9')
    expect(JSON.stringify(renderer.toJSON())).not.toContain('title":"m1"')

    act(() => renderer.root.findByProps({ 'aria-label': 'Search models' }).props.onChange({
      target: { value: 'm5' }
    }))
    const tree = JSON.stringify(renderer.toJSON())
    expect(tree).toContain('m5')
    expect(tree).not.toContain('title":"m9"')
    act(() => renderer.unmount())
  })

  it('keeps the batch toolbar and checkboxes hidden for short model lists', () => {
    const html = renderManager(provider({ models: ['m1', 'm2'] }))
    expect(html).not.toContain('Select page')
    expect(html).not.toContain('type="checkbox"')
  })
})
