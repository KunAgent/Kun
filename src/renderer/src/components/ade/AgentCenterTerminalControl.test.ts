// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { defaultKunHarnessSettings } from '@shared/app-settings-kun-harness'
import { withHarnessReadiness } from '@shared/test-support/harness-readiness'
const f = vi.hoisted(() => ({ request: vi.fn(), open: vi.fn(), route: vi.fn() }))
vi.mock('../../agent/runtime-client', () => ({ rendererRuntimeClient: { runtimeRequest: f.request } }))
vi.mock('../terminal/terminal-open', () => ({ openTerminal: f.open }))
vi.mock('../../store/chat-store', () => ({ useChatStore: { getState: () => ({ workspaceRoot: '/repo', route: 'chat', setRoute: f.route }) } }))
import { AgentCenterTerminalControl } from './AgentCenterTerminalControl'
const row: AdeHarnessRow = withHarnessReadiness({
  definition: { id: 'aider', displayName: 'Aider', transport: 'terminal', credentialModes: ['native-login'],
    permissionModes: [], modelSource: 'static', staticModels: [], builtin: true },
  status: { harnessId: 'aider', installed: 'yes', login: 'not-required', checkedAt: '' }
})
const settings = { ...defaultKunHarnessSettings(), enabledProfiles: row.enabledProfiles ?? [] }
let root: Root, container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  f.request.mockResolvedValue({ ok: true, status: 200, body: JSON.stringify({ harnessId: 'aider', kind: 'terminal', configurations: [] }) })
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.clearAllMocks(); vi.unstubAllGlobals() })
it('opens an owned agent target only after an explicit click on a ready enabled profile', async () => {
  await act(async () => root.render(createElement(AgentCenterTerminalControl, { row, settings, t: (key: string) => key })))
  expect(f.open).not.toHaveBeenCalled()
  const launch = container.querySelector<HTMLButtonElement>('[data-agent-open-terminal]')!
  expect(launch.disabled).toBe(false)
  await act(async () => launch.click())
  expect(f.open).toHaveBeenCalledWith({ cwd: '/repo', title: 'Aider', agent: { harnessId: 'aider', title: 'Aider' } })
})
it('keeps launch disabled without current runtime readiness even when the binary is installed', async () => {
  await act(async () => root.render(createElement(AgentCenterTerminalControl, {
    row: { ...row, readyProfiles: [] }, settings, t: (key: string) => key
  })))
  expect(container.querySelector<HTMLButtonElement>('[data-agent-open-terminal]')!.disabled).toBe(true)
  expect(container.textContent).toContain('agentIntegrations.terminalOpenHint')
  expect(f.open).not.toHaveBeenCalled()
})
