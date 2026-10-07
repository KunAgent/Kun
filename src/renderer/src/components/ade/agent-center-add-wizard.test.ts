import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { KunHarnessSettingsV1 } from '@shared/app-settings'

const provider = { testHarness: vi.fn(), listHarnesses: vi.fn() }
vi.mock('../../agent/registry', () => ({ getProvider: () => provider }))

import { AgentCenterAddWizard } from './agent-center-add-wizard'

const settings: KunHarnessSettingsV1 = {
  enabledProfiles: [], disabledIds: [], binaryPaths: {}, custom: [], defaults: {},
  defaultHarnessId: 'kun', agentOrder: [], terminalAgents: []
}

const codex: AdeHarnessRow = {
  definition: {
    id: 'codex', displayName: 'Codex', transport: 'codex-app-server',
    credentialModes: ['native-login', 'kun-gateway'], permissionModes: [],
    modelSource: 'probe', staticModels: [], builtin: true,
    setup: { login: { command: 'codex', args: ['login'] } }
  },
  status: {
    harnessId: 'codex', installed: 'yes', version: '0.145.0', ready: 'yes',
    login: 'unknown', resolvedCommand: '/usr/bin/codex', checkedAt: '2026-01-01T00:00:00Z'
  }
}

function render(settingsSurface = false) {
  const onClose = vi.fn(), onSelectAgent = vi.fn(), updateKun = vi.fn()
  let root!: ReactTestRenderer
  act(() => {
    root = create(createElement(AgentCenterAddWizard, {
      rows: [codex], settings, updateKun, onClose, onSelectAgent, settingsSurface
    }))
  })
  return { root, onClose, onSelectAgent, updateKun }
}

beforeEach(() => {
  vi.clearAllMocks()
  provider.listHarnesses.mockResolvedValue([codex])
})

describe('AgentCenterAddWizard', () => {
  it('scopes polished portal actions only to its Settings host', () => {
    const standalone = render()
    expect(standalone.root.root.findByProps({ 'data-agent-add-wizard': true }).props.className)
      .not.toContain('ds-settings-surface')
    act(() => standalone.root.unmount())

    const settingsWizard = render(true)
    expect(settingsWizard.root.root.findByProps({ 'data-agent-add-wizard': true }).props.className)
      .toContain('ds-settings-surface')
    const close = settingsWizard.root.root.findByProps({ 'data-agent-add-close': true })
    expect(close.props['data-settings-action']).toBe('ghost')
    expect(close.props['data-settings-size']).toBe('icon')
    expect(close.props.className).toBe('rounded-md p-1 text-ds-muted hover:bg-ds-hover')
    act(() => settingsWizard.root.unmount())
  })

  it('checks native login without requiring a gateway or trial turn', async () => {
    provider.testHarness.mockResolvedValue({
      harnessId: 'codex', transport: 'codex-app-server', level: 'handshake',
      ok: true, durationMs: 12,
      detect: { ok: true, durationMs: 3, status: codex.status },
      handshake: { ok: true, supported: true, durationMs: 9 }
    })
    const { root, onClose, onSelectAgent } = render()
    await act(async () => root.root.findByProps({ 'data-agent-add-select': 'codex' }).props.onClick())
    await act(async () => root.root.findByProps({ 'data-agent-add-check': true }).props.onClick())
    expect(provider.testHarness).toHaveBeenCalledWith('codex', {
      level: 'handshake', credentialMode: 'native-login', timeoutMs: 55_000
    }, { signal: expect.any(AbortSignal) })
    expect(root.root.findAllByProps({ 'data-agent-add-finish': true })).toHaveLength(1)
    expect(root.root.findByProps({ 'data-agent-add-check-state': 'unverified' })).toBeTruthy()
    expect(provider.testHarness).toHaveBeenCalledTimes(1)
    await act(async () => root.root.findByProps({ 'data-agent-add-done': true }).props.onClick())
    expect(onSelectAgent).toHaveBeenCalledWith('codex')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('reports an explicitly requested completed trial without treating it as profile enablement', async () => {
    provider.testHarness.mockResolvedValueOnce({
      harnessId: 'codex', level: 'handshake', ok: true, durationMs: 1,
      readiness: { usable: true },
      detect: { ok: true, durationMs: 1, status: codex.status }
    }).mockResolvedValueOnce({
      harnessId: 'codex', level: 'trial', ok: true, durationMs: 5,
      detect: { ok: true, durationMs: 1, status: codex.status },
      trial: { ok: true, status: 'completed', durationMs: 4 }
    })
    const { root, updateKun } = render()
    await act(async () => root.root.findByProps({ 'data-agent-add-select': 'codex' }).props.onClick())
    await act(async () => root.root.findByProps({ 'data-agent-add-check': true }).props.onClick())
    await act(async () => root.root.findByProps({ 'data-agent-add-trial': true }).props.onClick())
    expect(provider.testHarness.mock.calls[1]?.[1]).toMatchObject({ level: 'trial' })
    expect(root.root.findByProps({ 'data-agent-add-check-state': 'passed' })).toBeTruthy()
    expect(updateKun).not.toHaveBeenCalled()
    act(() => root.unmount())
  })

  it('offers only chat Agents and no terminal-only entry', () => {
    const terminal: AdeHarnessRow = { ...codex, definition: { ...codex.definition, id: 'aider', displayName: 'Aider', transport: 'terminal' },
      status: { ...codex.status, harnessId: 'aider' } }
    const application: AdeHarnessRow = { ...codex, definition: { ...codex.definition, id: 'editor', displayName: 'Editor', transport: 'application' },
      status: { ...codex.status, harnessId: 'editor' } }
    let root!: ReactTestRenderer
    act(() => {
      root = create(createElement(AgentCenterAddWizard, {
        rows: [codex, terminal, application], settings, updateKun: vi.fn(), onClose: vi.fn(), onSelectAgent: vi.fn()
      }))
    })
    expect(root.root.findAll((node) => typeof node.props['data-agent-add-select'] === 'string' && node.type === 'button')
      .map((node) => node.props['data-agent-add-select'])).toEqual(['codex'])
    expect(root.root.findAllByProps({ 'data-agent-add-terminal': true })).toHaveLength(0)
    act(() => root.unmount())
  })

  it('routes the import entry into the existing ACP import form', async () => {
    const { root } = render()
    await act(async () => root.root.findByProps({ 'data-agent-add-import': true }).props.onClick())
    expect(root.root.findAllByProps({ 'data-agent-custom-form': true })).toHaveLength(1)
    expect(provider.testHarness).not.toHaveBeenCalled()
  })

  it('marks a completed check stale when the executable override changes', async () => {
    provider.testHarness.mockResolvedValue({
      harnessId: 'codex', level: 'handshake', ok: true, durationMs: 1,
      readiness: { usable: true },
      detect: { ok: true, durationMs: 1, status: codex.status }
    })
    const { root, onClose, onSelectAgent, updateKun } = render()
    await act(async () => root.root.findByProps({ 'data-agent-add-select': 'codex' }).props.onClick())
    await act(async () => root.root.findByProps({ 'data-agent-add-check': true }).props.onClick())
    expect(root.root.findByProps({ 'data-agent-add-check-state': 'passed' })).toBeTruthy()
    await act(async () => root.update(createElement(AgentCenterAddWizard, {
      rows: [codex],
      settings: { ...settings, binaryPaths: { codex: '/another/codex' } },
      updateKun, onClose, onSelectAgent
    })))
    expect(root.root.findByProps({ 'data-agent-add-check-state': 'stale' })).toBeTruthy()
  })

  it('ignores a late connection result after the wizard closes', async () => {
    let resolveCheck!: (value: unknown) => void
    provider.testHarness.mockImplementation(() => new Promise((resolve) => { resolveCheck = resolve }))
    const { root, onClose } = render()
    await act(async () => root.root.findByProps({ 'data-agent-add-select': 'codex' }).props.onClick())
    await act(async () => root.root.findByProps({ 'data-agent-add-check': true }).props.onClick())
    const calls = provider.testHarness.mock.calls as unknown as Array<[string, unknown, { signal: AbortSignal }]>
    const signal = calls[0]![2].signal
    expect(signal.aborted).toBe(false)
    await act(async () => root.root.findByProps({ 'data-agent-add-close': true }).props.onClick())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(signal.aborted).toBe(true)
    await act(async () => resolveCheck({
      harnessId: 'codex', level: 'handshake', ok: true, durationMs: 1,
      readiness: { usable: true },
      detect: { ok: true, durationMs: 1, status: codex.status }
    }))
    expect(root.root.findAllByProps({ 'data-agent-add-finish': true })).toHaveLength(0)
  })
})
