// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentInstallControl } from './AgentInstallControl'
import { harnessInstallRequest } from '../../agent/kun-harness-install-client'
import { loadHarnesses } from '../../store/harness-store'
import type { HarnessInstallState } from '../../../../../kun/src/contracts/harness-install'

vi.mock('../../agent/kun-harness-install-client', () => ({ harnessInstallRequest: vi.fn() }))
vi.mock('../../store/harness-store', () => ({ loadHarnesses: vi.fn(async () => undefined) }))
let root: Root
let host: HTMLDivElement
let state: HarnessInstallState
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  state = { plan: { action: 'install', command: 'official-installer', platform: 'darwin', available: true } }
  vi.mocked(harnessInstallRequest).mockImplementation(async (_id, _action, operation) => {
    if (operation === 'start') state = { ...state, job: { id: 'job-1', harnessId: 'devin', command: 'official-installer',
      status: 'running', output: '', startedAt: new Date().toISOString() } }
    return state
  })
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
})
const render = () => act(async () => root.render(createElement(AgentInstallControl, {
  harnessId: 'devin', action: 'install', needed: true, t: (key: string) => key
})))

it('loads a host plan without installing, then starts once and refreshes after verified completion', async () => {
  await render()
  expect(harnessInstallRequest).toHaveBeenCalledTimes(1)
  await act(async () => vi.advanceTimersByTimeAsync(5_000))
  expect(harnessInstallRequest).toHaveBeenCalledTimes(1)
  await act(async () => host.querySelector<HTMLButtonElement>('[data-agent-install-start]')!.click())
  expect(vi.mocked(harnessInstallRequest).mock.calls.filter((call) => call[2] === 'start')).toHaveLength(1)
  expect(host.textContent).toContain('agentInstall.running')
  state = { ...state, job: { ...state.job!, status: 'completed' } }
  await act(async () => vi.advanceTimersByTimeAsync(1_500))
  expect(host.textContent).toContain('agentInstall.completed')
  expect(loadHarnesses).toHaveBeenCalledWith(true, { waitMs: 3_000 })
  const count = vi.mocked(harnessInstallRequest).mock.calls.length
  await act(async () => vi.advanceTimersByTimeAsync(5_000))
  expect(harnessInstallRequest).toHaveBeenCalledTimes(count)
})

it('disables install when a prerequisite is missing', async () => {
  state.plan = { ...state.plan!, available: false, missingCommand: 'npm' }
  await render()
  expect(host.querySelector<HTMLButtonElement>('[data-agent-install-start]')!.disabled).toBe(true)
  expect(host.textContent).toContain('agentInstall.missingCommand')
})

it('shows a recoverable request failure instead of silently doing nothing', async () => {
  vi.mocked(harnessInstallRequest).mockRejectedValueOnce(new Error('connection interrupted'))
  await render()
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('connection interrupted')
  expect(host.textContent).toContain('adeAgentAction.retry')
})
