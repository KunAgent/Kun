import { createElement, StrictMode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import type { GmailConversationStatus } from '@shared/gmail-api'
import { GmailConnectionCard } from './GmailConnectionCard'

const mocks = vi.hoisted(() => ({ status: vi.fn(), authorize: vi.fn(), poll: vi.fn(), cancel: vi.fn(),
  sharing: vi.fn(), disconnect: vi.fn(), localStatus: vi.fn(), prepareLocal: vi.fn() }))
vi.mock('./gmail-client', () => ({ gmailClient: mocks }))
const binding = { roomId: 'private-room', messageId: 'mail-card' }
const scopes = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send']
const connection = (patch: Partial<GmailConversationStatus> = {}): GmailConversationStatus => ({
  configured: true, connected: false, reconnectRequired: false, scopes: [], allowModelSharing: false,
  modelSharingAvailable: true, modelProcessingRecipient: 'configured-models',
  ...(patch.allowModelSharing ? { modelSharingRecipient: 'configured-models' as const } : {}), ...patch
})
const ready = (patch: Partial<GmailConversationStatus> = {}) =>
  connection({ connected: true, scopes, allowModelSharing: true, email: 'owner@example.com', ...patch })
const pending = { id: 'auth-id', url: 'https://accounts.google.com/o/oauth2/v2/auth', status: 'pending',
  expiresAt: '2099-01-01T00:00:00.000Z' }

describe('Gmail one-click connection card', () => {
  let renderer: ReactTestRenderer | undefined
  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await i18n.changeLanguage('en')
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.status.mockResolvedValue(connection())
    mocks.authorize.mockResolvedValue(pending)
  })
  afterEach(() => { if (renderer) act(() => renderer?.unmount()); vi.useRealTimers() })
  const mount = async (props: Record<string, unknown> = {}) => {
    if (renderer) act(() => renderer?.unmount())
    await act(async () => { renderer = create(createElement(GmailConnectionCard, { binding, ...props })) })
  }
  const buttons = (label: string) => renderer!.root.findAllByType('button').filter((entry) => entry.children.includes(label))
  const button = (label: string) => buttons(label)[0]!
  const click = async (label: string) => { await act(async () => button(label).props.onClick()) }
  const text = () => JSON.stringify(renderer!.toJSON())

  it('checks status on mount without authorizing, and treats the connect click as the conversation grant', async () => {
    await mount()
    expect(mocks.status).toHaveBeenCalledWith(binding, expect.any(AbortSignal))
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(mocks.sharing).not.toHaveBeenCalled()
    expect(mocks.localStatus).not.toHaveBeenCalled()
    expect(renderer!.root.findAllByType('input')).toHaveLength(0)
    await click('Connect Google account')
    expect(mocks.authorize).toHaveBeenCalledWith(binding, true)
    expect(renderer!.root.findByProps({ className: 'gmail-waiting' })).toBeDefined()
  })

  it('keeps the consent sentence beside the button and the data policy one click away', async () => {
    mocks.status.mockResolvedValue(connection({ modelSharingAvailable: false,
      modelSharingReason: 'deepseek_api_account_not_reviewed', modelProviderName: 'Any custom provider' }))
    await mount()
    expect(button('Connect Google account').props.disabled).toBe(false)
    expect(text()).toContain('currently configured models')
    expect(text()).toContain('Any custom provider')
    expect(text()).not.toContain('routing and failover')
    await click('How your data is used')
    expect(text()).toContain('routing and failover')
    expect(text()).toContain('no universal guarantee')
    expect(text()).not.toContain('account review')
    expect(text()).not.toContain('Ollama')
  })

  it('continues the recorded task automatically once Google authorization completes', async () => {
    vi.useFakeTimers()
    const continued = vi.fn().mockResolvedValue(undefined)
    mocks.poll.mockResolvedValue({ ...pending, status: 'connected' })
    await mount({ onContinue: continued })
    await click('Connect Google account')
    mocks.status.mockResolvedValue(ready())
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(mocks.poll).toHaveBeenCalledWith(binding, 'auth-id', expect.any(AbortSignal))
    expect(continued).toHaveBeenCalledOnce()
    expect(mocks.sharing).not.toHaveBeenCalled()
    expect(renderer!.root.findByProps({ className: 'gmail-compact' })).toBeDefined()
    expect(text()).toContain('owner@example.com')
  })

  it('does not continue when Google returned without the required Gmail scopes', async () => {
    vi.useFakeTimers()
    const continued = vi.fn()
    mocks.poll.mockResolvedValue({ ...pending, status: 'connected' })
    await mount({ onContinue: continued })
    await click('Connect Google account')
    mocks.status.mockResolvedValue(ready({ scopes: [scopes[0]] }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(continued).not.toHaveBeenCalled()
    expect(text()).toContain('missing required Gmail permissions')
    expect(button('Retry connection')).toBeDefined()
  })

  it('asks before using an already linked account in this conversation', async () => {
    const continued = vi.fn().mockResolvedValue(undefined)
    mocks.status.mockResolvedValue(connection({ connected: true, scopes, email: 'owner@example.com' }))
    await mount({ onContinue: continued })
    expect(text()).toContain('owner@example.com')
    expect(continued).not.toHaveBeenCalled()
    mocks.sharing.mockResolvedValue(ready())
    mocks.status.mockResolvedValue(ready())
    await click('Use Gmail in this conversation')
    expect(mocks.sharing).toHaveBeenCalledWith(binding, true)
    expect(continued).toHaveBeenCalledOnce()
  })

  it('does not reuse a legacy grant as permission for all configured models', async () => {
    const continued = vi.fn()
    mocks.status.mockResolvedValue(ready({ modelSharingRecipient: undefined }))
    await mount({ onContinue: continued })
    expect(buttons('Use Gmail in this conversation')).toHaveLength(1)
    expect(buttons('Continue task')).toHaveLength(0)
    expect(continued).not.toHaveBeenCalled()
  })

  it('collapses to one line when ready and keeps the grant across model changes', async () => {
    const continued = vi.fn().mockResolvedValue(undefined)
    mocks.status.mockResolvedValue(ready({ modelProviderName: 'Different provider', modelSharingAvailable: false }))
    await mount({ onContinue: continued })
    expect(text()).toContain('Gmail connected')
    expect(button('Continue task').props.disabled).toBe(false)
    expect(continued).not.toHaveBeenCalled()
    await click('Continue task')
    expect(continued).toHaveBeenCalledOnce()
    expect(mocks.sharing).not.toHaveBeenCalled()
    await mount({ onContinue: continued, resumed: true })
    expect(buttons('Continue task')).toHaveLength(0)
  })

  it('rechecks scopes before resuming even when the card looked ready', async () => {
    const continued = vi.fn()
    mocks.status.mockResolvedValue(ready())
    await mount({ onContinue: continued })
    mocks.status.mockResolvedValue(ready({ scopes: [scopes[0]] }))
    await click('Continue task')
    expect(continued).not.toHaveBeenCalled()
    expect(text()).toContain('missing required Gmail permissions')
  })

  it('cancels the current attempt with a normal notice and offers retry', async () => {
    mocks.cancel.mockResolvedValue({ ...pending, status: 'cancelled' })
    await mount()
    await click('Connect Google account')
    await click('Cancel')
    expect(mocks.cancel).toHaveBeenCalledWith(binding, 'auth-id')
    expect(renderer!.root.findByProps({ className: 'gmail-notice' }).children.join('')).toContain('Connection cancelled')
    expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
    await click('Retry connection')
    expect(mocks.authorize).toHaveBeenCalledTimes(2)
  })

  it('keeps account actions behind Manage and confirms Google-wide revocation separately', async () => {
    mocks.status.mockResolvedValue(ready())
    mocks.disconnect.mockResolvedValue(connection())
    await mount()
    expect(buttons('Disconnect')).toHaveLength(0)
    await click('Manage')
    await click('Also revoke Kun’s Google access')
    expect(mocks.disconnect).not.toHaveBeenCalled()
    const warning = renderer!.root.findByProps({ className: 'gmail-revoke-confirm' })
    expect(warning.findByType('p').children.join('')).toContain('other Kun clients')
    await click('Revoke Google access')
    expect(mocks.disconnect).toHaveBeenCalledWith(binding, true)
    mocks.status.mockResolvedValue(ready())
    await mount()
    await click('Manage')
    await click('Disconnect')
    expect(mocks.disconnect).toHaveBeenLastCalledWith(binding, false)
  })

  it('stops Gmail for this conversation without disconnecting the account', async () => {
    mocks.status.mockResolvedValue(ready())
    mocks.sharing.mockResolvedValue(connection({ connected: true, scopes, email: 'owner@example.com' }))
    await mount()
    await click('Manage')
    await click('Stop using Gmail in this conversation')
    expect(mocks.sharing).toHaveBeenCalledWith(binding, false)
    expect(mocks.disconnect).not.toHaveBeenCalled()
    expect(buttons('Use Gmail in this conversation')).toHaveLength(1)
  })

  it('switching accounts from a linked card does not grant this conversation', async () => {
    mocks.status.mockResolvedValue(connection({ connected: true, scopes, email: 'owner@example.com' }))
    await mount()
    await click('Manage')
    await click('Switch Google account')
    expect(mocks.authorize).toHaveBeenCalledWith(binding, false)
  })

  it('renders request text inertly without email HTML or remote images', async () => {
    const body = '<img src="https://tracking.example/pixel" onerror="alert(1)">'
    await mount({ body })
    expect(renderer!.root.findAllByType('img')).toHaveLength(0)
    expect(renderer!.root.findAllByType('p').some((entry) => entry.children.includes(body))).toBe(true)
  })

  it('shows neutral loading text without a default local-model disclosure', async () => {
    let resolve!: (status: GmailConversationStatus) => void
    mocks.status.mockReturnValueOnce(new Promise<GmailConversationStatus>((done) => { resolve = done }))
    await mount()
    expect(text()).toContain('Checking')
    expect(text()).not.toContain('Ollama')
    expect(text()).not.toContain('DeepSeek')
    expect(button('Connect Google account').props.disabled).toBe(true)
    await act(async () => resolve(connection()))
    expect(button('Connect Google account').props.disabled).toBe(false)
  })

  it('keeps authorization disabled only when the Gmail client is missing', async () => {
    mocks.status.mockResolvedValue(connection({ configured: false }))
    await mount()
    expect(button('Connect Google account').props.disabled).toBe(true)
    expect(text()).toContain('not configured')
  })

  it('recovers after a failed status request without authorizing automatically', async () => {
    mocks.status.mockRejectedValueOnce(new Error('offline'))
    await mount()
    expect(text()).toContain('Could not check Gmail')
    mocks.status.mockResolvedValue(connection())
    await click('Refresh')
    expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
    expect(button('Connect Google account').props.disabled).toBe(false)
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it('handles an expired attempt and starts a fresh one on retry', async () => {
    vi.useFakeTimers()
    mocks.poll.mockResolvedValue({ ...pending, status: 'expired' })
    await mount()
    await click('Connect Google account')
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(text()).toContain('This authorization expired')
    mocks.authorize.mockResolvedValue({ ...pending, id: 'new-auth-id' })
    await click('Retry connection')
    expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
    expect(mocks.authorize).toHaveBeenCalledTimes(2)
  })

  it('resets the card when the conversation changes', async () => {
    mocks.status.mockResolvedValueOnce(ready())
    await mount()
    expect(text()).toContain('Gmail connected')
    await act(async () => renderer!.update(createElement(GmailConnectionCard, { binding: { threadId: 'other-thread' } })))
    expect(text()).not.toContain('Gmail connected')
    expect(buttons('Connect Google account')).toHaveLength(1)
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it('never authorizes or grants access during StrictMode mounting', async () => {
    await act(async () => { renderer = create(createElement(StrictMode, null, createElement(GmailConnectionCard, { binding }))) })
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(mocks.sharing).not.toHaveBeenCalled()
    expect(mocks.localStatus).not.toHaveBeenCalled()
  })
})
