// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { KunRuntimeSettingsV1 } from '@shared/app-settings'
import { defaultKunHarnessSettings } from '@shared/app-settings-kun-harness'
const f = vi.hoisted(() => ({ rows: Array.from({ length: 43 }, (_, index) => {
  const id = index === 0 ? 'kun' : index === 4 ? 'gemini-cli' : `agent-${index}`
  return { definition: { id, displayName: id, transport: index === 0 ? 'native-loop' : index % 3 === 0 ? 'application' : index % 3 === 1 ? 'terminal' : 'acp',
    credentialModes: ['native-login'], permissionModes: [], modelSource: 'static', staticModels: [], builtin: true },
  status: { harnessId: id, installed: 'yes', login: 'unknown', checkedAt: '' } }
}) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../store/harness-store', () => ({
  useHarnessStore: (select: (state: unknown) => unknown) => select({ rows: f.rows, rowsLoading: false, rowsError: null }),
  loadHarnesses: vi.fn(), applyHarnessEnablementSettings: vi.fn(),
  harnessUnavailableLabelKey: (key: string) => key,
  harnessRowUnavailableCode: () => 'readiness_required'
}))
vi.mock('../../agent/registry', () => ({ getProvider: () => ({}) }))
vi.mock('../agent-icon', () => ({ AgentIcon: () => null }))
vi.mock('./AgentCenterCard', () => ({ AgentCenterCard: ({ row }: { row: { definition: { id: string } } }) =>
  createElement('div', { 'data-agent-card': row.definition.id }) }))
vi.mock('./agent-center-custom-form', () => ({ exportCustomEntry: vi.fn() }))
vi.mock('./agent-center-add-wizard', () => ({ AgentCenterAddWizard: () => null }))
import { AgentCenter } from './AgentCenter'
it('preserves selection and saved ordering while filtering the complete catalog', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div'), root = createRoot(container)
  const settings = { ...defaultKunHarnessSettings(), agentOrder: ['agent-11', 'kun', 'agent-3'] }
  try {
    await act(async () => root.render(createElement(AgentCenter, {
      kun: { harnesses: settings } as KunRuntimeSettingsV1, updateKun: vi.fn()
    })))
    const ids = () => [...container.querySelectorAll('[data-agent-list-id]')].map((element) => element.getAttribute('data-agent-list-id'))
    expect(ids()).toHaveLength(43)
    expect(ids().slice(0, 3)).toEqual(['agent-11', 'kun', 'agent-3'])
    expect(ids()).toContain('gemini-cli')
    await act(async () => container.querySelector<HTMLButtonElement>('[data-agent-list-id="agent-11"]')!.click())
    expect(container.querySelector('[data-agent-card]')?.getAttribute('data-agent-card')).toBe('agent-11')
    await act(async () => container.querySelector<HTMLButtonElement>('[data-agent-catalog-filter="application"]')!.click())
    expect(ids()).not.toContain('agent-11')
    expect(container.querySelector('[data-agent-card]')?.getAttribute('data-agent-card')).toBe('agent-3')
    await act(async () => container.querySelector<HTMLButtonElement>('[data-agent-catalog-filter="all"]')!.click())
    expect(container.querySelector('[data-agent-card]')?.getAttribute('data-agent-card')).toBe('agent-11')
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals() }
})
