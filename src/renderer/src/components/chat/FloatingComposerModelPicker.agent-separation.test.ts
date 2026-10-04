// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { FloatingComposerModelPicker } from './FloatingComposerModelPicker'
import { harnessModelProfiles } from '../../lib/ade-composer-harness'

let host: HTMLDivElement
let root: Root
beforeEach(async () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await i18n.changeLanguage('en')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false
})

describe('Model picker after Agent selection moves to the mode control', () => {
  it('constrains Claude gateway compatibility to reasoning off without changing native catalogs', async () => {
    const onReasoning = vi.fn()
    await act(async () => root.render(createElement(FloatingComposerModelPicker, {
      compact: false, mode: 'select', composerModel: 'gateway-model', composerPickList: ['gateway-model'],
      composerModelGroups: [{ providerId: 'ade-cred:kun-gateway:account', label: 'Kun gateway', modelIds: ['gateway-model'] }],
      composerReasoningEffort: 'high', allowedReasoningEfforts: ['off'],
      onComposerReasoningEffortChange: onReasoning, canChangeModel: true, onComposerModelChange: vi.fn()
    })))
    expect(onReasoning).toHaveBeenCalledWith('off')
    expect(host.textContent).not.toContain('High')
  })

  it('uses only advertised Devin reasoning options even when image capabilities are unknown', async () => {
    const onReasoning = vi.fn()
    await act(async () => root.render(createElement(FloatingComposerModelPicker, {
      compact: false, mode: 'select', composerModel: 'native', composerPickList: ['native'],
      composerModelGroups: [{ providerId: 'ade-cred:native-login', label: 'Native sign-in', nativeHarnessId: 'devin',
        modelIds: ['native'], modelInfo: { native: { id: 'native', displayName: 'Native Model',
          reasoningEfforts: ['medium', 'high'], defaultReasoningEffort: 'medium' } } }],
      composerReasoningEffort: 'max', onComposerReasoningEffortChange: onReasoning,
      canChangeModel: true, onComposerModelChange: vi.fn()
    })))
    expect(onReasoning).toHaveBeenCalledWith('medium')
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click())
    const source = [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')]
      .find((button) => button.textContent?.includes('Native sign-in'))!
    await act(async () => source.click())
    expect([...document.querySelectorAll<HTMLOptionElement>('[data-devin-model-list] select option')].map((option) => option.value))
      .toEqual(['medium', 'high'])
  })

  it('uses native image metadata and does not label unknown capabilities as text-only', async () => {
    await act(async () => root.render(createElement(FloatingComposerModelPicker, {
      compact: false, mode: 'select', composerModel: 'vision', composerPickList: ['vision', 'text', 'unknown'],
      composerModelGroups: [{ providerId: 'ade-cred:native-login', label: 'Native sign-in',
        modelIds: ['vision', 'text', 'unknown'], modelProfiles: harnessModelProfiles([
          { id: 'vision', inputModalities: ['text', 'image'] }, { id: 'text', inputModalities: ['text'] }
        ]) }], canChangeModel: true, onComposerModelChange: vi.fn()
    })))
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click())
    const source = [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')]
      .find((button) => button.textContent?.includes('Native sign-in'))!
    await act(async () => source.click())
    expect(document.querySelector('button[title="vision"]')?.textContent).toContain('Vision')
    expect(document.querySelector('button[title="text"]')?.textContent).toContain('Text')
    expect(document.querySelector('button[title="unknown"]')?.textContent).not.toContain('Text')
  })

  it.each([
    ['agent-default', 'Agent default model'],
    ['loading', 'Loading models…'],
    ['unavailable', 'Models unavailable']
  ] as const)('shows the %s catalog state without suggesting an HTTP provider', async (emptyModelState, label) => {
    const onConfigureProviders = vi.fn()
    await act(async () => root.render(createElement(FloatingComposerModelPicker, {
      compact: false, mode: 'select', controlVariant: 'split', composerModel: 'default', composerPickList: [],
      composerModelGroups: [{ providerId: 'ade-cred:native-login', label: 'Native sign-in', modelIds: [] }],
      canChangeModel: true, onComposerModelChange: vi.fn(), emptyModelState, onConfigureProviders
    })))
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
    expect(trigger.textContent).toContain(label)
    expect(trigger.textContent).not.toContain('Set up provider')
    await act(async () => trigger.click())
    expect(document.querySelector('[data-model-catalog-empty]')).not.toBeNull()
    expect(document.body.textContent).not.toContain('Configure providers')
    expect(document.querySelector('[data-agent-icon]')).toBeNull()
    expect(onConfigureProviders).not.toHaveBeenCalled()
  })

  it('retains the provider/model trigger and provider selection without an Agent section', async () => {
    const onComposerModelChange = vi.fn()
    await act(async () => root.render(createElement(FloatingComposerModelPicker, {
      compact: false, mode: 'select', controlVariant: 'split',
      composerModel: 'model-a', composerProviderId: 'provider-a', composerPickList: ['model-a', 'model-b'],
      composerModelGroups: [{ providerId: 'provider-a', label: 'Provider A', modelIds: ['model-a', 'model-b'] }],
      canChangeModel: true, onComposerModelChange, showProviderInModelLabel: true
    })))
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
    expect(trigger.textContent).toContain('Provider A · model-a')
    expect(trigger.querySelector('[data-agent-icon]')).toBeNull()
    await act(async () => trigger.click())
    expect(document.querySelector('[data-model-agent-section]')).toBeNull()
    const provider = [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find((button) => button.textContent?.includes('Provider A'))!
    await act(async () => provider.click())
    const model = [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find((button) => button.textContent?.includes('model-b'))!
    await act(async () => model.click())
    expect(onComposerModelChange).toHaveBeenCalledWith('model-b', 'provider-a')
  })

  it('keeps native-sign-in model routes without adding an Agent identity to the model trigger', async () => {
    const onComposerModelChange = vi.fn()
    await act(async () => root.render(createElement(FloatingComposerModelPicker, {
      compact: false, mode: 'select', controlVariant: 'split', composerModel: 'sonnet', composerPickList: ['sonnet', 'opus'],
      composerModelGroups: [{ providerId: 'ade-cred:native-login', label: 'Native sign-in', modelIds: ['sonnet', 'opus'] }],
      canChangeModel: true, onComposerModelChange
    })))
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
    expect(trigger.textContent).toContain('sonnet')
    expect(trigger.textContent).not.toContain('Claude')
    expect(trigger.querySelector('[data-model-source-icon="native-login"]')).not.toBeNull()
    expect(trigger.querySelector('[data-provider-icon="kun"]')).toBeNull()
    await act(async () => trigger.click())
    const provider = [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find((button) => button.textContent?.includes('Native sign-in'))!
    expect(provider.querySelector('[data-model-source-icon="native-login"]')).not.toBeNull()
    expect(provider.querySelector('[data-provider-icon="kun"]')).toBeNull()
    await act(async () => provider.click())
    const model = [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find((button) => button.textContent?.includes('opus'))!
    await act(async () => model.click())
    expect(onComposerModelChange).toHaveBeenCalledWith('opus', 'ade-cred:native-login')
    expect(document.querySelector('[data-model-agent-section]')).toBeNull()
  })
})
