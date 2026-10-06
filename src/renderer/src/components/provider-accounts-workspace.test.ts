import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import type { ProviderConfigurationSnapshot } from '@shared/provider-configuration'
import { ProviderAccountsWorkspace, providerAccountRows } from './provider-accounts-workspace'

const t = (key: string) => key
function snapshot(): ProviderConfigurationSnapshot {
  return { connections: Array.from({ length: 500 }, (_, index) => ({ id: `account-${index}`, name: `Account ${index}`,
    credentialStatus: 'ready', kind: 'http', authType: 'api-key', models: ['model'], configured: true })),
  configuration: { groups: { group: { id: 'group', name: 'Team Europe', enabled: true, defaults: {} } },
    templates: {}, connections: { 'account-499': { enabled: true, groupId: 'group', inherit: [], manualModels: [] } }, gatewayPolicies: {} }
  } as unknown as ProviderConfigurationSnapshot
}
describe('large provider account workspace', () => {
  it('searches account identity and group names without merging same-brand accounts', () => {
    expect(providerAccountRows(snapshot(), 'team europe', '').map((row) => row.id)).toEqual(['account-499'])
    expect(providerAccountRows(snapshot(), '', 'group').map((row) => row.id)).toEqual(['account-499'])
    expect(providerAccountRows(snapshot(), '', 'ungrouped')).toHaveLength(499)
  })
  it('renders bounded pages and keeps keyboard-native selection/action controls', async () => {
    let renderer!: ReactTestRenderer
    const selected: string[] = [], reviewed: unknown[] = []
    await act(async () => { renderer = create(createElement(ProviderAccountsWorkspace, { snapshot: snapshot(), selected: 'account-0',
      select: (id) => selected.push(id), review: (operations) => reviewed.push(operations), disabled: false, t })) })
    const page = () => renderer.root.findByProps({ 'data-provider-account-page': true })
    expect(page().findAllByProps({ type: 'button' })).toHaveLength(150)
    const next = renderer.root.findByProps({ 'aria-label': 'providerConfiguration.nextPage' })
    await act(async () => { next.props.onClick() })
    const select = page().findAllByProps({ 'aria-pressed': false })[0]
    await act(async () => { select.props.onClick() }); expect(selected).toEqual(['account-50'])
    await act(async () => { page().findAllByType('button')[1].props.onClick() })
    expect(reviewed[0]).toMatchObject([{ kind: 'configure-connection', connectionId: 'account-50', configuration: { enabled: false } }])
    await act(async () => { renderer.unmount() })
  })
})
