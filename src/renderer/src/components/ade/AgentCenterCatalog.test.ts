// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { defaultKunHarnessSettings } from '@shared/app-settings-kun-harness'
vi.mock('../agent-icon', () => ({ AgentIcon: () => null }))
import { AgentCatalogControls, AgentCatalogRail } from './AgentCenterCatalog'

const rows: AdeHarnessRow[] = Array.from({ length: 43 }, (_, index) => ({
  definition: { id: `agent-${index}`, displayName: `Agent ${index}`, transport: index % 3 === 0 ? 'application' : index % 3 === 1 ? 'terminal' : 'acp',
    credentialModes: ['native-login'], permissionModes: [], modelSource: 'static', staticModels: [], builtin: true },
  status: { harnessId: `agent-${index}`, installed: 'yes', login: 'unknown', checkedAt: '' }
}))
const t = (key: string): string => key
let root: Root, container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })
it('keeps a large catalog in a scrollable rail and supports arrow and end/home keyboard selection', async () => {
  function Page() {
    const [selectedId, setSelectedId] = useState('agent-0')
    return createElement(AgentCatalogRail, { rows, selectedId, settings: defaultKunHarnessSettings(),
      platform: 'darwin', onSelect: setSelectedId, t, tSettings: t })
  }
  await act(async () => root.render(createElement(Page)))
  const rail = container.querySelector('[data-agent-catalog-rail]')!
  expect(rail.className).toContain('overflow-y-auto')
  expect(rail.className).toContain('max-h-')
  expect(container.querySelectorAll('[role="option"]')).toHaveLength(43)
  const first = container.querySelector<HTMLButtonElement>('[data-agent-list-id="agent-0"]')!
  first.focus()
  await act(async () => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  expect(document.activeElement?.getAttribute('data-agent-list-id')).toBe('agent-1')
  expect(container.querySelector('[aria-selected="true"]')?.getAttribute('data-agent-list-id')).toBe('agent-1')
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
  expect(document.activeElement?.getAttribute('data-agent-list-id')).toBe('agent-42')
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })))
  expect(document.activeElement?.getAttribute('data-agent-list-id')).toBe('agent-0')
  expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1)
})
it('exposes labeled search and ordinary keyboard accessible filter buttons', async () => {
  const filter = vi.fn(), search = vi.fn()
  await act(async () => root.render(createElement(AgentCatalogControls, {
    filter: 'application', search: 'editor', onFilter: filter, onSearch: search, t
  })))
  expect(container.querySelector<HTMLInputElement>('input')?.getAttribute('aria-label')).toBe('agentIntegrations.search')
  expect(container.querySelector('[data-agent-catalog-filter="application"]')?.getAttribute('aria-pressed')).toBe('true')
  await act(async () => container.querySelector<HTMLButtonElement>('[data-agent-catalog-filter="terminal"]')!.click())
  expect(filter).toHaveBeenCalledWith('terminal')
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="agentIntegrations.clearSearch"]')!.click())
  expect(search).toHaveBeenCalledWith('')
})
