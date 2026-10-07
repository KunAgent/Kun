import {
  fixture,
  getExtensionIpcElectronMock,
  resetExtensionIpcHandlerTestState
} from './register-extension-ipc-handlers.test-support'
import {
  resolve
} from 'node:path'
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'
import {
  NativeDialogCoordinator
} from '../native-dialog-coordinator'
import {
  startExtensionNotificationPump,
  startExtensionSecretRevealConsentPump
} from './register-extension-ipc-handlers'

const electronMock = getExtensionIpcElectronMock()

describe('extension IPC security bridge pumps', () => {
  beforeEach(resetExtensionIpcHandlerTestState)

  it('pumps one-shot raw secret decisions through a Main-owned warning dialog', async () => {
    const state = fixture()
    state.runtimeRequest.mockImplementation(async (path: string, method?: string) => {
      if (path === '/v1/extensions/secret-reveal-requests' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            requests: [{
              id: 'secret_reveal_12345678-1234-1234-1234-123456789abc',
              extensionId: 'acme.example',
              extensionVersion: '1.2.3',
              accountId: 'account-123',
              operation: 'sign-request'
            }]
          })
        }
      }
      return { ok: true, status: 200, body: '{}' }
    })
    electronMock.showMessageBox.mockResolvedValue({ response: 1 })

    const stop = startExtensionSecretRevealConsentPump(state.options, 10_000)
    await vi.waitFor(() => expect(electronMock.showMessageBox).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(state.runtimeRequest).toHaveBeenCalledWith(
      '/v1/extensions/secret-reveal-requests/secret_reveal_12345678-1234-1234-1234-123456789abc/decision',
      'POST',
      JSON.stringify({ decision: 'allow' })
    ))
    stop()
  })

  it('backs off and deduplicates repeated secret reveal pump failures', async () => {
    vi.useFakeTimers()
    try {
      const state = fixture()
      const logError = vi.fn()
      state.runtimeRequest.mockRejectedValue(new Error('fetch failed'))
      const stop = startExtensionSecretRevealConsentPump({
        ...state.options,
        logError
      }, 250)

      await vi.advanceTimersByTimeAsync(0)
      expect(state.runtimeRequest).toHaveBeenCalledTimes(1)
      expect(logError).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(499)
      expect(state.runtimeRequest).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(state.runtimeRequest).toHaveBeenCalledTimes(2)
      expect(logError).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(999)
      expect(state.runtimeRequest).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(state.runtimeRequest).toHaveBeenCalledTimes(3)
      expect(logError).toHaveBeenCalledTimes(1)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits for a pending Main-owned dialog before opening a secret reveal prompt (#1053)', async () => {
    const state = fixture()
    state.runtimeRequest.mockImplementation(async (path: string, method?: string) => {
      if (path === '/v1/extensions/secret-reveal-requests' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            requests: [{
              id: 'secret_reveal_12345678-1234-1234-1234-123456789abc',
              extensionId: 'acme.example',
              extensionVersion: '1.2.3',
              accountId: 'account-123',
              operation: 'sign-request'
            }]
          })
        }
      }
      return { ok: true, status: 200, body: '{}' }
    })
    electronMock.showMessageBox.mockResolvedValue({ response: 1 })
    const nativeDialogs = new NativeDialogCoordinator()
    let releaseBlockingDialog!: () => void
    const blockingDialog = nativeDialogs.run(state.mainContents, () => new Promise<void>((resolve) => {
      releaseBlockingDialog = resolve
    }))

    const stop = startExtensionSecretRevealConsentPump({
      ...state.options,
      nativeDialogs
    }, 10_000)
    await vi.waitFor(() => expect(releaseBlockingDialog).toBeTypeOf('function'))
    await vi.waitFor(() => expect(state.runtimeRequest).toHaveBeenCalledWith(
      '/v1/extensions/secret-reveal-requests',
      'GET'
    ))
    expect(electronMock.showMessageBox).not.toHaveBeenCalled()

    releaseBlockingDialog()
    await blockingDialog
    await vi.waitFor(() => expect(electronMock.showMessageBox).toHaveBeenCalledOnce())
    stop()
  })

  it('projects validated runtime notification snapshots and returns trusted user actions', async () => {
    const state = fixture()
    const notificationId = 'notification_12345678-1234-1234-1234-123456789abc'
    state.runtimeRequest.mockImplementation(async (path: string, method?: string, body?: string) => {
      if (path === '/v1/extensions/workbench/notifications' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            schemaVersion: 1,
            notifications: [{
              notificationId,
              extensionId: 'acme.example',
              extensionVersion: '1.2.3',
              sourceId: 'provider-warning',
              title: 'Provider unavailable',
              message: 'Reconnect the account and retry.',
              severity: 'warning',
              actions: [{ id: 'retry', title: 'Retry' }],
              createdAt: '2026-07-11T00:00:00.000Z',
              expiresAt: '2026-07-11T00:01:00.000Z'
            }]
          })
        }
      }
      if (path.endsWith(`/${notificationId}/respond`) && method === 'POST') {
        expect(body).toBe(JSON.stringify({ actionId: 'retry' }))
        return { ok: true, status: 200, body: JSON.stringify({ responded: true }) }
      }
      return { ok: false, status: 404, body: '{}' }
    })

    const stop = startExtensionNotificationPump(state.options, 10_000)
    const workbench = state.mainContents
    await vi.waitFor(() => expect(workbench.send).toHaveBeenCalledWith(
      'extension:notifications',
      {
        notifications: [expect.objectContaining({
          notificationId,
          extensionId: 'acme.example',
          actions: [{ id: 'retry', title: 'Retry' }]
        })]
      }
    ))
    stop()
    await vi.waitFor(() => expect(state.runtimeRequest).toHaveBeenCalledWith(
      '/v1/extensions/workbench/presence',
      'DELETE'
    ))

    await expect(electronMock.handlers.get('extension:notification:respond')!(
      state.trustedEvent,
      { notificationId, actionId: 'retry' }
    )).resolves.toBe(true)
    await expect(electronMock.handlers.get('extension:notification:respond')!(
      state.untrustedEvent,
      { notificationId, actionId: 'retry' }
    )).rejects.toThrow(/trusted workbench frame/)
  })

  it('resets notification pump backoff after the runtime recovers', async () => {
    vi.useFakeTimers()
    try {
      const state = fixture()
      const logError = vi.fn()
      state.runtimeRequest
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          body: JSON.stringify({ schemaVersion: 1, notifications: [] })
        })
        .mockRejectedValueOnce(new Error('fetch failed'))
      const stop = startExtensionNotificationPump({
        ...state.options,
        logError
      }, 250)

      await vi.advanceTimersByTimeAsync(0)
      expect(state.runtimeRequest).toHaveBeenCalledTimes(1)
      expect(logError).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(500)
      expect(state.runtimeRequest).toHaveBeenCalledTimes(2)
      expect(logError).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(250)
      expect(state.runtimeRequest).toHaveBeenCalledTimes(3)
      expect(logError).toHaveBeenCalledTimes(2)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stretches the notification pump cadence while the queue stays empty and snaps back on work', async () => {
    vi.useFakeTimers()
    try {
      const state = fixture()
      let notifications: unknown[] = []
      state.runtimeRequest.mockImplementation(async () => ({
        ok: true,
        status: 200,
        body: JSON.stringify({ schemaVersion: 1, notifications })
      }))
      const stop = startExtensionNotificationPump(state.options, 250)
      await vi.advanceTimersByTimeAsync(0)
      // Four empty polls keep the base cadence before the stretch begins.
      await vi.advanceTimersByTimeAsync(1_000)
      expect(state.runtimeRequest).toHaveBeenCalledTimes(5)
      await vi.advanceTimersByTimeAsync(499)
      expect(state.runtimeRequest).toHaveBeenCalledTimes(5)
      await vi.advanceTimersByTimeAsync(1)
      expect(state.runtimeRequest).toHaveBeenCalledTimes(6)
      await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000)
      expect(state.runtimeRequest).toHaveBeenCalledTimes(9)
      await vi.advanceTimersByTimeAsync(3_999)
      expect(state.runtimeRequest).toHaveBeenCalledTimes(9)
      notifications = []
      await vi.advanceTimersByTimeAsync(1)
      expect(state.runtimeRequest).toHaveBeenCalledTimes(10)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('dispatches fire-and-forget guest notifications through the broker route', async () => {
    const state = fixture()
    const record = state.viewSessions.create({
      sessionId: 'view_12345678-1234-1234-1234-123456789abc',
      nonce: 'n'.repeat(43),
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'extension:acme.example/issues',
      entryPath: 'dist/index.html',
      parentWebContentsId: 1
    })
    state.viewSessions.prepareAttach(1, record.sourceUrl)
    const guest = { id: 20, once: vi.fn() }
    state.viewSessions.bindNextGuest(1, guest as never)

    await electronMock.handlers.get('extension:view:notify')!(
      { sender: guest },
      {
        sessionId: record.sessionId,
        sessionNonce: record.nonce,
        method: 'ui.setViewState',
        params: { value: { selected: 'item-1' } }
      }
    )

    expect(state.runtimeRequest).toHaveBeenCalledWith(
      `/v1/extensions/view-sessions/${record.runtimeSessionId}/requests`,
      'POST',
      expect.stringMatching(/"requestId":"view-notify-[^"]+".*"method":"ui\.setViewState"/),
      {
        'x-kun-extension-session-id': record.runtimeSessionId,
        'x-kun-extension-session-nonce': record.nonce
      }
    )
  })

})
