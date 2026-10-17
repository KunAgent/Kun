// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdeHarnessModels } from '@shared/ade-harnesses'
import i18n from '../../i18n'
import { AgentSettingsModelPicker } from './AgentSettingsModelPicker'
import { AgentSettingsSelect } from './AgentSettingsSelect'

const models: NonNullable<AdeHarnessModels['modelInfo']> = [
  { id: 'swe-2-high', displayName: 'SWE-2', inputModalities: ['text', 'image'] },
  { id: 'claude-opus-5-5-medium', displayName: 'Claude Opus 5.5' },
  { id: 'fusion-gpt-6-astra-high-sidekick-swe-2-medium', displayName: 'Fusion (GPT-6 Astra High Thinking + SWE-2 Medium)', category: 'fusion' }
]
let host: HTMLDivElement, root: Root
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  await i18n.changeLanguage('en')
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function click(selector: string) { await act(async () => document.querySelector<HTMLButtonElement>(selector)!.click()) }
async function input(selector: string, value: string) {
  const field = document.querySelector<HTMLInputElement>(selector)!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function render(value = '', overrides: Record<string, unknown> = {}) {
  const onChange = vi.fn(), onLoad = vi.fn()
  await act(async () => root.render(createElement(AgentSettingsModelPicker, {
    harnessId: 'devin', native: true, value, modelIds: models.map((model) => model.id), modelInfo: models,
    onChange, onLoad, ...overrides
  })))
  return { onChange, onLoad }
}

describe('Agent settings model picker', () => {
  it('does not re-save or invalidate readiness when the selected model is picked again', async () => {
    const { onChange } = await render('swe-2-high')
    await click('[data-agent-profile-model]'); await click('[data-devin-model="swe-2-high"]')
    expect(onChange).not.toHaveBeenCalled()
  })
  it('preserves the search entered while native model metadata is loading', async () => {
    await render('', { modelIds: [], modelInfo: [], loading: true })
    await click('[data-agent-profile-model]'); await input('[data-devin-model-list] input', 'Claude')
    await render()
    expect(document.querySelector<HTMLInputElement>('[data-devin-model-list] input')?.value).toBe('Claude')
    expect(document.querySelectorAll('[data-devin-model]')).toHaveLength(1)
  })
  it('reuses Devin names, brand icons and Fusion groups instead of native datalist options', async () => {
    const { onChange, onLoad } = await render('swe-2-high')
    expect(host.textContent).toContain('SWE-2')
    expect(host.textContent).not.toContain('swe-2-high')
    expect(onLoad).not.toHaveBeenCalled()
    await click('[data-agent-profile-model]')
    expect(onLoad).toHaveBeenCalledOnce()
    expect(document.querySelector('datalist')).toBeNull()
    expect(document.querySelector('[data-agent-settings-model-menu]')?.parentElement).toBe(document.body)
    expect(document.querySelector('[data-devin-model="claude-opus-5-5-medium"] [data-provider-icon]')).not.toBeNull()
    expect(document.querySelector('[data-devin-model^="fusion-"]')).toBeNull()
    await click('[data-devin-model-category="fusion"]')
    expect(document.querySelector('[data-devin-model^="fusion-"]')?.textContent).toContain('SWE-2 Medium')
    await click('[data-devin-model^="fusion-"]')
    expect(onChange).toHaveBeenCalledExactlyOnceWith(models[2].id)
    expect(document.querySelector('[data-agent-settings-model-menu]')).toBeNull()
    expect(document.activeElement).toBe(host.querySelector('[data-agent-profile-model]'))
  })
  it('searches friendly names across categories and restores the Agent default', async () => {
    const { onChange } = await render('swe-2-high')
    await click('[data-agent-profile-model]'); await input('[data-devin-model-list] input', 'GPT-6 Astra')
    expect(document.querySelectorAll('[data-devin-model]')).toHaveLength(1)
    await click('[data-agent-default-model]')
    expect(onChange).toHaveBeenCalledWith('')
  })
  it('commits a custom model only on explicit submit, and Escape leaves the saved value unchanged', async () => {
    const { onChange } = await render()
    await click('[data-agent-profile-model]'); await click('[data-agent-custom-model]')
    await input('[data-agent-custom-model-input]', '  vendor/custom-id  ')
    expect(onChange).not.toHaveBeenCalled()
    await click('[data-agent-custom-model-apply]')
    expect(onChange).toHaveBeenCalledWith('vendor/custom-id')
    onChange.mockClear(); await click('[data-agent-profile-model]')
    await act(async () => document.querySelector('[data-agent-settings-model-menu]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(onChange).not.toHaveBeenCalled(); expect(document.querySelector('[data-agent-settings-model-menu]')).toBeNull()
  })
  it('supports generic Agent labels, filtering, loading and retry without replacing the model id', async () => {
    const { onChange, onLoad } = await render('', { harnessId: 'opencode2', loading: true, error: 'fixture failure' })
    await click('[data-agent-profile-model]')
    expect(document.querySelector('[role="status"]')).toBeTruthy()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Retry')
    await input('[data-agent-settings-model-menu] input[type="search"]', 'Claude Opus')
    expect(document.querySelectorAll('[data-agent-model-option]')).toHaveLength(1)
    await click('[data-agent-model-option="claude-opus-5-5-medium"]')
    expect(onChange).toHaveBeenCalledWith('claude-opus-5-5-medium'); expect(onLoad).toHaveBeenCalledOnce()
  })
})

it('uses themed keyboard-accessible popovers for profile and permission choices', async () => {
  const onChange = vi.fn()
  await act(async () => root.render(createElement(AgentSettingsSelect, { label: 'Connection', value: 'native', onChange,
    marker: 'data-agent-profile-mode', options: [{ value: 'native', label: 'Native sign-in' }, { value: 'gateway', label: 'Kun gateway' }] })))
  await click('[data-agent-profile-mode]')
  expect(document.querySelector('select')).toBeNull()
  await click('[data-agent-setting-option="native"]')
  expect(onChange).not.toHaveBeenCalled()
  await click('[data-agent-profile-mode]')
  // Opening focuses the selected option on the next frame; let that land before moving focus.
  await act(async () => { await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))) })
  const first = document.querySelector<HTMLButtonElement>('[data-agent-setting-option="native"]')!
  first.focus()
  await act(async () => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  expect(document.activeElement?.textContent).toContain('Kun gateway')
  await click('[data-agent-setting-option="gateway"]')
  expect(onChange).toHaveBeenCalledWith('gateway')
  expect(document.querySelector('[data-agent-settings-listbox]')).toBeNull()
})

describe('Agent settings model picker with Agent option groups', () => {
  const route = (name: string, model: string) => `["${name}","${model}"]`
  const grouped: NonNullable<AdeHarnessModels['modelInfo']> = [
    { id: route('deepseek-official', 'deepseek-flash'), displayName: 'DeepSeek-V4.1-Flash', group: 'DeepSeek' },
    { id: route('deepseek-official', 'deepseek-v4-pro'), displayName: 'DeepSeek-V4-Pro', group: 'DeepSeek' },
    { id: route('deepseek-account', 'deepseek-flash'), displayName: 'DeepSeek-V4.1-Flash', group: 'DeepSeek Account' },
    { id: route('deepseek-account', 'deepseek-v4-pro'), displayName: 'DeepSeek-V4-Pro', group: 'DeepSeek Account' }
  ]
  const open = (value = '') => render(value, { harnessId: 'deepseek-harness', modelIds: grouped.map((model) => model.id), modelInfo: grouped })
  const headings = () => [...document.querySelectorAll('[data-agent-model-group]')].map((node) => node.getAttribute('aria-label'))

  it('files same-named models under their group and marks the selected route', async () => {
    const { onChange } = await open(grouped[2]!.id)
    await click('[data-agent-profile-model]')
    expect(headings()).toEqual(['DeepSeek', 'DeepSeek Account'])
    expect([...document.querySelectorAll('[data-agent-model-option]')].map((row) => row.textContent))
      .toEqual(['DeepSeek-V4.1-Flash', 'DeepSeek-V4-Pro', 'DeepSeek-V4.1-Flash', 'DeepSeek-V4-Pro'])
    const selected = document.querySelectorAll('[data-agent-model-option][aria-checked="true"]')
    expect(selected).toHaveLength(1)
    expect(selected[0]!.closest('[data-agent-model-group]')?.getAttribute('aria-label')).toBe('DeepSeek Account')
    await click(`[data-agent-model-option='${grouped[1]!.id}']`)
    expect(onChange).toHaveBeenCalledExactlyOnceWith(grouped[1]!.id)
  })
  it('keeps the heading of a group while a search narrows the list to it', async () => {
    await open()
    await click('[data-agent-profile-model]')
    await input('[data-agent-settings-model-menu] input[type="search"]', 'account')
    expect(headings()).toEqual(['DeepSeek Account'])
    expect(document.querySelectorAll('[data-agent-model-option]')).toHaveLength(2)
  })
  it('stays a flat list for a single group', async () => {
    await render('', { harnessId: 'deepseek-harness', modelIds: [grouped[0]!.id, grouped[1]!.id], modelInfo: grouped.slice(0, 2) })
    await click('[data-agent-profile-model]')
    expect(headings()).toEqual([])
    expect(document.querySelectorAll('[data-agent-model-option]')).toHaveLength(2)
  })
})
