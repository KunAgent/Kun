import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultKunRuntimeSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import {
  LegacyProviderSettingsMigrationCoordinator,
  projectRegistryCredentials,
  resolveProjectedRegistryCredential
} from './legacy-provider-settings-migration'
import { JsonSettingsStore } from './settings-store'
import { refreshStoredCodexOAuthCredentials } from '../../kun/src/services/codex-oauth-credential-refresher.js'
import { createWorkflowRuntime } from './workflow-runtime'
import {
  cleanupAppIpcHandlerTestState,
  handlers,
  registerOptions,
  resetAppIpcHandlerTestState,
  settings
} from './ipc/register-app-ipc-handlers.test-support'
import { registerAppIpcHandlers } from './ipc/register-app-ipc-handlers'

vi.mock('./main-window', () => ({
  trustedWorkbenchRendererUrl: () => 'http://127.0.0.1:5173/index.html'
}))

const STORED = { authoritative: true as const, apiKey: 'stored-codex-oauth' }

async function settingsWithProviders(dataDir: string): Promise<AppSettingsV1> {
  const defaults = await new JsonSettingsStore(await mkdtemp(join(tmpdir(), 'kun-oauth-proj-'))).load()
  const base = defaults.provider.providers[0]!
  return {
    ...defaults,
    provider: {
      ...defaults.provider,
      providers: [
        { ...base, id: 'kimi-code', name: 'Kimi', apiKey: 'kimi-key' },
        { ...base, id: 'codex', name: 'Codex', apiKey: '' }
      ]
    },
    agents: {
      ...defaults.agents,
      kun: { ...defaultKunRuntimeSettings(), ...defaults.agents.kun, dataDir, providerId: 'kimi-code' }
    }
  }
}

describe('stale Codex OAuth must not poison other providers', () => {
  it('skips token refresh when projecting stored credentials', async () => {
    const refresh = vi.fn(async () => 'refreshed')
    await expect(resolveProjectedRegistryCredential(STORED, refresh, { refreshOAuth: false }))
      .resolves.toEqual(STORED)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('returns stored credentials when OAuth refresh throws', async () => {
    const refresh = vi.fn(async () => {
      throw new Error('Codex subscription token refresh failed (401)')
    })
    await expect(resolveProjectedRegistryCredential(STORED, refresh)).resolves.toEqual(STORED)
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('projects Kimi when Codex refresh fails for an unrequested provider', async () => {
    const defaults = await new JsonSettingsStore(await mkdtemp(join(tmpdir(), 'kun-oauth-iso-'))).load()
    const base = defaults.provider.providers[0]!
    const settingsValue: AppSettingsV1 = {
      ...defaults,
      provider: {
        ...defaults.provider,
        providers: [
          { ...base, id: 'kimi-code', name: 'Kimi', apiKey: 'kimi-stale' },
          { ...base, id: 'codex', name: 'Codex', apiKey: '' }
        ]
      }
    }
    const projected = await projectRegistryCredentials(settingsValue, async (providerId) => {
      if (providerId === 'codex') {
        throw new Error('Codex subscription token refresh failed (401)')
      }
      return { authoritative: true, apiKey: 'kimi-live' }
    })
    expect(projected.provider.providers.find((provider) => provider.id === 'kimi-code')?.apiKey)
      .toBe('kimi-live')
    expect(projected.provider.providers.find((provider) => provider.id === 'codex')?.apiKey)
      .toBe('')
  })

  it('does not refresh OAuth for settings-style projection', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-oauth-skip-'))
    const refresh = vi.fn()
    const coordinator = new LegacyProviderSettingsMigrationCoordinator(async () => ({
      modelConnections: {} as never,
      resolveRegistryCredential: async (_providerId, options) => {
        if (options?.refreshOAuth !== false) refresh()
        return { authoritative: true, apiKey: 'kimi-live' }
      },
      service: { resolveApiKey: async () => null } as never
    }))
    const projected = await coordinator.withRegistryCredentials(
      await settingsWithProviders(dataDir),
      undefined,
      { refreshOAuth: false }
    )
    expect(refresh).not.toHaveBeenCalled()
    expect(projected.provider.providers.find((provider) => provider.id === 'kimi-code')?.apiKey)
      .toBe('kimi-live')
    await coordinator.withRegistryCredentials(await settingsWithProviders(dataDir))
    expect(refresh).toHaveBeenCalled()
  })

  it('keeps a live token projection when refresh succeeds', async () => {
    await expect(resolveProjectedRegistryCredential(STORED, async () => 'new-access'))
      .resolves.toEqual({ authoritative: true, apiKey: 'new-access' })
  })

  it('still fails a Codex token refresh at request time', async () => {
    const credentials = {
      kind: 'codex-oauth' as const,
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: 1,
      accountId: 'acct-old'
    }
    const failingFetch = vi.fn(async () => Response.json(
      { error: 'invalid_grant' },
      { status: 401 }
    )) as unknown as typeof fetch
    await expect(refreshStoredCodexOAuthCredentials(credentials, failingFetch))
      .rejects.toThrow('Codex subscription token refresh failed (401)')
  })
})

describe('settings:get skips OAuth refresh', () => {
  beforeEach(resetAppIpcHandlerTestState)
  afterEach(cleanupAppIpcHandlerTestState)

  it('loads settings without refreshing provider OAuth', async () => {
    const current = settings()
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    const contents = { id: 7, mainFrame }
    const withRegistryCredentials = vi.fn(async (value: AppSettingsV1) => value)
    registerAppIpcHandlers(registerOptions({
      store: { load: vi.fn(async () => current) } as never,
      getMainWindow: () => ({ isDestroyed: () => false, webContents: contents }) as never,
      withRegistryCredentials
    }))

    await expect(handlers.get('settings:get')?.({ sender: contents, senderFrame: mainFrame }))
      .resolves.toMatchObject({ version: 1 })
    expect(withRegistryCredentials).toHaveBeenCalledWith(current, undefined, { refreshOAuth: false })
  })
})

describe('workflow loadSettings skips OAuth refresh', () => {
  it('can list workflows when Codex refresh would fail', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-oauth-wf-'))
    const coordinator = new LegacyProviderSettingsMigrationCoordinator(async () => ({
      modelConnections: {} as never,
      resolveRegistryCredential: async (_providerId, options) => {
        if (options?.refreshOAuth !== false) {
          throw new Error('Codex subscription token refresh failed (401)')
        }
        return { authoritative: true, apiKey: 'kimi-live' }
      },
      service: { resolveApiKey: async () => null } as never
    }))
    const initial = await settingsWithProviders(dataDir)
    const store = {
      load: async () => initial,
      patch: async () => initial,
      update: async (
        mutation: (settings: AppSettingsV1) => AppSettingsV1 | Promise<AppSettingsV1>
      ) => mutation(initial)
    }
    const runtime = createWorkflowRuntime({
      store: store as never,
      withModelCredentials: (settingsValue) =>
        coordinator.withRegistryCredentials(settingsValue, undefined, { refreshOAuth: false }),
      runtimeRequest: vi.fn() as never,
      logError: vi.fn()
    })
    await expect(runtime.runWorkflowForTool('missing-workflow')).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('No agent-callable workflow')
    })
  })
})
