// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { defaultKunHarnessSettings } from '@shared/app-settings-kun-harness'
import type { HarnessIntegrationInfo } from '../../../../../kun/src/contracts/harness-integration'

const f = vi.hoisted(() => ({ request: vi.fn(), wait: vi.fn() }))
vi.mock('../../agent/runtime-client', () => ({ rendererRuntimeClient: { runtimeRequest: f.request } }))
vi.mock('./agent-enablement-settings', () => ({ AGENT_SETTINGS_TIMEOUT_MS: 125_000, waitForAgentSettings: f.wait }))
vi.mock('../agent-icon', () => ({ AgentIcon: () => null }))
import { AgentCenterApplicationCard } from './AgentCenterApplicationCard'

const row: AdeHarnessRow = {
  definition: { id: 'desktop-editor', displayName: 'Desktop Editor', transport: 'application',
    credentialModes: [], permissionModes: [], modelSource: 'static', staticModels: [], builtin: true,
    setup: { docsUrl: 'https://example.test/install' } },
  status: { harnessId: 'desktop-editor', installed: 'yes', login: 'not-required', checkedAt: '' }
}
const info: HarnessIntegrationInfo = { harnessId: row.definition.id, kind: 'application',
  application: { path: '/Applications/Editor.app', exists: true, kind: 'application' },
  configurations: [{ path: '/home/user/.config/editor/settings.json', exists: true, kind: 'file' },
    { path: '/home/user/.editor', exists: false, kind: 'directory' }] }
let root: Root, container: HTMLDivElement
const open = vi.fn(), docs = vi.fn()
const t = (key: string): string => key
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(window, 'kunGui', { configurable: true, value: { openAgentIntegration: open, openExternal: docs } })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  open.mockResolvedValue({ ok: true }); docs.mockResolvedValue(undefined)
  f.wait.mockResolvedValue(undefined)
  f.request.mockResolvedValue({ ok: true, status: 200, body: JSON.stringify(info) })
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.clearAllMocks(); vi.unstubAllGlobals() })
async function render(entry = row): Promise<void> {
  await act(async () => root.render(createElement(AgentCenterApplicationCard, {
    row: entry, settings: defaultKunHarnessSettings(), probing: false, onProbe: vi.fn(), onSetBinaryPath: vi.fn(), t
  })))
}
it('shows resolved installation and configuration targets and opens only typed host actions', async () => {
  await render()
  expect(f.request.mock.calls[0][0]).toBe('/v1/harnesses/desktop-editor/integration')
  expect(container.textContent).toContain('/home/user/.config/editor/settings.json')
  expect(container.querySelector('[data-agent-enablement]')).toBeNull()
  expect(container.querySelector('[data-agent-profile-model]')).toBeNull()
  const existing = container.querySelector<HTMLButtonElement>('[data-agent-open-configuration="0"]')!
  const missing = container.querySelector<HTMLButtonElement>('[data-agent-open-configuration="1"]')!
  expect(existing.disabled).toBe(false); expect(missing.disabled).toBe(true)
  await act(async () => existing.click())
  expect(open).toHaveBeenCalledWith({ harnessId: row.definition.id, action: 'configuration', index: 0 })
  await act(async () => container.querySelector<HTMLButtonElement>('[data-agent-open-application]')!.click())
  expect(open).toHaveBeenCalledWith({ harnessId: row.definition.id, action: 'application' })
  expect(open).toHaveBeenCalledTimes(2)
})
it('offers official installation instructions for missing applications and keeps launch unavailable', async () => {
  f.request.mockResolvedValue({ ok: true, status: 200, body: JSON.stringify({ ...info,
    application: { ...info.application, exists: false } }) })
  await render({ ...row, status: { ...row.status, installed: 'no' } })
  expect(container.textContent).toContain('agentIntegrations.missingApplication')
  expect(container.querySelector<HTMLButtonElement>('[data-agent-open-application]')!.disabled).toBe(true)
  const instructions = container.querySelector<HTMLButtonElement>('[data-agent-integration-docs]')!
  expect(instructions.textContent).toContain('agentIntegrations.installInstructions')
  await act(async () => instructions.click())
  expect(docs).toHaveBeenCalledWith('https://example.test/install')
  expect(open).not.toHaveBeenCalled()
})
it('reports failed location loads, supports retry and surfaces host opening errors', async () => {
  f.request.mockResolvedValueOnce({ ok: false, status: 503, body: '{}' })
  await render()
  expect(container.textContent).toContain('agentIntegrations.locationsError')
  const retry = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'adeAgentAction.retry')!
  await act(async () => retry.click())
  expect(container.textContent).toContain('/home/user/.config/editor/settings.json')
  open.mockResolvedValueOnce({ ok: false, message: 'Local application moved.' })
  await act(async () => container.querySelector<HTMLButtonElement>('[data-agent-open-application]')!.click())
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Local application moved.')
})

it('keeps manual application paths collapsed and saves an exact path without launching the client', async () => {
  const save = vi.fn(), probe = vi.fn(), beforeSave = vi.fn(async () => true)
  const settings = { ...defaultKunHarnessSettings(), binaryPaths: { [row.definition.id]: '/Applications/Old.app' } }
  await act(async () => root.render(createElement(AgentCenterApplicationCard, {
    row, settings, probing: false, onProbe: probe, onSetBinaryPath: save, beforeSave, t
  })))
  const details = container.querySelector<HTMLDetailsElement>('[data-agent-application-path-settings]')!
  expect(details.open).toBe(false)
  await act(async () => details.querySelector('summary')!.click())
  expect(details.open).toBe(true)
  const input = container.querySelector<HTMLInputElement>('[data-agent-application-path-input]')!
  expect(input.value).toBe('/Applications/Old.app')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '/opt/custom/Editor.exe')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(save).not.toHaveBeenCalled()
  await act(async () => container.querySelector<HTMLButtonElement>('[data-agent-save-application-path]')!.click())
  expect(save).toHaveBeenCalledExactlyOnceWith('/opt/custom/Editor.exe')
  expect(beforeSave).toHaveBeenCalledOnce()
  expect(f.wait.mock.calls[0][0].binaryPaths[row.definition.id]).toBe('/opt/custom/Editor.exe')
  expect(probe).toHaveBeenCalledOnce()
  expect(f.request).toHaveBeenCalledTimes(2)
  expect(open).not.toHaveBeenCalled()
  expect(docs).not.toHaveBeenCalled()
})
