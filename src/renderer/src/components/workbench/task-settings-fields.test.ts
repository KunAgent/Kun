import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdeExecutionConfigSnapshot } from '@shared/ade-execution-config'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { KunHarnessEnabledProfileV1 } from '@shared/app-settings'
import { AdeProjectDefaultsFieldsSchema } from '@shared/ade-project-defaults'
import { withHarnessReadiness } from '@shared/test-support/harness-readiness'

const fixture = vi.hoisted(() => ({
  rows: [] as AdeHarnessRow[],
  models: { 'claude-code': { models: ['sonnet', 'opus'] } },
  providerGroups: { 'claude-code': { groups: [
    { providerId: 'ready-account', label: 'Ready', models: ['ready-model'] },
    { providerId: 'disabled-account', label: 'Disabled', models: ['other-model'] }
  ] } }
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../agent/registry', () => ({ getProvider: () => ({}) }))
vi.mock('../../store/harness-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../store/harness-store')>(),
  useHarnessStore: Object.assign((selector: (state: typeof fixture) => unknown) => selector(fixture), { getState: () => fixture }),
  loadHarnesses: vi.fn(), loadHarnessModels: vi.fn(), loadHarnessProviderGroups: vi.fn()
}))
vi.mock('../../store/chat-store', () => ({ useChatStore: (selector: (state: unknown) => unknown) => selector({ composerModelGroups: [] }) }))
vi.mock('../agent-icon', () => ({ AgentIcon: () => null }))
import { TaskSettingsFields } from './task-settings-fields'

const effective: AdeExecutionConfigSnapshot = {
  version: 1, revision: 'fixture', route: { harnessId: 'kun', model: 'kun-model', credentialMode: 'provider' },
  collaborationEnabled: false, limits: { softWorkers: 1, hardWorkers: 2 }, isolation: 'local',
  origins: { route: 'global', collaborationEnabled: 'global', managerModel: 'global', limits: 'global', budget: 'global', isolation: 'global' },
  resolvedAt: ''
}
function row(profiles: KunHarnessEnabledProfileV1[]): AdeHarnessRow {
  return withHarnessReadiness({ definition: { id: 'claude-code', displayName: 'Claude Code', transport: 'agent-sdk',
    credentialModes: ['native-login', 'kun-gateway'], permissionModes: [], modelSource: 'probe', staticModels: ['sonnet'], builtin: true },
    status: { harnessId: 'claude-code', installed: 'yes', login: 'signed-in', checkedAt: '' } }, profiles)
}
let tree: ReactTestRenderer | undefined
const onChange = vi.fn()
function mount(route = effective.route) {
  act(() => { tree = create(createElement(TaskSettingsFields, { value: {}, effective: { ...effective, route },
    onChange, onRestore: vi.fn(), restored: new Set<never>(), disabled: false })) })
}
const control = (label: string) => tree!.root.findByProps({ 'aria-label': label })
const choices = (label: string) => control(label).findAllByType('option').filter((option) => !option.props.disabled).map((option) => option.props.value)
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); onChange.mockReset(); fixture.rows = [] })
afterEach(() => { act(() => tree?.unmount()); tree = undefined; vi.unstubAllGlobals() })

describe('task settings exact Agent profiles', () => {
  it('switches to the ready gateway profile instead of the disabled first native mode', () => {
    fixture.rows = [row([{ harnessId: 'claude-code', credentialMode: 'kun-gateway', providerId: 'ready-account' }])]
    mount()
    act(() => control('taskSettings.agent').props.onChange({ target: { value: 'claude-code' } }))
    expect(onChange).toHaveBeenCalledWith('route', { harnessId: 'claude-code', credentialMode: 'kun-gateway', providerId: 'ready-account', model: '' })
  })

  it('offers only ready credential modes and provider accounts, rejecting stale option events', () => {
    fixture.rows = [row([{ harnessId: 'claude-code', credentialMode: 'kun-gateway', providerId: 'ready-account' }])]
    mount({ harnessId: 'claude-code', credentialMode: 'kun-gateway', providerId: 'ready-account', model: 'ready-model' })
    expect(choices('taskSettings.credential')).toEqual(['kun-gateway'])
    expect(choices('taskSettings.provider')).toEqual(['', 'ready-account'])
    act(() => control('taskSettings.provider').props.onChange({ target: { value: 'disabled-account' } }))
    act(() => control('taskSettings.credential').props.onChange({ target: { value: 'native-login' } }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('preserves the ready named native account through model edits and save validation', () => {
    fixture.rows = [row([{ harnessId: 'claude-code', credentialMode: 'native-login', providerId: 'ready-account' }])]
    mount({ harnessId: 'claude-code', credentialMode: 'native-login', providerId: 'ready-account', model: 'sonnet' })
    expect(choices('agentEnablement.nativeAccount')).toEqual(['ready-account'])
    act(() => control('taskSettings.model').props.onChange({ target: { value: 'opus' } }))
    const next = { harnessId: 'claude-code', credentialMode: 'native-login', providerId: 'ready-account', model: 'opus' }
    expect(onChange).toHaveBeenCalledWith('route', next)
    expect(AdeProjectDefaultsFieldsSchema.safeParse({ route: next }).success).toBe(true)
  })

  it('keeps the system and named native accounts separate', () => {
    fixture.rows = [row([
      { harnessId: 'claude-code', credentialMode: 'native-login' },
      { harnessId: 'claude-code', credentialMode: 'native-login', providerId: 'ready-account' }
    ])]
    mount({ harnessId: 'claude-code', credentialMode: 'native-login', providerId: 'ready-account', model: 'sonnet' })
    expect(choices('agentEnablement.nativeAccount')).toEqual(['', 'ready-account'])
    act(() => control('agentEnablement.nativeAccount').props.onChange({ target: { value: '' } }))
    expect(onChange).toHaveBeenCalledWith('route', { harnessId: 'claude-code', credentialMode: 'native-login', providerId: undefined, model: '' })
  })
})
