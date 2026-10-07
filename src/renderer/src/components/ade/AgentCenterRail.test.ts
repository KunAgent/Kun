// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
vi.mock('../agent-icon', () => ({ AgentIcon: () => null }))
import { AgentCenterRail } from './AgentCenterRail'
import { groupAgentCatalog, type AgentListEntry } from './agent-center-catalog'
import type { AgentGroup, AgentStateId } from './agent-center-presentation'

function entry(id: string, group: AgentGroup, state: AgentStateId = 'ready'): AgentListEntry {
  const row: AdeHarnessRow = { definition: { id, displayName: id.toUpperCase(), transport: 'acp', credentialModes: ['native-login'],
    permissionModes: [], modelSource: 'static', staticModels: [], builtin: true },
  status: { harnessId: id, installed: 'yes', login: 'unknown', checkedAt: '' } }
  return { row, presentation: { state, group, tone: 'success', switch: 'on', mode: 'manage', next: null,
    listLine: { key: `line.${id}` }, statusLine: { key: 'status' } } }
}

const t = (key: string, options?: Record<string, unknown>): string => options?.count !== undefined ? `${key}:${options.count}` : key
let root: Root, container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

const entries = [entry('a', 'connected'), entry('b', 'connected'), entry('c', 'connected', 'signedOut'),
  entry('d', 'available'), ...Array.from({ length: 6 }, (_, index) => entry(`n${index}`, 'notInstalled'))]

function Page({ onMove = vi.fn(), initialExpanded = false }: { onMove?: (id: string, index: number) => void; initialExpanded?: boolean }) {
  const [selectedId, setSelectedId] = useState('a')
  const [expanded, setExpanded] = useState(initialExpanded)
  return createElement(AgentCenterRail, { groups: groupAgentCatalog(entries, [], { search: '', expanded, selectedId }),
    selectedId, defaultId: 'a', search: '', expanded, onSearch: vi.fn(), onToggleExpanded: () => setExpanded((value) => !value),
    onSelect: setSelectedId, onMove, t })
}

it('renders three labelled groups with counts, the default chip and each Agent state', async () => {
  await act(async () => root.render(createElement(Page)))
  expect([...container.querySelectorAll('[data-agent-group]')].map((el) => el.getAttribute('data-agent-group')))
    .toEqual(['connected', 'available', 'notInstalled'])
  expect(container.querySelector('[data-agent-group="connected"]')?.getAttribute('aria-label')).toBe('agentCenter.group.connected')
  expect(container.querySelector('[data-agent-list-id="a"]')?.textContent).toContain('adeAgentAction.isDefault')
  expect(container.querySelector('[data-agent-list-id="c"]')?.getAttribute('data-agent-state')).toBe('signedOut')
  expect(container.querySelector('[data-agent-list-id="a"]')?.textContent).toContain('line.a')
})

it('folds the long not-installed group and expands it on request', async () => {
  await act(async () => root.render(createElement(Page)))
  const ids = () => [...container.querySelectorAll('[data-agent-group="notInstalled"] [data-agent-list-id]')].length
  expect(ids()).toBe(3)
  const toggle = container.querySelector<HTMLButtonElement>('[data-agent-group-toggle]')!
  expect(toggle.textContent).toBe('agentCenter.rail.showMore:3')
  await act(async () => toggle.click())
  expect(ids()).toBe(6)
  expect(container.querySelector('[data-agent-group-toggle]')?.textContent).toBe('agentCenter.rail.showLess')
})

it('selects with arrows, Home and End across groups', async () => {
  await act(async () => root.render(createElement(Page)))
  const first = container.querySelector<HTMLButtonElement>('[data-agent-list-id="a"]')!
  first.focus()
  await act(async () => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  expect(document.activeElement?.getAttribute('data-agent-list-id')).toBe('b')
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
  expect(document.activeElement?.getAttribute('data-agent-list-id')).toBe('n2')
  expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1)
})

it('reorders connected Agents with Alt+Arrow and announces the new position', async () => {
  const onMove = vi.fn()
  await act(async () => root.render(createElement(Page, { onMove })))
  const b = container.querySelector<HTMLButtonElement>('[data-agent-list-id="b"]')!
  await act(async () => b.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true })))
  expect(onMove).toHaveBeenCalledWith('b', 0)
  expect(container.querySelector('[role="status"]')?.textContent).toBe('agentCenter.rail.moved')
  // Agents outside the connected group cannot be reordered.
  const d = container.querySelector<HTMLButtonElement>('[data-agent-list-id="d"]')!
  onMove.mockClear()
  await act(async () => d.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true })))
  expect(onMove).not.toHaveBeenCalled()
  expect(d.getAttribute('draggable')).not.toBe('true')
  expect(b.getAttribute('draggable')).toBe('true')
})
