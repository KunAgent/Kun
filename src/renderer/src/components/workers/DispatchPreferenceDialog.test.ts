// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { AdeDispatchPreferenceRule } from '@shared/ade-collaboration-settings'
import i18n from '../../i18n'
import { useHarnessStore } from '../../store/harness-store'
import { DispatchPreferenceDialog } from './DispatchPreferenceDialog'

vi.mock('../../store/chat-store', () => ({ useChatStore: (select: (state: unknown) => unknown) =>
  select({ composerModelGroups: [{ providerId: 'deepseek', label: 'DeepSeek', modelIds: ['small-model'], kind: 'http' }] }) }))
vi.mock('../../store/agent-roster-store', () => ({ useAgentRoster: () => ({ entries: [] }) }))
vi.mock('../../lib/harness-defaults', () => ({ harnessDefaultsSnapshot: () => ({}) }))
vi.mock('../../lib/harness-connection-presentation', () => ({ harnessConnectionPresentation: () => ({ code: null }), usesProviderOnlySdk: () => false }))
vi.mock('../../store/harness-store', async (original) => ({
  ...await original<typeof import('../../store/harness-store')>(),
  loadHarnesses: vi.fn(), loadHarnessModels: vi.fn(), loadHarnessProviderGroups: vi.fn(),
  harnessRowUnavailableCode: () => null, harnessRowAvailable: () => true
}))
function row(id: string): AdeHarnessRow {
  return { definition: { id, displayName: id, transport: id === 'kun' ? 'native-loop' : 'acp',
    credentialModes: ['native-login'], permissionModes: [], modelSource: 'probe', staticModels: [], builtin: true },
    status: { harnessId: id, installed: 'yes', login: 'signed-in', ready: 'yes', checkedAt: '2026-01-01T00:00:00Z' }
  } as unknown as AdeHarnessRow
}
let host: HTMLDivElement, root: Root
const saved = vi.fn()
function Harness() {
  const [rules, setRules] = useState<AdeDispatchPreferenceRule[]>([{ id: 'one', scenario: 'Review code', agentId: 'kun', enabled: true }])
  return createElement(DispatchPreferenceDialog, { preferences: rules, notes: '', onNotesChange: () => {},
    onPreferencesChange: setRules, saving: false, dirty: true, message: null, onClose: () => {}, onSave: () => saved(rules) })
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  await i18n.changeLanguage('en')
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); saved.mockReset()
  useHarnessStore.setState({ rows: [row('kun'), row('codex')], models: {}, providerGroups: {} })
  await act(async () => { root.render(createElement(Harness)) })
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function click(selector: string): Promise<void> {
  await act(async () => { document.querySelector<HTMLButtonElement>(selector)!.click() })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)) })
}
describe('preference dialog with real route pickers', () => {
  it('owns Agent menus and saves the selected Agent before or without model discovery', async () => {
    const modal = document.querySelector('[aria-modal="true"]')!
    await click('[data-composer-harness-picker]')
    const menu = document.querySelector('[data-harness-picker-menu]')!
    expect(modal.contains(menu)).toBe(true)
    expect(menu.contains(document.activeElement)).toBe(true)
    await click('[data-harness-id="codex"]')
    await click('[data-dispatch-preference-save]')
    expect(saved).toHaveBeenLastCalledWith([expect.objectContaining({ agentId: 'codex', model: undefined })])
    await act(async () => { useHarnessStore.setState({ models: { codex: { models: [], loading: false } } }) })
    await click('[data-dispatch-preference-save]')
    expect(saved).toHaveBeenLastCalledWith([expect.objectContaining({ agentId: 'codex', model: undefined })])
    expect(document.querySelector('[data-dispatch-route-picker]')?.getAttribute('data-dispatch-route-picker')).toBe('codex')
  })
  it('owns a small model menu, focuses an option, and keeps Escape within the picker', async () => {
    const modal = document.querySelector('[aria-modal="true"]')!
    await click('[data-composer-model-trigger]')
    const panel = document.querySelector('[data-composer-model-panel]')!
    expect(modal.contains(panel)).toBe(true)
    expect(panel.contains(document.activeElement)).toBe(true)
    expect(document.activeElement?.getAttribute('role')).toBe('menuitemradio')
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(document.querySelector('[data-composer-model-panel]')).toBeNull()
    expect(document.activeElement).toBe(document.querySelector('[data-composer-model-trigger]'))
    expect(document.querySelector('[aria-modal="true"]')).not.toBeNull()
    await click('[data-composer-model-trigger]')
    await click('[role="menuitemradio"]')
    await click('[data-dispatch-preference-save]')
    expect(saved).toHaveBeenLastCalledWith([expect.objectContaining({ agentId: 'kun', model: 'small-model', providerId: 'deepseek' })])
  })
})
