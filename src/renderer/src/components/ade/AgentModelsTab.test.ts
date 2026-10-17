// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdeHarnessModels, AdeHarnessRow } from '@shared/ade-harnesses'
import type { KunHarnessDefaultsEntryV1, KunHarnessEnabledProfileV1 } from '@shared/app-settings'
import { useHarnessStore } from '../../store/harness-store'
import { AgentModelsTab } from './AgentModelsTab'

const HARNESS_ID = 'deepseek-harness'
const route = (name: string, model: string) => `["${name}","${model}"]`
const grouped: NonNullable<AdeHarnessModels['modelInfo']> = [
  { id: route('deepseek-official', 'deepseek-flash'), displayName: 'DeepSeek-V4.1-Flash', group: 'DeepSeek' },
  { id: route('deepseek-official', 'deepseek-v4-pro'), displayName: 'DeepSeek-V4-Pro', group: 'DeepSeek' },
  { id: route('deepseek-account', 'deepseek-flash'), displayName: 'DeepSeek-V4.1-Flash', group: 'DeepSeek Account' }
]
const row = { definition: { id: HARNESS_ID, displayName: 'DeepSeek Harness', staticModels: [] } } as unknown as AdeHarnessRow
const profile = { credentialMode: 'native-login' } as KunHarnessEnabledProfileV1

let host: HTMLDivElement, rootNode: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); rootNode = createRoot(host)
})
afterEach(async () => { await act(async () => rootNode.unmount()); host.remove(); vi.unstubAllGlobals() })

async function mount(modelInfo: NonNullable<AdeHarnessModels['modelInfo']>, entry: KunHarnessDefaultsEntryV1 = {} as KunHarnessDefaultsEntryV1) {
  useHarnessStore.setState({ models: { [HARNESS_ID]: { loading: false, models: modelInfo.map((model) => model.id), modelInfo } }, providerGroups: {} })
  const onChange = vi.fn()
  await act(async () => rootNode.render(createElement(AgentModelsTab, { row, entry, profile, dirty: false, busy: false,
    onChange, onDiscard: vi.fn(), onRecheck: vi.fn(), t: (key: string) => key })))
  return { onChange }
}
const headings = () => [...document.querySelectorAll('[data-agent-model-group]')].map((node) => node.getAttribute('aria-label'))
const search = async (value: string) => {
  const field = host.querySelector<HTMLInputElement>('[data-agent-models-search]')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })) })
}

describe('Agent models tab with Agent option groups', () => {
  it('lists each group under its own heading and picks the exact route', async () => {
    const { onChange } = await mount(grouped, { model: grouped[2]!.id } as KunHarnessDefaultsEntryV1)
    expect(headings()).toEqual(['DeepSeek', 'DeepSeek Account'])
    const rowFor = (id: string) => host.querySelector<HTMLElement>(`[data-agent-model-row='${id}']`)!
    expect(rowFor(grouped[0]!.id).closest('[data-agent-model-group]')?.getAttribute('aria-label')).toBe('DeepSeek')
    expect(rowFor(grouped[2]!.id).closest('[data-agent-model-group]')?.getAttribute('aria-label')).toBe('DeepSeek Account')
    expect(rowFor(grouped[2]!.id).textContent).toContain('agentCenter.models.current')
    await act(async () => rowFor(grouped[1]!.id).querySelector('button')!.click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ model: grouped[1]!.id })
  })
  it('keeps the headings of the groups a search leaves', async () => {
    await mount(grouped)
    await search('account')
    expect(headings()).toEqual(['DeepSeek Account'])
    expect(host.querySelectorAll('[data-agent-model-row]')).toHaveLength(1)
  })
  it('stays a flat list when the Agent reports no groups', async () => {
    await mount(grouped.map(({ group: _group, ...model }) => model))
    expect(headings()).toEqual([])
    expect(host.querySelectorAll('[data-agent-model-row]')).toHaveLength(3)
  })
})
