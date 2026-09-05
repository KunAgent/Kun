import { describe, expect, it, vi } from 'vitest'

vi.mock('./ipc/app-ipc-handler-utils', () => ({
  assertTrustedWorkbenchSender: vi.fn()
}))

import type { BuiltinGitHubMcpIdentity } from '../shared/github-mcp-authorization'
import { normalizeAppSettings, type AppSettingsV1 } from '../shared/app-settings'
import { registerBuiltinGitHubMcpAuthorizationIpc } from './github-mcp-authorization-ipc'

type Handler = (event: unknown, payload?: unknown) => Promise<unknown> | unknown

const identity: BuiltinGitHubMcpIdentity = {
  source: 'github-cli',
  host: 'github.com',
  login: 'octocat',
  scopes: ['repo', 'read:org'],
  fingerprint: 'a'.repeat(64)
}

function harness(preview: BuiltinGitHubMcpIdentity | null = identity) {
  const applySettingsPatch = vi.fn(async () => undefined)
  const handlers = new Map<string, Handler>()
  const frame = { processId: 1, routingId: 2, url: 'http://127.0.0.1:5173/' }
  const webContents = { id: 1, mainFrame: frame }
  const previewCredential = vi.fn(async () => preview ?? undefined)
  const launchLogin = vi.fn(async () => ({ started: true as const }))
  registerBuiltinGitHubMcpAuthorizationIpc({
    ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) } as never,
    getMainWindow: () => ({ isDestroyed: () => false, webContents }) as never,
    getSettings: async () => normalizeAppSettings({} as AppSettingsV1),
    applySettingsPatch,
    previewCredential,
    launchLogin,
    assertSender: () => undefined,
    createNonce: () => 'nonce'
  })
  return {
    handlers,
    event: { sender: webContents, senderFrame: frame },
    applySettingsPatch,
    launchLogin
  }
}

describe('registerBuiltinGitHubMcpAuthorizationIpc', () => {
  it('binds nonce to identity and persists the reviewed policy', async () => {
    const { handlers, event, applySettingsPatch } = harness()
    await expect(handlers.get('github-mcp:authorization:preflight')?.(event, 'github.com'))
      .resolves.toEqual({
        status: 'ready', nonce: 'nonce', identity,
        enabled: false, allowedOrganizations: [], allowedRepositories: []
      })
    await expect(handlers.get('github-mcp:authorization:confirm')?.(event, {
      nonce: 'nonce',
      allowedHosts: ['github.com'],
      allowedOrganizations: ['Acme'],
      allowedRepositories: ['Acme/Web']
    })).resolves.toEqual({ authorized: true })
    expect(applySettingsPatch).toHaveBeenCalledWith({
      agents: { kun: { githubMcp: expect.objectContaining({
        enabled: true,
        githubHost: 'github.com',
        authorization: identity,
        allowedOrganizations: ['acme'],
        allowedRepositories: ['acme/web']
      }) } }
    })
  })

  it('starts login only after explicit IPC request', async () => {
    const { handlers, event, launchLogin } = harness(null)
    await expect(handlers.get('github-mcp:authorization:login')?.(event, 'github.com'))
      .resolves.toEqual({ started: true })
    expect(launchLogin).toHaveBeenCalledWith('github.com')
  })

  it('rejects unsupported enterprise hosts before preview or login', async () => {
    const { handlers, event, launchLogin } = harness(null)
    await expect(handlers.get('github-mcp:authorization:preflight')?.(event, 'github.enterprise.test'))
      .resolves.toEqual({ status: 'missing', host: 'github.enterprise.test' })
    await expect(handlers.get('github-mcp:authorization:login')?.(event, 'github.enterprise.test'))
      .resolves.toEqual({ started: false, reason: 'unsupported-host' })
    expect(launchLogin).not.toHaveBeenCalled()
  })

  it('rejects confirmation when the GitHub identity changes after preview', async () => {
    let current: BuiltinGitHubMcpIdentity | undefined = identity
    const applySettingsPatch = vi.fn(async () => undefined)
    const handlers = new Map<string, Handler>()
    registerBuiltinGitHubMcpAuthorizationIpc({
      ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) } as never,
      getMainWindow: () => null,
      getSettings: async () => normalizeAppSettings({} as AppSettingsV1),
      applySettingsPatch,
      previewCredential: async () => current,
      assertSender: () => undefined,
      createNonce: () => 'nonce'
    })
    const event = {}
    await handlers.get('github-mcp:authorization:preflight')?.(event)
    current = { ...identity, fingerprint: 'b'.repeat(64) }
    await expect(handlers.get('github-mcp:authorization:confirm')?.(event, {
      nonce: 'nonce', allowedHosts: [], allowedOrganizations: [], allowedRepositories: []
    })).resolves.toEqual({ authorized: false, reason: 'identity-changed' })
    expect(applySettingsPatch).not.toHaveBeenCalled()
  })

  it('keeps missing credentials disabled and supports explicit disable', async () => {
    const { handlers, event, applySettingsPatch } = harness(null)
    await expect(handlers.get('github-mcp:authorization:preflight')?.(event))
      .resolves.toEqual({ status: 'missing', host: 'github.com' })
    await expect(handlers.get('github-mcp:authorization:disable')?.(event))
      .resolves.toEqual({ disabled: true })
    expect(applySettingsPatch).toHaveBeenCalledWith({
      agents: { kun: { githubMcp: { enabled: false, authorization: null } } }
    })
  })
})
