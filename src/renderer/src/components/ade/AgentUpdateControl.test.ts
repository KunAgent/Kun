// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { HarnessUpdateState } from '../../../../../kun/src/contracts/harness-update'
const f = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../../agent/runtime-client', () => ({ rendererRuntimeClient: { runtimeRequest: f.request } }))
vi.mock('../../store/harness-store', () => ({ loadHarnesses: vi.fn(), loadHarnessModels: vi.fn(), invalidateHarnessModels: vi.fn(),
  applyHarnessEnablementSettings: vi.fn(), harnessIdsWithChangedLaunchSettings: () => [], useHarnessStore: { getState: () => ({ rows: [] }) } }))
vi.mock('./agent-enablement-settings', () => ({ waitForAgentSettings: vi.fn(async () => undefined) }))
vi.mock('../../store/chat-store', () => ({ useChatStore: { getState: () => ({ openSettings: vi.fn() }) } }))
vi.mock('./AgentUpdateHelpButton', () => ({ AgentUpdateHelpButton: ({ request }: { request: unknown }) =>
  createElement('div', { 'data-ask-kun-update': JSON.stringify(request) }) }))
vi.mock('./AgentSetupHelpButton', () => ({ AgentSetupHelpButton: ({ issue }: { issue: unknown }) =>
  createElement('div', { 'data-ask-kun-issue': JSON.stringify(issue) }) }))
import { AgentUpdateControl } from './AgentUpdateControl'
import { receiveHarnessUpdate, useHarnessUpdateStore } from '../../store/harness-update-store'
import { resetAgentUpdateRunner, useAgentUpdateRunner } from '../../store/harness-update-runner'

const row = { definition: { id: 'claude-code' }, status: { installed: 'yes', resolvedCommand: '/old' } } as AdeHarnessRow
const initial: HarnessUpdateState = { harnessId: 'claude-code', current: { path: '/old', source: 'kun-bundled', version: '2.1.220', fingerprint: 'old' },
  status: 'available', latestVersion: '2.1.281', channel: 'latest', canUpdate: true, canInstallManaged: true }
const t = (key: string, options?: Record<string, unknown>): string => options?.version ? `${key}:${options.version}` : key
let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  vi.clearAllMocks(); vi.unstubAllGlobals()
  resetAgentUpdateRunner()
  useHarnessUpdateStore.setState({ entries: {} })
})
const render = () => act(async () => root.render(createElement(AgentUpdateControl, { row, t })))
const button = (selector: string) => host.querySelector<HTMLButtonElement>(selector)

it('replaces the offer with the steps the moment the update is clicked', async () => {
  receiveHarnessUpdate(initial)
  let release: (value: unknown) => void = () => undefined
  f.request.mockImplementation((path: string) => String(path).endsWith('/start')
    ? new Promise((resolve) => { release = resolve }) : Promise.resolve({ ok: true, status: 200, body: JSON.stringify(initial) }))
  await render()
  expect(button('[data-agent-update-start]')?.textContent).toBe('agentUpdate.updateTo:2.1.281')
  await act(async () => button('[data-agent-update-start]')!.click())
  // The runtime has not answered yet, and the page already shows the work.
  expect(host.querySelector('[data-agent-update-available]')).toBeNull()
  expect(host.querySelector('[data-agent-update-run="starting"]')).not.toBeNull()
  expect(host.querySelector('[data-agent-update-step="wait"]')?.getAttribute('data-state')).toBe('active')
  expect(host.textContent).toContain('agentCenter.activity.leaveHint')
  await act(async () => release({ ok: true, status: 200, body: JSON.stringify({ ...initial, job: { id: 'run', action: 'update', status: 'running',
    startedAt: new Date().toISOString(), output: 'Updating to 2.1.281...\n' } }) }))
  expect(host.querySelector('[data-agent-update-step="install"]')?.getAttribute('data-state')).toBe('active')
  expect(host.querySelector('[data-agent-update-last-line]')?.textContent).toBe('Updating to 2.1.281...')
  expect(host.querySelector('details')?.open).toBe(true)
})

it('offers a retry and 小 Kun with versions, error and installer log when an update fails', async () => {
  const failed: HarnessUpdateState = { ...initial, job: { id: 'failed-update', action: 'update', status: 'failed', startedAt: '',
    output: 'npm warn cleanup EACCES', error: 'Agent compatibility verification failed; the current selection was kept', version: '2.1.281' } }
  f.request.mockResolvedValue({ ok: true, status: 200, body: JSON.stringify(failed) })
  receiveHarnessUpdate(failed)
  await render()
  expect(useAgentUpdateRunner.getState().items['claude-code']?.phase).toBe('failed')
  expect(host.querySelector('[data-agent-update-error]')?.textContent).toBe('Agent compatibility verification failed; the current selection was kept')
  expect(button('[data-agent-update-retry]')).not.toBeNull()
  expect(JSON.parse(host.querySelector('[data-ask-kun-issue]')!.getAttribute('data-ask-kun-issue')!)).toEqual({
    harnessId: 'claude-code', operation: 'update', error: 'Agent compatibility verification failed; the current selection was kept',
    output: 'npm warn cleanup EACCES', currentVersion: '2.1.220', currentPath: '/old', targetVersion: '2.1.281'
  })
})

it('disables actions while a status check may replace the installation they were offered for', async () => {
  receiveHarnessUpdate(initial)
  f.request.mockResolvedValue({ ok: true, status: 200, body: JSON.stringify(initial) })
  await render()
  await act(async () => useHarnessUpdateStore.setState({ entries: { 'claude-code': { info: initial, loading: true } } }))
  expect(button('[data-agent-update-start]')?.disabled).toBe(true)
  expect(button('[data-agent-update-check]')?.getAttribute('aria-busy')).toBe('true')
})

it('offers 小 Kun on the current-version row with what the card knows, except while updating or failed', async () => {
  receiveHarnessUpdate(initial)
  f.request.mockResolvedValue({ ok: true, status: 200, body: JSON.stringify(initial) })
  await render()
  expect(JSON.parse(host.querySelector('[data-ask-kun-update]')!.getAttribute('data-ask-kun-update')!)).toEqual({
    harnessId: 'claude-code', currentVersion: '2.1.220', currentPath: '/old', source: 'kun-bundled', latestVersion: '2.1.281'
  })

  await act(async () => useAgentUpdateRunner.setState({ items: { 'claude-code': { phase: 'failed', action: 'update', startedAt: 1, error: 'boom' } as never } }))
  expect(host.querySelector('[data-ask-kun-update]')).toBeNull()
  expect(host.querySelector('[data-ask-kun-issue]')).not.toBeNull()
})

it('has no 小 Kun update button when the Agent is already current', async () => {
  const current: HarnessUpdateState = { ...initial, status: 'current', canUpdate: false }
  receiveHarnessUpdate(current)
  f.request.mockResolvedValue({ ok: true, status: 200, body: JSON.stringify(current) })
  await render()
  expect(host.querySelector('[data-ask-kun-update]')).toBeNull()
})
