// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { withHarnessReadiness } from '@shared/test-support/harness-readiness'

const fixture = vi.hoisted(() => ({
  providerId: undefined as string | undefined,
  rows: [] as AdeHarnessRow[], rowsLoadedAt: 1, rowsLoading: false,
  models: { 'claude-code': { models: ['sonnet'] } }, providerGroups: {}
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../agent/registry', () => ({ getProvider: () => ({}) }))
vi.mock('../../store/harness-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../store/harness-store')>(),
  useHarnessStore: (selector: (state: typeof fixture) => unknown) => selector(fixture),
  loadHarnesses: vi.fn(), loadHarnessModels: vi.fn(), loadHarnessProviderGroups: vi.fn()
}))
vi.mock('../../lib/harness-defaults', () => ({ useHarnessDefaults: () => ({
  'claude-code': { credentialMode: 'native-login', providerId: fixture.providerId, model: 'sonnet' }
}) }))
vi.mock('../agent-icon', () => ({ AgentIcon: () => null }))
import { AdeOneOnOneDialog } from './AdeOneOnOneDialog'

let root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  fixture.providerId = undefined
  fixture.rows = [withHarnessReadiness({ definition: { id: 'claude-code', displayName: 'Claude Code', transport: 'agent-sdk',
    credentialModes: ['native-login'], permissionModes: [], modelSource: 'probe', staticModels: ['sonnet'], builtin: true },
    status: { harnessId: 'claude-code', installed: 'yes', login: 'signed-in', checkedAt: '' } }, [
    { harnessId: 'claude-code', credentialMode: 'native-login', providerId: 'named-account' },
    { harnessId: 'claude-code', credentialMode: 'native-login' }
  ])]
  root = createRoot(document.createElement('div'))
})
afterEach(async () => { await act(async () => root.unmount()); localStorage.clear(); vi.unstubAllGlobals() })

describe('one-on-one native account selection', () => {
  it.each([undefined, 'named-account'])('preserves the selected %s profile without falling back across accounts', async (providerId) => {
    fixture.providerId = providerId
    const onConfirm = vi.fn()
    await act(async () => root.render(createElement(AdeOneOnOneDialog, { onConfirm, onClose: vi.fn(), onOpenSettings: vi.fn() })))
    await act(async () => document.querySelector<HTMLButtonElement>('[data-ade-one-on-one-start]')!.click())
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ harnessId: 'claude-code', credentialMode: 'native-login', providerId }))
  })
})
