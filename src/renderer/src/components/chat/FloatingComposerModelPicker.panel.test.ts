// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import i18n from '../../i18n'
import { FloatingComposerModelPicker } from './FloatingComposerModelPicker'
import {
  composerReasoningLevelAfterAuto,
  composerReasoningLevels,
  initialExpandedModelGroups
} from './floating-composer-model-panel'

const CODEX: ModelProviderModelGroup = {
  providerId: 'codex-2',
  presetSource: 'codex',
  label: 'ChatGPT subscription 2',
  modelIds: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-6-astra'],
  modelProfiles: {
    'gpt-5.4': { inputModalities: ['text', 'image'], outputModalities: ['text'], supportsToolCalling: true, messageParts: ['text', 'image_url'], serviceTiers: ['priority'] },
    'gpt-5.4-mini': { inputModalities: ['text', 'image'], outputModalities: ['text'], supportsToolCalling: true, messageParts: ['text', 'image_url'] },
    'gpt-6-astra': { inputModalities: ['text', 'image'], outputModalities: ['text'], supportsToolCalling: true, messageParts: ['text', 'image_url'], serviceTiers: [] }
  }
}
const DEEPSEEK: ModelProviderModelGroup = { providerId: 'deepseek', label: 'DeepSeek', modelIds: ['deepseek-v4-pro', 'deepseek-v4-flash'] }
const numbered = (prefix: string, count: number): string[] => Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`)

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

type PickerProps = Parameters<typeof FloatingComposerModelPicker>[0]
async function renderPicker(props: Partial<PickerProps>): Promise<HTMLButtonElement> {
  await act(async () => root.render(createElement(FloatingComposerModelPicker, {
    compact: false,
    mode: 'select',
    composerModel: 'deepseek-v4-pro',
    composerProviderId: 'deepseek',
    composerPickList: [],
    composerModelGroups: [DEEPSEEK],
    composerReasoningEffort: 'high',
    canChangeModel: true,
    onComposerModelChange: vi.fn(),
    onComposerReasoningEffortChange: vi.fn(),
    ...props
  })))
  return host.querySelector<HTMLButtonElement>('[data-composer-model-trigger]')!
}
const panel = (): HTMLElement | null => document.querySelector('[data-composer-model-panel]')
const buttonWithText = (text: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-composer-model-panel] button')].find((button) => button.textContent?.trim() === text)

describe('composer model and reasoning control', () => {
  it('opens one panel with reasoning segments above the model list', async () => {
    const onReasoning = vi.fn()
    const trigger = await renderPicker({ onComposerReasoningEffortChange: onReasoning })
    expect(trigger.textContent).toContain('deepseek-v4-pro')
    expect(trigger.textContent).toContain('High')
    await act(async () => trigger.click())
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const segments = [...document.querySelectorAll<HTMLButtonElement>('[role="radiogroup"] [role="radio"]')]
    expect(segments.map((segment) => segment.textContent)).toEqual(['Off', 'Low', 'Med', 'High', 'Ultra'])
    expect(segments.find((segment) => segment.getAttribute('aria-checked') === 'true')?.textContent).toBe('High')
    await act(async () => segments[1]!.click())
    expect(onReasoning).toHaveBeenCalledWith('low')
    // Changing the effort keeps the panel open for a model pick.
    expect(panel()).not.toBeNull()
    expect([...document.querySelectorAll('[role="menuitemradio"]')].map((row) => row.textContent)).toEqual(['deepseek-v4-pro', 'deepseek-v4-flash'])
  })

  it('moves the effort with arrow keys', async () => {
    const onReasoning = vi.fn()
    const opened = await renderPicker({ onComposerReasoningEffortChange: onReasoning })
    await act(async () => opened.click())
    const group = document.querySelector<HTMLElement>('[role="radiogroup"]')!
    await act(async () => group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(onReasoning).toHaveBeenLastCalledWith('max')
  })

  it('keeps adaptive reasoning as its own switch', async () => {
    const onReasoning = vi.fn()
    const group: ModelProviderModelGroup = { providerId: 'ade-cred:native-login', label: 'Native sign-in', nativeHarnessId: 'codex',
      modelIds: ['gpt'], modelInfo: { gpt: { id: 'gpt', reasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: 'low' } } }
    const trigger = await renderPicker({ composerModel: 'gpt', composerProviderId: group.providerId, composerModelGroups: [group],
      composerReasoningEffort: 'auto', onComposerReasoningEffortChange: onReasoning })
    expect(trigger.textContent).toContain('Adaptive')
    await act(async () => trigger.click())
    const auto = document.querySelector<HTMLButtonElement>('[data-composer-model-panel] button[data-reasoning-effort="auto"]')!
    expect(auto.getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('[role="radio"][aria-checked="true"]')).toBeNull()
    await act(async () => auto.click())
    expect(onReasoning).toHaveBeenLastCalledWith('high')
    expect(composerReasoningLevels([{ id: 'auto', labelKey: '' }, { id: 'max', labelKey: '' }, { id: 'off', labelKey: '' }])).toEqual(['off', 'max'])
    expect(composerReasoningLevelAfterAuto(['low', 'medium'])).toBe('medium')
  })

  it('shows Fast on the trigger and toggles it inside the panel', async () => {
    const onFast = vi.fn()
    const trigger = await renderPicker({ composerModel: 'gpt-5.4', composerProviderId: 'codex-2', composerModelGroups: [CODEX],
      composerFastMode: true, onComposerFastModeChange: onFast })
    expect(trigger.querySelector('.lucide-zap')).not.toBeNull()
    expect(trigger.getAttribute('aria-label')).toContain('Fast mode on')
    await act(async () => trigger.click())
    const fast = document.querySelector<HTMLButtonElement>('button[aria-label="Fast mode on"]')!
    expect(fast.getAttribute('aria-pressed')).toBe('true')
    await act(async () => fast.click())
    expect(onFast).toHaveBeenCalledWith(false)
  })

  it.each([
    ['gpt-5.4-mini', 'Fast support is not confirmed for this model'],
    ['gpt-6-astra', 'This model does not offer Fast mode.']
  ])('explains why Fast is unavailable for %s', async (model, reason) => {
    const onFast = vi.fn()
    const trigger = await renderPicker({ composerModel: model, composerProviderId: 'codex-2', composerModelGroups: [CODEX],
      composerFastMode: true, onComposerFastModeChange: onFast })
    expect(trigger.querySelector('.lucide-zap')).toBeNull()
    await act(async () => trigger.click())
    const fast = document.querySelector<HTMLButtonElement>('.ds-composer-panel-toggle.is-fast')!
    expect(fast.getAttribute('aria-disabled')).toBe('true')
    expect(fast.getAttribute('aria-pressed')).toBe('false')
    expect(fast.title).toContain(reason)
    await act(async () => fast.click())
    expect(onFast).not.toHaveBeenCalled()
  })

  it('hides Fast for providers without it', async () => {
    const opened = await renderPicker({ composerFastMode: true, onComposerFastModeChange: vi.fn() })
    await act(async () => opened.click())
    expect(document.querySelector('.ds-composer-panel-toggle.is-fast')).toBeNull()
  })

  it('lists long catalogs by provider, expands the current one and filters across all', async () => {
    const onModel = vi.fn()
    const groups = [
      { providerId: 'alpha', label: 'Alpha', modelIds: numbered('alpha', 9) },
      { providerId: 'beta', label: 'Beta', modelIds: numbered('beta', 9) }
    ]
    const trigger = await renderPicker({ composerModel: 'beta-2', composerProviderId: 'beta', composerModelGroups: groups, onComposerModelChange: onModel })
    await act(async () => trigger.click())
    const rows = (): string[] => [...document.querySelectorAll('[role="menuitemradio"]')].map((row) => row.textContent ?? '')
    expect(rows()).toEqual(numbered('beta', 9))
    const alpha = document.querySelector<HTMLButtonElement>('[data-model-provider="alpha"] button[aria-expanded]')!
    expect(alpha.getAttribute('aria-expanded')).toBe('false')
    expect(alpha.textContent).toContain('9')
    await act(async () => alpha.click())
    expect(rows()).toHaveLength(18)
    await act(async () => alpha.click())

    const search = document.querySelector<HTMLInputElement>('[data-composer-model-panel] input[type="search"]')!
    expect(document.activeElement).toBe(search)
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(search, '-7')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(rows()).toEqual(['alpha-7', 'beta-7'])
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')][0]!.click())
    expect(onModel).toHaveBeenCalledWith('alpha-7', 'alpha')
    expect(panel()).toBeNull()
    expect(initialExpandedModelGroups(groups.slice(0, 1), null)).toEqual(new Set(['alpha']))
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const trigger = await renderPicker({})
    await act(async () => trigger.click())
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('offers provider settings at the bottom of the panel', async () => {
    const onConfigure = vi.fn()
    const opened = await renderPicker({ onConfigureProviders: onConfigure })
    await act(async () => opened.click())
    await act(async () => buttonWithText('Open provider settings')!.click())
    expect(onConfigure).toHaveBeenCalled()
    expect(panel()).toBeNull()
  })
})
