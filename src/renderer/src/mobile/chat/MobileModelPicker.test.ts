// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count !== undefined ? `${key}:${options.count}` : key
  })
}))

import {
  formatContextWindow,
  initialPickerProvider,
  MobileModelPicker,
  MOBILE_MODEL_SEARCH_THRESHOLD
} from './MobileModelPicker'

const manyModels = Array.from({ length: MOBILE_MODEL_SEARCH_THRESHOLD + 12 }, (_, index) => `router/model-${index}`)
const groups: ModelProviderModelGroup[] = [
  {
    providerId: 'deepseek',
    label: 'DeepSeek',
    modelIds: ['deepseek-chat', 'deepseek-reasoner'],
    modelProfiles: {
      'deepseek-chat': {
        aliases: ['DeepSeek V4'],
        contextWindowTokens: 131_072,
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        messageParts: []
      }
    }
  } as unknown as ModelProviderModelGroup,
  { providerId: 'openrouter', label: 'OpenRouter', modelIds: manyModels },
  // The same model id offered by two providers must keep its own provider.
  { providerId: 'mirror', label: 'Mirror', modelIds: ['deepseek-chat'] }
]

describe('MobileModelPicker', () => {
  let root: Root | undefined
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    container.remove()
  })

  function render(props: { model: string; providerId: string; onChange?: (model: string, provider: string) => void }) {
    root = createRoot(container)
    act(() => root!.render(createElement(MobileModelPicker, {
      model: props.model,
      providerId: props.providerId,
      groups,
      fallbackIds: [],
      onChange: props.onChange ?? (() => undefined)
    })))
  }

  const chips = (): HTMLButtonElement[] => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
  const rows = (): HTMLButtonElement[] => [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')]

  it('shows provider chips with model counts and opens on the selected provider', () => {
    render({ model: 'deepseek-chat', providerId: 'deepseek' })
    expect(chips().map((chip) => chip.textContent)).toEqual([
      'DeepSeek2', `OpenRouter${manyModels.length}`, 'Mirror1'
    ])
    expect(chips()[0]!.getAttribute('aria-selected')).toBe('true')
    expect(rows().map((row) => row.querySelector('.kun-mobile-model-name')?.textContent))
      .toEqual(['DeepSeek V4', 'deepseek-reasoner'])
    // Alias rows also show the raw id, context window and vision capability.
    expect(rows()[0]!.textContent).toContain('deepseek-chat')
    expect(rows()[0]!.textContent).toContain('128K')
    expect(rows()[0]!.textContent).toContain('mobileModelImageInput')
    expect(rows()[0]!.getAttribute('aria-pressed')).toBe('true')
    // Two models: no search box.
    expect(container.querySelector('input[type="search"]')).toBeNull()
  })

  it('switches provider lists and searches large catalogs', () => {
    render({ model: 'deepseek-chat', providerId: 'deepseek' })
    act(() => chips()[1]!.click())
    expect(rows()).toHaveLength(manyModels.length)
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!
    expect(search.placeholder).toBe(`mobileModelSearch:${manyModels.length}`)
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(search, 'model-1')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(rows().every((row) => row.textContent?.includes('model-1'))).toBe(true)
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(search, 'nothing-matches')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(rows()).toHaveLength(0)
    expect(container.textContent).toContain('mobileModelNoMatch')
    // The chip owning the current model keeps a marker while another is browsed.
    expect(chips()[0]!.dataset.hasSelection).toBe('true')
  })

  it('reports the browsed provider, not the first provider listing the same id', () => {
    const onChange = vi.fn()
    render({ model: 'deepseek-reasoner', providerId: 'deepseek', onChange })
    act(() => chips()[2]!.click())
    act(() => rows()[0]!.click())
    expect(onChange).toHaveBeenCalledWith('deepseek-chat', 'mirror')
  })

  it('hides the provider row when only one provider exists', () => {
    root = createRoot(container)
    act(() => root!.render(createElement(MobileModelPicker, {
      model: '', providerId: '', groups: [], fallbackIds: ['a', 'b'], onChange: () => undefined
    })))
    expect(chips()).toHaveLength(0)
    expect(rows().map((row) => row.textContent)).toEqual(['a', 'b'])
  })
})

describe('model picker helpers', () => {
  it('formats context windows compactly', () => {
    expect(formatContextWindow(131_072)).toBe('128K')
    expect(formatContextWindow(1_000_000)).toBe('1M')
    expect(formatContextWindow(1_048_576)).toBe('1M')
    expect(formatContextWindow(2_500_000)).toBe('2.5M')
    expect(formatContextWindow(undefined)).toBe('')
  })

  it('prefers the explicit provider, then the provider listing the model', () => {
    const providers = [{ id: 'a', models: [{ id: 'x' }] }, { id: 'b', models: [{ id: 'y' }] }]
    expect(initialPickerProvider(providers, 'b', 'x')).toBe('b')
    expect(initialPickerProvider(providers, '', 'y')).toBe('b')
    expect(initialPickerProvider(providers, 'gone', 'nope')).toBe('a')
  })
})
