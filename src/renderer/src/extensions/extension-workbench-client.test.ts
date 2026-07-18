import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExtensionWorkbenchClient, ExtensionWorkbenchClientError } from './extension-workbench-client'

function workbenchTransport(overrides: Record<string, unknown> = {}) {
  return {
    getWorkbench: vi.fn(async () => ({ ok: false, status: 500, body: '{}' })),
    listModelProviders: vi.fn(async () => ({ ok: false, status: 500, body: '{}' })),
    listProviderModels: vi.fn(async () => ({ ok: false, status: 500, body: '{}' })),
    ...overrides
  }
}

describe('ExtensionWorkbenchClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  it('loads the authenticated sanitized workbench snapshot through the bounded Main bridge', async () => {
    const getWorkbench = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({ schemaVersion: 1, revision: 4, extensions: [] })
    }))
    const client = new ExtensionWorkbenchClient(workbenchTransport({ getWorkbench }))
    await expect(client.loadContributions('/tmp/a b', 'zh-CN')).resolves.toMatchObject({ revision: 4 })
    expect(getWorkbench).toHaveBeenCalledWith({ workspaceRoot: '/tmp/a b', locale: 'zh-CN' })
  })

  it('normalizes runtime errors without leaking an unbounded payload', async () => {
    const client = new ExtensionWorkbenchClient(workbenchTransport({
      getWorkbench: vi.fn(async () => ({
        ok: false,
        status: 403,
        body: JSON.stringify({ code: 'EXTENSION_PERMISSION_DENIED', message: 'denied' })
      }))
    }))
    await expect(client.loadContributions()).rejects.toMatchObject({
      code: 'EXTENSION_PERMISSION_DENIED',
      status: 403,
      message: 'denied'
    } satisfies Partial<ExtensionWorkbenchClientError>)
  })

  it('uses trusted Main bridges for workbench and provider discovery in production', async () => {
    const api = {
      extensionGetWorkbench: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: JSON.stringify({ schemaVersion: 1, revision: 4, extensions: [] })
      })),
      extensionListModelProviders: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: JSON.stringify({ schemaVersion: 1, providers: [] })
      })),
      extensionListProviderModels: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: JSON.stringify({ schemaVersion: 1, models: [] })
      })),
      extensionList: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: JSON.stringify({ schemaVersion: 1, extensions: [] })
      }))
    }
    vi.stubGlobal('window', { kunGui: api })
    const client = new ExtensionWorkbenchClient()

    await expect(client.loadContributions('/workspace', 'zh-CN')).resolves.toMatchObject({ revision: 4 })
    await expect(client.listExtensions('/workspace', 'zh-CN')).resolves.toEqual([])
    await expect(client.listModelProviders('/workspace')).resolves.toEqual([])
    await expect(client.listProviderModels({
      extensionId: 'acme.sample',
      extensionVersion: '1.0.0',
      providerId: 'models',
      accountId: 'account-1',
      workspaceRoot: '/workspace'
    })).resolves.toEqual([])

    expect(api.extensionGetWorkbench).toHaveBeenCalledWith({ workspaceRoot: '/workspace', locale: 'zh-CN' })
    expect(api.extensionList).toHaveBeenCalledWith({
      limit: 500,
      workspaceRoot: '/workspace',
      locale: 'zh-CN'
    })
    expect(api.extensionListModelProviders).toHaveBeenCalledWith({ workspaceRoot: '/workspace' })
    expect(api.extensionListProviderModels).toHaveBeenCalledWith({
      extensionId: 'acme.sample',
      extensionVersion: '1.0.0',
      providerId: 'models',
      accountId: 'account-1',
      workspaceRoot: '/workspace'
    })
  })

  it('posts host-owned View context through the trusted session bridge', async () => {
    const post = vi.fn(async () => ({
      ok: true,
      status: 202,
      body: JSON.stringify({ schemaVersion: 1, accepted: true })
    }))
    vi.stubGlobal('window', { kunGui: { extensionPostViewMessage: post } })
    const client = new ExtensionWorkbenchClient()
    await client.postViewMessage('view_session_1', {
      channel: 'kun.resultPreview.open',
      payload: { schemaVersion: 1, result: { mimeType: 'application/json' } }
    })
    expect(post).toHaveBeenCalledWith({
      sessionId: 'view_session_1',
      channel: 'kun.resultPreview.open',
      payload: { schemaVersion: 1, result: { mimeType: 'application/json' } }
    })
  })

  it('omits an empty workspace scope when creating a View session', async () => {
    const create = vi.fn(async (request: { contributionId: string; workspaceRoot?: string }) => ({
      sessionId: 'view_session_123456',
      nonce: 'n'.repeat(43),
      extensionId: 'acme.sample',
      extensionVersion: '1.0.0',
      contributionId: request.contributionId,
      src: 'kun-extension://acme.sample/index.html',
      partition: 'temporary:view_session_123456'
    }))
    vi.stubGlobal('window', { kunGui: { extensionCreateViewSession: create } })
    const client = new ExtensionWorkbenchClient(workbenchTransport())

    await client.createViewSession('extension:acme.sample/issues', '   ')
    await client.createViewSession('extension:acme.sample/issues', ' /workspace ')
    await client.createViewSession('extension:acme.sample/issues', '/workspace', {
      retryHost: true
    })

    expect(create).toHaveBeenNthCalledWith(1, {
      contributionId: 'extension:acme.sample/issues'
    })
    expect(create).toHaveBeenNthCalledWith(2, {
      contributionId: 'extension:acme.sample/issues',
      workspaceRoot: '/workspace'
    })
    expect(create).toHaveBeenNthCalledWith(3, {
      contributionId: 'extension:acme.sample/issues',
      workspaceRoot: '/workspace',
      retryHost: true
    })
  })

  it('routes every mutating management action through the Main bridge only', async () => {
    const transport = workbenchTransport()
    const ok = { ok: true, status: 200, body: '{}' }
    const api = {
      extensionInstall: vi.fn(async () => ok),
      extensionEnable: vi.fn(async () => ok),
      extensionDisable: vi.fn(async () => ok),
      extensionRollback: vi.fn(async () => ok),
      extensionReload: vi.fn(async () => ok),
      extensionUninstall: vi.fn(async () => ok),
      extensionSetPermissions: vi.fn(async () => ok),
      extensionInvokeCommand: vi.fn(async () => ({ invoked: true }))
    }
    vi.stubGlobal('window', {
      kunGui: api,
      dispatchEvent: vi.fn()
    })
    const client = new ExtensionWorkbenchClient(transport)

    await client.install({ source: 'archive', path: '/tmp/sample.kunx' })
    await client.setEnabled('acme.sample', true, '/workspace')
    await client.setEnabled('acme.sample', false, '/workspace')
    await client.rollback('acme.sample')
    await client.reload('acme.sample')
    await client.uninstall('acme.sample')
    await client.setPermissions('acme.sample', '1.0.0', ['ui.views'], '/workspace')
    await client.setPermissionsAndEnable(
      'acme.sample',
      '1.0.0',
      ['ui.views', 'webview'],
      '/workspace',
      'global'
    )
    await expect(client.invokeCommand(
      'extension:acme.sample/refresh',
      { source: 'topBar' },
      '/workspace'
    )).resolves.toEqual({ invoked: true })

    expect(api.extensionInstall).toHaveBeenCalledWith({ source: 'archive', path: '/tmp/sample.kunx' })
    expect(api.extensionEnable).toHaveBeenCalledWith({ extensionId: 'acme.sample', workspaceRoot: '/workspace' })
    expect(api.extensionDisable).toHaveBeenCalledWith({ extensionId: 'acme.sample', workspaceRoot: '/workspace' })
    expect(api.extensionRollback).toHaveBeenCalledWith({ extensionId: 'acme.sample' })
    expect(api.extensionReload).toHaveBeenCalledWith({ extensionId: 'acme.sample' })
    expect(api.extensionUninstall).toHaveBeenCalledWith({ extensionId: 'acme.sample' })
    expect(api.extensionSetPermissions).toHaveBeenCalledWith({
      extensionId: 'acme.sample',
      expectedVersion: '1.0.0',
      permissions: ['ui.views'],
      workspaceRoot: '/workspace'
    })
    expect(api.extensionSetPermissions).toHaveBeenCalledWith({
      extensionId: 'acme.sample',
      expectedVersion: '1.0.0',
      permissions: ['ui.views', 'webview'],
      workspaceRoot: '/workspace',
      enableAfterApply: 'global'
    })
    expect(api.extensionInvokeCommand).toHaveBeenCalledWith({
      commandId: 'extension:acme.sample/refresh',
      context: { source: 'topBar' },
      workspaceRoot: '/workspace'
    })
    expect(transport.getWorkbench).not.toHaveBeenCalled()
    expect(transport.listModelProviders).not.toHaveBeenCalled()
    expect(transport.listProviderModels).not.toHaveBeenCalled()
  })

  it('uses only protected Main account bridges and parses redacted projections', async () => {
    const transport = workbenchTransport()
    const account = {
      id: 'account_1',
      providerId: 'ext-provider',
      label: 'Work account',
      authenticationType: 'api-key',
      status: 'connected',
      metadata: {},
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z',
      protection: 'system'
    }
    const pendingSession = {
      id: 'accountsession_1',
      status: 'pending',
      verificationUrl: 'https://auth.example.test/authorize',
      expiresAt: '2026-07-11T00:10:00.000Z'
    }
    const api = {
      extensionListAccounts: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: JSON.stringify({
          schemaVersion: 1,
          accounts: [account],
          protection: { mode: 'system', degraded: false, available: true }
        })
      })),
      extensionCreateAccountSession: vi.fn(async () => ({
        ok: true,
        status: 201,
        body: JSON.stringify({ schemaVersion: 1, session: pendingSession })
      })),
      extensionGetAccountSession: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: JSON.stringify({ schemaVersion: 1, session: pendingSession })
      })),
      extensionCompleteAccountSession: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: JSON.stringify({
          schemaVersion: 1,
          session: { id: pendingSession.id, status: 'completed', account }
        })
      })),
      extensionCancelAccountSession: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: JSON.stringify({ schemaVersion: 1, cancelled: true })
      })),
      extensionCreateApiKeyAccount: vi.fn(async () => ({
        ok: true,
        status: 201,
        body: JSON.stringify({ schemaVersion: 1, account })
      })),
      extensionDeleteAccount: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: JSON.stringify({ schemaVersion: 1, deleted: true })
      }))
    }
    vi.stubGlobal('window', { kunGui: api, dispatchEvent: vi.fn() })
    const client = new ExtensionWorkbenchClient(transport)

    await expect(client.listAccounts('acme.sample', 'acme-models')).resolves.toMatchObject({
      accounts: [{ id: 'account_1', label: 'Work account' }],
      protection: { mode: 'system', degraded: false, available: true }
    })
    await expect(client.createAccountSession({
      extensionId: 'acme.sample',
      extensionVersion: '1.0.0',
      providerId: 'acme-models',
      authenticationProviderId: 'acme-oauth'
    })).resolves.toMatchObject({ id: 'accountsession_1', status: 'pending' })
    await expect(client.getAccountSession('acme.sample', 'accountsession_1')).resolves.toMatchObject({
      status: 'pending'
    })
    await expect(client.completeAccountSession({
      extensionId: 'acme.sample',
      extensionVersion: '1.0.0',
      sessionId: 'accountsession_1',
      workspaceRoot: '/workspace'
    })).resolves.toMatchObject({
      status: 'completed',
      account: { id: 'account_1' }
    })
    await client.cancelAccountSession('acme.sample', 'accountsession_1')
    await expect(client.createApiKeyAccount({
      extensionId: 'acme.sample',
      extensionVersion: '1.0.0',
      providerId: 'acme-models',
      authenticationProviderId: 'acme-api-key',
      label: 'Work account',
      workspaceRoot: '/workspace'
    })).resolves.toMatchObject({ id: 'account_1' })
    await client.deleteAccount({
      extensionId: 'acme.sample',
      extensionVersion: '1.0.0',
      accountId: 'account_1',
      providerId: 'acme-models',
      workspaceRoot: '/workspace'
    })

    expect(api.extensionListAccounts).toHaveBeenCalledWith({
      extensionId: 'acme.sample',
      providerId: 'acme-models',
      includeUnavailable: true
    })
    expect(api.extensionCreateAccountSession).toHaveBeenCalledWith({
      extensionId: 'acme.sample',
      extensionVersion: '1.0.0',
      providerId: 'acme-models',
      authenticationProviderId: 'acme-oauth'
    })
    expect(api.extensionCreateApiKeyAccount).toHaveBeenCalledWith({
      extensionId: 'acme.sample',
      extensionVersion: '1.0.0',
      providerId: 'acme-models',
      authenticationProviderId: 'acme-api-key',
      label: 'Work account',
      workspaceRoot: '/workspace'
    })
    expect(api.extensionCompleteAccountSession).toHaveBeenCalledWith({
      extensionId: 'acme.sample',
      extensionVersion: '1.0.0',
      sessionId: 'accountsession_1',
      workspaceRoot: '/workspace'
    })
    expect(api.extensionDeleteAccount).toHaveBeenCalledWith({
      extensionId: 'acme.sample',
      extensionVersion: '1.0.0',
      accountId: 'account_1',
      providerId: 'acme-models',
      workspaceRoot: '/workspace'
    })
    expect(transport.getWorkbench).not.toHaveBeenCalled()
    expect(transport.listModelProviders).not.toHaveBeenCalled()
    expect(transport.listProviderModels).not.toHaveBeenCalled()
    const accountCalls = [
      ...api.extensionCreateAccountSession.mock.calls,
      ...api.extensionCompleteAccountSession.mock.calls,
      ...api.extensionCreateApiKeyAccount.mock.calls,
      ...api.extensionDeleteAccount.mock.calls
    ]
    expect(JSON.stringify(accountCalls)).not.toContain('secret')
    expect(JSON.stringify(accountCalls)).not.toContain('consentRequestId')
  })
})
