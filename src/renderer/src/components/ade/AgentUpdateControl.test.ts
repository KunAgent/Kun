// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { defaultKunHarnessSettings } from '@shared/app-settings-kun-harness'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { HarnessUpdateState } from '../../../../../kun/src/contracts/harness-update'
const f = vi.hoisted(() => ({ request: vi.fn(), load: vi.fn(), models: vi.fn(), invalidate: vi.fn(), wait: vi.fn(async () => undefined) }))
vi.mock('../../agent/runtime-client', () => ({ rendererRuntimeClient: { runtimeRequest: f.request } }))
vi.mock('../../store/harness-store', () => ({ loadHarnesses: f.load, loadHarnessModels: f.models, invalidateHarnessModels: f.invalidate }))
vi.mock('./agent-enablement-settings', () => ({ waitForAgentSettings: f.wait }))
vi.mock('../../store/chat-store', () => ({ useChatStore: { getState: () => ({ openSettings: vi.fn() }) } }))
vi.mock('./AgentSetupHelpButton', () => ({ AgentSetupHelpButton: ({ issue }: { issue: unknown }) =>
  createElement('div', { 'data-ask-kun-issue': JSON.stringify(issue) }) }))
import { AgentUpdateControl } from './AgentUpdateControl'
import { receiveHarnessUpdate, useHarnessUpdateStore } from '../../store/harness-update-store'
const row = { definition: { id: 'claude-code' }, status: { installed: 'yes', resolvedCommand: '/old' } } as AdeHarnessRow
const initial: HarnessUpdateState = { harnessId: 'claude-code', current: { path: '/old', source: 'kun-bundled', version: '2.1.220', fingerprint: 'old' },
  candidate: { path: '/new', source: 'native', version: '2.1.281', fingerprint: 'new' }, status: 'available', latestVersion: '2.1.281', channel: 'latest', canUpdate: false, canInstallManaged: true }
afterEach(() => { vi.clearAllMocks(); useHarnessUpdateStore.setState({ entries: {} }) })
it('shows the effective source and verifies the server activation plan before saving a new path', async () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  receiveHarnessUpdate(initial)
  const patch = vi.fn(), root = createRoot(document.createElement('div'))
  const ready: HarnessUpdateState = { ...initial, job: { id: 'job', action: 'use-local', status: 'ready', startedAt: '', output: '',
    previousPath: '/old', activationPath: '/new', activationFingerprint: 'new', version: '2.1.281' } }
  f.request.mockImplementation(async (path: string) => ({ ok: true, status: 200,
    body: JSON.stringify(path.endsWith('/activate') ? { ok: true } : ready) }))
  try {
    await act(async () => root.render(createElement(AgentUpdateControl, { row, settings: defaultKunHarnessSettings(), patch,
      beforeCheck: async () => true, t: (key: string) => key })))
    expect(patch).not.toHaveBeenCalled()
    await act(async () => receiveHarnessUpdate(ready))
    expect(patch).toHaveBeenCalledWith({ providers: { 'claude-code': { command: '/new' } } })
    expect(f.request.mock.calls[0][0]).toBe('/v1/harnesses/claude-code/updates')
    expect(f.request.mock.calls.some(([path]) => path.endsWith('/activate'))).toBe(true)
    expect(f.invalidate).toHaveBeenCalledWith('claude-code')
    expect(f.models).toHaveBeenCalledWith('claude-code', true)
  } finally { await act(async () => root.unmount()); (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false }
})
it('does not activate an installation on the basis of a stale update notice', async () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const patch = vi.fn(), root = createRoot(document.createElement('div'))
  f.request.mockResolvedValue({ ok: true, status: 200, body: JSON.stringify(initial) })
  receiveHarnessUpdate({ ...initial, job: { id: 'stale-job', action: 'use-local', status: 'ready', startedAt: '', output: '',
    previousPath: '/old', activationPath: '/unverified', activationFingerprint: 'fake' } })
  try {
    await act(async () => root.render(createElement(AgentUpdateControl, { row, settings: defaultKunHarnessSettings(), patch, t: (key: string) => key })))
    expect(patch.mock.calls.some(([value]) => value.providers?.['claude-code']?.command === '/unverified')).toBe(false)
  } finally { await act(async () => root.unmount()); (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false }
})
it('restores the prior effective executable and releases maintenance if activation loses account readiness', async () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const patch = vi.fn(), root = createRoot(document.createElement('div')), beforeCheck = vi.fn(async () => true)
  const ready: HarnessUpdateState = { ...initial, job: { id: 'failed-activation', action: 'use-local', status: 'ready', startedAt: '', output: '',
    previousPath: '/old', activationPath: '/new', activationFingerprint: 'new', version: '2.1.281' } }
  f.request.mockImplementation(async (path: string) => path.endsWith('/activate')
    ? { ok: false, status: 409, body: JSON.stringify({ message: 'Native account unavailable' }) }
    : { ok: true, status: 200, body: JSON.stringify(path.endsWith('/cancel') ? { ok: true } : ready) })
  receiveHarnessUpdate(ready)
  try {
    await act(async () => root.render(createElement(AgentUpdateControl, { row, settings: defaultKunHarnessSettings(), patch,
      beforeCheck, t: (key: string) => key })))
    expect(patch.mock.calls.map(([value]) => value.providers['claude-code']?.command)).toEqual(['/new', '/old'])
    expect(beforeCheck).toHaveBeenCalledTimes(2)
    expect(f.request.mock.calls.some(([path]) => path.endsWith('/cancel'))).toBe(true)
  } finally { await act(async () => root.unmount()); (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false }
})
it('offers 小 Kun with versions, error and installer log when an update fails', async () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div'), root = createRoot(host)
  const failed: HarnessUpdateState = { ...initial, job: { id: 'failed-update', action: 'update', status: 'failed', startedAt: '',
    output: 'npm warn cleanup EACCES', error: 'Agent compatibility verification failed; the current selection was kept', version: '2.1.281' } }
  f.request.mockResolvedValue({ ok: true, status: 200, body: JSON.stringify(failed) })
  receiveHarnessUpdate(failed)
  try {
    await act(async () => root.render(createElement(AgentUpdateControl, { row, settings: defaultKunHarnessSettings(), patch: vi.fn(), t: (key: string) => key })))
    expect(JSON.parse(host.querySelector('[data-ask-kun-issue]')!.getAttribute('data-ask-kun-issue')!)).toEqual({
      harnessId: 'claude-code', operation: 'update', error: 'Agent compatibility verification failed; the current selection was kept',
      output: 'npm warn cleanup EACCES', currentVersion: '2.1.220', currentPath: '/old', targetVersion: '2.1.281'
    })
  } finally { await act(async () => root.unmount()); (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false }
})
it('re-checks and explains a changed installation instead of showing the bare mismatch', async () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div'), root = createRoot(host)
  const moved: HarnessUpdateState = { ...initial, current: { ...initial.current, fingerprint: 'moved' } }
  f.request.mockImplementation(async (path: string) => path.endsWith('/start')
    ? { ok: false, status: 409, body: JSON.stringify({ message: 'Agent installation changed; check updates again' }) }
    : { ok: true, status: 200, body: JSON.stringify(moved) })
  receiveHarnessUpdate(initial)
  // The re-check runs only inside the app shell.
  Object.assign(window, { kunGui: { runtimeRequest: vi.fn() } })
  try {
    await act(async () => root.render(createElement(AgentUpdateControl, { row, settings: defaultKunHarnessSettings(), patch: vi.fn(),
      beforeCheck: async () => true, t: (key: string) => key })))
    const managed = () => [...host.querySelectorAll('button')].find((button) => button.textContent === 'agentUpdate.managed')!
    // A check in flight may replace the installation the action was offered for.
    await act(async () => useHarnessUpdateStore.setState({ entries: { 'claude-code': { info: initial, loading: true } } }))
    expect(managed().disabled).toBe(true)
    await act(async () => useHarnessUpdateStore.setState({ entries: { 'claude-code': { info: initial, loading: false, checkedAt: Date.now() } } }))
    await act(async () => managed().click())
    const start = f.request.mock.calls.find(([path]) => path.endsWith('/start'))!
    expect(JSON.parse(start[2])).toMatchObject({ action: 'managed', expectedFingerprint: 'old' })
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toBe('agentUpdate.installationChanged'))
    expect(useHarnessUpdateStore.getState().entries['claude-code']?.info?.current.fingerprint).toBe('moved')
  } finally { delete (window as { kunGui?: unknown }).kunGui; await act(async () => root.unmount()); (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false }
})
