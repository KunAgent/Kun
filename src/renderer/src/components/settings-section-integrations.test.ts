import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GoogleWorkspaceApi, GoogleWorkspaceStatus } from '@shared/google-workspace'
import { IntegrationsSettingsSection } from './settings-section-integrations'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const state = (overrides: Partial<GoogleWorkspaceStatus> = {}): GoogleWorkspaceStatus => ({
  experimental: true,
  binary: { available: true, version: '0.22.5' },
  auth: { state: 'disconnected', scopes: [] },
  services: { gmail: { state: 'unknown' }, calendar: { state: 'unknown' }, drive: { state: 'unknown' } },
  ...overrides
})
const loginRunning = () => state({ operation: { id: 'login-1', kind: 'login', state: 'running' } })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
let renderer: ReactTestRenderer | undefined
let api: { [K in keyof GoogleWorkspaceApi]: ReturnType<typeof vi.fn<GoogleWorkspaceApi[K]>> }
const button = (label: string) => renderer!.root.findAllByType('button').find((node) => node.props.children === label)!
const output = () => JSON.stringify(renderer!.toJSON())
const mount = async () => { await act(async () => { renderer = create(createElement(IntegrationsSettingsSection)) }) }

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  api = {
    status: vi.fn(async () => state()), login: vi.fn(async () => loginRunning()),
    setup: vi.fn(async () => state({ auth: { state: 'setup_required', scopes: [] } })),
    logout: vi.fn(async () => state()), test: vi.fn(async () => state()),
    cancel: vi.fn(async () => state({ operation: { id: 'login-1', kind: 'login', state: 'cancelled' } })),
    openAuthorization: vi.fn(async () => ({ opened: true }))
  }
  vi.stubGlobal('window', { kunGui: { googleWorkspace: api, openExternal: vi.fn(async () => undefined) }, confirm: vi.fn(() => true) })
})
afterEach(async () => {
  await act(async () => { renderer?.unmount() })
  renderer = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Google Workspace settings', () => {
  it('shows honest disconnected and untested states, with no login on mount', async () => {
    await mount()
    expect(output()).toContain('googleWorkspaceAuth_disconnected')
    expect(output()).toContain('googleWorkspaceService_unknown')
    expect(button('googleWorkspaceConnect').props.disabled).toBe(false)
    expect(button('googleWorkspaceTest').props.disabled).toBe(true)
    expect(api.login).not.toHaveBeenCalled()
    expect(api.openAuthorization).not.toHaveBeenCalled()
  })
  it('blocks repeated clicks synchronously and cancels a late login result', async () => {
    const result = deferred<GoogleWorkspaceStatus>()
    api.login.mockReturnValueOnce(result.promise)
    await mount()
    const connect = button('googleWorkspaceConnect')
    await act(async () => { connect.props.onClick(); connect.props.onClick() })
    expect(api.login).toHaveBeenCalledTimes(1)
    expect(button('googleWorkspaceConnect').props.disabled).toBe(true)
    await act(async () => { button('googleWorkspaceCancel').props.onClick() })
    await act(async () => { result.resolve(loginRunning()) })
    expect(api.cancel).toHaveBeenCalledTimes(1)
    expect(api.openAuthorization).not.toHaveBeenCalled()
    expect(output()).toContain('googleWorkspaceOperationState_cancelled')
    expect(button('googleWorkspaceConnect').props.disabled).toBe(false)
  })
  it('cancels owned login when Settings closes before start responds', async () => {
    const result = deferred<GoogleWorkspaceStatus>()
    api.login.mockReturnValueOnce(result.promise)
    await mount()
    await act(async () => { button('googleWorkspaceConnect').props.onClick() })
    await act(async () => { renderer!.unmount() })
    renderer = undefined
    await act(async () => { result.resolve(loginRunning()) })
    expect(api.cancel).toHaveBeenCalledTimes(1)
    expect(api.openAuthorization).not.toHaveBeenCalled()
  })
  it('does not overwrite Cancel with a stale status poll or open its browser', async () => {
    await mount()
    await act(async () => { button('googleWorkspaceConnect').props.onClick() })
    expect(api.openAuthorization).toHaveBeenCalledTimes(1)
    const poll = deferred<GoogleWorkspaceStatus>()
    api.status.mockReturnValueOnce(poll.promise)
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    await act(async () => { button('googleWorkspaceCancel').props.onClick() })
    await act(async () => { poll.resolve(loginRunning()) })
    expect(api.openAuthorization).toHaveBeenCalledTimes(1)
    expect(output()).toContain('googleWorkspaceOperationState_cancelled')
  })
  it('stops polling after completion and does not cancel completed work on close', async () => {
    await mount()
    await act(async () => { button('googleWorkspaceConnect').props.onClick() })
    api.status.mockResolvedValueOnce(state({ auth: { state: 'connected', scopes: ['openid'] }, operation: { id: 'login-1', kind: 'login', state: 'succeeded' } }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(output()).toContain('googleWorkspaceAuth_connected')
    const calls = api.status.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(api.status).toHaveBeenCalledTimes(calls)
    await act(async () => { renderer!.unmount() })
    renderer = undefined
    expect(api.cancel).not.toHaveBeenCalled()
  })
  it('offers manual setup without secret input or fabricated connection', async () => {
    api.status.mockResolvedValueOnce(state({ auth: { state: 'setup_required', scopes: [] } }))
    await mount()
    expect(output()).toContain('googleWorkspaceSetupStep3')
    expect(renderer!.root.findAllByType('input')).toHaveLength(0)
    expect(button('googleWorkspaceConnect').props.disabled).toBe(true)
    await act(async () => { button('googleWorkspaceSetup').props.onClick() })
    expect(api.setup).toHaveBeenCalledTimes(1)
    expect(api.login).not.toHaveBeenCalled()
  })
  it('requires confirmation for local credential removal and respects dismissal', async () => {
    api.status.mockResolvedValueOnce(state({ auth: { state: 'connected', scopes: [] } }))
    await mount()
    vi.mocked(window.confirm).mockReturnValueOnce(false)
    await act(async () => { button('googleWorkspaceDisconnect').props.onClick() })
    expect(api.logout).not.toHaveBeenCalled()
    await act(async () => { button('googleWorkspaceDisconnect').props.onClick() })
    expect(window.confirm).toHaveBeenCalledWith('googleWorkspaceDisconnectConfirm')
    expect(api.logout).toHaveBeenCalledTimes(1)
  })
  it('cancels a pending test on navigation and allows retry after failed status', async () => {
    api.status.mockRejectedValueOnce(new Error('private process output'))
    await mount()
    expect(output()).toContain('googleWorkspaceStatusError')
    expect(output()).not.toContain('private process output')
    api.status.mockResolvedValueOnce(state({ auth: { state: 'connected', scopes: [] } }))
    await act(async () => { renderer!.root.findAllByType('button').find((node) => String(node.props.children).includes('googleWorkspaceRefresh'))!.props.onClick() })
    const result = deferred<GoogleWorkspaceStatus>()
    api.test.mockReturnValueOnce(result.promise)
    await act(async () => { button('googleWorkspaceTest').props.onClick() })
    await act(async () => { renderer!.unmount() })
    renderer = undefined
    result.resolve(state())
    expect(api.cancel).toHaveBeenCalledTimes(1)
  })
  it('does not cancel operations only observed on mount', async () => {
    api.status.mockResolvedValueOnce(loginRunning())
    await mount()
    await act(async () => { renderer!.unmount() })
    renderer = undefined
    expect(api.cancel).not.toHaveBeenCalled()
    expect(api.openAuthorization).not.toHaveBeenCalled()
  })
})
