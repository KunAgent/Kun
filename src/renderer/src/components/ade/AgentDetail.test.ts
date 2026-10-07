import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultKunHarnessSettings } from '@shared/app-settings-kun-harness'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { KunHarnessSettingsV1 } from '@shared/app-settings'
import { withHarnessReadiness } from '@shared/test-support/harness-readiness'
import { useHarnessStore } from '../../store/harness-store'
import { AgentDetail } from './AgentDetail'

const provider = vi.hoisted(() => ({ testHarness: vi.fn() }))
vi.mock('../../agent/registry', () => ({ getProvider: () => provider }))
vi.mock('./agent-enablement-settings', () => ({ AGENT_SETTINGS_TIMEOUT_MS: 125_000, waitForAgentSettings: vi.fn().mockResolvedValue(undefined) }))
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  const echo = (key: string, options?: Record<string, unknown>): string => options ? `${key}(${JSON.stringify(options)})` : key
  return { ...actual, useTranslation: () => ({ t: echo }) }
})

const t = (key: string, options?: Record<string, unknown>): string => options ? `${key}(${JSON.stringify(options)})` : key
const text = (node: ReactTestInstance): string => node.children.map((child) => typeof child === 'string' ? child : text(child)).join('')

function agentRow(id = 'claude-code', status: Partial<AdeHarnessRow['status']> = {}, modes: AdeHarnessRow['definition']['credentialModes'] = ['native-login', 'provider']): AdeHarnessRow {
  return { definition: { id, displayName: `${id} display`, transport: 'agent-sdk', credentialModes: modes,
    permissionModes: [], modelSource: 'probe', staticModels: [], builtin: true,
    setup: { install: [{ platform: 'any', command: 'npm i -g x' }], login: { command: id, args: ['login'] } } },
  status: { harnessId: id, installed: 'yes', version: '2.0.0', login: 'signed-in', checkedAt: '2026-01-01T00:00:00.000Z', ...status } }
}

function mount(row: AdeHarnessRow, settings: KunHarnessSettingsV1, extra: Partial<Parameters<typeof AgentDetail>[0]> = {}): { tree: ReactTestRenderer; patch: ReturnType<typeof vi.fn> } {
  const patch = vi.fn()
  let tree!: ReactTestRenderer
  act(() => {
    tree = create(createElement(AgentDetail, { row, settings, probing: false, platform: 'darwin', t, tSettings: t,
      onPatchHarness: patch, onProbe: vi.fn(), onSetBinaryPath: vi.fn(), onSetPermissionMode: vi.fn(), ...extra }))
  })
  return { tree, patch }
}

const enabled = (id = 'claude-code'): KunHarnessSettingsV1 => ({ ...defaultKunHarnessSettings(),
  enabledProfiles: [{ harnessId: id, credentialMode: 'native-login' }] })

beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); useHarnessStore.setState({ rows: [], models: {}, providerGroups: {} }) })
afterEach(() => { vi.unstubAllGlobals() })

describe('AgentDetail', () => {
  it('keeps the switch locked and offers install steps while the Agent is not installed', () => {
    const { tree } = mount(agentRow('claude-code', { installed: 'no', reasonCode: 'not_installed', version: undefined }), defaultKunHarnessSettings())
    const toggle = tree.root.findByProps({ 'data-agent-enable': true })
    expect(toggle.props.disabled).toBe(true)
    expect(toggle.props['data-agent-switch']).toBe('locked')
    expect(tree.root.findAllByProps({ 'data-agent-setup': 'claude-code' })).toHaveLength(1)
    expect(tree.root.findByProps({ 'data-agent-enable-step': true }).props.disabled).toBe(true)
    act(() => tree.unmount())
  })

  it('starts the check from the switch for an installed, unconnected Agent', async () => {
    provider.testHarness.mockReset().mockResolvedValue({ harnessId: 'claude-code', transport: 'agent-sdk', level: 'handshake', ok: false, durationMs: 1,
      detect: { durationMs: 1, ok: true, status: agentRow().status } })
    const { tree } = mount(agentRow(), defaultKunHarnessSettings(), { beforeEnableCheck: async () => true })
    expect(tree.root.findByProps({ 'data-agent-enable': true }).props['data-agent-switch']).toBe('off')
    await act(async () => { tree.root.findByProps({ 'data-agent-enable': true }).props.onClick() })
    expect(provider.testHarness).toHaveBeenCalledTimes(1)
    act(() => tree.unmount())
  })

  it('shows the sign-in notice with one primary action and hands the command to the terminal', () => {
    const onSetupCommand = vi.fn()
    const row: AdeHarnessRow = { ...agentRow('claude-code', { login: 'signed-out', reasonCode: 'signed_out' }), readyProfiles: [], enabled: true }
    const { tree } = mount(row, enabled(), { onSetupCommand })
    expect(tree.root.findAllByProps({ 'data-agent-notice': 'signedOut' })).toHaveLength(1)
    expect(tree.root.findByProps({ 'data-agent-enable': true }).props['data-agent-switch']).toBe('on')
    act(() => tree.root.findByProps({ 'data-agent-next': 'login' }).props.onClick())
    expect(onSetupCommand).toHaveBeenCalledWith('claude-code', 'claude-code login', 'claude-code display')
    act(() => tree.unmount())
  })

  it('keeps a connection edit as a draft: nothing is saved until it is checked, and it can be discarded', () => {
    const { tree, patch } = mount(withHarnessReadiness(agentRow()), enabled())
    expect(tree.root.findAllByProps({ 'data-agent-draft': true })).toHaveLength(0)
    act(() => tree.root.findByProps({ 'data-agent-profile-mode-option': 'provider' }).props.onClick())
    expect(patch).not.toHaveBeenCalled()
    expect(tree.root.findAllByProps({ 'data-agent-draft': true })).toHaveLength(1)
    expect(tree.root.findByProps({ 'data-agent-enable': true }).props['data-agent-switch']).toBe('on')
    expect(tree.root.findByProps({ 'data-agent-status': 'needsRecheck' })).toBeTruthy()
    act(() => tree.root.findByProps({ 'data-agent-draft-discard': true }).props.onClick())
    expect(tree.root.findAllByProps({ 'data-agent-draft': true })).toHaveLength(0)
    expect(patch).not.toHaveBeenCalled()
    act(() => tree.unmount())
  })

  it('saves connection edits at once while the Agent is still off', () => {
    const { tree, patch } = mount(agentRow(), defaultKunHarnessSettings())
    act(() => tree.root.findByProps({ 'data-agent-profile-mode-option': 'provider' }).props.onClick())
    expect(patch).toHaveBeenCalledWith({ defaults: { 'claude-code': expect.objectContaining({ credentialMode: 'provider' }) } })
    expect(tree.root.findAllByProps({ 'data-agent-draft': true })).toHaveLength(0)
    act(() => tree.unmount())
  })

  it('asks for confirmation before running a trial turn and reports its outcome', async () => {
    provider.testHarness.mockReset().mockResolvedValue({ harnessId: 'claude-code', transport: 'agent-sdk', level: 'trial', ok: true, durationMs: 5,
      detect: { durationMs: 1, ok: true, status: agentRow().status }, trial: { ok: true, status: 'completed', durationMs: 842, usage: { totalTokens: 12 } } })
    const onTest = vi.fn((level: 'handshake' | 'trial') => provider.testHarness('claude-code', { level }))
    const { tree } = mount(withHarnessReadiness(agentRow()), enabled(), { onTest })
    expect(onTest).not.toHaveBeenCalled()
    act(() => tree.root.findByProps({ 'data-agent-trial-start': true }).props.onClick())
    expect(onTest).not.toHaveBeenCalled()
    await act(async () => { tree.root.findByProps({ 'data-agent-trial-confirm': true }).props.onClick() })
    expect(onTest).toHaveBeenCalledWith('trial')
    expect(text(tree.root.findByProps({ 'data-agent-trial-result': 'ok' }))).toContain('842')
    act(() => tree.unmount())
  })
})
