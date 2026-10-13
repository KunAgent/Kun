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
const pending = { id: 'auth-id', url: 'https://accounts.google.com/o/oauth2/v2/auth', status: 'pending',
  expiresAt: '2099-01-01T00:00:00.000Z' }

describe('Gmail conversation permission and human connection controls', () => {
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
  const button = (label: string) => renderer!.root.findAllByType('button').find((entry) => entry.children.includes(label))!
  const text = () => JSON.stringify(renderer!.toJSON())

  it('checks status without authorizing, preparing a model, or granting access', async () => {
    await mount()
    expect(mocks.status).toHaveBeenCalledWith(binding, expect.any(AbortSignal))
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(mocks.localStatus).not.toHaveBeenCalled()
    expect(mocks.prepareLocal).not.toHaveBeenCalled()
    expect(renderer!.root.findByType('input').props.checked).toBe(false)
    await act(async () => button('Connect Google account').props.onClick())
    expect(mocks.authorize).toHaveBeenCalledWith(binding, false)
    expect(renderer!.root.findByProps({ className: 'gmail-waiting' })).toBeDefined()
  })

  it('sends conversation permission only after a human checks the box', async () => {
    await mount()
    await act(async () => renderer!.root.findByType('input').props.onChange({ target: { checked: true } }))
    expect(mocks.sharing).not.toHaveBeenCalled()
    await act(async () => button('Connect Google account').props.onClick())
    expect(mocks.authorize).toHaveBeenCalledWith(binding, true)
  })

  it('needs a connected mailbox and conversation permission before continuing', async () => {
    const continued = vi.fn()
    mocks.status.mockResolvedValue(connection({ connected: true, email: 'owner@example.com', scopes }))
    mocks.sharing.mockResolvedValue(connection({ connected: true, scopes, allowModelSharing: true }))
    await mount({ onContinue: continued })
    expect(button('Continue this task').props.disabled).toBe(true)
    await act(async () => renderer!.root.findByType('input').props.onChange({ target: { checked: true } }))
    expect(mocks.sharing).toHaveBeenCalledWith(binding, true)
    mocks.status.mockResolvedValue(connection({ connected: true, scopes, allowModelSharing: true }))
    await act(async () => button('Continue this task').props.onClick())
    expect(continued).toHaveBeenCalledOnce()
  })

  it('cancels the current attempt with a normal notice and offers retry', async () => {
    mocks.cancel.mockResolvedValue({ ...pending, status: 'cancelled' })
    await mount()
    await act(async () => button('Connect Google account').props.onClick())
    await act(async () => button('Cancel').props.onClick())
    expect(mocks.cancel).toHaveBeenCalledWith(binding, 'auth-id')
    expect(renderer!.root.findByProps({ className: 'gmail-notice' }).children.join('')).toContain('Connection cancelled')
    expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
    await act(async () => button('Retry connection').props.onClick())
    expect(mocks.authorize).toHaveBeenCalledTimes(2)
  })

  it('requires a separate confirmation for Google-wide revocation', async () => {
    mocks.status.mockResolvedValue(connection({ connected: true, scopes, allowModelSharing: true }))
    mocks.disconnect.mockResolvedValue(connection())
    await mount()
    await act(async () => button('Also revoke Kun’s Google access').props.onClick())
    expect(mocks.disconnect).not.toHaveBeenCalled()
    const warning = renderer!.root.findByProps({ className: 'gmail-revoke-confirm' })
    expect(warning.findByType('p').children.join('')).toContain('other Kun clients')
    await act(async () => button('Revoke Google access').props.onClick())
    expect(mocks.disconnect).toHaveBeenCalledWith(binding, true)
    await mount()
    await act(async () => button('Disconnect').props.onClick())
    expect(mocks.disconnect).toHaveBeenLastCalledWith(binding, false)
  })

  it('polls only the explicit authorization and displays the connected email', async () => {
    vi.useFakeTimers()
    mocks.poll.mockResolvedValue({ ...pending, status: 'connected' })
    await mount()
    await act(async () => button('Connect Google account').props.onClick())
    mocks.status.mockResolvedValue(connection({ connected: true, scopes, email: 'owner@example.com' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(mocks.poll).toHaveBeenCalledWith(binding, 'auth-id', expect.any(AbortSignal))
    expect(renderer!.root.findByProps({ className: 'gmail-connected-email' }).children).toContain('owner@example.com')
    expect(mocks.sharing).not.toHaveBeenCalled()
  })

  it('resets consent when the conversation changes', async () => {
    mocks.status.mockResolvedValueOnce(connection({ connected: true, scopes, allowModelSharing: true }))
    await mount()
    expect(renderer!.root.findByType('input').props.checked).toBe(true)
    await act(async () => renderer!.update(createElement(GmailConnectionCard, { binding: { threadId: 'other-thread' } })))
    expect(renderer!.root.findByType('input').props.checked).toBe(false)
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it('renders request text inertly without email HTML or remote images', async () => {
    const body = '<img src="https://tracking.example/pixel" onerror="alert(1)">'
    await mount({ body })
    expect(renderer!.root.findAllByType('img')).toHaveLength(0)
    expect(renderer!.root.findAllByType('p').some((entry) => entry.children.includes(body))).toBe(true)
  })

  it('keeps consent and connection available regardless of selected provider or old review flags', async () => {
    mocks.status.mockResolvedValue(connection({ modelSharingAvailable: false,
      modelSharingReason: 'deepseek_api_account_not_reviewed', modelProviderName: 'Any custom provider' }))
    await mount()
    expect(renderer!.root.findByType('input').props.disabled).toBe(false)
    expect(button('Connect Google account').props.disabled).toBe(false)
    expect(text()).not.toContain('account review')
    expect(text()).not.toContain('Ollama')
    expect(text()).not.toContain('DeepSeek')
    expect(text()).toContain('currently configured models')
    expect(text()).toContain('routing and failover')
    expect(text()).toContain('no universal guarantee')
  })

  it('does not reuse a legacy grant as permission for all configured models', async () => {
    mocks.status.mockResolvedValue(connection({ connected: true, scopes, allowModelSharing: true,
      modelSharingRecipient: undefined }))
    await mount({ onContinue: vi.fn() })
    expect(renderer!.root.findByType('input').props.checked).toBe(false)
    expect(renderer!.root.findByType('input').props.disabled).toBe(false)
    expect(button('Continue this task').props.disabled).toBe(true)
  })

  it('preserves current conversation permission when the model changes', async () => {
    mocks.status.mockResolvedValue(connection({ connected: true, scopes, allowModelSharing: true, modelProviderName: 'First provider' }))
    await mount({ onContinue: vi.fn() })
    mocks.status.mockResolvedValue(connection({ connected: true, scopes, allowModelSharing: true,
      modelProviderName: 'Different provider', modelSharingAvailable: false }))
    await act(async () => button('Refresh').props.onClick())
    expect(renderer!.root.findByType('input').props.checked).toBe(true)
    expect(button('Continue this task').props.disabled).toBe(false)
    expect(mocks.sharing).not.toHaveBeenCalled()
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
    expect(renderer!.root.findByType('input').props.disabled).toBe(true)
    expect(button('Refresh').props.disabled).toBe(false)
  })

  it('recovers after a failed status request without authorizing automatically', async () => {
    mocks.status.mockRejectedValueOnce(new Error('offline'))
    await mount()
    expect(text()).toContain('Could not check Gmail')
    mocks.status.mockResolvedValue(connection())
    await act(async () => button('Refresh').props.onClick())
    expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
    expect(button('Connect Google account').props.disabled).toBe(false)
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it('handles an expired attempt and starts a fresh one on retry', async () => {
    vi.useFakeTimers()
    mocks.poll.mockResolvedValue({ ...pending, status: 'expired' })
    await mount()
    await act(async () => button('Connect Google account').props.onClick())
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(text()).toContain('This authorization expired')
    mocks.authorize.mockResolvedValue({ ...pending, id: 'new-auth-id' })
    await act(async () => button('Retry connection').props.onClick())
    expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
    expect(mocks.authorize).toHaveBeenCalledTimes(2)
  })

  it('rechecks scopes before resuming even when the checkbox is enabled', async () => {
    const continued = vi.fn()
    mocks.status.mockResolvedValue(connection({ connected: true, scopes, allowModelSharing: true }))
    await mount({ onContinue: continued })
    mocks.status.mockResolvedValue(connection({ connected: true, scopes: [scopes[0]], allowModelSharing: true }))
    await act(async () => button('Continue this task').props.onClick())
    expect(continued).not.toHaveBeenCalled()
    expect(text()).toContain('allow this conversation')
  })

  it('never authorizes or grants access during StrictMode mounting', async () => {
    await act(async () => { renderer = create(createElement(StrictMode, null, createElement(GmailConnectionCard, { binding }))) })
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(mocks.sharing).not.toHaveBeenCalled()
    expect(mocks.localStatus).not.toHaveBeenCalled()
    expect(renderer!.root.findByType('input').props.checked).toBe(false)
  })
})
