import { createElement } from 'react'
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
  modelSharingAvailable: true, modelProcessingRecipient: 'kun-managed-local', modelProcessingConsentId: 'route-stamp',
  ...(patch.allowModelSharing ? { modelSharingRecipient: 'kun-managed-local' as const } : {}), ...patch
})
const pending = { id: 'auth-id', url: 'https://accounts.google.com/o/oauth2/v2/auth', status: 'pending',
  expiresAt: '2099-01-01T00:00:00.000Z' }

describe('Gmail human connection and sharing controls', () => {
  let renderer: ReactTestRenderer | undefined
  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await i18n.changeLanguage('en')
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.status.mockResolvedValue(connection())
    mocks.authorize.mockResolvedValue(pending)
    mocks.localStatus.mockResolvedValue({ installed: false, running: false, ready: false, preparing: false, model: 'qwen3:4b' })
  })
  afterEach(() => { if (renderer) act(() => renderer?.unmount()); vi.useRealTimers() })
  const mount = async (props: Record<string, unknown> = {}) => {
    if (renderer) act(() => renderer?.unmount())
    await act(async () => { renderer = create(createElement(GmailConnectionCard, { binding, ...props })) })
  }
  const button = (label: string) => renderer!.root.findAllByType('button').find((entry) => entry.children.includes(label))!

  it('loads status without authorizing and keeps data sharing off by default', async () => {
    await mount()
    expect(mocks.status).toHaveBeenCalledWith(binding, expect.any(AbortSignal))
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(renderer!.root.findByType('input').props.checked).toBe(false)
    await act(async () => button('Connect in system browser').props.onClick())
    expect(mocks.authorize).toHaveBeenCalledWith(binding, false, 'kun-managed-local', 'route-stamp')
    expect(renderer!.root.findByProps({ className: 'gmail-waiting' })).toBeDefined()
  })

  it('only forwards model-sharing consent after a human checks it', async () => {
    await mount()
    await act(async () => renderer!.root.findByType('input').props.onChange({ target: { checked: true } }))
    expect(mocks.sharing).not.toHaveBeenCalled()
    await act(async () => button('Connect in system browser').props.onClick())
    expect(mocks.authorize).toHaveBeenCalledWith(binding, true, 'kun-managed-local', 'route-stamp')
  })

  it('does not let a connected mailbox resume the task without the conversation grant', async () => {
    const continued = vi.fn()
    mocks.status.mockResolvedValue(connection({ connected: true, email: 'owner@example.com', scopes }))
    mocks.sharing.mockResolvedValue(connection({ connected: true, scopes, allowModelSharing: true }))
    await mount({ onContinue: continued })
    expect(button('Continue this task').props.disabled).toBe(true)
    await act(async () => renderer!.root.findByType('input').props.onChange({ target: { checked: true } }))
    expect(mocks.sharing).toHaveBeenCalledWith(binding, true, 'kun-managed-local', 'route-stamp')
    mocks.status.mockResolvedValue(connection({ connected: true, scopes, allowModelSharing: true }))
    await act(async () => button('Continue this task').props.onClick())
    expect(continued).toHaveBeenCalledOnce()
  })

  it('cancels only the explicit pending attempt', async () => {
    mocks.cancel.mockResolvedValue({ ...pending, status: 'cancelled' })
    await mount()
    await act(async () => button('Connect in system browser').props.onClick())
    await act(async () => button('Cancel').props.onClick())
    expect(mocks.cancel).toHaveBeenCalledWith(binding, 'auth-id')
    expect(renderer!.root.findAllByProps({ role: 'alert' })[0].children.join('')).toContain('Authorization cancelled')
  })

  it('disconnects locally by default and requires a separate project-wide revoke confirmation', async () => {
    mocks.status.mockResolvedValue(connection({ connected: true, scopes, allowModelSharing: true }))
    mocks.disconnect.mockResolvedValue(connection())
    await mount()
    await act(async () => button('Also revoke Kun’s Google access').props.onClick())
    expect(mocks.disconnect).not.toHaveBeenCalled()
    const warning = renderer!.root.findByProps({ className: 'gmail-revoke-confirm' })
    expect(warning.findByType('p').children.join('')).toContain('other Kun OAuth clients')
    await act(async () => button('Revoke Google access').props.onClick())
    expect(mocks.disconnect).toHaveBeenCalledWith(binding, true)
    await mount()
    await act(async () => button('Disconnect locally').props.onClick())
    expect(mocks.disconnect).toHaveBeenLastCalledWith(binding, false)
  })

  it('polls the same authorization and updates connected state without executing mail tools', async () => {
    vi.useFakeTimers()
    mocks.poll.mockResolvedValue({ ...pending, status: 'connected' })
    await mount()
    await act(async () => button('Connect in system browser').props.onClick())
    mocks.status.mockResolvedValue(connection({ connected: true, scopes, email: 'owner@example.com' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(mocks.poll).toHaveBeenCalledWith(binding, 'auth-id', expect.any(AbortSignal))
    expect(renderer!.root.findByProps({ className: 'gmail-connected-email' }).children).toContain('owner@example.com')
    expect(mocks.sharing).not.toHaveBeenCalled()
  })

  it('changes scope without carrying a previous conversation consent', async () => {
    mocks.status.mockResolvedValueOnce(connection({ connected: true, scopes, allowModelSharing: true }))
    await mount()
    expect(renderer!.root.findByType('input').props.checked).toBe(true)
    await act(async () => renderer!.update(createElement(GmailConnectionCard, { binding: { threadId: 'other-thread' } })))
    expect(renderer!.root.findByType('input').props.checked).toBe(false)
    expect(mocks.authorize).not.toHaveBeenCalled()
  })
  it('renders message text inertly and offers no remote email image or HTML execution', async () => {
    const body = '<img src="https://tracking.example/pixel" onerror="alert(1)">'
    await mount({ body })
    expect(renderer!.root.findAllByType('img')).toHaveLength(0)
    expect(renderer!.root.findAllByType('p').some((entry) => entry.children.includes(body))).toBe(true)
  })
  it('allows connection only but disables model sharing when the provider is not approved', async () => {
    mocks.status.mockResolvedValue(connection({ modelSharingAvailable: false, modelProviderName: 'Unreviewed provider' }))
    await mount({ onContinue: vi.fn() })
    expect(renderer!.root.findByType('input').props.disabled).toBe(true)
    expect(button('Connect in system browser').props.disabled).toBe(false)
    expect(renderer!.root.findAllByProps({ role: 'status' }).some((entry) => entry.children.join('').includes('local Ollama'))).toBe(true)
    expect(mocks.sharing).not.toHaveBeenCalled()
  })
  it('prepares the local model only after a human click and preserves the original task model', async () => {
    vi.useFakeTimers()
    mocks.status.mockResolvedValue(connection({ modelSharingAvailable: false }))
    const local = { installed: true, running: false, ready: false, preparing: false, model: 'qwen3:4b' }
    mocks.localStatus.mockResolvedValue(local)
    mocks.prepareLocal.mockResolvedValue({ ...local, preparing: true })
    const continued = vi.fn()
    await mount({ onContinue: continued })
    expect(mocks.prepareLocal).not.toHaveBeenCalled()
    await act(async () => button('Prepare local email model').props.onClick())
    expect(mocks.prepareLocal).toHaveBeenCalledWith(binding)
    mocks.localStatus.mockResolvedValue({ ...local, ready: true, running: true })
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(renderer!.root.findAllByType('small').some((entry) => entry.children.join('').includes('start a new conversation'))).toBe(true)
    expect(continued).not.toHaveBeenCalled()
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it('does not convert an old local grant into DeepSeek cloud consent', async () => {
    mocks.status.mockResolvedValue(connection({ connected: true, scopes, allowModelSharing: true,
      modelProcessingRecipient: 'deepseek-api', modelSharingRecipient: 'kun-managed-local' }))
    await mount({ onContinue: vi.fn() })
    expect(renderer!.root.findByType('input').props.checked).toBe(false)
    expect(button('Continue this task').props.disabled).toBe(true)
    expect(mocks.sharing).not.toHaveBeenCalled()
    expect(JSON.stringify(renderer!.toJSON())).toContain('api.deepseek.com')
    expect(JSON.stringify(renderer!.toJSON())).toContain('China')
    expect(JSON.stringify(renderer!.toJSON())).toContain('current conversation context')
    expect(JSON.stringify(renderer!.toJSON())).toContain('not promise zero retention')
  })

  it('binds new human cloud consent to the disclosed recipient and rechecks before continuing', async () => {
    const deepseek = connection({ connected: true, scopes, modelProcessingRecipient: 'deepseek-api' })
    mocks.status.mockResolvedValue(deepseek)
    mocks.sharing.mockResolvedValue({ ...deepseek, allowModelSharing: true, modelSharingRecipient: 'deepseek-api' })
    const continued = vi.fn()
    await mount({ onContinue: continued })
    await act(async () => renderer!.root.findByType('input').props.onChange({ target: { checked: true } }))
    expect(mocks.sharing).toHaveBeenCalledWith(binding, true, 'deepseek-api', 'route-stamp')
    mocks.status.mockResolvedValue({ ...deepseek, allowModelSharing: true, modelSharingRecipient: 'kun-managed-local' })
    await act(async () => button('Continue this task').props.onClick())
    expect(continued).not.toHaveBeenCalled()
    expect(renderer!.root.findByType('input').props.checked).toBe(false)
  })

  it('keeps unreviewed API accounts connection-only and explains the host prerequisite', async () => {
    mocks.status.mockResolvedValue(connection({ modelProcessingRecipient: 'deepseek-api',
      modelSharingAvailable: false, modelSharingReason: 'deepseek_api_account_not_reviewed' }))
    await mount()
    expect(renderer!.root.findByType('input').props.disabled).toBe(true)
    expect(button('Connect in system browser').props.disabled).toBe(false)
    expect(JSON.stringify(renderer!.toJSON())).toContain('exact API account and credential')
    expect(JSON.stringify(renderer!.toJSON())).toContain('cannot create that review')
  })

  it('does not trust a legacy sharing boolean without a recipient-bound grant', async () => {
    mocks.status.mockResolvedValue(connection({ connected: true, scopes, allowModelSharing: true,
      modelProcessingRecipient: undefined, modelSharingRecipient: undefined }))
    await mount({ onContinue: vi.fn() })
    expect(renderer!.root.findByType('input').props.checked).toBe(false)
    expect(button('Continue this task').props.disabled).toBe(true)
  })
})
