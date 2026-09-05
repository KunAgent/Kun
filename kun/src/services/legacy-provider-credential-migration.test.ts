import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ExtensionCredentialStore } from './extension-credential-store.js'
import type { ExtensionPrincipal } from './extension-agent-service.js'
import { ExtensionProviderAccountStore } from './extension-provider-account-store.js'
import {
  LegacyProviderCredentialMigrationService,
  materializeLegacyProviderCredential
} from './legacy-provider-credential-migration.js'

describe('LegacyProviderCredentialMigrationService', () => {
  it('migrates secret-first, reuses markers, and preserves distinct overrides', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-legacy-credential-'))
    const accounts = new ExtensionProviderAccountStore({
      dataDir,
      nowIso: () => '2026-07-11T00:00:00.000Z'
    })
    const credentials = new ExtensionCredentialStore({ dataDir, profileId: 'default' })
    const migration = new LegacyProviderCredentialMigrationService({
      dataDir,
      accounts,
      credentials,
      nowIso: () => '2026-07-11T00:00:00.000Z'
    })
    const sources = [{
      sourceId: 'provider:deepseek',
      providerId: 'deepseek',
      providerName: 'DeepSeek',
      label: 'Provider profile',
      apiKey: 'provider-secret',
      modelId: 'deepseek-chat'
    }, {
      sourceId: 'runtime:kun',
      providerId: 'deepseek',
      providerName: 'DeepSeek',
      label: 'Kun runtime override',
      apiKey: 'runtime-secret'
    }]

    const first = await migration.migrate(sources)
    expect(first).toHaveLength(2)
    expect(first[0]?.accountId).not.toBe(first[1]?.accountId)
    expect(first.every((entry) => entry.removePlaintext && !entry.reused)).toBe(true)
    await migration.markSettingsCommitted(first.map((entry) => entry.sourceId))
    const second = await migration.migrate(sources)
    expect(second.map((entry) => entry.accountId)).toEqual(first.map((entry) => entry.accountId))
    expect(second.every((entry) => entry.reused)).toBe(true)

    const markers = await readFile(
      join(dataDir, 'extensions', 'legacy-credential-migrations.json'),
      'utf8'
    )
    expect(markers).not.toContain('provider-secret')
    expect(markers).not.toContain('runtime-secret')
    expect(await migration.listBindings()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: 'provider:deepseek',
        providerId: 'deepseek',
        accountId: first[0]?.accountId,
        modelId: 'deepseek-chat',
        phase: 'settings-committed'
      })
    ]))
  })

  it('shares an account for the same provider secret but preserves different secrets', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-legacy-credential-'))
    const accounts = new ExtensionProviderAccountStore({ dataDir })
    const credentials = new ExtensionCredentialStore({ dataDir, profileId: 'default' })
    const migration = new LegacyProviderCredentialMigrationService({ dataDir, accounts, credentials })

    const results = await migration.migrate([
      providerSource('provider:one', 'same-secret'),
      providerSource('runtime:same', 'same-secret'),
      providerSource('runtime:different', 'different-secret')
    ])

    expect(results[0]?.accountId).toBe(results[1]?.accountId)
    expect(results[2]?.accountId).not.toBe(results[0]?.accountId)
  })

  it('keeps a stable account for an explicit replacement and rolls back a failed settings commit', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-legacy-credential-'))
    const accounts = new ExtensionProviderAccountStore({ dataDir })
    const credentials = new ExtensionCredentialStore({ dataDir, profileId: 'default' })
    const migration = new LegacyProviderCredentialMigrationService({ dataDir, accounts, credentials })
    const [initial] = await migration.migrate([providerSource('provider:deepseek', 'old-secret')])
    await migration.markSettingsCommitted([initial!.sourceId])

    const [replacement] = await migration.migrate(
      [providerSource('provider:deepseek', 'new-secret')],
      { replaceCommitted: true }
    )
    expect(replacement?.accountId).toBe(initial?.accountId)
    expect((await migration.resolveApiKey('provider:deepseek'))?.apiKey).toBe('new-secret')

    await migration.rollbackPending(['provider:deepseek'])
    expect((await migration.resolveApiKey('provider:deepseek'))?.apiKey).toBe('old-secret')
    expect((await migration.listBindings())[0]?.phase).toBe('settings-committed')
  })

  it('ignores plaintext restored from an old backup after settings commit', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-legacy-credential-'))
    const accounts = new ExtensionProviderAccountStore({ dataDir })
    const credentials = new ExtensionCredentialStore({ dataDir, profileId: 'default' })
    const migration = new LegacyProviderCredentialMigrationService({ dataDir, accounts, credentials })
    const [initial] = await migration.migrate([providerSource('provider:deepseek', 'secure-newer')])
    await migration.markSettingsCommitted([initial!.sourceId])

    const [stale] = await migration.migrate([providerSource('provider:deepseek', 'stale-backup')])
    expect(stale?.ignoredStalePlaintext).toBe(true)
    expect(stale?.accountId).toBe(initial?.accountId)
    expect((await migration.resolveApiKey('provider:deepseek'))?.apiKey).toBe('secure-newer')
  })

  it('preserves the account and binding while its provider is unavailable', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-legacy-credential-'))
    const accounts = new ExtensionProviderAccountStore({ dataDir })
    const credentials = new ExtensionCredentialStore({ dataDir, profileId: 'default' })
    const migration = new LegacyProviderCredentialMigrationService({ dataDir, accounts, credentials })
    const [result] = await migration.migrate([providerSource('provider:deepseek', 'kept-secret')])
    await migration.markSettingsCommitted([result!.sourceId])

    await accounts.unregisterProvider(corePrincipal(), 'deepseek')
    expect((await accounts.getAccount(result!.accountId))?.status).toBe('unavailable')
    expect(await migration.resolveApiKey('provider:deepseek')).toBeNull()
    expect(await migration.listBindings()).toEqual([
      expect.objectContaining({ sourceId: 'provider:deepseek', accountId: result!.accountId })
    ])

    await accounts.upsertCoreProvider({ id: 'deepseek', displayName: 'DeepSeek' })
    expect((await migration.resolveApiKey('provider:deepseek'))?.apiKey).toBe('kept-secret')
  })

  it('forgets settings-committed bindings so hydrate cannot resurrect a cleared key', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-legacy-credential-forget-'))
    const accounts = new ExtensionProviderAccountStore({ dataDir })
    const credentials = new ExtensionCredentialStore({ dataDir, profileId: 'default' })
    const migration = new LegacyProviderCredentialMigrationService({ dataDir, accounts, credentials })
    const [initial] = await migration.migrate([providerSource('provider:deepseek', 'forget-me')])
    await migration.markSettingsCommitted([initial!.sourceId])
    expect((await migration.resolveApiKey('provider:deepseek'))?.apiKey).toBe('forget-me')

    await migration.forgetSources(['provider:deepseek'])
    expect(await migration.resolveApiKey('provider:deepseek')).toBeNull()
    expect(await migration.listBindings()).toEqual([])
    expect(await accounts.getAccount(initial!.accountId)).toBeNull()
  })

  it('keeps a shared account when forgetting only one of two sources', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-legacy-credential-forget-shared-'))
    const accounts = new ExtensionProviderAccountStore({ dataDir })
    const credentials = new ExtensionCredentialStore({ dataDir, profileId: 'default' })
    const migration = new LegacyProviderCredentialMigrationService({ dataDir, accounts, credentials })
    const results = await migration.migrate([
      providerSource('provider:one', 'shared-secret'),
      providerSource('runtime:same', 'shared-secret')
    ])
    await migration.markSettingsCommitted(results.map((entry) => entry.sourceId))
    expect(results[0]?.accountId).toBe(results[1]?.accountId)

    await migration.forgetSources(['provider:one'])
    expect(await migration.resolveApiKey('provider:one')).toBeNull()
    expect((await migration.resolveApiKey('runtime:same'))?.apiKey).toBe('shared-secret')
    expect(await accounts.getAccount(results[0]!.accountId)).not.toBeNull()
  })

  it('updates a resolved credential in place without changing its migration marker', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-legacy-credential-refresh-'))
    const accounts = new ExtensionProviderAccountStore({ dataDir })
    const credentials = new ExtensionCredentialStore({ dataDir, profileId: 'default' })
    const migration = new LegacyProviderCredentialMigrationService({ dataDir, accounts, credentials })
    const [initial] = await migration.migrate([providerSource('provider:grok', 'old-oauth-json')])
    await migration.markSettingsCommitted([initial!.sourceId])
    const markerBefore = await readFile(
      join(dataDir, 'extensions', 'legacy-credential-migrations.json'),
      'utf8'
    )

    await expect(
      migration.updateResolvedApiKey(
        'provider:grok',
        'old-oauth-json',
        'refreshed-oauth-json'
      )
    ).resolves.toBe(true)

    expect((await migration.resolveApiKey('provider:grok'))?.apiKey).toBe('refreshed-oauth-json')
    expect(await readFile(
      join(dataDir, 'extensions', 'legacy-credential-migrations.json'),
      'utf8'
    )).toBe(markerBefore)

    // The GUI main process may still hold the pre-refresh settings snapshot.
    // A later unrelated settings save must not restore that stale token.
    await migration.migrate(
      [providerSource('provider:grok', 'old-oauth-json')],
      { replaceCommitted: true }
    )
    expect((await migration.resolveApiKey('provider:grok'))?.apiKey).toBe('refreshed-oauth-json')
  })
})

describe('materializeLegacyProviderCredential', () => {
  it('unwraps Codex OAuth credentials into access token + ChatGPT headers', () => {
    const material = materializeLegacyProviderCredential(JSON.stringify({
      kind: 'codex-oauth',
      accessToken: 'codex-access',
      refreshToken: 'refresh',
      accountId: 'acct_1',
      expiresAt: Date.now() + 60_000
    }))
    expect(material.apiKey).toBe('codex-access')
    expect(material.headers).toMatchObject({
      'ChatGPT-Account-Id': 'acct_1',
      originator: 'codex_cli_rs',
      'OpenAI-Beta': 'responses=experimental'
    })
    expect(material.headers?.['User-Agent']).toMatch(/^codex_cli_rs\/0\.153\.3 \(.+; .+\)$/)
    expect(material.headers?.['User-Agent']).not.toMatch(/deepseekgui|kun/i)
    expect(material.headers?.['x-grok-client-identifier']).toBeUndefined()
  })

  it('unwraps Grok OAuth credentials into access token + cli-chat-proxy headers', () => {
    const material = materializeLegacyProviderCredential(JSON.stringify({
      kind: 'grok-oauth',
      accessToken: 'grok-access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 60_000,
      email: 'user@x.ai'
    }))
    expect(material).toEqual({
      apiKey: 'grok-access',
      headers: {
        'X-XAI-Token-Auth': 'xai-grok-cli',
        'x-authenticateresponse': 'authenticate-response',
        'x-grok-client-version': '0.2.112',
        'x-grok-client-mode': 'interactive'
      }
    })
  })

  it('unwraps Gemini Code Assist OAuth without losing refresh material', () => {
    const material = materializeLegacyProviderCredential(JSON.stringify({
      kind: 'gemini-oauth',
      accessToken: 'gemini-access',
      refreshToken: 'gemini-refresh',
      expiresAt: Date.now() + 60_000,
      projectId: 'project-1',
      userTier: 'standard'
    }))

    expect(material).toMatchObject({
      apiKey: 'gemini-access',
      geminiAuth: {
        kind: 'gemini-oauth',
        accessToken: 'gemini-access',
        refreshToken: 'gemini-refresh',
        projectId: 'project-1'
      }
    })
  })
})

function providerSource(sourceId: string, apiKey: string) {
  return {
    sourceId,
    providerId: 'deepseek',
    providerName: 'DeepSeek',
    label: sourceId,
    apiKey,
    modelId: 'deepseek-chat'
  }
}

function corePrincipal(): ExtensionPrincipal {
  return {
    extensionId: 'kun.core',
    extensionVersion: '1',
    permissions: [
      'providers.register',
      'accounts.read',
      'accounts.manage:deepseek',
      'accounts.use:deepseek'
    ],
    workspaceRoots: [],
    workspaceTrusted: true
  }
}
