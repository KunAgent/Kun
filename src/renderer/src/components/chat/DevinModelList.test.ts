// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { DevinModelList } from './DevinModelList'
import { readDevinRecentModels } from './devin-model-presentation'
import type { ComposerModelMenuGroup } from './floating-composer-model-picker-logic'

const group: ComposerModelMenuGroup = { providerId: 'ade-cred:native-login', label: 'Native sign-in', nativeHarnessId: 'devin',
  modelIds: ['swe-2-high', 'claude-opus-medium', 'fusion-gpt-high-sidekick-swe-medium'], modelInfo: {
    'swe-2-high': { id: 'swe-2-high', displayName: 'SWE-2', inputModalities: ['text', 'image'], reasoningEfforts: ['medium', 'high', 'max'] },
    'claude-opus-medium': { id: 'claude-opus-medium', displayName: 'Claude Opus', inputModalities: ['text', 'image'] },
    'fusion-gpt-high-sidekick-swe-medium': { id: 'fusion-gpt-high-sidekick-swe-medium', displayName: 'Fusion (GPT-6 High Thinking + SWE-2 Medium)', category: 'fusion' }
  } }
let host: HTMLDivElement, root: Root
const storageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await i18n.changeLanguage('en')
  const storage = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value), clear: () => storage.clear() } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); if (storageDescriptor) Object.defineProperty(window, 'localStorage', storageDescriptor) })
async function render(onPick = vi.fn(), onReasoningChange = vi.fn()) {
  await act(async () => root.render(createElement(DevinModelList, { group, currentModel: 'swe-2-high', currentReasoning: 'high',
    reasoningOptions: [{ id: 'high', labelKey: 'composerReasoningHigh' }, { id: 'max', labelKey: 'composerReasoningMax' }],
    onReasoningChange, onPick, t: i18n.t.bind(i18n), maxHeight: 440 })))
  return { onPick, onReasoningChange }
}

it('shows native names and brands while keeping Fusion combinations out of the ordinary model list', async () => {
  await render()
  const rows = [...host.querySelectorAll('[data-devin-model]')]
  expect(rows.map((row) => row.textContent)).toEqual(['SWE-2', 'Claude Opus'])
  expect(rows[0].querySelector('[data-agent-icon="devin"]')).toBeTruthy()
  expect(host.textContent).not.toContain('swe-2-high')
  expect(host.querySelectorAll('select option')).toHaveLength(2)
  expect(host.textContent).toContain('Vision')
})

it('shows both Fusion partners and submits the exact native ID', async () => {
  const { onPick } = await render()
  await act(async () => host.querySelector<HTMLButtonElement>('[data-devin-model-category="fusion"]')!.click())
  const row = host.querySelector<HTMLButtonElement>('[data-devin-model]')!
  expect(row.textContent).toContain('GPT-6 High Thinking')
  expect(row.textContent).toContain('SWE-2 Medium')
  await act(async () => row.click())
  expect(onPick).toHaveBeenCalledWith('fusion-gpt-high-sidekick-swe-medium')
  expect(readDevinRecentModels()[0]).toBe('fusion-gpt-high-sidekick-swe-medium')
})

it('searches native labels across both categories', async () => {
  await render()
  const input = host.querySelector<HTMLInputElement>('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'GPT-6 High Thinking')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(host.querySelectorAll('[data-devin-model]')).toHaveLength(1)
  expect(host.querySelector('[data-devin-model]')?.getAttribute('data-devin-model')).toMatch(/^fusion-/)
})
