import {
  cleanupAppIpcHandlerTestState,
  createGate,
  expectRendererModelCredentialsRedacted,
  getAppIpcElectronMock,
  handlers,
  registerOptions,
  resetAppIpcHandlerTestState,
  settings,
  settingsWithPlaintextModelCredentials
} from './register-app-ipc-handlers.test-support'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'
import {
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {
  tmpdir
} from 'node:os'
import {
  join
} from 'node:path'
import {
  mergeKunRuntimeSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import {
  registerAppIpcHandlers
} from './register-app-ipc-handlers'

vi.mock('../main-window', () => ({
  trustedWorkbenchRendererUrl: () => 'http://127.0.0.1:5173/index.html'
}))

import {
  ApprovalConsentVerifier,
  KUN_APPROVAL_CONSENT_HEADER
} from '../../../kun/src/server/approval-consent.js'

const electronMock = getAppIpcElectronMock()

describe('registerAppIpcHandlers settings and approvals', () => {
  beforeEach(resetAppIpcHandlerTestState)
  afterEach(cleanupAppIpcHandlerTestState)

  it('initializes and opens only the fixed settings configuration file', async () => {
    const loaded = settings()
    const store = { load: vi.fn(async () => loaded), save: vi.fn(async () => undefined) }
    registerAppIpcHandlers(registerOptions({
      store: store as never,
      resolveSettingsConfigPath: () => '/private/Kun/kun-settings.json'
    }))

    await expect(handlers.get('settings:open-config-file')?.({})).resolves.toEqual({ ok: true })
    expect(store.save).toHaveBeenCalledWith(loaded)
    expect(electronMock.openPath).toHaveBeenCalledWith('/private/Kun/kun-settings.json')
  })

  it('reports failures while opening the settings configuration file', async () => {
    electronMock.openPath.mockResolvedValueOnce('No application can open this file')
    const store = { load: vi.fn(async () => settings()), save: vi.fn(async () => undefined) }
    registerAppIpcHandlers(registerOptions({ store: store as never }))

    await expect(handlers.get('settings:open-config-file')?.({})).resolves.toEqual({
      ok: false,
      message: 'No application can open this file'
    })
  })

  it('rejects invalid settings patches at the handler boundary', async () => {
    const applySettingsPatch = vi.fn(async () => settings())

    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const handler = handlers.get('settings:set')
    expect(handler).toBeTypeOf('function')
    await expect(
      handler?.({}, { agents: { kun: { mysteryFlag: true } } })
    ).rejects.toThrow(/Invalid payload for settings:set/)
    expect(applySettingsPatch).not.toHaveBeenCalled()
  })

  it('passes the conversation visualization toggle through settings:set', async () => {
    const applySettingsPatch = vi.fn(async () => settings())
    const payload = {
      agents: {
        kun: {
          lab: {
            conversationVisualization: { enabled: true }
          }
        }
      }
    }
    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    await expect(handlers.get('settings:set')?.({}, payload)).resolves.toEqual(settings())
    expect(applySettingsPatch).toHaveBeenCalledWith(payload)
  })

  it('includes the Zod path when settings:set rejects an empty primary model', async () => {
    const applySettingsPatch = vi.fn(async () => settings())

    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const handler = handlers.get('settings:set')
    await expect(
      handler?.({}, { agents: { kun: { model: '' } } })
    ).rejects.toThrow(/Invalid payload for settings:set: agents\.kun\.model: Too small/)
    expect(applySettingsPatch).not.toHaveBeenCalled()
  })

  it('redacts plaintext model credentials from settings:get without mutating the Main snapshot', async () => {
    const current = settingsWithPlaintextModelCredentials()
    const original = JSON.stringify(current)
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    const contents = { id: 7, mainFrame }
    registerAppIpcHandlers(registerOptions({
      store: { load: vi.fn(async () => current) } as never,
      getMainWindow: () => ({ isDestroyed: () => false, webContents: contents }) as never
    }))

    const result = await handlers.get('settings:get')?.({ sender: contents, senderFrame: mainFrame })

    expectRendererModelCredentialsRedacted(result)
    expect(JSON.stringify(current)).toBe(original)
  })

  it('redacts plaintext model credentials from both settings write responses', async () => {
    const persisted = settingsWithPlaintextModelCredentials()
    const original = JSON.stringify(persisted)
    const applySettingsPatch = vi.fn(async () => persisted)
    const saveSettingsPatch = vi.fn(async () => persisted)
    registerAppIpcHandlers(registerOptions({ applySettingsPatch, saveSettingsPatch }))

    const setResult = await handlers.get('settings:set')?.({}, { theme: 'dark' })
    const saveResult = await handlers.get('settings:save-silent')?.({}, { locale: 'zh' })

    expectRendererModelCredentialsRedacted(setResult)
    expectRendererModelCredentialsRedacted(saveResult)
    expect(applySettingsPatch).toHaveBeenCalledWith({ theme: 'dark' })
    expect(saveSettingsPatch).toHaveBeenCalledWith({ locale: 'zh' })
    expect(JSON.stringify(persisted)).toBe(original)
  })

  it('reveals only the requested provider credential to the trusted workbench', async () => {
    const projected = settingsWithPlaintextModelCredentials()
    const providerId = projected.provider.providers[0]!.id
    const stored: AppSettingsV1 = {
      ...projected,
      provider: {
        ...projected.provider,
        apiKey: '',
        providers: projected.provider.providers.map((provider) => ({
          ...provider,
          apiKey: ''
        }))
      }
    }
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    const contents = { id: 7, mainFrame }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    const trustedEvent = { sender: contents, senderFrame: mainFrame }
    const withRegistryCredentials = vi.fn(async () => projected)
    registerAppIpcHandlers(registerOptions({
      store: { load: vi.fn(async () => stored) } as never,
      getMainWindow: () => mainWindow as never,
      withRegistryCredentials
    }))

    await expect(handlers.get('model-provider:credential:reveal')?.(
      trustedEvent,
      { providerId }
    )).resolves.toEqual({ providerId, credential: 'provider-secret-0' })
    expect(withRegistryCredentials).toHaveBeenCalledOnce()
    expect(withRegistryCredentials).toHaveBeenCalledWith(stored, [providerId])
  })

  it('rejects untrusted provider credential reveal before loading protected settings', async () => {
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    const contents = { id: 7, mainFrame }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    const storeLoad = vi.fn(async () => settings())
    const withRegistryCredentials = vi.fn(async (value: AppSettingsV1) => value)
    registerAppIpcHandlers(registerOptions({
      store: { load: storeLoad } as never,
      getMainWindow: () => mainWindow as never,
      withRegistryCredentials
    }))

    await expect(handlers.get('model-provider:credential:reveal')?.(
      { sender: { id: 99 }, senderFrame: { processId: 90, routingId: 91, url: 'http://127.0.0.1:5173/index.html' } },
      { providerId: 'deepseek' }
    )).rejects.toThrow(/trusted workbench frame/)
    expect(storeLoad).not.toHaveBeenCalled()
    expect(withRegistryCredentials).not.toHaveBeenCalled()
  })

  it('requires trusted native confirmation before resetting unreadable credentials', async () => {
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    const contents = { id: 7, mainFrame }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    const resetUnreadableCredentials = vi.fn(async () => ({
      reset: true as const,
      backupPath: '/tmp/credential-recovery',
      movedItems: ['secret.key']
    }))
    registerAppIpcHandlers(registerOptions({
      getMainWindow: () => mainWindow as never,
      resetUnreadableCredentials
    }))
    const handler = handlers.get('credentials:reset-unreadable')

    await expect(handler?.({
      sender: { id: 99 },
      senderFrame: { processId: 90, routingId: 91, url: 'http://127.0.0.1:5173/index.html' }
    })).rejects.toThrow(/trusted workbench frame/)

    electronMock.showMessageBox.mockResolvedValueOnce({ response: 1 })
    await expect(handler?.({ sender: contents, senderFrame: mainFrame })).resolves.toEqual({ reset: false })
    expect(resetUnreadableCredentials).not.toHaveBeenCalled()

    electronMock.showMessageBox.mockResolvedValueOnce({ response: 0 })
    await expect(handler?.({ sender: contents, senderFrame: mainFrame })).resolves.toMatchObject({ reset: true })
    expect(resetUnreadableCredentials).toHaveBeenCalledOnce()
  })

  it('reports whether a workspace directory currently exists', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kun-workspace-exists-'))
    const filePath = join(root, 'not-a-directory')
    writeFileSync(filePath, 'file', 'utf8')
    registerAppIpcHandlers(registerOptions())

    const handler = handlers.get('workspace:directory-exists')
    expect(handler).toBeTypeOf('function')
    await expect(handler?.({}, root)).resolves.toBe(true)
    await expect(handler?.({}, filePath)).resolves.toBe(false)
    await expect(handler?.({}, join(root, 'missing'))).resolves.toBe(false)

    rmSync(root, { recursive: true, force: true })
  })

  it('passes valid settings patches through to applySettingsPatch', async () => {
    const applySettingsPatch = vi.fn(async () => settings())

    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const payload = {
      theme: 'dark' as const,
      agents: {
        kun: {
          port: 19000
        }
      }
    }
    const handler = handlers.get('settings:set')
    await expect(handler?.({}, payload)).resolves.toEqual(settings())
    expect(applySettingsPatch).toHaveBeenCalledWith(payload)
  })

  it('accepts ChatGPT subscription service tiers at the settings boundary', async () => {
    const applySettingsPatch = vi.fn(async () => settings())
    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))
    const payload = {
      provider: {
        providers: [{
          id: 'codex',
          name: 'ChatGPT 订阅',
          modelProfiles: {
            'gpt-5.6-sol': {
              serviceTiers: ['priority' as const]
            }
          }
        }]
      }
    }

    await expect(handlers.get('settings:set')?.({}, payload)).resolves.toEqual(settings())
    expect(applySettingsPatch).toHaveBeenCalledWith(payload)
  })

  it('accepts strict multi-account provider source metadata with routing settings', async () => {
    const applySettingsPatch = vi.fn(async () => settings())
    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))
    const payload = {
      provider: {
        providers: [{
          id: 'kimi-code-2',
          name: 'Kimi Code 2',
          presetSource: { presetId: 'kimi-code', mode: 'api' as const },
          models: ['kimi-for-coding']
        }],
        routePools: [{
          id: 'kimi-route', name: 'Kimi Route', modelId: 'kimi-auto', enabled: true, strategy: 'priority' as const,
          targets: [{ id: 'target-2', providerId: 'kimi-code-2', modelId: 'kimi-for-coding', enabled: true, weight: 1 }],
          failurePolicy: { failoverHttpStatusCodes: [429], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: true },
          healthPolicy: { failureThreshold: 3, cooldownMs: 60_000, halfOpenMaxAttempts: 1 }
        }]
      }
    }

    await expect(handlers.get('settings:set')?.({}, payload)).resolves.toEqual(settings())
    expect(applySettingsPatch).toHaveBeenCalledWith(payload)
  })

  it('preserves project grants instead of accepting them through generic settings writes', async () => {
    const applySettingsPatch = vi.fn(async () => settings())
    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    await handlers.get('settings:set')?.({}, {
      agents: {
        kun: {
          model: 'next-model',
          projectConfig: {
            grants: [{ workspaceRoot: '/workspace/forged', configDigest: 'a'.repeat(64) }]
          }
        }
      }
    })

    expect(applySettingsPatch).toHaveBeenCalledWith({
      agents: { kun: { model: 'next-model' } }
    })
  })

  it('does not persist renderer-requested full access without protected native consent', async () => {
    const current = settings()
    current.agents.kun = mergeKunRuntimeSettings(current.agents.kun, {
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      approvalReviewer: 'user'
    })
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    const contents = { id: 7, mainFrame }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    const applySettingsPatch = vi.fn(async () => settings())
    const saveSettingsPatch = vi.fn(async () => settings())
    registerAppIpcHandlers(registerOptions({
      store: { load: vi.fn(async () => current) } as never,
      getMainWindow: () => mainWindow as never,
      applySettingsPatch,
      saveSettingsPatch
    }))
    const payload = {
      agents: {
        kun: {
          approvalPolicy: 'auto' as const,
          sandboxMode: 'danger-full-access' as const,
          approvalReviewer: 'user' as const
        }
      }
    }
    const trustedEvent = { sender: contents, senderFrame: mainFrame }

    await expect(handlers.get('settings:set')?.({
      sender: { id: 99 },
      senderFrame: { processId: 90, routingId: 91, url: 'http://127.0.0.1:5173/index.html' }
    }, payload)).rejects.toThrow(/trusted workbench frame/)
    expect(applySettingsPatch).not.toHaveBeenCalled()

    // A Direct DOM synthetic click can at most make the trusted renderer send
    // this request. Cancelling the Main-owned prompt leaves settings unchanged.
    electronMock.showMessageBox.mockResolvedValueOnce({ response: 1 })
    await expect(handlers.get('settings:set')?.(trustedEvent, payload)).resolves.toEqual(current)
    expect(applySettingsPatch).not.toHaveBeenCalled()
    expect(electronMock.showMessageBox).toHaveBeenLastCalledWith(
      mainWindow,
      expect.objectContaining({
        detail: expect.stringContaining(
          'Full access lets Kun access any local file, execute host commands, and use network-capable tools'
        )
      })
    )

    electronMock.showMessageBox.mockResolvedValueOnce({ response: 0 })
    await handlers.get('settings:set')?.(trustedEvent, payload)
    expect(applySettingsPatch).toHaveBeenCalledWith(payload)

    electronMock.showMessageBox.mockResolvedValueOnce({ response: 1 })
    await handlers.get('settings:save-silent')?.(trustedEvent, payload)
    expect(saveSettingsPatch).not.toHaveBeenCalled()
  })

  it('uses the resolved shared runtime token after trusted native approval', async () => {
    const current = settings()
    const resolvedRuntimeToken = 'approval-runtime-secret'
    expect(current.agents.kun.runtimeToken).toBe('')
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    const contents = { id: 7, mainFrame }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    const leaseRequest = vi.fn(async (
      _path: string,
      _method?: string,
      _body?: string,
      _headers?: Record<string, string>
    ) => ({ ok: true, status: 200, body: '{}' }))
    const acquireRuntimeRequestLease = vi.fn(async () => ({
      runtimeToken: resolvedRuntimeToken,
      request: leaseRequest
    }))
    const runtimeRequest = vi.fn()
    registerAppIpcHandlers(registerOptions({
      store: { load: vi.fn(async () => current) } as never,
      getMainWindow: () => mainWindow as never,
      acquireRuntimeRequestLease,
      runtimeRequest
    }))
    const handler = handlers.get('approval:decide')!
    const payload = { approvalId: 'approval-1', decision: 'allow', source: 'user' }

    await expect(handler({
      sender: { id: 99 },
      senderFrame: { processId: 90, routingId: 91, url: 'http://127.0.0.1:5173/index.html' }
    }, payload)).rejects.toThrow(/trusted workbench frame/)
    expect(runtimeRequest).not.toHaveBeenCalled()
    expect(acquireRuntimeRequestLease).not.toHaveBeenCalled()

    electronMock.showMessageBox.mockResolvedValueOnce({ response: 1 })
    await expect(handler({ sender: contents, senderFrame: mainFrame }, payload))
      .resolves.toEqual({ confirmed: false })
    expect(runtimeRequest).not.toHaveBeenCalled()
    expect(acquireRuntimeRequestLease).not.toHaveBeenCalled()

    electronMock.showMessageBox.mockResolvedValueOnce({ response: 0 })
    await expect(handler({ sender: contents, senderFrame: mainFrame }, payload))
      .resolves.toMatchObject({ confirmed: true, response: { ok: true } })
    expect(acquireRuntimeRequestLease).toHaveBeenCalledOnce()
    expect(runtimeRequest).not.toHaveBeenCalled()
    expect(leaseRequest).toHaveBeenCalledOnce()
    const headers = leaseRequest.mock.calls[0]?.[3] as Record<string, string>
    const consent = headers[KUN_APPROVAL_CONSENT_HEADER]
    expect(consent).toMatch(/^v1\./)
    expect(new ApprovalConsentVerifier(resolvedRuntimeToken).verifyAndConsume({
      token: consent,
      approvalId: 'approval-1',
      decision: 'allow'
    })).toBe(true)
  })

  it('reveals the approval parent and records only a redacted native-dialog reference', async () => {
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    const contents = { id: 7, mainFrame }
    const restore = vi.fn()
    const show = vi.fn()
    const focus = vi.fn()
    const mainWindow = {
      isDestroyed: () => false,
      isMinimized: () => true,
      isVisible: () => false,
      isFocused: () => false,
      restore,
      show,
      focus,
      webContents: contents
    }
    const logInfo = vi.fn()
    const runtimeRequest = vi.fn(async () => ({ ok: true, status: 200, body: '{}' }))
    registerAppIpcHandlers(registerOptions({
      getMainWindow: () => mainWindow as never,
      runtimeRequest,
      logInfo
    }))
    electronMock.showMessageBox.mockResolvedValueOnce({ response: 1 })

    await expect(handlers.get('approval:decide')?.({
      sender: contents,
      senderFrame: mainFrame
    }, {
      approvalId: 'approval-secret-value',
      decision: 'allow',
      source: 'user'
    })).resolves.toEqual({ confirmed: false })

    expect(restore).toHaveBeenCalledOnce()
    expect(show).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledOnce()
    expect(electronMock.showMessageBox).toHaveBeenCalledWith(
      mainWindow,
      expect.objectContaining({
        detail: expect.stringContaining('Approval reference: sha256:')
      })
    )
    expect(electronMock.showMessageBox.mock.calls[0]?.[1]?.detail)
      .not.toContain('approval-secret-value')
    expect(logInfo).toHaveBeenCalledWith(
      'approval',
      'Opening protected native approval dialog.',
      expect.objectContaining({
        approvalRef: expect.stringMatching(/^sha256:[a-f0-9]{16}$/),
        windowBeforeReveal: expect.objectContaining({
          destroyed: false,
          visible: false,
          minimized: true,
          focused: false
        }),
        windowAfterReveal: expect.objectContaining({ destroyed: false })
      })
    )
    expect(logInfo).toHaveBeenCalledWith(
      'approval',
      'Protected native approval dialog resolved.',
      expect.objectContaining({ response: 1, confirmed: false })
    )
    expect(runtimeRequest).not.toHaveBeenCalled()
  })

  it('fails closed when the approval parent is destroyed while the native dialog closes', async () => {
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    let destroyed = false
    const contents = { id: 7, mainFrame, isDestroyed: () => destroyed }
    const mainWindow = { isDestroyed: () => destroyed, webContents: contents }
    const runtimeRequest = vi.fn(async () => ({ ok: true, status: 200, body: '{}' }))
    const logInfo = vi.fn()
    registerAppIpcHandlers(registerOptions({
      getMainWindow: () => mainWindow as never,
      runtimeRequest,
      logInfo
    }))
    electronMock.showMessageBox.mockImplementationOnce(async () => {
      destroyed = true
      return { response: 0 }
    })

    await expect(handlers.get('approval:decide')?.({
      sender: contents,
      senderFrame: mainFrame
    }, {
      approvalId: 'approval-parent-destroyed',
      decision: 'allow',
      source: 'user'
    })).resolves.toEqual({ confirmed: false })

    expect(runtimeRequest).not.toHaveBeenCalled()
    expect(logInfo).toHaveBeenCalledWith(
      'approval',
      'Protected native approval confirmation was not submitted.',
      expect.objectContaining({ reason: 'parent_or_sender_unavailable_after_confirmation' })
    )
  })

  it('fails closed when the approval sender navigates while the native dialog is open', async () => {
    const mainFrame = { processId: 10, routingId: 20, detached: false, url: 'http://127.0.0.1:5173/index.html' }
    const contents = {
      id: 7,
      mainFrame,
      isDestroyed: () => false
    }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    const runtimeRequest = vi.fn(async () => ({ ok: true, status: 200, body: '{}' }))
    const logInfo = vi.fn()
    registerAppIpcHandlers(registerOptions({
      getMainWindow: () => mainWindow as never,
      runtimeRequest,
      logInfo
    }))
    electronMock.showMessageBox.mockImplementationOnce(async () => {
      contents.mainFrame = { processId: 11, routingId: 21, detached: false, url: 'http://127.0.0.1:5173/index.html' }
      return { response: 0 }
    })

    await expect(handlers.get('approval:decide')?.({
      sender: contents,
      senderFrame: mainFrame
    }, {
      approvalId: 'approval-navigated',
      decision: 'allow',
      source: 'user'
    })).resolves.toEqual({ confirmed: false })

    expect(runtimeRequest).not.toHaveBeenCalled()
    expect(logInfo).toHaveBeenCalledWith(
      'approval',
      'Protected native approval confirmation was not submitted.',
      expect.objectContaining({ reason: 'parent_or_sender_unavailable_after_confirmation' })
    )
  })

  it('fails closed when the approval sender changes while the Runtime lease is acquired', async () => {
    const mainFrame = { processId: 10, routingId: 20, detached: false, url: 'http://127.0.0.1:5173/index.html' }
    const contents = {
      id: 7,
      mainFrame,
      isDestroyed: () => false
    }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    let releaseLease!: () => void
    const leaseGate = new Promise<void>((resolve) => { releaseLease = resolve })
    const leaseRequest = vi.fn(async () => ({ ok: true, status: 200, body: '{}' }))
    const acquireRuntimeRequestLease = vi.fn(async () => {
      await leaseGate
      return { runtimeToken: 'lease-token', request: leaseRequest }
    })
    const logInfo = vi.fn()
    registerAppIpcHandlers(registerOptions({
      getMainWindow: () => mainWindow as never,
      acquireRuntimeRequestLease,
      logInfo
    }))
    electronMock.showMessageBox.mockResolvedValueOnce({ response: 0 })

    const decision = handlers.get('approval:decide')?.({
      sender: contents,
      senderFrame: mainFrame
    }, {
      approvalId: 'approval-navigated-during-ensure',
      decision: 'allow',
      source: 'user'
    })
    await vi.waitFor(() => expect(acquireRuntimeRequestLease).toHaveBeenCalledOnce())
    contents.mainFrame = { processId: 11, routingId: 21, detached: false, url: 'http://127.0.0.1:5173/index.html' }
    releaseLease()

    await expect(decision).resolves.toEqual({ confirmed: false })
    expect(leaseRequest).not.toHaveBeenCalled()
    expect(logInfo).toHaveBeenCalledWith(
      'approval',
      'Protected native approval confirmation was not submitted.',
      expect.objectContaining({ reason: 'parent_or_sender_unavailable_after_runtime_ensure' })
    )
  })

  it('revalidates a policy approval sender after Runtime lease acquisition', async () => {
    const mainFrame = { processId: 10, routingId: 20, detached: false, url: 'http://127.0.0.1:5173/index.html' }
    const contents = { id: 7, mainFrame, isDestroyed: () => false }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    const leaseGate = createGate()
    const leaseRequest = vi.fn(async () => ({ ok: true, status: 200, body: '{}' }))
    const acquireRuntimeRequestLease = vi.fn(async () => {
      await leaseGate.promise
      return { runtimeToken: 'lease-token', request: leaseRequest }
    })
    registerAppIpcHandlers(registerOptions({
      getMainWindow: () => mainWindow as never,
      acquireRuntimeRequestLease
    }))

    const decision = handlers.get('approval:decide')?.({
      sender: contents,
      senderFrame: mainFrame
    }, {
      approvalId: 'approval-policy-during-ensure',
      decision: 'allow',
      source: 'policy'
    })
    await vi.waitFor(() => expect(acquireRuntimeRequestLease).toHaveBeenCalledOnce())
    contents.mainFrame = { processId: 11, routingId: 21, detached: false, url: 'http://127.0.0.1:5173/index.html' }
    leaseGate.release()

    await expect(decision).resolves.toEqual({ confirmed: false })
    expect(leaseRequest).not.toHaveBeenCalled()
    expect(electronMock.showMessageBox).not.toHaveBeenCalled()
  })

  it('returns a safe Runtime failure when approval lease acquisition fails', async () => {
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    const contents = { id: 7, mainFrame, isDestroyed: () => false }
    const mainWindow = { isDestroyed: () => false, webContents: contents }
    const logError = vi.fn()
    registerAppIpcHandlers(registerOptions({
      getMainWindow: () => mainWindow as never,
      acquireRuntimeRequestLease: vi.fn(async () => {
        throw new Error('/Users/private-user/.kun/runtime failed to start')
      }),
      logError
    }))

    const result = await handlers.get('approval:decide')?.({
      sender: contents,
      senderFrame: mainFrame
    }, {
      approvalId: 'approval-lease-failed',
      decision: 'deny',
      source: 'policy'
    }) as { confirmed: boolean; response: { ok: boolean; body: string } }

    expect(result.confirmed).toBe(true)
    expect(result.response.ok).toBe(false)
    expect(result.response.body).toContain('runtime_unhealthy')
    expect(result.response.body).not.toContain('private-user')
    expect(logError).toHaveBeenCalledWith(
      'approval',
      'Protected approval Runtime lease acquisition failed.',
      expect.objectContaining({
        approvalRef: expect.stringMatching(/^sha256:/),
        errorType: 'Error'
      })
    )
    expect(JSON.stringify(logError.mock.calls)).not.toContain('private-user')
  })

})
